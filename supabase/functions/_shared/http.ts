// =====================================================================
// 보장분석 라이프 리포트 v5.4 — 공용 HTTP 유틸 (Deno Edge Function)
// CORS · JSON 응답 · 캐시 금지 헤더를 한 곳에서 관리합니다.
// 이미지·개인정보를 로그로 남기지 않기 위해 이 파일에는 로깅을 두지 않습니다.
// =====================================================================

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** 이미지·인식 결과는 어떤 프록시에도 캐시되지 않아야 합니다. */
export const NO_STORE: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export function preflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, ...NO_STORE } });
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      ...extra,
    },
  });
}

export function fail(code: string, status: number, message?: string): Response {
  return json({ ok: false, error: code, message: message ?? code }, status);
}

/** Authorization: Bearer <JWT> 에서 토큰만 꺼냅니다. */
export function bearer(req: Request): string | null {
  const raw = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

export function clientIp(req: Request): string | null {
  const h = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  if (!h) return null;
  return h.split(",")[0].trim();
}

/** IP 원문은 남기지 않고 해시만 감사 로그에 기록합니다. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
