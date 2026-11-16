#!/usr/bin/env python3
"""보장분석 라이프 리포트 v5.4 — Playwright 자동 검증.

실행: python3 tests/test_v5_4.py

검증:
  · supabase/ 백엔드 패키지: SQL 구문(pglast) · 테이블/RLS/트리거/is_pro 필수 요소
  · Edge Function 3종: deno check 타입 검사 + 휘발성·CORS·요금 상수·서명 검증 필수 요소
  · 계정/구독 모달: 열기 · 로그인/회원가입 탭 · 구독 요금(월 5,000원/연 50,000원) · 베타 안내 문구
  · 로컬 베타 모드: 외부 요청 0 · 입력값 미전송 · 사진 촬영 시 v5.3 정적 안내 유지
  · 모의(mock) 백엔드: 연결 테스트 → 실서버 모드 · 회원가입/로그인 세션 · 구독 상태 반영
  · 모의 비전 응답: 사진 촬영 → 멀티파트 전송 → 비전 JSON → 검수 화면 → 입력칸 반영(엔드투엔드)
  · 결제 함수 호출 본문(plan) · 서버 금액(5,000/50,000) 확인
  · 콘솔 오류 0 · 모바일(360px) 넘침 0 · 단일 HTML 외부 참조 0
  · 대표 스크린샷 3장
"""
import functools
import http.server
import json
import os
import re
import socket
import socketserver
import subprocess
import sys
import threading
import time

for _libs in ("/workspace/tmp/libs/usr/lib/x86_64-linux-gnu", "/workspace/.pwlibs/root/usr/lib/x86_64-linux-gnu"):
    if os.path.isdir(_libs):
        os.environ.setdefault("LD_LIBRARY_PATH", _libs)
        break

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUP = os.path.join(ROOT, "supabase")
OUT = os.path.join(ROOT, "tests", "out")
SHOTS = "/workspace/reports/bojang-guide/screenshots"
os.makedirs(OUT, exist_ok=True)
os.makedirs(SHOTS, exist_ok=True)

BETA_NOTICE = "현재 베타 오프라인 모드 · 서버 연결 시 클라우드 동기화 및 AI 사진 인식이 활성화됩니다"
VISION_TEXT = "\n".join([
    "일반암 진단비 5,000만원",
    "유사암 진단비 1,000만원",
    "뇌혈관질환 진단비 2,000만원",
    "월 보험료 24만원",
    "실손의료보험 4세대",
])

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ((" · " + str(detail)) if detail else ""))
    return ok


# =========================================================
# 1. 백엔드 패키지 파일 검사
# =========================================================
SQL_PATH = os.path.join(SUP, "migrations", "001_initial_schema.sql")
CFG_PATH = os.path.join(SUP, "config.toml")
FN = {
    "vision": os.path.join(SUP, "functions", "parse-coverage-vision", "index.ts"),
    "billing": os.path.join(SUP, "functions", "billing-subscribe", "index.ts"),
    "webhook": os.path.join(SUP, "functions", "billing-webhook", "index.ts"),
}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def check_backend_package():
    for label, path in [("SQL", SQL_PATH), ("config.toml", CFG_PATH),
                        ("parse-coverage-vision", FN["vision"]),
                        ("billing-subscribe", FN["billing"]),
                        ("billing-webhook", FN["webhook"]),
                        ("DEPLOY.md", os.path.join(SUP, "DEPLOY.md"))]:
        check(f"supabase/{label} 존재", os.path.isfile(path), path.replace(ROOT + "/", ""))

    sql = read(SQL_PATH)
    parsed = None
    try:
        import pglast  # type: ignore
        parsed = len(pglast.parse_sql(sql))
    except Exception as e:
        parsed = "parser-unavailable: %s" % e
    check("SQL 구문 파싱 성공", isinstance(parsed, int) and parsed > 30, parsed)

    tables = ["profiles", "subscriptions", "clients", "brand_settings", "audit_logs"]
    check("SQL 5개 테이블", all(re.search(r"create table if not exists public\.%s" % t, sql) for t in tables),
          [t for t in tables if not re.search(r"create table if not exists public\.%s" % t, sql)])
    check("SQL RLS 활성 5개", len(re.findall(r"alter table public\.\w+\s+enable row level security", sql)) == 5,
          len(re.findall(r"alter table public\.\w+\s+enable row level security", sql)))
    check("SQL updated_at 트리거", sql.count("execute function public.set_updated_at()") >= 4
          and "create or replace function public.set_updated_at()" in sql, sql.count("set_updated_at()"))
    check("SQL is_pro() 함수", "create or replace function public.is_pro(uid uuid)" in sql
          and "security definer" in sql, "is_pro")
    check("SQL 본인 행 정책", all(p in sql for p in ["profiles_self_read", "subs_self_read", "clients_rw", "brand_read", "brand_write", "audit_self_read"]), "policies")
    check("SQL billing_key 컬럼 권한 차단", re.search(r"grant select \([\s\S]*?\) on public\.subscriptions to authenticated", sql) is not None
          and "billing_key" not in re.search(r"grant select \(([\s\S]*?)\) on public\.subscriptions", sql).group(1), "column grant")
    check("SQL 웹훅 멱등 인덱스", "audit_logs_dedupe_uidx" in sql and "dedupe_key" in sql, "dedupe")

    cfg = read(CFG_PATH)
    for fn in ["parse-coverage-vision", "billing-subscribe", "billing-webhook"]:
        check(f"config.toml 함수 {fn}", "[functions.%s]" % fn in cfg, fn)
    check("웹훅 함수 verify_jwt=false", re.search(r"\[functions\.billing-webhook\][\s\S]*?verify_jwt = false", cfg) is not None, "webhook jwt")
    check("서울 리전·리다이렉트 설정", "byhan2025.github.io" in cfg and "enable_refresh_token_rotation = true" in cfg, "auth cfg")

    vision = read(FN["vision"])
    check("비전: JWT 검증", "requireUser(" in vision and "Authorization" in vision, "requireUser")
    check("비전: 10MB 제한", "10 * 1024 * 1024" in vision and "too_large" in vision, "10MB")
    check("비전: 저장 금지(스토리지 미사용)", "storage.from(" not in vision and ".upload(" not in vision, "no storage")
    check("비전: 버퍼·base64 참조 해제", "bytes = null" in vision and "b64 = null" in vision, "null refs")
    check("비전: 캐시 금지·CORS", "preflight(" in vision and "no-store" in read(os.path.join(SUP, "functions", "_shared", "http.ts")), "no-store")
    check("비전: OpenAI·Gemini 경로", "api.openai.com" in vision and "generativelanguage.googleapis.com" in vision, "providers")
    check("비전: 표준 스키마(persisted:false)", "bojang.coverage.v1" in vision and "persisted: false" in vision
          and "stored_bytes: 0" in vision, "schema")
    check("비전: 레이트 리밋", "RATE_LIMIT_PER_MIN = 6" in vision and "rate_limited" in vision, "rate limit")
    check("비전: PII 마스킹", "maskPii" in vision and r"\d{6}" in vision, "mask")

    billing = read(FN["billing"])
    check("결제: 요금 상수 5,000/50,000", "month: { amount: 5000" in billing and "year: { amount: 50000" in billing, "PLAN_PRICE")
    check("결제: 금액 서버 신뢰", "클라이언트 값을 쓰지 않습니다" in billing or "PLAN_PRICE[cycle].amount" in billing, "server amount")
    check("결제: JWT 필수", "requireUser(" in billing, "requireUser")
    check("결제: 토스 빌링키 발급+첫 결제", "/v1/billing/authorizations/issue" in billing and "/v1/billing/" in billing, "toss")
    check("결제: 포트원 검증", "api.portone.io" in billing and "amount_mismatch" in billing, "portone")
    check("결제: 테스트 모드", "BILLING_TEST_MODE" in billing and "test: true" in billing, "test mode")
    check("결제: subscriptions 갱신", 'from("subscriptions")' in billing and "current_period_end" in billing, "db")

    webhook = read(FN["webhook"])
    check("웹훅: HMAC 서명 검증", "hmacB64" in webhook and "timingSafeEqual" in webhook and "PG_WEBHOOK_SECRET" in webhook, "hmac")
    check("웹훅: 멱등(중복 200)", "duplicate: true" in webhook and "dedupe" in webhook.lower(), "idempotent")
    check("웹훅: 상태 동기화", "past_due" in webhook and "cancel_at_period_end" in webhook, "state")
    check("웹훅: verify_jwt 없이 서명 인증", "verify_jwt = false" in cfg and "bad_signature" in webhook, "401")

    deno = None
    for cand in ("/workspace/.local/deno/deno", os.path.expanduser("~/.deno/bin/deno")):
        if os.path.isfile(cand):
            deno = cand
            break
    if not deno:
        try:
            deno = subprocess.check_output(["which", "deno"], text=True).strip() or None
        except Exception:
            deno = None
    if deno:
        try:
            r = subprocess.run([deno, "check", FN["vision"], FN["billing"], FN["webhook"]],
                               capture_output=True, text=True, timeout=300, cwd=os.path.join(SUP, "functions"))
            err = (r.stderr or "").strip().splitlines()
            check("Edge Function deno check 통과", r.returncode == 0, (err[-1] if err else "ok")[:120])
        except subprocess.TimeoutExpired:
            check("Edge Function deno check 통과", False, "timeout")
    else:
        print("[SKIP] deno 미설치 — deno check 생략 (구조 검증은 위에서 수행)")


# =========================================================
# 2. 모의(mock) 백엔드 서버
# =========================================================
MOCK = {"vision": [], "billing": [], "auth": [], "rest": []}


class MockHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _body(self):
        n = int(self.headers.get("content-length") or 0)
        return self.rfile.read(n) if n else b""

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def do_GET(self):
        p = self.path.split("?")[0]
        if p.startswith("/auth/v1/health"):
            self._json(200, {"name": "GoTrue", "version": "mock", "description": "mock auth"})
            return
        if p.startswith("/rest/v1/subscriptions"):
            self._json(200, [{"plan": "pro", "status": "active", "billing_cycle": "year",
                              "current_period_end": "2027-11-16T00:00:00Z", "price_krw": 50000}])
            return
        if p.startswith("/rest/v1/"):
            self._json(200, [])
            return
        super().do_GET()

    def do_POST(self):
        p = self.path.split("?")[0]
        body = self._body()
        if p.startswith("/auth/v1/signup") or p.startswith("/auth/v1/token"):
            try:
                payload = json.loads(body.decode("utf-8") or "{}")
            except Exception:
                payload = {}
            MOCK["auth"].append({"path": p, "payload": payload})
            email = payload.get("email", "fc@example.com")
            self._json(200, {
                "access_token": "mock-access-token", "refresh_token": "mock-refresh-token",
                "expires_in": 3600, "token_type": "bearer",
                "user": {"id": "11111111-2222-3333-4444-555555555555", "email": email},
            })
            return
        if p.startswith("/auth/v1/logout"):
            self.send_response(204)
            self.end_headers()
            return
        if p.startswith("/rest/v1/"):
            MOCK["rest"].append({"path": p, "body": body.decode("utf-8", "ignore")})
            self._json(201, [])
            return
        if p.startswith("/functions/v1/parse-coverage-vision"):
            ct = self.headers.get("content-type", "")
            MOCK["vision"].append({"content_type": ct, "length": len(body),
                                   "auth": self.headers.get("authorization", ""),
                                   "body_head": body[:400].decode("latin-1")})
            self._json(200, {
                "ok": True, "schema": "bojang.coverage.v1", "text": VISION_TEXT,
                "lines": 5, "items": [], "premium": None, "silson": None,
                "hint": "보장분석 담보표", "model": "gpt-4o-mini-mock", "ms": 412,
                "persisted": False, "stored_bytes": 0,
            })
            return
        if p.startswith("/functions/v1/billing-subscribe"):
            try:
                payload = json.loads(body.decode("utf-8") or "{}")
            except Exception:
                payload = {}
            MOCK["billing"].append({"payload": payload, "auth": self.headers.get("authorization", "")})
            cycle = payload.get("plan", "month")
            amount = 50000 if cycle == "year" else 5000
            self._json(200, {
                "ok": True, "test": True, "provider": "test", "plan": "pro", "status": "active",
                "billing_cycle": cycle, "price_krw": amount,
                "current_period_start": "2026-11-16T03:00:00Z",
                "current_period_end": "2027-11-16T03:00:00Z",
            })
            return
        self._json(404, {"error": "not_found"})


def start_server(root):
    handler = functools.partial(MockHandler, directory=root)
    socketserver.TCPServer.allow_reuse_address = True
    for _ in range(30):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        try:
            httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
        except OSError:
            continue
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        for _ in range(50):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    return httpd, f"http://127.0.0.1:{port}"
            except OSError:
                time.sleep(0.05)
    raise RuntimeError("server start failed")


def make_photo(path):
    try:
        from PIL import Image, ImageDraw
    except Exception:
        import base64
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        with open(path, "wb") as f:
            f.write(png)
        return
    img = Image.new("RGB", (1200, 1600), "#ffffff")
    d = ImageDraw.Draw(img)
    d.text((80, 60), "COVERAGE TABLE", fill="#111111")
    for i in range(22):
        d.line([(80, 130 + i * 66), (1120, 130 + i * 66)], fill="#1b1b1b", width=5)
    img.save(path, "JPEG", quality=90)


# =========================================================
# 3. 브라우저 검증
# =========================================================
def main():
    print("=" * 70)
    print("1) 백엔드 패키지 검사")
    print("=" * 70)
    check_backend_package()

    photo = os.path.join(OUT, "v54-photo.jpg")
    make_photo(photo)

    httpd, base = start_server(ROOT)
    url = base + "/index.html"
    errors = []
    external = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"),
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=2)
            page = ctx.new_page()
            page.add_init_script("window.__BOJANG_CONFIG__ = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };")
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            page.on("request", lambda r: external.append(r.url) if not r.url.startswith(base) and not r.url.startswith("data:") else None)
            page.set_default_timeout(20000)
            page.goto(url, wait_until="load")
            page.wait_for_timeout(600)
            page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
            page.reload(wait_until="load")
            page.wait_for_timeout(900)

            print("\n" + "=" * 70)
            print("2) 버전 · 모드 · 계정 진입점")
            print("=" * 70)
            title = page.title()
            check("타이틀 v5.4 이상", any(v in title for v in ("v5.4", "v5.5", "v5.6", "v5.7", "v5.8", "v5.9")) and "보장분석 라이프 리포트" in title, title)
            check("메인 eyebrow V5.4 이상", any(v in page.inner_text(".hh-eyebrow") for v in ("V5.4", "V5.5", "V5.6", "V5.7", "V5.8", "V5.9")), page.inner_text(".hh-eyebrow"))
            check("메인 버전 표기", any(v in page.inner_text(".hh-ver") for v in ("v5.4", "v5.5", "v5.6", "v5.7", "v5.8", "v5.9")), page.inner_text(".hh-ver"))
            sw = read(os.path.join(ROOT, "sw.js"))
            check("서비스워커 캐시 v5.4 이상", any(v in sw for v in ("'bojang-guide-v5.4'", "'bojang-guide-v5.5'", "'bojang-guide-v5.6'", "'bojang-guide-v5.7'", "'bojang-guide-v5.8'", "'bojang-guide-v5.9'")), sw.splitlines()[2] if sw else "")
            check("서비스워커 backend.js 포함", "./backend.js" in sw, "asset")
            check("backend.js 모듈 로드", page.evaluate("() => typeof BojangBackend === 'object'"), "BojangBackend")
            check("기본 모드 beta-local", page.evaluate("() => BojangBackend.mode()") == "beta-local",
                  page.evaluate("() => BojangBackend.mode()"))
            check("계정 버튼(헤더 고객 스트립)", page.is_visible("#btn-account") and page.get_attribute("#btn-account", "data-account") == "1",
                  page.inner_text("#btn-account").replace("\n", " "))
            page.evaluate("() => BojangApp.openMoreMenu(true)")
            page.wait_for_timeout(150)
            check("계정 버튼(메인 허브 · 더보기 메뉴)", page.is_visible("#btn-account-home")
                  and "계정 / 구독" in page.inner_text("#btn-account-home"), page.inner_text("#btn-account-home").replace("\n", " "))
            page.evaluate("() => BojangApp.openMoreMenu(false)")

            print("\n" + "=" * 70)
            print("3) 계정 / 구독 모달 (베타 오프라인)")
            print("=" * 70)
            page.click("#btn-account")
            page.wait_for_timeout(400)
            check("모달 열림", page.is_visible("#account-modal"), page.is_visible("#account-modal"))
            check("서버 상태 칩", "베타 오프라인 모드" in page.inner_text("#acct-chip"), page.inner_text("#acct-chip"))
            check("베타 안내 문구", BETA_NOTICE in page.inner_text("#acct-server-note").replace("\n", " "),
                  page.inner_text("#acct-server-note")[:80])
            check("로그인/회원가입 탭", page.is_visible('[data-authtab="signin"]') and page.is_visible('[data-authtab="signup"]')
                  and page.inner_text('#account-modal').count("회원가입") >= 1, "tabs")
            check("로그인 폼(이메일·비밀번호)", page.is_visible("#acct-email") and page.is_visible("#acct-pw")
                  and page.get_attribute("#acct-email", "type") == "email"
                  and page.get_attribute("#acct-pw", "type") == "password", "form")
            plans = page.inner_text(".acct-plans").replace("\n", " ")
            check("구독 요금 월 5,000원", "월 5,000원" in plans, plans[:60])
            check("구독 요금 연 50,000원", "연 50,000원" in plans, plans[:60])
            check("구독 CTA 기본 월 요금", "월 5,000원" in page.inner_text("#acct-pay"), page.inner_text("#acct-pay"))
            page.click('[data-acctplan="year"]')
            page.wait_for_timeout(200)
            check("연 구독 선택 시 CTA 갱신", "연 50,000원" in page.inner_text("#acct-pay")
                  and page.get_attribute('[data-acctplan="year"]', "aria-pressed") == "true", page.inner_text("#acct-pay"))
            page.click('[data-acctplan="month"]')
            page.wait_for_timeout(150)
            page.screenshot(path=os.path.join(SHOTS, "v54-01-account-modal.png"))

            # 잘못된 이메일 → 형식 검증
            page.fill("#acct-email", "not-an-email")
            page.fill("#acct-pw", "123456")
            page.click("#acct-submit")
            page.wait_for_timeout(250)
            check("이메일 형식 검증", "이메일 형식" in page.inner_text("#acct-msg"), page.inner_text("#acct-msg"))
            # 정상 입력 → 베타 오프라인 안내(전송 없음)
            page.fill("#acct-email", "fc@example.com")
            page.click("#acct-submit")
            page.wait_for_timeout(300)
            msg = page.inner_text("#acct-msg")
            check("베타 모드 로그인 시도 안내", BETA_NOTICE in msg and "전송되지 않았습니다" in msg, msg[:90])
            check("베타 모드 세션 미생성", page.evaluate("() => localStorage.getItem('bojang.auth.v1')") is None, "no session")
            page.click("#acct-pay")
            page.wait_for_timeout(300)
            check("베타 모드 구독 안내", "서버 연결 후" in page.inner_text("#acct-msg"), page.inner_text("#acct-msg")[:80])
            page.click("#acct-x")
            page.wait_for_timeout(250)
            check("모달 닫기", not page.is_visible("#account-modal"), page.is_visible("#account-modal"))

            print("\n" + "=" * 70)
            print("4) 베타 모드 사진 촬영 — v5.3 안내 유지 · 외부 요청 0")
            print("=" * 70)
            keys_before = page.evaluate("() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).sort().join(',')")
            page.evaluate("() => BojangApp.switchView('capture')")
            page.wait_for_timeout(300)
            page.set_input_files("#cap-file", photo)
            page.wait_for_timeout(1500)
            check("촬영 결과 표시", page.is_visible("#cap-result"), page.is_visible("#cap-result"))
            beta = page.inner_text("#cap-beta")
            check("베타 정적 안내 유지", all(k in beta for k in ["정적 베타", "95% 이상", "PDF 파일 올리기"]), beta[:70])
            check("베타 모드 비전 호출 0", len(MOCK["vision"]) == 0, len(MOCK["vision"]))
            keys_after = page.evaluate("() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).sort().join(',')")
            check("저장소 키 변화 0", keys_before == keys_after, (keys_before, keys_after))
            check("베타 모드 외부 요청 0", len(external) == 0, external[:3])

            print("\n" + "=" * 70)
            print("5) 모의 백엔드 연결 — 개발자 설정 패널")
            print("=" * 70)
            page.evaluate("() => BojangApp.switchView('home')")
            page.wait_for_timeout(200)
            page.click("#btn-account")
            page.wait_for_timeout(300)
            page.click("#acct-dev")
            page.wait_for_timeout(250)
            check("개발자 설정 패널", page.is_visible("#acct-dev-panel"), True)
            page.fill("#acct-url", base)
            page.fill("#acct-key", "mock-anon-key")
            page.click("#acct-save")
            page.wait_for_timeout(900)
            check("실서버 모드 전환", page.evaluate("() => BojangBackend.mode()") == "live-backend",
                  page.evaluate("() => BojangBackend.mode()"))
            check("연결 테스트 통과", page.evaluate("() => BojangBackend.state().connection") == "ok",
                  page.evaluate("() => BojangBackend.state().connection"))
            check("연결됨 칩", "실서버 연결됨" in page.inner_text("#acct-chip"), page.inner_text("#acct-chip"))
            check("연결 안내 문구", "실서버" in page.inner_text("#acct-server-note"), page.inner_text("#acct-server-note")[:60])

            print("\n" + "=" * 70)
            print("6) 회원가입 · 로그인 · 구독 상태")
            print("=" * 70)
            page.click('[data-authtab="signup"]')
            page.wait_for_timeout(150)
            check("회원가입 탭 전환", page.inner_text("#acct-submit") == "회원가입", page.inner_text("#acct-submit"))
            page.fill("#acct-email", "fc@example.com")
            page.fill("#acct-pw", "123456")
            page.click("#acct-submit")
            page.wait_for_timeout(1200)
            check("회원가입 요청 전송", len(MOCK["auth"]) == 1 and "/auth/v1/signup" in MOCK["auth"][0]["path"], MOCK["auth"])
            check("세션 저장", page.evaluate("() => !!localStorage.getItem('bojang.auth.v1')"), "session")
            check("로그인 상태 UI", page.is_visible("#acct-signedin") and not page.is_visible("#acct-signedout"),
                  page.is_visible("#acct-signedin"))
            check("계정 이메일 표시", page.inner_text("#acct-email-view") == "fc@example.com", page.inner_text("#acct-email-view"))
            check("구독 상태 서버 반영", "Pro" in page.inner_text("#acct-sub-state") and "active" in page.inner_text("#acct-sub-state"),
                  page.inner_text("#acct-sub-state"))
            check("BojangPlan hydrate (pro)", page.evaluate("() => BojangPlan.currentPlan()") == "pro",
                  page.evaluate("() => BojangPlan.currentPlan()"))
            page.screenshot(path=os.path.join(SHOTS, "v54-03-live-account.png"))

            # 구독 시작 (연 50,000원) — 서버 금액·플랜 확인
            page.click('[data-acctplan="year"]')
            page.wait_for_timeout(150)
            page.click("#acct-pay")
            page.wait_for_timeout(900)
            check("결제 함수 호출", len(MOCK["billing"]) >= 1, len(MOCK["billing"]))
            check("결제 요청 플랜=year", MOCK["billing"][-1]["payload"].get("plan") == "year", MOCK["billing"][-1]["payload"])
            check("결제 요청 JWT 포함", "Bearer mock-access-token" == MOCK["billing"][-1]["auth"], MOCK["billing"][-1]["auth"])
            pay_msg = page.inner_text("#acct-msg")
            check("구독 시작 안내", "테스트 모드" in pay_msg or "구독" in pay_msg, pay_msg[:80])
            check("구독 상태 갱신(연 50,000원)", "50,000원" in page.inner_text("#acct-pay")
                  and "사용 중" in page.inner_text("#acct-pay"), page.inner_text("#acct-pay"))
            page.click("#acct-x")
            page.wait_for_timeout(250)

            print("\n" + "=" * 70)
            print("7) 사진 → AI 비전(모의) → 검수 화면 → 반영")
            print("=" * 70)
            page.evaluate("() => BojangApp.switchView('capture')")
            page.wait_for_timeout(300)
            keys_before2 = page.evaluate("() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).sort().join(',')")
            page.set_input_files("#cap-file", photo)
            page.wait_for_timeout(2200)
            check("비전 엔드포인트 호출", len(MOCK["vision"]) == 1, len(MOCK["vision"]))
            vreq = MOCK["vision"][0] if MOCK["vision"] else {}
            check("멀티파트 이미지 전송", "multipart/form-data" in vreq.get("content_type", "")
                  and 'name="image"' in vreq.get("body_head", "") and vreq.get("length", 0) > 2000,
                  (vreq.get("content_type", ""), vreq.get("length")))
            check("비전 호출 JWT", "Bearer mock-access-token" == vreq.get("auth"), vreq.get("auth"))
            check("검수 화면 자동 이동", page.is_visible("#view-import")
                  and "is-active" in page.get_attribute("#view-import", "class"), page.get_attribute("#view-import", "class"))
            check("검수 결과 표시", page.is_visible("#imp-review"), page.is_visible("#imp-review"))
            labels = page.eval_on_selector_all(".rv-main b", "els => els.map(e => e.innerText.trim())")
            pairs = page.evaluate("""() => {
              const out = {};
              document.querySelectorAll('.rv-row').forEach((r) => {
                const b = r.querySelector('.rv-main b');
                const n = r.querySelector('.rv-num');
                out[b.innerText.trim()] = n ? n.value : '';
              });
              return out;
            }""")
            check("비전 인식 5건", len(pairs) == 5 and set(pairs) == {
                "월 보험료", "실손 세대", "일반암 진단비", "유사암 진단비", "뇌혈관질환 진단비"
            }, (len(pairs), labels))
            check("비전 인식 금액", pairs.get("월 보험료") == "24" and pairs.get("일반암 진단비") == "5000"
                  and pairs.get("유사암 진단비") == "1000" and pairs.get("뇌혈관질환 진단비") == "2000"
                  and pairs.get("실손 세대") == "4", pairs)
            snips = page.eval_on_selector_all(".rv-snip", "els => els.map(e => e.innerText.trim())")
            check("근거 원문 표시", len(snips) == 5 and any("일반암 진단비 5,000만원" in s for s in snips), snips[:2])
            summary = page.inner_text("#imp-summary")
            check("검수 요약(사진 AI)", "사진 AI 인식" in summary and "5건 인식" in summary, summary[:80])
            page.wait_for_timeout(200)
            page.screenshot(path=os.path.join(SHOTS, "v54-02-vision-mock.png"))
            keys_after2 = page.evaluate("() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).sort().join(',')")
            check("비전 후 저장소 키 변화 0", keys_before2 == keys_after2, (keys_before2, keys_after2))
            leaked = page.evaluate("""() => {
              const dump = [];
              for (const store of [localStorage, sessionStorage]) {
                for (let i = 0; i < store.length; i++) dump.push(store.getItem(store.key(i)) || '');
              }
              return { img: dump.filter((v) => v.indexOf('data:image') >= 0).length,
                       big: dump.filter((v) => v.length > 200000).length };
            }""")
            check("사진 데이터 저장 0", leaked["img"] == 0 and leaked["big"] == 0, leaked)

            page.click("#imp-apply")
            page.wait_for_timeout(1200)
            state = page.evaluate("""() => ({
              view: document.querySelector('#view-analysis').classList.contains('is-active'),
              general: window.__bojangState.cov.cancer.general,
              similar: window.__bojangState.cov.cancer.similar,
              brain: window.__bojangState.cov.brain.dx.vascular,
              premium: window.__bojangState.premium,
              silson: window.__bojangState.silson,
              score: (document.querySelector('.ring-text strong') || {}).textContent || ''
            })""")
            check("검수 → 입력칸 반영", state["general"] == 5000 and state["similar"] == 1000
                  and state["brain"] == 2000, (state["general"], state["similar"], state["brain"]))
            check("보험료·실손 반영", state["premium"] == 24 and str(state["silson"]) == "4",
                  (state["premium"], state["silson"]))
            check("점수 재계산", state["view"] is True and state["score"].isdigit() and int(state["score"]) > 0,
                  state["score"])

            # 상담 저장 → clients 동기화(mock)
            hist_before = page.evaluate("() => BojangApp.state.history.length")
            page.evaluate("() => { const b = document.getElementById('btn-save'); if (b) b.click(); }")
            page.wait_for_timeout(900)
            hist_after = page.evaluate("() => BojangApp.state.history.length")
            idb_rows = page.evaluate("() => BojangStore.table('history').toArray().then((r) => r.length)")
            check("상담 저장 (IndexedDB 상담 이력)", hist_after > hist_before and idb_rows >= 1, (hist_before, hist_after, idb_rows))
            # v5.8: 상담 1건은 consultations 로 올라가고, 테이블이 없으면 clients 로 폴백합니다
            check("상담 저장 시 서버 동기화(consultations·clients)", len(MOCK["rest"]) >= 1
                  and any(("/rest/v1/consultations" in r["path"]) or ("/rest/v1/clients" in r["path"]) for r in MOCK["rest"]),
                  [r["path"] for r in MOCK["rest"]][:2])
            brand_res = page.evaluate("() => BojangBackend.pushBrandSettings({ name: '테스트 브랜드', slogan: '테스트 슬로건', theme: 'navy', logo: '' })")
            page.wait_for_timeout(400)
            check("브랜드 저장 시 brand_settings 동기화", any("/rest/v1/brand_settings" in r["path"] for r in MOCK["rest"]),
                  (brand_res, [r["path"] for r in MOCK["rest"]]))

            print("\n" + "=" * 70)
            print("8) 로그아웃 · 연결 실패 · 모바일")
            print("=" * 70)
            page.evaluate("() => BojangBackend.openAccount()")
            page.wait_for_timeout(300)
            page.click("#acct-signout")
            page.wait_for_timeout(600)
            check("로그아웃 세션 삭제", page.evaluate("() => localStorage.getItem('bojang.auth.v1')") is None, "cleared")
            check("로그아웃 후 free", page.evaluate("() => BojangPlan.currentPlan()") == "free",
                  page.evaluate("() => BojangPlan.currentPlan()"))
            check("로그아웃 후 로그인 폼", page.is_visible("#acct-signedout"), True)
            check("기기 상담 기록 유지 (IndexedDB)", page.evaluate("() => BojangApp.state.history.length") >= 1,
                  "history")
            if not page.is_visible("#acct-dev-panel"):
                page.click("#acct-dev")
                page.wait_for_timeout(200)
            check("연결 후 설정 패널 자동 접힘→재열기", page.is_visible("#acct-dev-panel"), True)
            page.fill("#acct-url", "http://127.0.0.1:1")
            page.fill("#acct-key", "bad-key")
            page.click("#acct-save")
            page.wait_for_timeout(1200)
            check("연결 실패 표시", "연결 실패" in page.inner_text("#acct-chip"), page.inner_text("#acct-chip"))

            page.set_viewport_size({"width": 360, "height": 780})
            page.wait_for_timeout(300)
            over = page.evaluate("""() => {
              const de = document.documentElement;
              const wide = [];
              const card = document.querySelector('#account-modal .acct-card');
              card.querySelectorAll('*').forEach((el) => {
                const b = el.getBoundingClientRect();
                if (b.width > 0 && (b.right > de.clientWidth + 1.5 || b.left < -1.5)) wide.push(el.className || el.tagName);
              });
              return { d: de.scrollWidth, c: de.clientWidth, wide: wide.slice(0, 4), card: card.getBoundingClientRect().width };
            }""")
            check("360px 계정 모달 넘침 0", over["d"] <= over["c"] + 1 and not over["wide"], over)
            page.click("#acct-x")
            page.wait_for_timeout(200)
            page.set_viewport_size({"width": 430, "height": 932})
            page.evaluate("() => BojangApp.switchView('home')")
            page.wait_for_timeout(300)
            over2 = page.evaluate("""() => {
              const de = document.documentElement;
              return { d: de.scrollWidth, c: de.clientWidth };
            }""")
            check("430px 메인 넘침 0", over2["d"] <= over2["c"] + 1, over2)

            # 의도적으로 연결 실패(127.0.0.1:1)를 만들었으므로 그 네트워크 노이즈만 분리합니다
            network_noise = [e for e in errors
                             if "Failed to load resource" in e and ("ERR_UNSAFE_PORT" in e or "ERR_CONNECTION_REFUSED" in e
                                                                   or "ERR_NAME_NOT_RESOLVED" in e)]
            others = [e for e in errors if e not in network_noise]
            check("의도적 연결 실패는 네트워크 오류만", len(network_noise) <= 2, network_noise[:2])
            check("콘솔 오류 0 (의도적 연결 실패 제외)", len(others) == 0, others[:3])

            print("\n" + "=" * 70)
            print("9) 단일 HTML · file:// 오프라인")
            print("=" * 70)
            single = os.path.join(ROOT, "dist", "bojang-guide.single.html")
            html = read(single)
            check("단일 HTML: v5.4 · backend 포함", "v5.4" in html and "BojangBackend" in html and "BojangImport" in html,
                  len(html) // 1024)
            check("단일 HTML: 외부 참조 0", '<script src="./' not in html and '<link rel="stylesheet" href="./' not in html, "refs")
            ctx2 = browser.new_context(viewport={"width": 430, "height": 932})
            p2 = ctx2.new_page()
            p2.add_init_script("window.__BOJANG_CONFIG__ = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };")
            file_errors = []
            p2.on("pageerror", lambda e: file_errors.append(str(e)))
            p2.on("console", lambda m: file_errors.append(m.text) if m.type == "error" else None)
            p2.goto("file://" + single, wait_until="load")
            p2.wait_for_timeout(900)
            p2.click("#btn-account")
            p2.wait_for_timeout(400)
            file_mode = p2.evaluate("() => BojangBackend.mode()")
            check("file:// 계정 모달 동작", p2.is_visible("#account-modal") and file_mode == "beta-local" and not file_errors,
                  (file_mode, file_errors[:2]))
            p2.fill("#acct-email", "fc@example.com")
            p2.fill("#acct-pw", "123456")
            p2.click("#acct-submit")
            p2.wait_for_timeout(300)
            check("file:// 베타 로그인 안내", BETA_NOTICE in p2.inner_text("#acct-msg"), p2.inner_text("#acct-msg")[:60])
            ctx2.close()
            browser.close()
    finally:
        httpd.shutdown()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
