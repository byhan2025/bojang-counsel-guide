// =====================================================================
// 보장분석 라이프 리포트 v5.4 — PG 웹훅 (billing-webhook)
//
// POST /functions/v1/billing-webhook          (verify_jwt = false · 서명으로 인증)
//   지원: 토스페이먼츠(tosspayments-webhook-signature), 포트원/Standard Webhooks(webhook-signature)
//   서명 검증 실패 → 401, 처리 성공/중복 → 200, 형식 오류 → 422
//
// 멱등: audit_logs.dedupe_key(unique) 에 `provider:eventId` 를 넣어 두 번 와도 한 번만 반영합니다.
// 상태 전이: 결제 성공 → active(+기간 연장) / 실패 → past_due(3일 유예) / 해지·환불 → canceled
// =====================================================================
import { fail, json, preflight, sha256Hex } from "../_shared/http.ts";
import { admin, audit, env } from "../_shared/supabase.ts";

type Kind = "paid" | "failed" | "canceled" | "refunded" | "ignored";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacB64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToB64(new Uint8Array(sig));
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 서명 후보를 모두 시도합니다(벤더별 헤더·payload 조합 차이를 흡수). */
async function verifySignature(req: Request, raw: string): Promise<boolean> {
  const secret = env("PG_WEBHOOK_SECRET");
  if (!secret) return false;

  const stdId = req.headers.get("webhook-id") ?? "";
  const stdTs = req.headers.get("webhook-timestamp") ?? "";
  const stdSig = req.headers.get("webhook-signature") ?? "";
  const tossSig = req.headers.get("tosspayments-webhook-signature") ?? "";
  const tossTs = req.headers.get("tosspayments-webhook-transmission-time") ?? "";

  const provided: string[] = [];
  for (const s of [stdSig, tossSig]) {
    if (!s) continue;
    for (const part of s.split(" ")) {
      const v = part.includes(",") ? part.split(",").pop() ?? "" : part;
      if (v) provided.push(v.replace(/^v1[=,]/i, "").trim());
    }
  }
  if (!provided.length) return false;

  const messages = [raw];
  if (stdId && stdTs) messages.push(`${stdId}.${stdTs}.${raw}`);
  if (stdTs) messages.push(`${stdTs}.${raw}`);
  if (stdId) messages.push(`${stdId}.${raw}`);

  /* 벤더마다 서명 표기(base64/hex)가 달라 두 형태를 모두 비교합니다. */
  const forms: string[] = [];
  for (const p of provided) {
    forms.push(p);
    try {
      forms.push(bytesToHex(b64ToBytes(p)));
    } catch { /* base64 아님 */ }
    if (/^[0-9a-f]+$/i.test(p) && p.length % 2 === 0) {
      forms.push(bytesToHex(hexToBytes(p)));
    }
  }

  for (const m of messages) {
    const candidates = [await hmacB64(secret, m), await hmacHex(secret, m)];
    for (const c of candidates) {
      for (const f of forms) if (timingSafeEqual(c, f)) return true;
    }
  }
  return false;
}

type Evt = Record<string, unknown>;

function pick(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function classify(evt: Evt): { kind: Kind; eventId: string; provider: "toss" | "portone"; billingKey?: string; customerKey?: string; userId?: string; amount?: number } {
  const provider = (String(evt.provider ?? "") || (evt.eventType ? "toss" : "portone")) === "toss" ? "toss" : "portone";
  const eventId = String(evt.eventId ?? evt.id ?? pick(evt, "data.paymentId") ?? pick(evt, "data.paymentKey") ?? "");
  const billingKey = String(pick(evt, "data.billingKey") ?? pick(evt, "data.billing_key") ?? "") || undefined;
  const customerKey = String(pick(evt, "data.customerKey") ?? pick(evt, "data.customerId") ?? "") || undefined;
  const userId = String(pick(evt, "data.metadata.userId") ?? pick(evt, "data.metadata.user_id") ?? "") || undefined;
  const amountRaw = pick(evt, "data.totalAmount") ?? pick(evt, "data.amount.total") ?? pick(evt, "data.amount");
  const amount = typeof amountRaw === "number" ? amountRaw : undefined;

  const status = String(pick(evt, "data.status") ?? "").toUpperCase();
  const type = String(evt.type ?? evt.eventType ?? "");

  let kind: Kind = "ignored";
  if (/CANCEL|CANCELED|CANCELLED|취소/i.test(type) || status === "CANCELED") kind = "canceled";
  else if (/REFUND/i.test(type)) kind = "refunded";
  else if (/FAIL|ABORT/i.test(type) || status === "ABORTED" || status === "FAILED") kind = "failed";
  else if (/PAID|DONE|APPROVED|SUCCEED/i.test(type) || status === "DONE" || status === "PAID") kind = "paid";
  else if (/DELETED/i.test(type)) kind = "canceled";

  return { kind, eventId, provider, billingKey, customerKey, userId, amount };
}

function addCycle(from: Date, cycle: string | null): Date {
  const d = new Date(from.getTime());
  if (cycle === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

type SubRow = { id: string; user_id: string; status: string; billing_cycle: string | null; current_period_end: string | null };

async function findSubscription(info: ReturnType<typeof classify>): Promise<SubRow | null> {
  let q = admin().from("subscriptions").select("id, user_id, status, billing_cycle, current_period_end");
  if (info.billingKey) q = q.eq("billing_key", info.billingKey);
  else if (info.customerKey) q = q.eq("customer_key", info.customerKey);
  else if (info.userId) q = q.eq("user_id", info.userId);
  else return null;
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  return (data as SubRow | null) ?? null;
}

async function applyEvent(info: ReturnType<typeof classify>): Promise<string> {
  const sub = await findSubscription(info);
  if (!sub) return "no_subscription";
  const now = new Date();

  if (info.kind === "paid") {
    const currEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
    const base = currEnd && currEnd > now ? currEnd : now;
    const end = addCycle(base, sub.billing_cycle);
    const { error } = await admin().from("subscriptions").update({
      status: "active",
      plan: "pro",
      current_period_start: now.toISOString(),
      current_period_end: end.toISOString(),
      cancel_at_period_end: false,
      canceled_at: null,
    }).eq("id", sub.id);
    return error ? `error:${error.message}` : "active";
  }
  if (info.kind === "failed") {
    await admin().from("subscriptions").update({ status: "past_due" }).eq("id", sub.id);
    return "past_due";
  }
  if (info.kind === "canceled" || info.kind === "refunded") {
    const end = sub.current_period_end ? new Date(sub.current_period_end) : now;
    const keepUntilPeriodEnd = info.kind === "canceled" && end > now;
    await admin().from("subscriptions").update({
      status: keepUntilPeriodEnd ? "active" : "canceled",
      cancel_at_period_end: true,
      canceled_at: now.toISOString(),
      billing_key: null,
    }).eq("id", sub.id);
    return keepUntilPeriodEnd ? "cancel_scheduled" : "canceled";
  }
  return "ignored";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const raw = await req.text();
  if (!raw) return fail("empty_body", 422);
  if (raw.length > 512 * 1024) return fail("too_large", 413);

  const ok = await verifySignature(req, raw);
  if (!ok) return fail("bad_signature", 401);

  let evt: Evt;
  try {
    evt = JSON.parse(raw) as Evt;
  } catch {
    return fail("bad_json", 422);
  }

  const info = classify(evt);
  if (!info.eventId) return fail("missing_event_id", 422);

  const dedupeKey = `${info.provider}:${info.eventId}`;
  const logged = await audit({
    userId: info.userId ?? null,
    actor: "webhook",
    action: `webhook.${info.kind}`,
    target: info.provider,
    detail: { event_id: info.eventId, kind: info.kind, amount: info.amount ?? null, raw_type: String(evt.type ?? evt.eventType ?? "") },
    dedupeKey,
    ipHash: await sha256Hex(req.headers.get("x-forwarded-for") ?? "unknown"),
  });
  if (logged.duplicate) return json({ ok: true, duplicate: true });

  const applied = await applyEvent(info);
  return json({ ok: true, kind: info.kind, applied, duplicate: false });
});
