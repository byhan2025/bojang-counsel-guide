// =====================================================================
// 보장분석 라이프 리포트 v6.0 — QR 로그인 승인 (qr-auth-approve)
//
// POST /functions/v1/qr-auth-approve      (Authorization: Bearer <폰 사용자 JWT> 필수)
//   { challenge_id, device_id, code2, pc_pub_hash, phone_pub, enc, signature }
//   { action: "reject", challenge_id }
//
// 200 → { ok: true, session_token, pc_name }
// 4xx → { ok: false, error: "unauthorized" | "not-master" | "bad-signature" | "expired"
//          | "used" | "relay-mismatch" | "code-mismatch" | "not-found" }
//
// 검증 순서 (모두 통과해야 세션이 생깁니다)
//   ① 폰 JWT — requireUser
//   ② 등록된 마스터 휴대폰(registered_devices.master)인지
//   ③ 폰 기기 개인키 서명 — transcript(SMK1|approve|challenge|code2|pc_pub_hash|device|issued_at)
//   ④ 180초 만료 · 단회 소비 — update ... where status='pending' and expires_at>now() 로 원자적 소비
//   ⑤ pc_pub_hash · code2 일치 — 릴레이 치환 방어
//   상담 데이터(enc)는 폰이 PC 공개키로 암호화한 암문이라 서버는 내용을 볼 수 없습니다.
// =====================================================================
import { fail, json, preflight } from "../_shared/http.ts";
import { admin, audit, requireUser } from "../_shared/supabase.ts";

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

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(prefix: string, bytes = 18): string {
  return prefix + b64u(crypto.getRandomValues(new Uint8Array(bytes))).replace(/[^0-9A-Za-z]/g, "").slice(0, 24);
}

async function verifyDeviceSignature(pub: Jwk, sig: string, text: string): Promise<boolean> {
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

function approveTranscript(ch: {
  id: string;
  code2: string;
  pc_pub_hash: string;
  issued_at: string;
}, deviceId: string): string {
  return ["SMK1", "approve", ch.id, ch.code2, ch.pc_pub_hash, deviceId, String(Date.parse(ch.issued_at))]
    .join("|");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const auth = await requireUser(req);
  if (!auth.ok) return fail("unauthorized", auth.status, "로그인이 필요합니다.");
  const userId = auth.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return fail("bad-request", 400, "JSON 본문이 필요합니다.");
  }

  const challengeId = String(body.challenge_id ?? "");
  if (!challengeId) return fail("bad-request", 400, "challenge_id 가 없습니다.");

  try {
    const { data: ch, error } = await admin()
      .from("qr_challenges")
      .select("id, code2, pc_pub_hash, pc_pub_ecdsa, pc_name, issued_at, expires_at, status, consumed_at")
      .eq("id", challengeId)
      .maybeSingle();
    if (error) return fail("server_error", 500, error.message);
    if (!ch) return fail("not-found", 404, "요청을 찾을 수 없습니다.");

    /* ---------- 거절 ---------- */
    if (String(body.action ?? "") === "reject") {
      await admin()
        .from("qr_challenges")
        .update({ status: "rejected" })
        .eq("id", challengeId)
        .eq("status", "pending");
      await audit({ userId, actor: "user", action: "smartkey.reject", target: challengeId });
      return json({ ok: true });
    }

    if (ch.status === "approved" || ch.consumed_at) return fail("used", 409, "이미 사용된 코드입니다.");
    if (ch.status !== "pending") return fail("expired", 410, "만료되었거나 교체된 코드입니다.");
    if (Date.parse(String(ch.expires_at)) <= Date.now()) {
      await admin().from("qr_challenges").update({ status: "expired" }).eq("id", challengeId);
      return fail("expired", 410, "180초가 지나 만료되었습니다.");
    }

    const deviceId = String(body.device_id ?? "");
    const { data: dev, error: devErr } = await admin()
      .from("registered_devices")
      .select("id, kind, master, pub_ecdsa, user_id")
      .eq("id", deviceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (devErr) return fail("server_error", 500, devErr.message);
    if (!dev) return fail("unregistered-device", 403, "등록된 기기가 아닙니다.");
    if (dev.kind !== "phone" || !dev.master) return fail("not-master", 403, "마스터 휴대폰에서만 승인할 수 있습니다.");
    if (!isJwk(dev.pub_ecdsa)) return fail("no-device-key", 403, "기기 공개키가 없습니다.");

    if (String(body.pc_pub_hash ?? "") !== String(ch.pc_pub_hash)) {
      return fail("relay-mismatch", 409, "PC 키 해시가 일치하지 않습니다.");
    }
    if (String(body.code2 ?? "") !== String(ch.code2)) {
      return fail("code-mismatch", 409, "확인 숫자가 일치하지 않습니다.");
    }
    const signature = String(body.signature ?? "");
    const okSig = signature &&
      await verifyDeviceSignature(dev.pub_ecdsa, signature, approveTranscript({
        id: ch.id,
        code2: ch.code2,
        pc_pub_hash: ch.pc_pub_hash,
        issued_at: ch.issued_at,
      }, deviceId));
    if (!okSig) return fail("bad-signature", 401, "기기 서명 검증에 실패했습니다.");

    const phonePub = body.phone_pub;
    const enc = body.enc as { iv?: string; ct?: string } | null;
    if (!isJwk(phonePub) || !enc || !enc.iv || !enc.ct) {
      return fail("bad-request", 400, "암호화된 상담 데이터가 없습니다.");
    }

    const sessionToken = randomToken("pcs_");

    /* ---------- 단회 소비 (원자적) ---------- */
    const { data: consumed, error: cErr } = await admin()
      .from("qr_challenges")
      .update({
        status: "approved",
        consumed_at: new Date().toISOString(),
        user_id: userId,
        device_id: deviceId,
        phone_pub: phonePub,
        enc,
        approve_sig: signature,
        session_token: sessionToken,
      })
      .eq("id", challengeId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .is("consumed_at", null)
      .select("id")
      .maybeSingle();
    if (cErr) return fail("server_error", 500, cErr.message);
    if (!consumed) return fail("used", 409, "다른 창에서 먼저 사용되었습니다. 새 코드를 받아 주세요.");

    const { error: sErr } = await admin().from("pc_sessions").insert({
      token: sessionToken,
      user_id: userId,
      device_id: deviceId,
      pc_pub_hash: ch.pc_pub_hash,
      pc_name: ch.pc_name ?? "PC",
    });
    if (sErr) return fail("server_error", 500, sErr.message);

    /* PC 기기 등록 — (user_id, kind='pc') 유니크라, 이미 다른 PC 가 등록되어 있으면
       이번 승인은 세션만 만들고 기기 교체는 폰의 「기존 PC 밀어내기」로 합니다. */
    const { data: pcDev } = await admin()
      .from("registered_devices")
      .select("id, pub_hash")
      .eq("user_id", userId)
      .eq("kind", "pc")
      .maybeSingle();
    let pcDeviceId: string | null = null;
    if (!pcDev) {
      pcDeviceId = "pc_" + ch.pc_pub_hash.slice(0, 12);
      const { error: pErr } = await admin().from("registered_devices").insert({
        id: pcDeviceId,
        user_id: userId,
        kind: "pc",
        name: ch.pc_name ?? "PC",
        pub_ecdsa: ch.pc_pub_ecdsa,
        pub_hash: ch.pc_pub_hash,
        master: false,
        session_token: sessionToken,
      });
      if (pErr) pcDeviceId = null;
    } else if (pcDev.pub_hash === ch.pc_pub_hash) {
      pcDeviceId = pcDev.id;
      await admin().from("registered_devices")
        .update({ session_token: sessionToken, last_seen: new Date().toISOString() })
        .eq("id", pcDev.id)
        .eq("user_id", userId);
    }

    await admin()
      .from("registered_devices")
      .update({ last_seen: new Date().toISOString() })
      .eq("id", deviceId)
      .eq("user_id", userId);

    await audit({
      userId,
      actor: "user",
      action: "smartkey.approve",
      target: challengeId,
      detail: { pc_name: ch.pc_name, device_id: deviceId },
    });

    return json({ ok: true, session_token: sessionToken, pc_name: ch.pc_name ?? "PC", pc_device_id: pcDeviceId });
  } catch (e) {
    return fail("server_error", 500, String((e as Error)?.message ?? e));
  }
});
