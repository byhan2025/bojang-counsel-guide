// =====================================================================
// 보장분석 라이프 리포트 v6.0 — QR 로그인 챌린지 (qr-auth-challenge)
//
// POST /functions/v1/qr-auth-challenge
//   { pc_pub_ecdh, pc_pub_ecdsa, pc_pub_hash, pc_name, pc_platform, pc_host,
//     issued_at, pc_sig }                        → 챌린지 발급 (PC 는 로그아웃 상태여도 됨)
//   { action: "peek", code6 }                    → 폰: 6자리 코드로 요청 내용 미리보기
//   { action: "poll", challenge_id }             → PC: 승인 여부 폴링
//
// 200 → { ok: true, challenge: { id, code6, code2, pc_pub_hash, pc_name, pc_host,
//          issued_at, expires_at, status }, ttl: 180 }
// 4xx → { ok: false, error: "rate-limit" | "bad-pc-signature" | "not-found" | "expired" | "bad-request" }
//
// 보안
//   · PC 는 challenge 발급 시 자기 ECDSA 개인키로 transcript 에 서명합니다(pc_sig).
//     위조된 pc_pub 을 밀어넣어 상담 데이터를 가로채는 릴레이를 막기 위한 1차 검증입니다.
//   · 180초 만료 · 6자리 코드 · 2자리 확인 숫자 · pc_pub_hash 지문을 함께 발급합니다.
//   · 응답은 절대 캐시하지 않습니다(no-store). IP 원문은 저장하지 않고 해시만 감사 로그에 남깁니다.
// =====================================================================
import { clientIp, fail, json, preflight, sha256Hex } from "../_shared/http.ts";
import { admin, audit } from "../_shared/supabase.ts";

const TTL_SECONDS = 180;
const RATE_LIMIT_PER_MIN = 8;
const CODE_TTL_GUARD_MS = 1_000;
/* v6.1 — 6자리 코드 추측 방어 */
const PEEK_LIMIT_PER_MIN = 12;
const PEEK_FAIL_LIMIT_10MIN = 25;

type Jwk = { kty: string; crv: string; x: string; y: string };

function isJwk(v: unknown): v is Jwk {
  const j = v as Jwk | null;
  return !!j && j.kty === "EC" && j.crv === "P-256" && typeof j.x === "string" && typeof j.y === "string";
}

function b64uToBytes(txt: string): Uint8Array<ArrayBuffer> {
  const s = txt.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomDigits(n: number): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (let i = 0; i < n; i++) s += String(b[i] % 10);
  return s;
}

function randomId(prefix: string, bytes = 8): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return prefix + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function verifyPcSignature(pub: Jwk, sig: string, text: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      b64uToBytes(sig),
      new TextEncoder().encode(text),
    );
  } catch {
    return false;
  }
}

export async function challengeTranscript(hash: string, issuedAt: number): Promise<string> {
  return ["SMK1", "challenge", hash, String(issuedAt)].join("|");
}

async function rateLimited(req: Request): Promise<boolean> {
  const ip = clientIp(req);
  if (!ip) return false;
  const ipHash = await sha256Hex("qr-challenge|" + ip);
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin()
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "smartkey.challenge")
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  return (count ?? 0) >= RATE_LIMIT_PER_MIN;
}

/** v6.1.1 — 코드 조회(peek) 시도 제한.
 *  v6.1 까지는 실패 누적 시 “최근 10분 전체 pending 챌린지”를 폐기했습니다.
 *  그러면 공격자가 아무 코드나 반복 입력하는 것만으로 다른 사용자의 정상 챌린지까지 날려버리는
 *  DoS 가 됩니다. 그래서 전역 폐기를 없애고, (a) 차단은 이 요청 IP 단위로만 하고,
 *  (b) 폐기는 같은 IP 가 발급한 챌린지(= 시도 중인 세션)로만 한정합니다.
 *  특정 코드를 노리는 추측은 그 IP 가 스스로 만든 챌린지까지만 정리하므로 다른 사용자에게 가지 않습니다. */
async function peekGuard(req: Request): Promise<{ blocked: boolean; discarded: number }> {
  const ip = clientIp(req);
  if (!ip) return { blocked: false, discarded: 0 };
  const ipHash = await sha256Hex("qr-peek|" + ip);
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const tenAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const [minute, ten] = await Promise.all([
    admin().from("audit_logs").select("id", { count: "exact", head: true })
      .eq("action", "smartkey.peek").eq("ip_hash", ipHash).gte("created_at", minuteAgo),
    admin().from("audit_logs").select("id", { count: "exact", head: true })
      .eq("action", "smartkey.peek_fail").eq("ip_hash", ipHash).gte("created_at", tenAgo),
  ]);
  if ((minute.count ?? 0) >= PEEK_LIMIT_PER_MIN) {
    return { blocked: true, discarded: 0 };
  }
  if ((ten.count ?? 0) >= PEEK_FAIL_LIMIT_10MIN) {
    /* 추측 공격으로 판단 — 이 IP 가 발급한 10분 내 챌린지만 폐기 (다른 사용자 챌린지는 유지) */
    const { data: own } = await admin()
      .from("audit_logs")
      .select("target")
      .eq("action", "smartkey.challenge")
      .eq("ip_hash", await sha256Hex("qr-challenge|" + ip))
      .gte("created_at", tenAgo)
      .limit(50);
    const ids = (Array.isArray(own) ? own : [])
      .map((row) => String((row as { target?: string }).target ?? ""))
      .filter((t) => t.startsWith("ch_"));
    let discarded = 0;
    if (ids.length) {
      const { data } = await admin()
        .from("qr_challenges")
        .update({ status: "discarded" })
        .in("id", ids)
        .eq("status", "pending")
        .select("id");
      discarded = Array.isArray(data) ? data.length : 0;
    }
    return { blocked: true, discarded };
  }
  return { blocked: false, discarded: 0 };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return fail("bad-request", 400, "JSON 본문이 필요합니다.");
  }

  const action = String(body.action ?? "create");

  try {
    /* ---------- 폰: 6자리 코드로 미리보기 ---------- */
    if (action === "peek") {
      const code6 = String(body.code6 ?? "").replace(/\D/g, "");
      if (code6.length !== 6) return fail("bad-request", 400, "6자리 코드가 아닙니다.");
      const ipHash = await sha256Hex("qr-peek|" + (clientIp(req) ?? ""));
      const guard = await peekGuard(req);
      await audit({
        actor: "system", action: "smartkey.peek", target: code6.slice(0, 2) + "****",
        detail: { blocked: guard.blocked, discarded: guard.discarded }, ipHash,
      });
      if (guard.blocked) return fail("rate-limit", 429, "시도가 너무 많습니다. 새 코드를 받아 주세요.");
      const { data, error } = await admin()
        .from("qr_challenges")
        .select("id, code6, code2, pc_pub_hash, pc_name, pc_platform, pc_host, issued_at, expires_at, status")
        .eq("code6", code6)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return fail("server_error", 500, error.message);
      if (!data) {
        await audit({ actor: "system", action: "smartkey.peek_fail", target: code6.slice(0, 2) + "****", detail: {}, ipHash });
        return fail("not-found", 404, "코드를 찾을 수 없거나 만료되었습니다.");
      }
      return json({ ok: true, challenge: data });
    }

    /* ---------- PC: 승인 여부 폴링 ---------- */
    if (action === "poll") {
      const id = String(body.challenge_id ?? "");
      if (!id) return fail("bad-request", 400);
      const { data, error } = await admin()
        .from("qr_challenges")
        .select("id, status, expires_at, consumed_at, session_token, phone_pub, enc, pc_name")
        .eq("id", id)
        .maybeSingle();
      if (error) return fail("server_error", 500, error.message);
      if (!data) return fail("not-found", 404);
      let status = String(data.status);
      if (status === "pending" && Date.parse(String(data.expires_at)) < Date.now()) {
        status = "expired";
        await admin().from("qr_challenges").update({ status: "expired" }).eq("id", id).eq("status", "pending");
      }
      return json({
        ok: true,
        status,
        session_token: data.session_token ?? null,
        phone_pub: data.phone_pub ?? null,
        enc: data.enc ?? null,
        pc_name: data.pc_name ?? "",
        consumed_at: data.consumed_at ?? null,
      });
    }

    /* ---------- PC: 이전 코드 무효화 (새로고침) ---------- */
    if (action === "cancel") {
      const id = String(body.challenge_id ?? "");
      const sig = String(body.cancel_sig ?? "");
      if (!id || !sig) return fail("bad-request", 400);
      const { data: ch } = await admin()
        .from("qr_challenges")
        .select("id, pc_pub_ecdsa, status")
        .eq("id", id)
        .maybeSingle();
      if (!ch) return fail("not-found", 404);
      const okCancel = await verifyPcSignature(ch.pc_pub_ecdsa as Jwk, sig, ["SMK1", "cancel", id].join("|"));
      if (!okCancel) return fail("bad-pc-signature", 401, "PC 키 서명 검증에 실패했습니다.");
      await admin().from("qr_challenges").update({ status: "replaced" }).eq("id", id).eq("status", "pending");
      return json({ ok: true });
    }

    /* ---------- PC: 챌린지 발급 ---------- */
    if (action !== "create") return fail("bad-request", 400, "알 수 없는 action 입니다.");

    const ecdh = body.pc_pub_ecdh;
    const ecdsa = body.pc_pub_ecdsa;
    const hash = String(body.pc_pub_hash ?? "");
    const issuedAt = Number(body.issued_at ?? 0);
    const sig = String(body.pc_sig ?? "");
    if (!isJwk(ecdh) || !isJwk(ecdsa) || hash.length < 8 || !sig || !issuedAt) {
      return fail("bad-request", 400, "PC 공개키·서명 정보가 부족합니다.");
    }
    /* 발급 시각은 서버 시계 기준 ±5분만 허용(오래된 서명 재사용 방지) */
    if (Math.abs(Date.now() - issuedAt) > 5 * 60_000) {
      return fail("stale-request", 400, "PC 시계가 서버와 5분 이상 차이납니다. 다시 시도해 주세요.");
    }
    if (await rateLimited(req)) return fail("rate-limit", 429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");

    const okSig = await verifyPcSignature(ecdsa, sig, await challengeTranscript(hash, issuedAt));
    if (!okSig) return fail("bad-pc-signature", 401, "PC 키 서명 검증에 실패했습니다.");

    /* 같은 PC 의 이전 미사용 코드는 교체(replaced) */
    await admin()
      .from("qr_challenges")
      .update({ status: "replaced" })
      .eq("pc_pub_hash", hash)
      .eq("status", "pending");

    const nowMs = Date.now();
    const row = {
      id: randomId("ch_", 8),
      code6: randomDigits(6),
      code2: randomDigits(2),
      pc_pub_ecdh: ecdh,
      pc_pub_ecdsa: ecdsa,
      pc_pub_hash: hash,
      pc_sig: sig,
      pc_name: String(body.pc_name ?? "PC").slice(0, 60),
      pc_platform: String(body.pc_platform ?? "").slice(0, 40),
      pc_host: String(body.pc_host ?? "").slice(0, 80),
      issued_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + TTL_SECONDS * 1000 + CODE_TTL_GUARD_MS).toISOString(),
      status: "pending",
    };

    const { error } = await admin().from("qr_challenges").insert(row);
    if (error) return fail("server_error", 500, error.message);

    await audit({
      actor: "system",
      action: "smartkey.challenge",
      target: row.id,
      detail: { pc_host: row.pc_host, pc_platform: row.pc_platform },
      ipHash: await sha256Hex("qr-challenge|" + (clientIp(req) ?? "")),
    });

    return json({
      ok: true,
      ttl: TTL_SECONDS,
      challenge: {
        id: row.id,
        code6: row.code6,
        code2: row.code2,
        pc_pub_ecdh: row.pc_pub_ecdh,
        pc_pub_ecdsa: row.pc_pub_ecdsa,
        pc_pub_hash: row.pc_pub_hash,
        pc_name: row.pc_name,
        pc_platform: row.pc_platform,
        pc_host: row.pc_host,
        issued_at: nowMs,
        expires_at: nowMs + TTL_SECONDS * 1000,
        status: "pending",
      },
    });
  } catch (e) {
    return fail("server_error", 500, String((e as Error)?.message ?? e));
  }
});
