#!/usr/bin/env python3
"""보장분석 라이프 리포트 v5.8 — 클라우드 동기화 · 고지의무 체크 · 카톡 요약 · QR 46pt 자동 검증.

실행: python3 tests/test_v5_8.py

검증:
  · 버전 v5.8 (타이틀·헤더·서비스워커·manifest·monetize·단일 HTML·외부 참조 0)
  · 클라우드 상담 동기화 — 로그인 → 상담 저장 → consultations upsert(결정적 UUID·이미지 없음)
    → 다른 기기(새 컨텍스트)에서 로그인만으로 최근 상담 자동 수신(☁) → 불러오기로 점수·입력 복원
  · 테이블 미적용(PGRST205) 폴백 — clients.payload 에 스냅샷 저장 → 다른 기기에서 복원
  · 미로그인·오프라인 — 로컬 저장만, 서버 요청 0, 오류 0
  · 고지의무 체크 — 일반 3·1·5 / 간편 3·2·5 판정, 3개월→2·5년 자동 연동, 준비 서류, 1탭 복사
  · 카톡 요약 — 5~6줄 · 담당자 연락처 · 클립보드 복사 · 미리보기 시트
  · 명함 QR 46pt — 01p 표지 스캔값 일치, 10장 넘침 0
  · 사진 AI 직접 기재 담보 매핑(parseCustomItems), Gemini 모델 체인 코드
  · 콘솔 오류 0, 360px 넘침 0
"""
import base64
import functools
import http.server
import json
import os
import re
import socket
import socketserver
import sys
import threading
import time
import urllib.parse

for _libs in ("/workspace/tmp/libs/usr/lib/x86_64-linux-gnu", "/workspace/.pwlibs/root/usr/lib/x86_64-linux-gnu"):
    if os.path.isdir(_libs):
        os.environ.setdefault("LD_LIBRARY_PATH", _libs)
        break

from playwright.sync_api import sync_playwright

try:
    import pymupdf
except Exception:  # pragma: no cover
    import fitz as pymupdf

try:
    import zxingcpp
except Exception:  # pragma: no cover
    zxingcpp = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out")
SHOTS = "/workspace/reports/bojang-guide/v5.8"
os.makedirs(OUT, exist_ok=True)
os.makedirs(SHOTS, exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ((" · " + str(detail)) if detail != "" else ""))
    return ok


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


# =====================================================================
# 모의 Supabase — 같은 서버(동일 출처)에서 Auth·PostgREST 를 흉내 냅니다.
#   · 두 개의 브라우저 컨텍스트 = PC 와 아이폰
#   · consultations 테이블을 끄면(fail_consult) 실제 프로젝트처럼 PGRST205 를 돌려줍니다.
# =====================================================================
UID = "11111111-1111-1111-1111-111111111111"
EMAIL = "qa.v58@bojang.test"


class Store(object):
    def __init__(self):
        self.consultations = []
        self.clients = []
        self.requests = []
        self.fail_consult = False

    def reset_runtime(self):
        self.requests = []


STORE = Store()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    # ---------- helpers ----------
    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _empty(self, code=204):
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw.decode("utf-8")) if raw else None
        except Exception:
            return None

    def _parts(self):
        parsed = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(parsed.query)
        return parsed.path, q

    @staticmethod
    def _eq(q, key):
        v = q.get(key, [""])[0]
        return v[3:] if v.startswith("eq.") else v

    # ---------- routing ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.end_headers()

    def do_GET(self):
        path, q = self._parts()
        if not path.startswith("/mock/"):
            return super().do_GET()
        path = path[len("/mock"):]
        STORE.requests.append(("GET", path))
        if path == "/auth/v1/health":
            return self._json(200, {"name": "mock", "version": "v5.8"})
        if path == "/rest/v1/subscriptions":
            return self._json(200, [])
        if path == "/rest/v1/brand_settings":
            return self._json(200, [])
        if path == "/rest/v1/consultations":
            if STORE.fail_consult:
                return self._json(404, {"code": "PGRST205", "message": "Could not find the table 'public.consultations' in the schema cache"})
            uid = self._eq(q, "user_id")
            rows = [r for r in STORE.consultations if r.get("user_id") == uid]
            rows.sort(key=lambda r: r.get("consulted_at") or "", reverse=True)
            limit = int(q.get("limit", ["20"])[0])
            return self._json(200, rows[:limit])
        if path == "/rest/v1/clients":
            uid = self._eq(q, "user_id")
            rows = [r for r in STORE.clients if r.get("user_id") == uid]
            if "display_name" in q:
                nm = self._eq(q, "display_name")
                rows = [r for r in rows if r.get("display_name") == nm]
            limit = int(q.get("limit", ["20"])[0])
            return self._json(200, rows[:limit])
        return self._json(404, {"message": "not found"})

    def do_POST(self):
        path, q = self._parts()
        if not path.startswith("/mock/"):
            return self._json(404, {"message": "no"})
        path = path[len("/mock"):]
        body = self._body()
        STORE.requests.append(("POST", path))
        if path == "/auth/v1/token":
            return self._json(200, {
                "access_token": "mock-token", "refresh_token": "mock-refresh",
                "expires_in": 3600, "user": {"id": UID, "email": EMAIL}
            })
        if path == "/auth/v1/signup":
            return self._json(200, {
                "access_token": "mock-token", "refresh_token": "mock-refresh",
                "expires_in": 3600, "user": {"id": UID, "email": EMAIL}
            })
        if path == "/auth/v1/logout":
            return self._empty(204)
        if path == "/rest/v1/consultations":
            if STORE.fail_consult:
                return self._json(404, {"code": "PGRST205", "message": "Could not find the table 'public.consultations' in the schema cache"})
            row = body or {}
            STORE.consultations = [r for r in STORE.consultations if r.get("id") != row.get("id")]
            STORE.consultations.append(row)
            return self._empty(201)
        if path == "/rest/v1/clients":
            row = body or {}
            row["id"] = row.get("id") or ("cl-" + str(len(STORE.clients) + 1))
            STORE.clients = [r for r in STORE.clients
                             if not (r.get("user_id") == row.get("user_id") and r.get("display_name") == row.get("display_name"))]
            STORE.clients.append(row)
            return self._empty(201)
        if path == "/rest/v1/brand_settings":
            return self._empty(201)
        return self._json(404, {"message": "no"})

    def do_PATCH(self):
        path, q = self._parts()
        if not path.startswith("/mock/"):
            return self._json(404, {"message": "no"})
        path = path[len("/mock"):]
        body = self._body()
        STORE.requests.append(("PATCH", path))
        if path in ("/rest/v1/clients", "/rest/v1/brand_settings"):
            if path == "/rest/v1/clients":
                rid = self._eq(q, "id")
                for r in STORE.clients:
                    if r.get("id") == rid:
                        r.update(body or {})
            return self._empty(204)
        return self._json(404, {"message": "no"})


def start_server():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return httpd, "http://127.0.0.1:%d" % port
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("server start failed")


FILL = """() => {
  const S = BojangApp.state;
  S.client = { name: '김민수', birth: '1983-03-12', consultant: '김한기', dateLabel: '2026년 11월 16일' };
  S.age = '40'; S.gender = '남'; S.job = '2'; S.silson = '2'; S.premium = 28;
  S.cov.cancer.general = 3000; S.cov.cancer.similar = 500; S.cov.brain.dx.vascular = 2000;
  S.cov.custom = { cancer: [], brain: [{ id: 'b1', name: '특정순환계질환(3~5종) 주요치료비', amount: 2000, mode: 'bundle' }], heart: [], surgery: [], care: [] };
  BojangBrand.save({ name: '보반 라이프 리포트', slogan: '고객 맞춤형 보장 점검 · 리모델링 상담 가이드',
                     consultant: '김한기', title: '손해보험 설계사', phone: '010-4908-4175', kakao: 'open.kakao.com/o/bojang58' });
  BojangApp.analyze();
}"""

CAPTURE_PDF = """async (kind) => {
  let out;
  try { out = await BojangApp.buildPdfBlob(kind); }
  finally { document.getElementById('pdf-overlay').hidden = true; }
  const buf = await out.blob.arrayBuffer();
  let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return { pages: out.pages, overflow: out.overflow, b64: btoa(bin) };
}"""


def app_errors(errs):
    """의도적으로 404 를 돌려준 폴백 시험에서 브라우저가 남기는 네트워크 로그는 제외."""
    return [e for e in errs if "Failed to load resource" not in e]


def new_page(browser, base, color_scheme=None):
    ctx = browser.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=2,
                              permissions=["clipboard-read", "clipboard-write"])
    errors = []
    ctx.add_init_script("window.__BOJANG_CONFIG__ = { SUPABASE_URL: '%s/mock', SUPABASE_ANON_KEY: 'test-anon-key' };" % base)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.set_default_timeout(20000)
    pg.goto(base + "/index.html", wait_until="load")
    pg.wait_for_timeout(700)
    pg.evaluate("() => localStorage.clear()")
    pg.reload(wait_until="load")
    pg.wait_for_timeout(1300)
    pg.evaluate("() => { const t = document.getElementById('tour-invite'); if (t) t.hidden = true; }")
    return ctx, pg, errors


def login(pg):
    pg.click("#btn-account")
    pg.wait_for_timeout(400)
    pg.fill("#acct-email", EMAIL)
    pg.fill("#acct-pw", "bojang1234")
    pg.click("#acct-submit")
    pg.wait_for_timeout(900)
    pg.evaluate("() => BojangBackend.closeAccount()")
    pg.wait_for_timeout(300)
    return pg.evaluate("() => ({ session: BojangBackend.hasSession(), mode: BojangBackend.mode(), msg: (document.getElementById('acct-msg')||{}).textContent })")


def main():
    httpd, base = start_server()
    url = base + "/index.html"
    all_errors = []
    scores = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"),
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])

            # =========================================================
            # 1. 버전 · 정적 구조
            # =========================================================
            ctx, pg, errors = new_page(browser, base)
            title = pg.title()
            check("타이틀 v5.8", "v5.8" in title and "보장분석 라이프 리포트" in title, title)
            check("헤더 버전 표기 v5.8", "v5.8" in pg.inner_text(".hh-ver"), pg.inner_text(".hh-ver"))
            check("헤더 eyebrow V5.8", "V5.8" in pg.inner_text(".hh-eyebrow"), pg.inner_text(".hh-eyebrow"))
            sw = read(os.path.join(ROOT, "sw.js"))
            check("서비스워커 캐시 v5.8", "bojang-guide-v5.8" in sw, sw.splitlines()[2])
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest v5.8", "v5.8" in man.get("name", ""), man.get("name"))
            check("manifest — 새 기능 설명", all(k in man.get("description", "") for k in ["클라우드", "고지의무", "카톡", "QR"]), man.get("description")[:70])
            monet = read(os.path.join(ROOT, "monetize.js"))
            check("monetize — 버전·제목 v5.8", "v5.8" in monet.splitlines()[0] and "v5.8 ·" in monet, monet.splitlines()[0][:48])
            check("README — v5.8 섹션", "v5.8에서 달라진 것" in read(os.path.join(ROOT, "README.md")), "README.md")

            backend_src = read(os.path.join(ROOT, "backend.js"))
            app_src = read(os.path.join(ROOT, "app.js"))
            tools_src = read(os.path.join(ROOT, "tools.js"))
            parser_src = read(os.path.join(ROOT, "import-parser.js"))
            report_src = read(os.path.join(ROOT, "report.js"))
            fn_src = read(os.path.join(ROOT, "supabase/functions/parse-coverage-vision/index.ts"))
            mig = read(os.path.join(ROOT, "supabase/migrations/002_consultations.sql"))

            check("마이그레이션 — consultations DDL·RLS·유니크", all(k in mig for k in [
                "create table if not exists public.consultations", "enable row level security",
                "consultations_user_local_uidx", "grant select, insert, update, delete", "cons_rw"]), "002_consultations.sql")
            check("백엔드 — consultations 동기화·폴백", all(k in backend_src for k in [
                "CONSULT_TABLE", "syncConsultation", "pullConsultations", "PGRST20", "entrySnapshot", "rowToEntry"]), "backend.js")
            check("백엔드 — 결정적 UUID(SHA-256)", "bojang.consult.v2" in backend_src and "crypto.subtle.digest" in backend_src, "")
            check("앱 — 클라우드 병합·카톡 요약", all(k in app_src for k in [
                "syncHistoryFromCloud", "ingestCloud", "kakaoSummary", "openKakaoModal", "hist-cloud"]), "app.js")
            check("도구 — 고지 3·1·5 / 3·2·5 체크", all(k in tools_src for k in [
                "DISC_PERIODS", "generalJudge", "simpleJudge", "disclosureText", "discDocs", "data-disc-period"]), "tools.js")
            check("파서 — custom 담보 인식", "parseCustomItems" in parser_src
                  and "특정순환계질환(3~5종) 주요치료비" in parser_src and "kind: 'custom'" in parser_src, "import-parser.js")
            check("비전 — 모델 체인 3.8-flash → 4-hydrogen → flash-latest",
                  all(k in fn_src for k in ['GEMINI_MODEL_CHAIN = ["gemini-3.8-flash", "gemini-4-hydrogen", "gemini-flash-latest"]', "RETRY_STATUS", "geminiCandidates", "UPSTREAM_TIMEOUT_MS"]) and "AbortSignal.timeout" in fn_src, "index.ts")
            check("PDF — 표지 QR 46pt · 명함 166", "const qs = 46;" in report_src and "{ h: 166 }" in report_src, "report.js")

            # =========================================================
            # 2. 클라우드 동기화 — 미로그인 상태
            # =========================================================
            STORE.reset_runtime()
            check("미로그인 — 클라우드 상태 안내", "이 기기에만 저장" in pg.inner_text(".cloud-state"), pg.inner_text(".cloud-state"))
            pg.evaluate(FILL)
            pg.wait_for_timeout(300)
            pg.evaluate("() => BojangApp.switchView('analysis')")
            pg.wait_for_timeout(400)
            scores["A"] = pg.evaluate("() => BojangApp.state.lastResult.m.score")
            pg.click("#btn-save")
            pg.wait_for_timeout(500)
            local = pg.evaluate("() => ({ n: BojangApp.state.history.length, cloud: BojangApp.state.history[0].cloud || false })")
            check("미로그인 — 로컬 저장 정상", local["n"] == 1 and not local["cloud"], local)
            check("미로그인 — 서버 요청 0", not any(m == "POST" and "/consultations" in pth for m, pth in STORE.requests), STORE.requests)
            check("미로그인 — 콘솔 오류 0", not errors, errors[:2])

            # =========================================================
            # 3. 로그인 → 상담 저장 → consultations upsert
            # =========================================================
            STORE.reset_runtime()
            auth = login(pg)
            check("모의 실서버 로그인", auth["session"] and auth["mode"] == "live-backend", auth)
            check("로그인 후 클라우드 연결 표시", "클라우드 연결" in pg.inner_text(".cloud-state"), pg.inner_text(".cloud-state"))
            pg.wait_for_timeout(400)
            if pg.query_selector("[data-del]"):
                pg.evaluate("() => { const b = document.querySelector('[data-del]'); if (b) b.click(); }")
                pg.wait_for_timeout(400)
            pg.evaluate(FILL)
            pg.wait_for_timeout(200)
            pg.evaluate("() => BojangApp.switchView('analysis')")
            pg.wait_for_timeout(300)
            pg.fill("#cust-label", "김민수 40대 남")
            pg.click("#btn-save")
            pg.wait_for_timeout(900)
            posts = [r for r in STORE.consultations if r.get("user_id") == UID]
            check("consultations 1행 저장", len(posts) == 1, len(posts))
            row = posts[0] if posts else {}
            check("행 — 결정적 UUID 형식", bool(re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", str(row.get("id", "")))), row.get("id"))
            check("행 — local_id·label", str(row.get("local_id", "")).startswith("c") and row.get("label") == "김민수 40대 남", [row.get("local_id"), row.get("label")])
            check("행 — input_json 스냅샷", (row.get("input_json") or {}).get("cov", {}).get("cancer", {}).get("general") == 3000
                  and (row.get("input_json") or {}).get("cov", {}).get("custom", {}).get("brain", [{}])[0].get("amount") == 2000,
                  str((row.get("input_json") or {}).get("cov", {}).get("cancer", {}))[:80])
            check("행 — result_json 점수", (row.get("result_json") or {}).get("score") == scores["A"], (row.get("result_json") or {}).get("score"))
            blob = json.dumps(row, ensure_ascii=False)
            check("행 — 이미지·원본 증권 없음", not any(k in blob.lower() for k in ["data:image", "base64", "photo", "capture.jpg"]), len(blob))
            check("저장 후 토스트 — 클라우드 안내", "클라우드" in pg.evaluate("() => document.getElementById('toast').textContent"), pg.evaluate("() => document.getElementById('toast').textContent"))

            # 같은 상담을 두 번 올려도 행이 늘지 않음(멱등 upsert)
            pg.evaluate("""async () => {
              const e = BojangApp.state.history[0];
              await BojangBackend.syncConsultation(e);
              await BojangBackend.syncConsultation(e);
            }""")
            pg.wait_for_timeout(700)
            check("멱등 upsert — 같은 상담은 1행 유지", len([r for r in STORE.consultations if r.get("user_id") == UID]) == 1, len(STORE.consultations))
            check("같은 상담 id → 같은 uuid", pg.evaluate("""async () => {
                const a = await BojangBackend.consultUuid('c1');
                const b = await BojangBackend.consultUuid('c1');
                const c = await BojangBackend.consultUuid('c2');
                return a === b && a !== c;
            }"""), "")
            all_errors += errors
            ctx.close()

            # =========================================================
            # 4. 다른 기기(아이폰) — 로그인만으로 이어보기
            # =========================================================
            ctx, pg, errors = new_page(browser, base)
            check("새 기기 — 처음엔 기록 없음", pg.evaluate("() => BojangApp.state.history.length") == 0, "")
            check("새 기기 — 로그인 전 저장 안내", "이 기기에만 저장" in pg.inner_text(".cloud-state"), pg.inner_text(".cloud-state"))
            auth2 = login(pg)
            pg.wait_for_timeout(900)
            got = pg.evaluate("""() => ({
              n: BojangApp.state.history.length,
              label: (BojangApp.state.history[0] || {}).label || '',
              cloud: !!(BojangApp.state.history[0] || {}).cloud,
              badge: !!document.querySelector('.hist-cloud')
            })""")
            check("로그인 → 클라우드 상담 자동 수신", auth2["session"] and got["n"] >= 1 and got["cloud"] and got["badge"], got)
            check("클라우드 행 라벨 유지", got["label"] == "김민수 40대 남", got["label"])
            pg.screenshot(path=os.path.join(SHOTS, "ui-cloud-history.png"), full_page=False)
            pg.click("[data-load]")
            pg.wait_for_timeout(700)
            restored = pg.evaluate("""() => { const r = BojangApp.state.lastResult; return {
              score: r ? r.m.score : null, premium: BojangApp.state.premium,
              general: BojangApp.state.cov.cancer.general, custom: (BojangApp.state.cov.custom.brain[0] || {}).amount,
              name: BojangApp.state.client.name }; }""")
            check("불러오기 — 점수 복원", restored["score"] == scores["A"], restored)
            check("불러오기 — 입력·직접 기재 복원", restored["premium"] == 28 and restored["general"] == 3000 and restored["custom"] == 2000 and restored["name"] == "김민수", restored)
            check("불러오기 — 콘솔 오류 0", not errors, errors[:2])
            all_errors += errors
            ctx.close()

            # =========================================================
            # 5. consultations 테이블 미적용 → clients.payload 폴백
            # =========================================================
            STORE.fail_consult = True
            STORE.clients = []
            ctx, pg, errors = new_page(browser, base)
            login(pg)
            pg.wait_for_timeout(400)
            pg.evaluate(FILL)
            pg.wait_for_timeout(200)
            pg.evaluate("() => BojangApp.switchView('analysis')")
            pg.wait_for_timeout(300)
            pg.fill("#cust-label", "폴백 고객")
            pg.click("#btn-save")
            pg.wait_for_timeout(900)
            cl = [r for r in STORE.clients if r.get("user_id") == UID]
            check("폴백 — clients 1행 저장", len(cl) == 1, len(cl))
            snap = (cl[0].get("payload") or {}).get("entry") or {}
            check("폴백 — payload.entry 스냅샷", (snap.get("inputs") or {}).get("cov", {}).get("cancer", {}).get("general") == 3000 and snap.get("label"), str(snap.get("label")))
            check("폴백 — 상태 문구(기존 고객 표)", "기존 고객 표" in pg.inner_text(".cloud-state"), pg.inner_text(".cloud-state"))
            check("폴백 — 콘솔 오류 0(404 네트워크 로그 제외)", not app_errors(errors), app_errors(errors)[:2])
            all_errors += errors
            ctx.close()

            ctx, pg, errors = new_page(browser, base)
            login(pg)
            pg.wait_for_timeout(900)
            fb = pg.evaluate("() => ({ n: BojangApp.state.history.length, label: (BojangApp.state.history[0]||{}).label||'', cloud: !!(BojangApp.state.history[0]||{}).cloud })")
            check("폴백 — 다른 기기에서 복원", fb["n"] >= 1 and fb["cloud"] and fb["label"] == "폴백 고객", fb)
            all_errors += errors
            ctx.close()
            STORE.fail_consult = False

            # =========================================================
            # 6. 고지의무 체크 도구
            # =========================================================
            ctx, pg, errors = new_page(browser, base)
            pg.evaluate("() => BojangApp.switchView('disclose')")
            pg.wait_for_timeout(400)
            tabs = pg.eval_on_selector_all(".disc-tab", "els => els.map(e => e.textContent.replace(/\\s/g,''))")
            check("고지 — 기간 탭 4개", tabs == ["3개월0", "1년0", "2년0", "5년0"], tabs)
            pg.click("[data-disc-period='3개월']")
            pg.wait_for_timeout(200)
            pg.click("[data-disc='m3dx']")
            pg.wait_for_timeout(300)
            after = pg.evaluate("""() => ({
              tabs: Array.from(document.querySelectorAll('.disc-tab')).map(e => e.textContent.replace(/\\s/g,'')),
              general: document.querySelectorAll('.disc-judge .disc-verdict b')[0].textContent,
              simple: document.querySelectorAll('.disc-judge .disc-verdict b')[1].textContent,
              main: document.getElementById('disc-verdict-main').textContent,
              docs: Array.from(document.querySelectorAll('.disc-docs li')).map(e => e.textContent)
            })""")
            check("3개월 체크 — 2·5년 문항 자동 연동", after["tabs"] == ["3개월1", "1년0", "2년2", "5년3"], after["tabs"])
            check("3개월 체크 — 일반·간편 모두 고지 필요", after["general"] == "고지 필요" and after["simple"] == "고지 필요", [after["general"], after["simple"]])
            check("3개월 체크 — 3개월 경과 후 재검토 권장", "3개월 경과 후 재검토" in after["main"], after["main"][:60])
            check("준비 서류 — 진단서·입퇴원·수술확인서", any("진단서" in d for d in after["docs"]) and any("입·퇴원확인서" in d for d in after["docs"])
                  and any("수술확인서" in d for d in after["docs"]), after["docs"][:3])
            pg.screenshot(path=os.path.join(SHOTS, "ui-disclosure-check.png"), full_page=False)
            pg.click("#disc-copy")
            pg.wait_for_timeout(400)
            clip = pg.evaluate("() => navigator.clipboard.readText()")
            check("고지 — 결과·서류 1탭 복사", clip.startswith("[고지의무 체크 결과]") and "일반심사(3·1·5)" in clip and "간편심사(3·2·5)" in clip, clip.splitlines()[:3])
            pg.click("#disc-reset")
            pg.wait_for_timeout(300)
            check("고지 — 체크 비우기", pg.eval_on_selector_all(".disc-tab", "els => els.map(e => e.textContent.replace(/\\s/g,''))") == ["3개월0", "1년0", "2년0", "5년0"], "")

            # 2년 이내 수술 → 3·2·5 도 걸림 / 3년 이내 → 3·2·5 통과 가능
            pg.click("[data-disc-period='2년']")
            pg.wait_for_timeout(200)
            pg.click("[data-disc='y2op']")
            pg.wait_for_timeout(300)
            v2 = pg.evaluate("() => ({ g: document.querySelectorAll('.disc-judge .disc-verdict b')[0].textContent, s: document.querySelectorAll('.disc-judge .disc-verdict b')[1].textContent })")
            check("2년 수술 — 일반·간편 모두 고지", v2["g"] == "고지 필요" and v2["s"] == "고지 필요", v2)
            pg.click("#disc-reset")
            pg.wait_for_timeout(200)
            pg.click("[data-disc-period='5년']")
            pg.wait_for_timeout(200)
            pg.click("[data-disc='y3']")
            pg.wait_for_timeout(300)
            v3 = pg.evaluate("""() => ({ g: document.querySelectorAll('.disc-judge .disc-verdict b')[0].textContent,
                                        s: document.querySelectorAll('.disc-judge .disc-verdict b')[1].textContent,
                                        main: document.getElementById('disc-verdict-main').textContent })""")
            check("3년 이내 — 일반 고지 필요 · 간편 3·2·5 통과", v3["g"] == "고지 필요" and v3["s"] == "통과 가능", v3)
            check("3년 이내 — 3·2·5 전환 가이드", "3·2·5" in v3["main"] and "전환" in v3["main"], v3["main"][:70])

            # =========================================================
            # 7. 카톡 요약 1탭 복사
            # =========================================================
            pg.click("#disc-reset")
            pg.evaluate(FILL)
            pg.wait_for_timeout(300)
            pg.evaluate("() => BojangApp.switchView('analysis')")
            pg.wait_for_timeout(400)
            pg.click("#btn-kakao")
            pg.wait_for_timeout(600)
            modal = pg.evaluate("""() => ({ open: !document.getElementById('kakao-modal').hidden,
                                            text: document.getElementById('kakao-preview').textContent })""")
            lines = [l for l in modal["text"].split("\n") if l.strip()]
            check("카톡 — 미리보기 시트 열림", modal["open"], modal["open"])
            check("카톡 — 5~6줄 요약", 5 <= len(lines) <= 6, len(lines))
            check("카톡 — 점수·등급", ("%d점" % scores["A"]) in modal["text"] and "종합 보장등급" in modal["text"], lines[1] if len(lines) > 1 else "")
            check("카톡 — 핵심 부족 1~2순위", "먼저 채울 곳" in modal["text"] and "1)" in modal["text"], lines[2] if len(lines) > 2 else "")
            check("카톡 — 담당자 연락처", "김한기" in modal["text"] and "010-4908-4175" in modal["text"], lines[-2] if len(lines) > 1 else "")
            clip2 = pg.evaluate("() => navigator.clipboard.readText()")
            check("카톡 — 클립보드에 복사됨", clip2.strip() == modal["text"].strip(), clip2.splitlines()[:1])
            pg.screenshot(path=os.path.join(SHOTS, "ui-kakao-summary.png"), full_page=False)
            pg.click("#kakao-copy")
            pg.wait_for_timeout(300)
            check("카톡 — 다시 복사", pg.evaluate("() => navigator.clipboard.readText()").strip() == modal["text"].strip(), "")
            pg.click("#kakao-close")
            pg.wait_for_timeout(250)
            check("카톡 — 닫기", pg.evaluate("() => document.getElementById('kakao-modal').hidden"), "")
            pg.click("#btn-kakao")
            pg.wait_for_timeout(300)
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(200)
            esc_closed = pg.evaluate("() => document.getElementById('kakao-modal').hidden")
            if not esc_closed:
                pg.click("#kakao-close")
                pg.wait_for_timeout(200)
            check("카톡 — Esc 닫기", esc_closed, esc_closed)

            # =========================================================
            # 8. 사진 AI 직접 기재 담보 매핑 (custom)
            # =========================================================
            parsed = pg.evaluate("""() => {
              const text = ['[뇌]', '특정순환계질환(3~5종) 주요치료비 2,000만원',
                            '[암]', '표적항암약물허가치료비 3,000만원', '일반암 진단비 5,000만원',
                            '[간병]', '중증치매간병비 8만원'].join('\\n');
              const r = BojangImport.parseCoverageText(text);
              return r.items.map(it => ({ label: it.label, kind: it.kind, area: it.area, value: it.value, name: it.name }));
            }""")
            custom = [it for it in parsed if it.get("kind") == "custom"]
            check("파서 — 직접 기재 담보 2건 인식", len(custom) == 2, custom)
            check("파서 — 특정순환계질환 → 뇌 통합형", any(it["name"] == "특정순환계질환(3~5종) 주요치료비" and it["area"] == "brain" and it["value"] == 2000 for it in custom), custom[:1])
            check("파서 — 중증치매간병비 → 간병", any(it["name"] == "중증치매간병비" and it["area"] == "care" for it in custom), custom)
            check("파서 — 표적항암은 표준 항암약물치료비 칸으로(이중 반영 없음)",
                  any(it.get("label") == "항암약물치료비" and it.get("value") == 3000 for it in parsed) and not any(it["name"] == "표적항암약물허가치료비" for it in custom), parsed[:2])
            check("파서 — 표준 규칙과 이중 반영 없음", len([it for it in parsed if it.get("label") == "일반암 진단비"]) == 1, parsed)
            applied = pg.evaluate("""() => {
              BojangApp.state.cov.custom = { cancer: [], brain: [], heart: [], surgery: [], care: [] };
              const items = [
                { kind: 'custom', area: 'brain', name: '특정순환계질환(3~5종) 주요치료비', value: 2000, mode: 'bundle', apply: true },
                { kind: 'custom', area: 'cancer', name: '표적항암약물허가치료비', value: 3000, mode: 'individual', apply: true },
                { kind: 'custom', area: 'care', name: '중증치매간병비', value: 8, mode: 'individual', apply: true }
              ];
              BojangApp.applyImport(items, {});
              const c = BojangApp.state.cov.custom;
              return c;
            }""")
            check("반영 — custom 3영역 입력", applied["brain"][0]["amount"] == 2000 and applied["cancer"][0]["amount"] == 3000 and applied["care"][0]["amount"] == 8, applied)

            # =========================================================
            # 9. PDF — 01p 명함 QR 46pt 스캔
            # =========================================================
            pg.evaluate(FILL)
            pg.wait_for_timeout(300)
            out = pg.evaluate(CAPTURE_PDF, "detail")
            check("10장 PDF — 페이지 수", out["pages"] == 10, out["pages"])
            check("10장 PDF — 넘침 0", out["overflow"] == [], out["overflow"])
            pdf_path = os.path.join(OUT, "v58-detail.pdf")
            with open(pdf_path, "wb") as f:
                f.write(base64.b64decode(out["b64"]))
            doc = pymupdf.open(pdf_path)
            try:
                pix = doc[0].get_pixmap(dpi=300)
                png = os.path.join(SHOTS, "detail-01-qr-cover.png")
                pix.save(png)
                qr_text, qr_w = None, 0.0
                if zxingcpp:
                    import cv2
                    img = cv2.imread(png)
                    res = zxingcpp.read_barcodes(img)
                    if res:
                        qr_text = res[0].text
                        pos = res[0].position
                        qr_w = abs(pos.top_right.x - pos.top_left.x) / 300.0 * 72
                check("01p 명함 QR — 스캔값 일치", qr_text == "https://open.kakao.com/o/bojang58", qr_text)
                check("01p 명함 QR — 40pt 초과(46pt 박스)", qr_w >= 38.0, round(qr_w, 2))
            finally:
                doc.close()
            pg.screenshot(path=os.path.join(SHOTS, "ui-cloud-sync.png"), full_page=True)

            # =========================================================
            # 10. 360px 넘침 0 · 콘솔 오류 0
            # =========================================================
            small = browser.new_context(viewport={"width": 360, "height": 780}, device_scale_factor=2)
            sp = small.new_page()
            serr = []
            sp.on("console", lambda m: serr.append(m.text) if m.type == "error" else None)
            sp.on("pageerror", lambda e: serr.append("pageerror: " + str(e)))
            sp.goto(base + "/index.html", wait_until="load")
            sp.wait_for_timeout(1200)
            sp.evaluate("() => { const t = document.getElementById('tour-invite'); if (t) t.hidden = true; }")
            over = {}
            for view in ("home", "analysis", "disclose", "toolkit"):
                sp.evaluate("(v) => BojangApp.switchView(v)", view)
                sp.wait_for_timeout(400)
                over[view] = sp.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check("360px — 가로 넘침 0 (홈·분석·고지·툴킷)", all(v <= 1 for v in over.values()), over)
            sp.evaluate("() => BojangApp.switchView('disclose')")
            sp.wait_for_timeout(300)
            sp.click("[data-disc-period='5년']")
            sp.wait_for_timeout(300)
            over_disc = sp.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check("360px — 고지 도구 넘침 0", over_disc <= 1, over_disc)
            check("360px — 콘솔 오류 0", not serr, serr[:2])
            all_errors += errors + serr
            small.close()
            pg.close()
            ctx.close()
            check("전체 콘솔 오류 0", not app_errors(all_errors), app_errors(all_errors)[:3])

            # =========================================================
            # 11. 단일 HTML
            # =========================================================
            single = read(os.path.join(ROOT, "dist", "bojang-guide.single.html"))
            check("단일 HTML — v5.8 기능 반영", all(k in single for k in [
                "v5.8", "syncConsultation", "pullConsultations", "kakaoSummary", "disc-tab", "const qs = 46;",
                "parseCustomItems"]), True)
            refs = re.findall(r'<(?:script|link|img)[^>]+(?:src|href)="([^"]+)"', single)
            ext = [r for r in refs if r.startswith("http") or r.startswith("//")]
            check("단일 HTML — 외부 참조 0", not ext, ext[:3])
            browser.close()
    finally:
        httpd.shutdown()

    ok = sum(1 for _, o, _ in results if o)
    total = len(results)
    print("\n=== v5.8 테스트 %d/%d 통과 ===" % (ok, total))
    with open(os.path.join(OUT, "v58-results.json"), "w", encoding="utf-8") as f:
        json.dump({"ok": ok, "total": total, "results": [
            {"name": n, "ok": o, "detail": str(d)} for n, o, d in results]}, f, ensure_ascii=False, indent=2)
    return 0 if ok == total else 1


if __name__ == "__main__":
    sys.exit(main())
