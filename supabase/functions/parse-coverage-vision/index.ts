// =====================================================================
// 보장분석 라이프 리포트 v5.4 — AI 비전 프록시 (parse-coverage-vision)
//
// POST /functions/v1/parse-coverage-vision     (Authorization: Bearer <user JWT>)
//   Content-Type: multipart/form-data
//     image : image/jpeg|png|webp  (클라이언트 전처리본 · 최대 10MB)
//     hint? : string               (예: "암/뇌/심장 담보표")
//   또는 Content-Type: application/json
//     { "image": "data:image/jpeg;base64,...", "hint": "..." }
//
// 200 → {
//   "ok": true, "schema": "bojang.coverage.v1",
//   "text": "일반암 진단비 5,000만원\n...",   // v5.3 parseCoverageText() 그대로 재파싱
//   "items": [], "premium": null, "silson": null,
//   "model": "gpt-4o-mini", "ms": 1840, "persisted": false, "stored_bytes": 0
// }
// 4xx → { "ok": false, "error": "too_large" | "not_coverage_table" | "rate_limited" | "unauthorized" }
//
// 휘발성 보장(설계서 §15-2):
//   · 이미지를 Storage·DB·로그 어디에도 저장하지 않습니다. 메모리에서 base64 로 바꿔 모델에 보낸 뒤
//     바이트 버퍼·base64 문자열 참조를 즉시 null 로 끊습니다.
//   · 응답 헤더 Cache-Control: no-store — CDN·프록시 캐시 금지.
//   · 감사 로그에는 사용자·시각·모델·소요시간·바이트 수만 남기고 이미지/인식 원문은 남기지 않습니다.
// =====================================================================
import { fail, json, preflight, sha256Hex } from "../_shared/http.ts";
import { admin, audit, env, requireUser } from "../_shared/supabase.ts";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
/* v5.8 — 모델 한 번 호출에 걸 수 있는 상한. Gemini 가 응답하지 않을 때 워커가
   150초 리소스 한도까지 매달려 546(WORKER_RESOURCE_LIMIT)으로 죽는 것을 막습니다. */
const UPSTREAM_TIMEOUT_MS = 25_000;
const MAX_TEXT_CHARS = 20000;
const RATE_LIMIT_PER_MIN = 6;
const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];

const PROMPT = [
  "당신은 한국 보험 보장분석표(증권 요약표) 판독기입니다.",
  "이미지에 실제로 보이는 담보명과 금액만 줄 단위로 옮기세요.",
  "규칙:",
  "1) 추측하지 마세요. 보이지 않는 담보·금액은 만들지 마세요.",
  "2) 각 줄은 '담보명 + 금액' 형태로, 금액은 이미지에 적힌 단위(만원/원) 그대로 적으세요.",
  "3) 월 보험료와 실손 세대가 보이면 각각 '월 보험료 27만원', '실손의료보험 4세대' 처럼 한 줄로 적으세요.",
  "4) 이름·주민등록번호·연락처·주소는 읽지 말고 ●●● 로 가리세요.",
  "5) 표를 읽을 수 없으면 {\"lines\": []} 만 반환하세요.",
  "6) 보장분석 앱의 고정 칸에 없는 특약도 증권에 적힌 담보명 그대로 한 줄로 남기세요. 특히 아래 이름은 줄이지 말고 그대로 쓰세요.",
  "   - 특정순환계질환(3~5종) 주요치료비 / 표적항암약물허가치료비 / 다빈치로봇수술비 / 중증치매간병비 / 관절·척추 수술비 / 상해간병일당 / 장기요양간병비 / 뇌·심장 중환자실입원일당",
  "7) 같은 담보가 뇌 영역과 심장 영역에 따로 적혀 있으면 각각 한 줄로 적으세요(영역 머리글과 함께).",
  '출력은 설명 없이 JSON 하나만: {"lines": ["일반암 진단비 5,000만원", "..."]}',
].join("\n");

type Parsed = { bytes: Uint8Array; mime: string; hint: string };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

async function readInput(req: Request): Promise<Parsed | Response> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("image");
    const hint = String(form.get("hint") ?? "");
    if (!file || typeof file === "string") return fail("image_required", 422);
    const f = file as File;
    const mime = (f.type || "image/jpeg").toLowerCase();
    if (!ALLOWED_MIME.includes(mime)) return fail("unsupported_type", 415);
    if (f.size > MAX_IMAGE_BYTES) return fail("too_large", 413);
    const bytes = new Uint8Array(await f.arrayBuffer()); // 메모리에서만
    if (bytes.byteLength > MAX_IMAGE_BYTES) return fail("too_large", 413);
    if (bytes.byteLength === 0) return fail("image_required", 422);
    return { bytes, mime, hint };
  }

  if (ct.includes("application/json")) {
    let body: { image?: string; hint?: string } = {};
    try {
      body = await req.json();
    } catch {
      return fail("bad_json", 422);
    }
    const raw = String(body.image ?? "");
    if (!raw) return fail("image_required", 422);
    const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(raw);
    const mime = (m ? m[1] : "image/jpeg").toLowerCase();
    const b64 = m ? m[2] : raw;
    if (!ALLOWED_MIME.includes(mime)) return fail("unsupported_type", 415);
    if (Math.floor((b64.length * 3) / 4) > MAX_IMAGE_BYTES) return fail("too_large", 413);
    return { bytes: base64ToBytes(b64), mime, hint: String(body.hint ?? "") };
  }

  return fail("unsupported_type", 415);
}

/** 주민등록번호·휴대폰·긴 숫자열을 응답에서 지웁니다(모델이 지시를 어겨도 한 번 더). */
function maskPii(line: string): string {
  return line
    .replace(/\d{6}\s*-\s*\d{7}/g, "●●●●●●-●●●●●●●")
    .replace(/\b01[016789]\s*-\s*\d{3,4}\s*-\s*\d{4}\b/g, "●●●-●●●●-●●●●")
    .replace(/\b\d{3}-\d{2}-\d{5}\b/g, "●●●-●●-●●●●●");
}

function cleanLines(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const out: string[] = [];
  for (const v of arr) {
    const line = maskPii(String(v ?? "").replace(/\s+/g, " ").trim());
    if (!line) continue;
    if (line.length > 200) continue;
    if (out.includes(line)) continue;
    out.push(line);
    if (out.join("\n").length > MAX_TEXT_CHARS) break;
  }
  return out;
}

/** 모델 응답 문자열에서 JSON(lines) 또는 평문 줄을 뽑아냅니다. */
function extractLines(raw: string): string[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const fenced = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const obj = JSON.parse(fenced);
    if (obj && Array.isArray(obj.lines)) return cleanLines(obj.lines);
    if (obj && typeof obj.text === "string") return cleanLines(obj.text.split(/\n+/));
  } catch {
    // JSON 이 아니면 평문으로 처리
  }
  return cleanLines(text.split(/\n+/));
}

type VisionOut = { lines: string[]; model: string };

async function callOpenAI(b64: string, mime: string, model: string): Promise<VisionOut> {
  const key = env("OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "이 보장분석표를 읽어 JSON 으로만 답하세요." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "high" } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai_${res.status}`);
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "";
  return { lines: extractLines(raw), model };
}

/* v5.8 — 무료 등급 Gemini 모델 우선순위
   · gemini-3.8-flash : 2026-11 시점 신규 사용자에게 열려 있는 기본 Flash (검증됨)
   · gemini-4-hydrogen : 상위 모델이 열려 있으면 사용 (없으면 404 → 다음 후보)
   · gemini-flash-latest : 별칭. 모델명이 바뀌어도 따라가는 마지막 안전망
   · GEMINI_VISION_MODEL 환경변수가 있으면 그 모델을 가장 먼저 시도합니다. */
const GEMINI_MODEL_CHAIN = ["gemini-3.8-flash", "gemini-4-hydrogen", "gemini-flash-latest"];
const RETRY_STATUS = [404, 429, 500, 502, 503, 504];

function geminiCandidates(model: string): string[] {
  const first = String(model || "").trim();
  const list = first ? [first].concat(GEMINI_MODEL_CHAIN) : GEMINI_MODEL_CHAIN.slice();
  return list.filter((m, i) => m && list.indexOf(m) === i);
}

async function callGemini(b64: string, mime: string, model: string): Promise<VisionOut> {
  const key = env("GEMINI_API_KEY");
  const candidates = geminiCandidates(model);
  let lastStatus = 500;
  for (const m of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: PROMPT }] },
          contents: [{
            role: "user",
            parts: [
              { text: "이 보장분석표를 읽어 JSON 으로만 답하세요." },
              { inline_data: { mime_type: mime, data: b64 } },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 1500, responseMimeType: "application/json" },
        }),
      });
    } catch {
      /* 시간 초과·네트워크 실패 → 다음 후보 모델로 */
      lastStatus = 504;
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      return { lines: extractLines(raw), model: m };
    }
    lastStatus = res.status;
    if (RETRY_STATUS.indexOf(res.status) < 0) break;
  }
  throw new Error(`gemini_${lastStatus}`);
}

/* 레이트 리밋 — 인스턴스 메모리 기준(사용자당 1분 6회).
   다중 인스턴스에서는 근사치이므로, 유료 트래픽이 커지면 audit_logs 집계 기반으로 승격합니다. */
const hits = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const keep = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (keep.length >= RATE_LIMIT_PER_MIN) {
    hits.set(userId, keep);
    return true;
  }
  keep.push(now);
  hits.set(userId, keep);
  if (hits.size > 5000) hits.clear(); // 메모리 상한
  return false;
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const auth = await requireUser(req);
  if (!auth.ok) return fail(auth.code, auth.status);
  const userId = auth.user.id;

  /* v6.0 — 스마트키 기기·세션 검증 보강.
     PC 가 원격 잠금된 세션으로는 AI 사진 인식을 호출할 수 없습니다.
     헤더가 없으면(휴대폰 단독 사용) 기존과 동일하게 동작합니다. */
  const skSession = (req.headers.get("x-smartkey-session") ?? "").trim();
  if (skSession) {
    const { data: session } = await admin()
      .from("pc_sessions")
      .select("token, user_id, revoked_at")
      .eq("token", skSession)
      .maybeSingle();
    if (!session || session.user_id !== userId) return fail("device_unverified", 401, "이 기기 세션을 확인할 수 없습니다.");
    if (session.revoked_at) return fail("device_revoked", 401, "원격 잠금된 PC에서는 서버 기능을 쓸 수 없습니다.");
  }

  if (rateLimited(userId)) {
    return fail("rate_limited", 429, "사진 인식은 1분에 6회까지 가능합니다. 잠시 후 다시 시도해 주세요.");
  }

  const read = await readInput(req);
  if (read instanceof Response) return read;

  /* ---- 메모리에서만 처리: 바이트 → base64 → 참조 해제 ---- */
  let bytes: Uint8Array | null = read.bytes;
  let b64: string | null = null;
  let mime = read.mime;
  const hint = read.hint.slice(0, 120);
  const byteLength = bytes.byteLength;
  b64 = bytesToBase64(bytes);
  bytes.fill(0);
  bytes = null; // 원본 버퍼 참조 즉시 해제

  const openaiKey = env("OPENAI_API_KEY");
  const geminiKey = env("GEMINI_API_KEY");
  if (!openaiKey && !geminiKey) {
    b64 = null;
    return fail("provider_not_configured", 503, "AI 비전 키(OPENAI_API_KEY 또는 GEMINI_API_KEY)가 설정되지 않았습니다.");
  }

  let out: VisionOut;
  try {
    if (openaiKey) {
      out = await callOpenAI(b64, mime, env("VISION_MODEL") || "gpt-4o-mini");
    } else {
      out = await callGemini(b64, mime, env("GEMINI_VISION_MODEL") || GEMINI_MODEL_CHAIN[0]);
    }
  } catch (e) {
    b64 = null;
    await audit({
      userId,
      actor: "user",
      action: "vision.error",
      target: "parse-coverage-vision",
      detail: { bytes: byteLength, ms: Date.now() - started, message: String((e as Error).message).slice(0, 60) },
      ipHash: await sha256Hex(req.headers.get("x-forwarded-for") ?? "unknown"),
    });
    return fail("upstream_error", 502, "AI 비전 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
  b64 = null; // base64 참조 즉시 해제 — 응답 후 어디에도 남기지 않습니다
  mime = "";

  const text = out.lines.join("\n").slice(0, MAX_TEXT_CHARS);
  const ms = Date.now() - started;

  await audit({
    userId,
    actor: "user",
    action: "vision.parse",
    target: "parse-coverage-vision",
    detail: { bytes: byteLength, lines: out.lines.length, model: out.model, ms, hint: hint || null },
    ipHash: await sha256Hex(req.headers.get("x-forwarded-for") ?? "unknown"),
  });

  if (!out.lines.length) {
    return fail("not_coverage_table", 422, "담보표로 읽히지 않았습니다. 담보명과 금액이 함께 보이게 다시 촬영해 주세요.");
  }

  /* v5.3 parseCoverageText() 와 호환되는 표준 스키마.
     클라이언트는 text 를 다시 파싱해 인식 근거(snippet)까지 검수 화면에 보여줍니다. */
  return json({
    ok: true,
    schema: "bojang.coverage.v1",
    text,
    lines: out.lines.length,
    items: [],
    premium: null,
    silson: null,
    hint: hint || null,
    model: out.model,
    ms,
    persisted: false,
    stored_bytes: 0,
  });
});
