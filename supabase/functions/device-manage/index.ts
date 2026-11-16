// =====================================================================
// 보장분석 라이프 리포트 v6.0 — 기기 관리 · 원격 잠금 (device-manage)
//
// POST /functions/v1/device-manage        (Authorization: Bearer <사용자 JWT> 필수)
//   { action: "list" }                         → 기기·세션 목록
//   { action: "bind", id, kind, name, pub_ecdsa, pub_hash, session_token? } → 기기 등록(최대 2)
//   { action: "evict", device_id }             → 기존 PC 밀어내기(세션 즉시 무효)
//   { action: "revoke", token }                → 원격 잠금(세션 즉시 무효)
//   { action: "session", token }               → PC 가 자기 세션 유효성 확인(잠금 감지)
//
// 규칙
//   · (user_id, kind) 유니크 — 휴대폰 1대 + PC 1대, 최대 2기기.
//   · PC 를 새로 붙이려면 기존 PC 를 evict 해야 하고, evict 는 세션을 즉시 무효화합니다.
//   · 마스터 휴대폰은 evict 로 지울 수 없습니다(본인 잠김 방지).
// =====================================================================
import { fail, json, preflight } from "../_shared/http.ts";
import { admin, audit, requireUser } from "../_shared/supabase.ts";

type Jwk = { kty: string; crv: string; x: string; y: string };

function isJwk(v: unknown): v is Jwk {
  const j = v as Jwk | null;
  return !!j && j.kty === "EC" && j.crv === "P-256" && typeof j.x === "string" && typeof j.y === "string";
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
  const action = String(body.action ?? "list");
  const db = admin();

  try {
    if (action === "list") {
      const { data: devices, error } = await db
        .from("registered_devices")
        .select("id, kind, name, pub_hash, master, session_token, created_at, last_seen")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (error) return fail("server_error", 500, error.message);
      const { data: sessions } = await db
        .from("pc_sessions")
        .select("token, device_id, pc_name, created_at, last_seen, revoked_at, revoked_by")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      const list = (devices ?? []).map((d) => ({
        ...d,
        session: (sessions ?? []).find((s) => s.token === d.session_token) ?? null,
      }));
      return json({ ok: true, devices: list, sessions: sessions ?? [] });
    }

    if (action === "bind") {
      const kind = String(body.kind ?? "");
      if (kind !== "phone" && kind !== "pc") return fail("bad-request", 400, "kind 는 phone 또는 pc 입니다.");
      const pub = body.pub_ecdsa;
      if (!isJwk(pub)) return fail("bad-request", 400, "기기 공개키가 필요합니다.");
      const pubHash = String(body.pub_hash ?? "").slice(0, 32);
      const id = String(body.id ?? "").slice(0, 40) ||
        (kind === "phone" ? "ph_" : "pc_") + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

      const { data: existing } = await db
        .from("registered_devices")
        .select("id, kind, name, pub_hash, master, session_token, created_at, last_seen")
        .eq("user_id", userId)
        .eq("kind", kind)
        .maybeSingle();

      if (existing) {
        if (existing.pub_hash === pubHash) {
          await db.from("registered_devices")
            .update({ last_seen: new Date().toISOString(), session_token: body.session_token ?? existing.session_token })
            .eq("id", existing.id).eq("user_id", userId);
          return json({ ok: true, device: { ...existing, session_token: body.session_token ?? existing.session_token }, existing: true });
        }
        if (kind === "phone") {
          return fail("master-exists", 409, "이미 등록된 마스터 휴대폰이 있습니다. 기기 관리에서 먼저 해제해 주세요.");
        }
        return json({
          ok: false,
          error: "device-limit",
          message: "PC는 1대까지 연결됩니다. 기존 PC를 밀어내면 바로 연결됩니다.",
          evictable: [{ id: existing.id, name: existing.name, last_seen: existing.last_seen, session_token: existing.session_token }],
        }, 409);
      }

      const row = {
        id,
        user_id: userId,
        kind,
        name: String(body.name ?? (kind === "phone" ? "휴대폰" : "PC")).slice(0, 60),
        pub_ecdsa: pub,
        pub_hash: pubHash,
        master: kind === "phone",
        session_token: body.session_token ? String(body.session_token) : null,
        last_seen: new Date().toISOString(),
      };
      const { error } = await db.from("registered_devices").insert(row);
      if (error) {
        if (String((error as { code?: string }).code) === "23505") {
          return fail("device-limit", 409, "최대 2기기(휴대폰 1 + PC 1)까지 등록됩니다.");
        }
        return fail("server_error", 500, error.message);
      }
      await audit({ userId, actor: "user", action: "smartkey.bind", target: id, detail: { kind } });
      return json({ ok: true, device: row });
    }

    if (action === "evict") {
      const deviceId = String(body.device_id ?? "");
      if (!deviceId) return fail("bad-request", 400);
      const { data: dev } = await db
        .from("registered_devices")
        .select("id, kind, name, master")
        .eq("id", deviceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!dev) return fail("not-found", 404);
      if (dev.master) return fail("master-protected", 403, "마스터 휴대폰은 원격 잠금 대상이 아닙니다.");
      await db.from("pc_sessions")
        .update({ revoked_at: new Date().toISOString(), revoked_by: "phone" })
        .eq("user_id", userId)
        .eq("device_id", deviceId)
        .is("revoked_at", null);
      await db.from("registered_devices").delete().eq("id", deviceId).eq("user_id", userId);
      await audit({ userId, actor: "user", action: "smartkey.evict", target: deviceId });
      return json({ ok: true, evicted: { id: dev.id, name: dev.name } });
    }

    if (action === "revoke") {
      const token = String(body.token ?? "");
      if (!token) return fail("bad-request", 400);
      await db.from("pc_sessions")
        .update({ revoked_at: new Date().toISOString(), revoked_by: "phone" })
        .eq("token", token)
        .eq("user_id", userId)
        .is("revoked_at", null);
      await db.from("registered_devices")
        .update({ session_token: null })
        .eq("user_id", userId)
        .eq("session_token", token);
      await audit({ userId, actor: "user", action: "smartkey.revoke", target: token.slice(0, 10) });
      return json({ ok: true });
    }

    if (action === "session") {
      const token = String(body.token ?? "");
      if (!token) return fail("bad-request", 400);
      const { data: s, error } = await db
        .from("pc_sessions")
        .select("token, device_id, pc_name, pc_pub_hash, created_at, last_seen, revoked_at, revoked_by")
        .eq("token", token)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return fail("server_error", 500, error.message);
      if (!s) return fail("no-session", 404);
      if (s.revoked_at) return json({ ok: false, error: "revoked", session: s }, 401);
      await db.from("pc_sessions").update({ last_seen: new Date().toISOString() }).eq("token", token);
      return json({ ok: true, session: s });
    }

    return fail("bad-request", 400, "알 수 없는 action 입니다.");
  } catch (e) {
    return fail("server_error", 500, String((e as Error)?.message ?? e));
  }
});
