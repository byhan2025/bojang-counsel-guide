// =====================================================================
// 보장분석 라이프 리포트 v5.4 — Supabase 클라이언트 · JWT 검증 (공용)
// · admin(): service_role — RLS 우회. 함수 안에서만 쓰고 클라이언트로 나가지 않습니다.
// · requireUser(): Authorization 헤더의 JWT 를 Supabase Auth 에 직접 조회해 사용자를 확정합니다.
//   (게이트웨이 verify_jwt=true 와 별개로 함수 내부에서 한 번 더 확인합니다.)
// =====================================================================
import { createClient, type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2";
import { bearer } from "./http.ts";

let cached: SupabaseClient | null = null;

export function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

export function admin(): SupabaseClient {
  if (cached) return cached;
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다");
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "bojang-guide-edge/5.4" } },
  });
  return cached;
}

export type AuthResult =
  | { ok: true; user: User; token: string }
  | { ok: false; code: "unauthorized" | "server_misconfigured"; status: number };

export async function requireUser(req: Request): Promise<AuthResult> {
  const token = bearer(req);
  if (!token) return { ok: false, code: "unauthorized", status: 401 };
  let client: SupabaseClient;
  try {
    client = admin();
  } catch {
    return { ok: false, code: "server_misconfigured", status: 500 };
  }
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return { ok: false, code: "unauthorized", status: 401 };
  return { ok: true, user: data.user, token };
}

/** 감사 로그 — 내용(고객 원문·이미지) 없이 사용량만 남깁니다. */
export async function audit(entry: {
  userId?: string | null;
  actor?: "user" | "system" | "webhook" | "admin";
  action: string;
  target?: string | null;
  detail?: Record<string, unknown>;
  dedupeKey?: string | null;
  ipHash?: string | null;
}): Promise<{ ok: boolean; duplicate: boolean; id?: number }> {
  try {
    const { data, error } = await admin()
      .from("audit_logs")
      .insert({
        user_id: entry.userId ?? null,
        actor: entry.actor ?? "system",
        action: entry.action,
        target: entry.target ?? null,
        detail: entry.detail ?? {},
        dedupe_key: entry.dedupeKey ?? null,
        ip_hash: entry.ipHash ?? null,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: true, duplicate: true };
      return { ok: false, duplicate: false };
    }
    return { ok: true, duplicate: false, id: (data as { id?: number } | null)?.id };
  } catch {
    return { ok: false, duplicate: false };
  }
}
