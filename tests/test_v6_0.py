#!/usr/bin/env python3
"""보장분석 라이프 리포트 v6.0 — 스마트키 · 계정 잠금 · 서버 보안 최종 검증.

실행: python3 tests/test_v6_0.py

검증 축
  A. 버전 v6.0 통일 (version.js · sw.js · manifest · index.html · README · 단일 HTML · 보호 빌드)
  B. PC 스마트키 — RAM 전용 키쌍 · 1회용 챌린지(6자리·2자리·180초) · QR 렌더 · 새 코드 교체
  C. 폰 스마트키 — 카메라 스캔(순수 JS) · 6자리 코드 폴백 · 승인 화면(기기명·시각·도메인·숫자·동일 크기 버튼)
  D. 승인 E2E — PIN/WebAuthn 분기 · 암호화 상담 데이터 전달 · 단회 소비 · PC 세션
  E. 릴레이 방어 — PC 서명 위조 거부 · pc_pub_hash 불일치 · 확인 숫자 불일치 · 만료 · 다른 키 복호 실패
  F. 기기 바인딩 2대 · 1탭 기존 PC 밀어내기 · 원격 잠금(활성 창 즉시 잠금) · 재진입 차단
  G. 자동 잠금 · PIN 오류/해제 · 프라이버시 가림 모드(30장 고객명 마스킹)
  H. 360px 넘침 0 · 콘솔 오류 0 · 단일 HTML 외부 참조 0 · 보호 빌드 동작 동일
  I. 서버 패키지 — 003 마이그레이션(멱등·RLS·2기기 유니크) · Edge Function 3종 · 비전 기기 검증
  J. 정직한 표기 — 실서버 미배포 폴백 · 실기기 미검증 안내
"""
import json
import os
import re
import socket
import socketserver
import sys
import threading
import time
import urllib.parse
import http.server

for _libs in ("/workspace/tmp/libs/usr/lib/x86_64-linux-gnu", "/workspace/.pwlibs/root/usr/lib/x86_64-linux-gnu"):
    if os.path.isdir(_libs):
        os.environ.setdefault("LD_LIBRARY_PATH", _libs)
        break

from playwright.sync_api import sync_playwright

try:
    import pglast
except Exception:  # pragma: no cover
    pglast = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out")
SHOTS = "/workspace/reports/bojang-guide/v6.0"
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
# 모의 Supabase — 실서버가 켜진 상태를 흉내 냅니다.
# Smartkey Edge Function 은 배포되지 않은 상태(404)이므로 앱이 자체 모의 릴레이로
# 폴백하는 경로까지 함께 검증됩니다.
# =====================================================================
UID = "33333333-3333-3333-3333-333333333333"
EMAIL = "qa.v60@bojang.test"
STORE = {"consultations": [], "requests": []}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _empty(self, code=204):
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
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
        return parsed.path, urllib.parse.parse_qs(parsed.query)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.end_headers()

    def do_GET(self):
        path, _ = self._parts()
        if not path.startswith("/mock/"):
            return super().do_GET()
        path = path[len("/mock"):]
        STORE["requests"].append(("GET", path))
        if path == "/auth/v1/health":
            return self._json(200, {"name": "mock", "version": "v6.0"})
        if path in ("/rest/v1/subscriptions", "/rest/v1/brand_settings", "/rest/v1/clients"):
            return self._json(200, [])
        if path == "/rest/v1/consultations":
            return self._json(200, [])
        return self._json(404, {"message": "not found"})

    def do_POST(self):
        path, _ = self._parts()
        if not path.startswith("/mock/"):
            return self._json(404, {"message": "no"})
        path = path[len("/mock"):]
        STORE["requests"].append(("POST", path))
        body = self._body()
        if path == "/auth/v1/token":
            return self._json(200, {"access_token": "mock-token", "refresh_token": "mock-refresh",
                                    "expires_in": 3600, "user": {"id": UID, "email": EMAIL}})
        if path == "/auth/v1/signup":
            return self._json(200, {"access_token": "mock-token", "refresh_token": "mock-refresh",
                                    "expires_in": 3600, "user": {"id": UID, "email": EMAIL}})
        if path == "/auth/v1/logout":
            return self._empty(204)
        if path == "/rest/v1/consultations":
            return self._empty(201)
        # 스마트키 Edge Function 은 미배포 → 404 (앱은 모의 릴레이로 폴백해야 합니다)
        return self._json(404, {"message": "not found"})

    def do_PATCH(self):
        path, _ = self._parts()
        if not path.startswith("/mock/"):
            return self._json(404, {"message": "no"})
        return self._empty(204)


def start_server():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    for _ in range(60):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return httpd, "http://127.0.0.1:%d" % port
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("server start failed")


SET_CLIENT = """() => {
  const S = BojangApp.state;
  S.client = { name: '김민수', birth: '1983-03-12', consultant: '김한기', dateLabel: '2026년 11월 16일' };
  S.age = '40'; S.gender = '남'; S.job = '2'; S.silson = '2'; S.premium = 28; S.sample = false;
  BojangApp.renderAllInputs();
  BojangApp.analyze();
  return { name: S.client.name, prem: S.premium };
}"""


def new_page(browser, base, init_script=None, width=430, height=932):
    ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2)
    errors = []
    ctx.add_init_script("window.__BOJANG_CONFIG__ = { SUPABASE_URL: '%s/mock', SUPABASE_ANON_KEY: 'test-anon-key' };" % base)
    if init_script:
        ctx.add_init_script(init_script)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.set_default_timeout(20000)
    pg.goto(base + "/index.html", wait_until="load")
    pg.wait_for_timeout(1400)
    pg.evaluate("() => { const t = document.getElementById('tour-invite'); if (t) t.hidden = true; }")
    return ctx, pg, errors


def app_errors(errs):
    return [e for e in errs if "Failed to load resource" not in e and "404" not in e[:12]]


def overflow(pg):
    return pg.evaluate("() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)")


def main():
    httpd, base = start_server()
    all_errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"),
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])

            # =========================================================
            # A. 버전 v6.0 · 파일
            # =========================================================
            ctx, pg, errors = new_page(browser, base)
            pg.evaluate(SET_CLIENT)
            ver_src = read(os.path.join(ROOT, "version.js"))
            decls = re.findall(r"const APP_VERSION = '([^']+)'", ver_src)
            check("version.js — APP_VERSION 단일 선언 v6.0", decls == ["v6.0"], decls)
            check("window.APP_VERSION = v6.0", pg.evaluate("() => window.APP_VERSION") == "v6.0", pg.evaluate("() => window.APP_VERSION"))
            check("BojangVersion.value = v6.0", pg.evaluate("() => BojangVersion.value") == "v6.0", pg.evaluate("() => BojangVersion.value"))
            check("헤더 eyebrow V6.0", pg.inner_text(".hh-eyebrow").strip() == "LIFE REPORT · BETA V6.0", pg.inner_text(".hh-eyebrow"))
            check("헤더 버전 표기 v6.0", pg.inner_text(".hh-ver").strip().startswith("v6.0"), pg.inner_text(".hh-ver"))
            check("타이틀 v6.0", "v6.0" in pg.title(), pg.title())
            pg.evaluate("() => BojangApp.switchView('analysis')")
            pg.wait_for_timeout(250)
            check("입력 영역 eyebrow V6.0", "V6.0" in pg.inner_text("#view-analysis .intro-eyebrow"), pg.inner_text("#view-analysis .intro-eyebrow"))
            pg.evaluate("() => BojangPlan.openBetaModal('plan')")
            pg.wait_for_timeout(350)
            check("모달 eyebrow V6.0", "V6.0" in pg.inner_text("#beta-modal .bm-eyebrow"), pg.inner_text("#beta-modal .bm-eyebrow"))
            pg.evaluate("() => { const m = document.getElementById('beta-modal'); if (m) m.hidden = true; }")

            sw = read(os.path.join(ROOT, "sw.js"))
            check("서비스워커 캐시 bojang-guide-v6.0", "const CACHE = 'bojang-guide-v6.0';" in sw, sw.splitlines()[2])
            check("서비스워커 자산 — smartkey.js · qrscan.js", "./smartkey.js" in sw and "./qrscan.js" in sw, "sw.js")
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest v6.0", "v6.0" in man.get("name", ""), man.get("name"))
            check("manifest — 스마트키·원격 잠금·가림 설명", all(k in man.get("description", "") for k in ("스마트키", "원격 잠금", "가림")), man.get("description", "")[:70])
            html = read(os.path.join(ROOT, "index.html"))
            check("index.html — 스마트키 스크립트 로드", "./smartkey.js" in html and "./qrscan.js" in html, "index.html")
            check("index.html — v5.9 표기 잔재 0", "v5.9" not in html, "index.html")
            check("README — v6.0 절", "## v6.0에서 달라진 것" in read(os.path.join(ROOT, "README.md")), "README.md")
            build_src = read(os.path.join(ROOT, "build_single.py"))
            check("build_single — 스마트키 자산 포함", "smartkey.js" in build_src and "qrscan.js" in build_src, "build")
            check("build_single — 보호 패스 함수", "def protect_js" in build_src and "REGEX_PREV" in build_src, "protect_js")

            # =========================================================
            # B. PC 스마트키 — 챌린지 · QR · 180초
            # =========================================================
            check("메뉴 — 스마트키 3버튼", pg.eval_on_selector_all("#btn-smartkey-pc, #btn-smartkey-phone, #btn-smartkey-devices", "els => els.length") == 3)
            r = pg.evaluate("async () => await BojangSmartKey.pc.open()")
            check("PC 챌린지 발급", bool(r and r.get("ok")), r and r.get("ok"))
            ch = pg.evaluate("() => BojangSmartKey.pc.challenge()")
            check("6자리 코드 (숫자 6개)", bool(ch) and re.fullmatch(r"\d{6}", ch["code6"] or "") is not None, ch and ch.get("code6"))
            check("2자리 확인 숫자 (00~99)", bool(ch) and re.fullmatch(r"\d{2}", ch["code2"] or "") is not None, ch and ch.get("code2"))
            check("만료 180초", bool(ch) and 175 <= round((ch["expires_at"] - ch["issued_at"]) / 1000) <= 181,
                  ch and round((ch["expires_at"] - ch["issued_at"]) / 1000))
            check("카운트다운 표시", pg.inner_text("#sk-remain").startswith("남은 시간"), pg.inner_text("#sk-remain"))
            check("QR 렌더 — 실제 모듈", pg.eval_on_selector_all("#sk-qr svg rect", "els => els.length") > 40,
                  pg.eval_on_selector_all("#sk-qr svg rect", "els => els.length"))
            check("6자리 코드 화면 표시", pg.inner_text("#sk-code6").replace(" ", "") == ch["code6"], pg.inner_text("#sk-code6"))
            check("2자리 배지 표시", pg.inner_text("#sk-code2") == ch["code2"], pg.inner_text("#sk-code2"))
            check("대기 상태 문구", "승인을 기다리는 중" in pg.inner_text("#sk-pc-status"), pg.inner_text("#sk-pc-status"))

            payload = pg.evaluate("() => BojangSmartKey.pc.payload()")
            check("QR 페이로드 형식 BJK1|id|code6|code2|hash", payload.startswith("BJK1|") and len(payload.split("|")) == 5, payload[:40])
            check("페이로드에 pc_pub_hash 포함", payload.split("|")[4] == ch["pc_pub_hash"], payload.split("|")[4])

            pc_priv_leak = pg.evaluate("""() => {
              const raw = JSON.stringify(localStorage);
              return { hasCred: /privateKey|"d":/.test(raw), keys: Object.keys(localStorage) };
            }""")
            check("PC 개인키는 저장소에 없음 (RAM 전용)", not pc_priv_leak["hasCred"], pc_priv_leak["keys"])
            check("모의 검증 표기 (실서버 미배포 정직 표기)", "모의 검증" in pg.evaluate("() => BojangSmartKey.server.statusText()"),
                  pg.evaluate("() => BojangSmartKey.server.statusText()"))

            old_id = ch["id"]
            pg.click("#sk-refresh")
            pg.wait_for_timeout(900)
            ch2 = pg.evaluate("() => BojangSmartKey.pc.challenge()")
            check("새 코드 — 새 challenge id", ch2["id"] != old_id, ch2["id"][:12])
            check("새 코드 — 이전 코드 교체됨", pg.evaluate("(id) => BojangSmartKey.server.getChallenge(id).then(o => o.challenge.status)", old_id) == "replaced",
                  pg.evaluate("(id) => BojangSmartKey.server.getChallenge(id).then(o => o.challenge.status)", old_id))
            check("새 코드 — 이전 6자리로 조회 불가", pg.evaluate("(c) => BojangSmartKey.server.peekByCode(c).then(o => o.ok || o.error)", ch["code6"]) in (False, "not-found"),
                  pg.evaluate("(c) => BojangSmartKey.server.peekByCode(c).then(o => o.ok || o.error)", ch["code6"]))

            # PC 서명 자체 검증
            sig_ok = pg.evaluate("""async () => {
              const B = BojangSmartKey.crypto;
              const ch = BojangSmartKey.pc.challenge();
              const text = ['SMK1', 'challenge', ch.pc_pub_hash, String(ch.issued_at)].join('|');
              const good = await B.verifyText(ch.pc_pub_ecdsa, ch.pc_sig, text);
              const bad = await B.verifyText(ch.pc_pub_ecdsa, ch.pc_sig, text + 'x');
              return { good, bad };
            }""")
            check("PC 키 서명 검증 통과", sig_ok["good"] is True, sig_ok)
            check("PC 키 서명 변조 거부", sig_ok["bad"] is False, sig_ok)

            # =========================================================
            # C. 폰 스마트키 — 6자리 폴백 · 승인 화면
            # =========================================================
            ph = pg.evaluate("async () => await BojangSmartKey.phone.open()")
            check("폰 기기 등록 (마스터)", bool(ph and ph.get("ok")), ph and ph.get("ok"))
            check("마스터 등록 확인", pg.evaluate("""async () => {
              const d = await BojangSmartKey.server.devices();
              return (d.devices || []).filter(x => x.kind === 'phone' && x.master).length;
            }""") == 1)
            check("카메라 스캔 버튼 있음", pg.is_visible("#sk-scan-start"))
            check("6자리 직접 입력 폴백 있음", pg.is_visible("#sk-code-input"))
            wrong = pg.evaluate("async () => await BojangSmartKey.phone.submitCode('000000')")
            check("틀린 6자리 — 거부", not wrong.get("ok"), wrong.get("message"))
            check("틀린 코드 안내 문구", "코드" in pg.inner_text("#sk-ph-err"), pg.inner_text("#sk-ph-err"))

            ch3 = pg.evaluate("() => BojangSmartKey.pc.challenge()")
            okc = pg.evaluate("async (c) => await BojangSmartKey.phone.submitCode(c)", ch3["code6"])
            check("맞는 6자리 — 승인 화면 전환", bool(okc.get("ok")) and pg.evaluate("() => BojangSmartKey.phone.step()") == "approve", okc.get("ok"))
            check("승인 화면 — PC 기기명", "PC" in pg.inner_text("#sk-ap-pcname"), pg.inner_text("#sk-ap-pcname"))
            check("승인 화면 — 접속 시각", re.search(r"\d{1,2}월 \d{1,2}일 \d{2}:\d{2}", pg.inner_text("#sk-ap-time2")) is not None, pg.inner_text("#sk-ap-time2"))
            check("승인 화면 — 공식 도메인", "127.0.0.1" in pg.inner_text("#sk-ap-domain"), pg.inner_text("#sk-ap-domain"))
            check("승인 화면 — 2자리 확인 숫자 일치", pg.inner_text("#sk-ap-code2") == ch3["code2"], pg.inner_text("#sk-ap-code2"))
            boxes = pg.evaluate("""() => {
              const a = document.getElementById('sk-reject').getBoundingClientRect();
              const b = document.getElementById('sk-approve-btn').getBoundingClientRect();
              return { w1: Math.round(a.width), w2: Math.round(b.width), h1: Math.round(a.height), h2: Math.round(b.height) };
            }""")
            check("거절/승인 버튼 동등한 크기", abs(boxes["w1"] - boxes["w2"]) <= 1 and abs(boxes["h1"] - boxes["h2"]) <= 1, boxes)

            # 카메라 권한 거부 폴백은 별도 컨텍스트에서
            cam_ctx, cam_pg, cam_err = new_page(browser, base, init_script="""
              Object.defineProperty(navigator, 'mediaDevices', {
                configurable: true,
                value: { getUserMedia: () => Promise.reject(new Error('NotAllowedError')) }
              });
            """)
            cam = cam_pg.evaluate("async () => await BojangSmartKey.phone.scanStart()")
            check("카메라 거부 — 오류로 죽지 않음", cam.get("ok") is False, cam.get("message"))
            check("카메라 거부 — 6자리 입력 안내", "6자리" in cam_pg.inner_text("#sk-ph-err"), cam_pg.inner_text("#sk-ph-err"))
            cam2 = cam_pg.evaluate("""async () => {
              await BojangSmartKey.pc.open();
              const c = BojangSmartKey.pc.challenge();
              return await BojangSmartKey.phone.submitCode(c.code6);
            }""")
            check("카메라 거부 — 6자리 코드로 계속 진행", bool(cam2.get("ok")), cam2.get("ok"))
            all_errors += app_errors(cam_err)
            cam_ctx.close()

            # QR 스캔 디코드 경로 (카메라 대신 동일 페이로드)
            qr_ok = pg.evaluate("""async () => {
              const pl = BojangSmartKey.pc.payload();
              const r = await BojangSmartKey.phone.onDecode(pl);
              return { ok: r.ok, step: BojangSmartKey.phone.step() };
            }""")
            check("QR 스캔 — 승인 화면 진입", qr_ok["ok"] and qr_ok["step"] == "approve", qr_ok)
            tampered = pg.evaluate("""async () => {
              const pl = BojangSmartKey.pc.payload().split('|');
              pl[3] = String((Number(pl[3]) + 7) % 100).padStart(2, '0');
              const r = await BojangSmartKey.phone.onDecode(pl.join('|'));
              return { ok: r.ok, reason: r.reason, err: document.getElementById('sk-ph-err').textContent };
            }""")
            check("QR 변조 — 확인 숫자 불일치 거부", tampered["ok"] is False and tampered["reason"] == "code2-mismatch", tampered)

            # =========================================================
            # D. 승인 E2E — PIN · 암호화 데이터 · 단회 소비
            # =========================================================
            pg.evaluate("async (c) => await BojangSmartKey.phone.submitCode(c)", ch3["code6"])
            first = pg.evaluate("async () => await BojangSmartKey.phone.approveWithPin('4827')")
            check("PIN 승인 — 성공", bool(first.get("ok")), first)
            check("PIN 최초 승인 시 자동 설정", pg.evaluate("() => BojangSmartKey.auth.hasPin()") is True)
            pg.wait_for_timeout(1500)
            st = pg.evaluate("() => BojangSmartKey.pc.state()")
            check("PC 세션 — 승인됨", st["status"] == "approved", st["status"])
            check("PC 세션 — 토큰 발급", bool((st["session"] or {}).get("token")), (st["session"] or {}).get("token", "")[:12])
            check("PC 세션 — 기기 등록", bool((st["session"] or {}).get("bound")), (st["session"] or {}).get("bindError"))
            inh = st["inherited"] or {}
            check("암호화 상담 데이터 복호화", (inh.get("client") or {}).get("name") == "김민수", inh.get("client"))

            reused = pg.evaluate("""async (c) => {
              await BojangSmartKey.phone.submitCode(c);
              return await BojangSmartKey.phone.approveWithPin('4827');
            }""", ch3["code6"])
            check("단회 소비 — 같은 코드 재승인 거부", reused.get("ok") is False, reused.get("message"))

            devs = pg.evaluate("async () => await BojangSmartKey.server.devices()")
            check("기기 2대 등록 (폰+PC)", len(devs.get("devices", [])) == 2, [d["kind"] for d in devs.get("devices", [])])
            sess_ok = pg.evaluate("async () => { const s = BojangSmartKey.pc.state().session; const r = await BojangSmartKey.server.session(s.token); return r.ok; }")
            check("서버 세션 유효", sess_ok is True, sess_ok)

            enc_plain = pg.evaluate("""() => {
              const st = JSON.parse(localStorage.getItem('bojang.sk.server'));
              const ch = Object.values(st.challenges).find(c => c.status === 'approved');
              return { hasEnc: !!(ch && ch.enc && ch.ct === undefined), enc: JSON.stringify(ch.enc).length,
                       plain: JSON.stringify(ch.enc).includes('김민수') };
            }""")
            check("서버에는 암문만 저장 (평문 없음)", enc_plain["hasEnc"] and not enc_plain["plain"], enc_plain)

            # =========================================================
            # E. 릴레이 방어 — 서명 · 해시 · 숫자 · 만료 · 복호 키
            # =========================================================
            bad_pc = pg.evaluate("""async () => {
              const C = BojangSmartKey.crypto;
              const k = await C.genEcdsa();
              const pub = await C.exportPubJwk(k.publicKey);
              const ecdh = await C.genEcdh();
              const ecdhPub = await C.exportPubJwk(ecdh.publicKey);
              return await BojangSmartKey.server.createChallenge({
                pc_pub_ecdh: ecdhPub, pc_pub_ecdsa: pub, pc_pub_hash: 'deadbeefdeadbeef',
                pc_name: 'attacker', pc_platform: 'x', pc_host: 'evil.example', issued_at: Date.now(), pc_sig: 'AAAA'
              });
            }""")
            check("위조 PC 서명 — 챌린지 발급 거부", bad_pc.get("ok") is False and bad_pc.get("error") == "bad-pc-signature", bad_pc.get("error"))

            relay = pg.evaluate("""async () => {
              const C = BojangSmartKey.crypto;
              const k = await C.genEcdsa();
              const pub = await C.exportPubJwk(k.publicKey);
              const ecdh = await C.genEcdh();
              const ecdhPub = await C.exportPubJwk(ecdh.publicKey);
              const hash = 'cafebabecafebabe';
              const at = Date.now();
              const sig = await C.signText(k.privateKey, ['SMK1','challenge',hash,String(at)].join('|'));
              const out = await BojangSmartKey.server.createChallenge({
                pc_pub_ecdh: ecdhPub, pc_pub_ecdsa: pub, pc_pub_hash: hash,
                pc_name: 'Relay PC', pc_platform: 'x', pc_host: 'evil.example', issued_at: at, pc_sig: sig
              });
              const dev = BojangSmartKey.phone.device();
              const priv = await C.importEcdsaPriv(dev.priv);
              const transcript = ['SMK1','approve',out.challenge.id,out.challenge.code2,hash,dev.id,String(at)].join('|');
              const goodSig = await C.signText(priv, transcript);
              const wrongSig = await C.signText(priv, transcript + '|x');
              const phoneKeys = await C.genEcdh();
              const phonePub = await C.exportPubJwk(phoneKeys.publicKey);
              const base = { challenge_id: out.challenge.id, device_id: dev.id, code2: out.challenge.code2,
                             pc_pub_hash: hash, phone_pub: phonePub, enc: { iv: 'AAAA', ct: 'BBBB' } };
              const badSigRes = await BojangSmartKey.server.approve(Object.assign({}, base, { signature: wrongSig }));
              const relayRes = await BojangSmartKey.server.approve(Object.assign({}, base, { signature: goodSig, pc_pub_hash: 'ffffffffffffffff' }));
              const codeRes = await BojangSmartKey.server.approve(Object.assign({}, base, { signature: goodSig, code2: '99' }));
              const okRes = await BojangSmartKey.server.approve(Object.assign({}, base, { signature: goodSig }));
              return { badSig: badSigRes.error, relay: relayRes.error, code: codeRes.error, ok: okRes.ok, id: out.challenge.id };
            }""")
            check("폰 기기 서명 위조 — 거부", relay["badSig"] == "bad-signature", relay["badSig"])
            check("pc_pub_hash 불일치 — 릴레이 거부", relay["relay"] == "relay-mismatch", relay["relay"])
            check("확인 숫자 불일치 — 거부", relay["code"] == "code-mismatch", relay["code"])
            check("정상 서명 — 승인", relay["ok"] is True, relay["ok"])

            wrong_key = pg.evaluate("""async () => {
              const C = BojangSmartKey.crypto;
              const st = JSON.parse(localStorage.getItem('bojang.sk.server'));
              const ch = st.challenges['%s'];
              const other = await C.genEcdh();
              const key = await C.deriveAes(other.privateKey, ch.phone_pub);
              try { await C.aesDecrypt(key, ch.enc.iv, ch.enc.ct); return 'decrypted'; }
              catch (e) { return 'failed'; }
            }""" % relay["id"])
            check("다른 PC 키로는 복호 실패", wrong_key == "failed", wrong_key)

            expired = pg.evaluate("""async () => {
              await BojangSmartKey.pc.issue();
              const ch = BojangSmartKey.pc.challenge();
              const st = JSON.parse(localStorage.getItem('bojang.sk.server'));
              st.challenges[ch.id].expires_at = Date.now() - 1000;
              localStorage.setItem('bojang.sk.server', JSON.stringify(st));
              const poll = await BojangSmartKey.server.poll(ch.id);
              const dev = BojangSmartKey.phone.device();
              const C = BojangSmartKey.crypto;
              const priv = await C.importEcdsaPriv(dev.priv);
              const phoneKeys = await C.genEcdh();
              const phonePub = await C.exportPubJwk(phoneKeys.publicKey);
              const sig = await C.signText(priv, ['SMK1','approve',ch.id,ch.code2,ch.pc_pub_hash,dev.id,String(ch.issued_at)].join('|'));
              const res = await BojangSmartKey.server.approve({ challenge_id: ch.id, device_id: dev.id, code2: ch.code2,
                pc_pub_hash: ch.pc_pub_hash, phone_pub: phonePub, enc: { iv: 'AAAA', ct: 'BBBB' }, signature: sig });
              return { status: poll.status, err: res.error };
            }""")
            check("180초 만료 — 폴링이 expired", expired["status"] == "expired", expired["status"])
            check("만료 후 승인 거부", expired["err"] in ("expired", "not-pending"), expired["err"])

            # =========================================================
            # F. 기기 바인딩 2대 · 1탭 밀어내기 · 원격 잠금
            # =========================================================
            ctx2, pg2, errors2 = new_page(browser, base)
            pushout = pg2.evaluate("""async () => {
              await BojangSmartKey.phone.open();
              const dummy = await BojangSmartKey.server.bind({ kind: 'pc', name: 'Office PC', pub_hash: 'aaaa1111bbbb2222', pub_ecdsa: null });
              await BojangSmartKey.pc.open();
              const ch = BojangSmartKey.pc.challenge();
              await BojangSmartKey.phone.submitCode(ch.code6);
              const ap = await BojangSmartKey.phone.approveWithPin('4827');
              await new Promise(r => setTimeout(r, 1400));
              const st = BojangSmartKey.pc.state();
              return { dummy: dummy.ok, ap: ap.ok, bound: (st.session || {}).bound, evictable: (st.session || {}).evictable || [] };
            }""")
            check("2대 등록 상태에서 새 PC — 세션은 열림", pushout["ap"] is True, pushout["ap"])
            check("2대 초과 — 기기 등록 보류 + 밀어낼 후보", pushout["bound"] is False and len(pushout["evictable"]) == 1, pushout["evictable"])
            pg2.evaluate("() => BojangSmartKey.phone.close()")
            pg2.wait_for_timeout(200)
            check("1탭 밀어내기 버튼 표시", pg2.is_visible("#sk-pc-pushout"), pg2.inner_text("#sk-pc-pushout") if pg2.is_visible("#sk-pc-pushout") else "")
            pg2.click("#sk-pc-pushout")
            pg2.wait_for_timeout(600)
            after_push = pg2.evaluate("""async () => {
              const d = await BojangSmartKey.server.devices();
              const st = BojangSmartKey.pc.state();
              return { names: (d.devices || []).map(x => x.name), bound: (st.session || {}).bound };
            }""")
            check("밀어내기 후 — 새 PC 등록", after_push["bound"] is True, after_push)
            check("밀어내기 후 — 기기 2대 유지", len(after_push["names"]) == 2, after_push["names"])
            check("밀어내기 후 — 기존 PC 사라짐", "Office PC" not in after_push["names"], after_push["names"])

            ctx3, pg3, errors3 = new_page(browser, base)
            remote = pg3.evaluate("""async () => {
              await BojangSmartKey.phone.open();
              await BojangSmartKey.pc.open();
              const ch = BojangSmartKey.pc.challenge();
              await BojangSmartKey.phone.submitCode(ch.code6);
              await BojangSmartKey.phone.approveWithPin('4827');
              await new Promise(r => setTimeout(r, 1300));
              await BojangSmartKey.devices.open();
              const btn = document.querySelector('[data-sk-revoke]');
              const list = document.querySelectorAll('.sk-device').length;
              if (btn) btn.click();
              await new Promise(r => setTimeout(r, 2400));
              return { list, locked: BojangSmartKey.lock.isLocked(), why: document.getElementById('sk-lock-why').textContent,
                       cls: document.documentElement.classList.contains('is-sk-locked') };
            }""")
            check("기기 관리 — 등록 기기 목록", remote["list"] == 2, remote["list"])
            check("원격 잠금 — 활성 창 즉시 잠금", remote["locked"] is True, remote["locked"])
            check("원격 잠금 — 안내 문구", "원격 잠금" in remote["why"], remote["why"])
            check("원격 잠금 — 화면 가림 클래스", remote["cls"] is True, remote["cls"])
            rev = pg3.evaluate("""async () => {
              const d = await BojangSmartKey.server.devices();
              const s = (d.sessions || [])[0];
              return s ? { revoked: !!s.revoked_at, by: s.revoked_by } : null;
            }""")
            check("원격 잠금 — 서버 세션 무효화", bool(rev and rev["revoked"]), rev)
            check("PIN 오류 — 거부", pg3.evaluate("async () => (await BojangSmartKey.lock.unlock('0000')).ok") is False)
            pg3.wait_for_timeout(320)
            check("PIN 정상 — 잠금 해제", pg3.evaluate("async () => (await BojangSmartKey.lock.unlock('4827')).ok") is True)
            check("잠금 해제 — 가림 클래스 해제", pg3.evaluate("() => document.documentElement.classList.contains('is-sk-locked')") is False)

            # 비활성 재진입 차단 — 저장된 세션이 서버에서 무효화된 뒤 새로고침하면 잠금으로 열립니다.
            pg3.evaluate("""async () => {
              await BojangSmartKey.phone.open();
              await BojangSmartKey.pc.open();
              const ch = BojangSmartKey.pc.challenge();
              await BojangSmartKey.phone.submitCode(ch.code6);
              await BojangSmartKey.phone.approveWithPin('4827');
              await new Promise(r => setTimeout(r, 1300));
              BojangSmartKey.phone.close();
            }""")
            locked_on_reload = pg3.evaluate("""async () => {
              const token = (BojangSmartKey.pc.state().session || {}).token || '';
              await BojangSmartKey.server.revoke(token);   // 다른 기기에서 원격 잠금한 상황
              return { token };
            }""")
            pg3.reload(wait_until="load")
            pg3.wait_for_timeout(1700)
            pg3.evaluate("() => { const t = document.getElementById('tour-invite'); if (t) t.hidden = true; }")
            resume = pg3.evaluate("() => ({ locked: BojangSmartKey.lock.isLocked(), session: BojangSmartKey.pc.state().session })")
            check("재진입 — 무효 세션은 잠금", resume["locked"] is True and resume["session"] is None, resume)
            all_errors += app_errors(errors2) + app_errors(errors3)

            # =========================================================
            # G. 자동 잠금 · 프라이버시 가림 모드
            # =========================================================
            ctx4, pg4, errors4 = new_page(browser, base)
            auto = pg4.evaluate("""async () => {
              await BojangSmartKey.auth.registerPin('4827');
              BojangSmartKey.prefs.set({ autoLockMin: 0.02 });
              BojangSmartKey.lock.arm();
              document.dispatchEvent(new Event('pointerdown'));
              await new Promise(r => setTimeout(r, 1500));
              return { locked: BojangSmartKey.lock.isLocked() };
            }""")
            check("자동 잠금 — 자리 비움 후 잠김", auto["locked"] is True, auto)
            pg4.evaluate("() => { const i = document.getElementById('sk-lock-pin'); if (i) i.value='4827'; }")
            pg4.wait_for_timeout(320)
            check("자동 잠금 — PIN 해제", pg4.evaluate("async () => (await BojangSmartKey.lock.unlock('4827')).ok") is True)

            masks = pg4.evaluate("() => ['홍길동','김민','이',''].map(n => BojangSmartKey.privacy.maskName(n))")
            check("가림 — 이름 마스킹 3종", masks == ["홍*동", "김*", "*", ""], masks)
            phone_mask = pg4.evaluate("() => BojangSmartKey.privacy.maskText('010-1234-5678 김민수 830312-1234567')")
            check("가림 — 전화·주민번호 마스킹", "****" in phone_mask and "830312-1******" in phone_mask, phone_mask)
            pg4.evaluate(SET_CLIENT)
            pg4.click('[data-mode="client"]')
            pg4.wait_for_timeout(700)
            before_mask = pg4.eval_on_selector("#deck-stage", "e => e.innerText")
            check("30장 고객 화면 — 고객명 표시", "김민수" in before_mask, before_mask[:40])
            pg4.evaluate("() => BojangSmartKey.privacy.setEnabled(true)")
            pg4.wait_for_timeout(500)
            after_mask = pg4.eval_on_selector("#deck-stage", "e => e.innerText")
            check("가림 모드 — 30장 고객명 마스킹", "김민수" not in after_mask and "김*수" in after_mask, after_mask[:60])
            check("가림 모드 — 상단 고객명도 마스킹", pg4.inner_text("#cs-name") == "김*수님", pg4.inner_text("#cs-name"))
            check("가림 모드 — 상담 화면 유지(30장 그대로)", len(after_mask) > 100, len(after_mask))
            check("가림 모드 — 칩 표시", "ON" in pg4.inner_text("#sk-privacy-chip"), pg4.inner_text("#sk-privacy-chip"))
            pg4.evaluate("() => BojangSmartKey.privacy.setEnabled(false)")
            pg4.wait_for_timeout(400)
            check("가림 해제 — 원래 이름 복원", pg4.inner_text("#cs-name") == "김민수님" and "김민수" in pg4.eval_on_selector("#deck-stage", "e => e.innerText"), pg4.inner_text("#cs-name"))
            all_errors += app_errors(errors4)

            # =========================================================
            # H. WebAuthn / PIN 분기
            # =========================================================
            ctx5, pg5, errors5 = new_page(browser, base)
            branch = pg5.evaluate("""async () => {
              const out = {};
              out.defaultMethod = BojangSmartKey.phone.authMethod();
              await BojangSmartKey.phone.open();
              await BojangSmartKey.pc.open();
              const ch = BojangSmartKey.pc.challenge();
              await BojangSmartKey.phone.submitCode(ch.code6);
              out.pinBoxVisible = !document.getElementById('sk-pin-box').hidden;
              out.bioHidden = document.getElementById('sk-auth-bio').hidden;
              BojangSmartKey.auth.setForce('webauthn');
              out.forced = BojangSmartKey.phone.authMethod();
              document.getElementById('sk-auth-bio').hidden = false;
              document.getElementById('sk-pin-box').hidden = true;
              const bio = await BojangSmartKey.phone.approveWithBiometric();
              out.bioOk = bio.ok;
              out.pinShownAfterFail = !document.getElementById('sk-pin-box').hidden;
              BojangSmartKey.auth.setForce(normalMethod => normalMethod);
              BojangSmartKey.auth.setForce(null);
              const reg = await BojangSmartKey.auth.registerBiometric();
              out.regOk = reg.ok; out.regReason = reg.reason;
              return out;
            }""")
            method_expected = "webauthn" if True else "pin"
            check("http 환경 — 기본 인증은 PIN", branch["defaultMethod"] == "pin", branch["defaultMethod"])
            check("승인 화면 — PIN 입력칸 노출", branch["pinBoxVisible"] is True and branch["bioHidden"] is True, branch)
            check("https 강제 — WebAuthn 분기", branch["forced"] == "webauthn", branch["forced"])
            check("생체인증 실패 — PIN으로 자동 전환", branch["bioOk"] is False and branch["pinShownAfterFail"] is True, branch)
            check("https 아님 — 생체인증 등록 거부", branch["regOk"] is False and branch["regReason"] == "unsupported", branch)
            all_errors += app_errors(errors5)

            # =========================================================
            # H-2. v5.9 실측 결함 4건 회귀 (회의실 4호 봇 · 부이 대리)
            # =========================================================
            # ① 새 상담 시작 → 수기 입력 → 한 화면 빠른 입력: 샘플(27만원·5,000만원) 혼입 0
            ctxq, pgq, errq = new_page(browser, base)
            first_state = pgq.evaluate("() => ({ prem: BojangApp.state.premium, gen: BojangApp.state.cov.cancer.general, sample: BojangApp.state.sample })")
            check("회귀① — 첫 실행은 샘플(27만원·5,000만원)", first_state["prem"] == 27 and first_state["sample"] is True, first_state)
            pgq.click("#btn-start-consult")
            pgq.wait_for_timeout(400)
            pgq.click('#input-hub [data-mode="manual"]')
            pgq.wait_for_timeout(250)
            pgq.click('#input-hub [data-manual="quick"]')
            pgq.wait_for_timeout(600)
            quick = pgq.evaluate("""() => {
              const nums = Array.from(document.querySelectorAll('#view-quick input[type="number"]'));
              const nonzero = nums.filter(n => Number(n.value || 0) !== 0).map(n => [n.dataset.qitem + '.' + n.dataset.qpart + (n.dataset.qsub ? '.' + n.dataset.qsub : ''), n.value]);
              const checks = Array.from(document.querySelectorAll('#view-quick input[type="checkbox"]')).filter(c => c.checked).length;
              return { prem: document.getElementById('q-premium').value, name: document.getElementById('q-name').value,
                       nonzero, checks, header: document.getElementById('quick-client').textContent };
            }""")
            check("회귀① — 빠른 입력 월 보험료 0", str(quick["prem"]) in ("0", ""), quick["prem"])
            check("회귀① — 빠른 입력 담보 금액 전부 0", not quick["nonzero"], quick["nonzero"])
            check("회귀① — 빠른 입력 고객명 빈값", quick["name"] == "", repr(quick["name"]))
            check("회귀① — 보유 체크 0", quick["checks"] == 0, quick["checks"])
            check("회귀① — 헤더에 27만원 없음", "27" not in quick["header"], quick["header"])
            check("회귀① — 6단계 입력실도 빈값", pgq.evaluate("""() => {
              const p = document.getElementById('premium');
              return { prem: p ? p.value : null, gen: BojangApp.state.cov.cancer.general };
            }""")["gen"] == 0)
            quick_err = app_errors(errq)

            # ② 개인정보처리방침 — AI 전송 문구 정직화
            legal_text = pgq.evaluate("""() => {
              BojangApp.legal.open('privacy');
              const t = document.getElementById('legal-body').innerText;
              return t;
            }""")
            check("회귀② — '1회 전송·즉시 삭제' 단정 제거", "1회 전송" not in legal_text, legal_text[:40])
            check("회귀② — 외부 AI API 전송 명시", "외부 AI API" in legal_text and "Gemini" in legal_text, "")
            check("회귀② — 공급자 정책 적용 명시", "공급자" in legal_text and ("남용" in legal_text or "정책" in legal_text), "")
            check("회귀② — 대체 모델 재시도 가능 명시", "대체 모델" in legal_text, "")
            check("회귀② — 앱·자체 서버 미저장 명시", "저장하지 않습니다" in legal_text, "")
            check("회귀② — 즉시 삭제 보증 불가 명시", "보증하지" in legal_text, "")

            # ③ 로컬 계산 vs 클라우드 저장 범위 구분
            home_copy = pgq.evaluate("() => document.querySelector('.home-hero > p') ? document.querySelector('.home-hero > p').innerText : ''")
            check("회귀③ — 홈에 '이 기기에서' 계산 명시", "이 기기에서" in home_copy, home_copy[:60])
            check("회귀③ — 홈에 Supabase(서울) 저장 명시", "Supabase(서울)" in home_copy, "")
            check("회귀③ — 저장 항목(이름·보험료·담보) 명시", all(k in home_copy for k in ("이름", "보험료", "담보")), "")
            privacy_scope = legal_text
            check("회귀③ — 방침에 클라우드 저장 항목 상세", all(k in privacy_scope for k in ("연령대", "성별", "계약", "고지")), "")
            cloud_badge = pgq.evaluate("""async () => {
              await BojangBackend.signIn('qa.v60@bojang.test', 'secret123');
              return Array.from(document.querySelectorAll('.cloud-state')).map(e => e.textContent);
            }""")
            check("회귀③ — 클라우드 배지에 저장 범위 표시", any("클라우드(서울)" in t and "보험료" in t for t in cloud_badge), cloud_badge)

            # ④ 첫 화면 UX — 부제 명확화 · 긴 기준일 문단 접기
            sub = pgq.inner_text("#home-load-sub")
            check("회귀④ — 최근 상담 부제", sub == "최근 3건 표시 · 최대 30건 저장", sub)
            details = pgq.evaluate("""() => {
              const d = document.querySelector('.app-foot-details');
              if (!d) return null;
              return { open: d.open, summary: d.querySelector('summary').textContent.trim(),
                       pHeight: d.querySelector('.app-foot').getBoundingClientRect().height,
                       text: d.querySelector('.app-foot').textContent.length };
            }""")
            check("회귀④ — 기준일 문단 접기(details)", bool(details) and details["open"] is False, details)
            check("회귀④ — 접힌 상태에서 본문 숨김", details and details["pHeight"] == 0, details and details["pHeight"])
            check("회귀④ — 요약 문구", details and "자세히" in details["summary"], details and details["summary"])
            pgq.evaluate("() => { BojangApp.legal.close(); }")
            all_errors += quick_err
            ctxq.close()

            # =========================================================
            # I. QR 디코더 — 왕복 · 회전 · 잡음 · 오류정정
            # ==========================================================
            qr = pg.evaluate("""() => {
              function render(text, scale, quiet, angle, specks, damage) {
                const m = BojangQR.matrix(text);
                const n = m.size + quiet * 2;
                const W = Math.ceil(n * scale * 1.5), H = W;
                const g = new Uint8Array(W * H).fill(255);
                const cx = W / 2, cy = H / 2, rad = angle * Math.PI / 180;
                for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                  const dx = x - cx, dy = y - cy;
                  const sx = Math.cos(-rad) * dx - Math.sin(-rad) * dy + cx;
                  const sy = Math.sin(-rad) * dx + Math.cos(-rad) * dy + cy;
                  const col = Math.floor(sx / scale) - quiet, row = Math.floor(sy / scale) - quiet;
                  if (col >= 0 && row >= 0 && col < m.size && row < m.size && m.modules[row][col]) g[y * W + x] = 0;
                }
                /* 잡음은 데이터 영역(파인더 바깥)에 고정 시드로 뿌립니다 — 재현 가능한 내구성 검증 */
                let seed = 12345;
                const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
                const lo = Math.round((quiet + 10) * scale), hi = Math.round((quiet + m.size - 10) * scale);
                for (let i = 0; i < (specks || 0); i++) {
                  const x = lo + Math.floor(rnd() * Math.max(1, hi - lo));
                  const y = lo + Math.floor(rnd() * Math.max(1, hi - lo));
                  g[y * W + x] = rnd() < 0.5 ? 0 : 255;
                }
                if (damage) {
                  const spots = [[9, 9], [m.size - 10, 12], [12, m.size - 10], [Math.floor(m.size / 2), Math.floor(m.size / 2)]];
                  for (let i = 0; i < Math.min(damage, spots.length); i++) {
                    const mx = spots[i][0], my = spots[i][1];
                    const px = (mx + quiet + 0.5) * scale, py = (my + quiet + 0.5) * scale, r = Math.max(1, scale * 0.7);
                    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                      if (dx * dx + dy * dy <= r * r) {
                        const X = Math.round(px + dx), Y = Math.round(py + dy);
                        if (X >= 0 && Y >= 0 && X < W && Y < H) g[Y * W + X] = 0;
                      }
                    }
                  }
                }
                return { W, H, g };
              }
              const t = 'BJK1|ch_9f2c1a7d4e|482913|57|a1b2c3d4';
              const out = [];
              for (const a of [0, -12, 90]) {
                const r = render(t, 5, 4, a, 0, 0);
                out.push(['rot' + a, BojangQRScan.decodeGray(r.W, r.H, r.g) === t]);
              }
              const n = render(t, 5, 4, 3, 500, 0);
              out.push(['noise', BojangQRScan.decodeGray(n.W, n.H, n.g) === t]);
              /* 손상은 재현 가능하도록 고정 좌표(데이터 영역 4곳)로 줍니다 — 리드솔로몬 오류정정 검증 */
              const d = render(t, 5, 4, 0, 0, 4);
              out.push(['damage4', BojangQRScan.decodeGray(d.W, d.H, d.g) === t]);
              const s = render(t, 2.5, 4, 0, 0, 0);
              out.push(['small', BojangQRScan.decodeGray(s.W, s.H, s.g) === t]);
              const kr = render('보장분석 스마트키 v6.0 테스트', 5, 4, 6, 0, 0);
              out.push(['korean', BojangQRScan.decodeGray(kr.W, kr.H, kr.g) === '보장분석 스마트키 v6.0 테스트']);
              return out;
            }""")
            for name, ok in qr:
                check("QR 디코더 — " + name, ok)

            # =========================================================
            # J. 360px · 콘솔 · 단일 HTML · 보호 빌드
            # =========================================================
            pg.set_viewport_size({"width": 360, "height": 800})
            pg.wait_for_timeout(300)
            pg.evaluate("async () => { await BojangSmartKey.pc.open(); }")
            pg.wait_for_timeout(400)
            check("360px — PC 스마트키 모달 넘침 0", overflow(pg) == 0, overflow(pg))
            pg.evaluate("async () => { await BojangSmartKey.phone.open(); const c = BojangSmartKey.pc.challenge(); if (c) await BojangSmartKey.phone.submitCode(c.code6); }")
            pg.wait_for_timeout(400)
            check("360px — 폰 승인 화면 넘침 0", overflow(pg) == 0, overflow(pg))
            pg.evaluate("async () => await BojangSmartKey.devices.open()")
            pg.wait_for_timeout(400)
            check("360px — 기기 관리 넘침 0", overflow(pg) == 0, overflow(pg))

            # 스크린샷 3장 (검수용)
            pg.set_viewport_size({"width": 430, "height": 932})
            pg.evaluate("async () => { BojangSmartKey.devices.close(); BojangSmartKey.phone.close(); await BojangSmartKey.pc.open(); }")
            pg.wait_for_timeout(600)
            pg.screenshot(path=os.path.join(SHOTS, "ui-pc-qr-challenge.png"), full_page=False)
            pg.evaluate("""async () => {
              const c = BojangSmartKey.pc.challenge();
              await BojangSmartKey.phone.open();
              await BojangSmartKey.phone.submitCode(c.code6);
            }""")
            pg.wait_for_timeout(500)
            pg.screenshot(path=os.path.join(SHOTS, "ui-mobile-smartkey-approve.png"), full_page=False)
            pg.evaluate("""async () => {
              BojangSmartKey.phone.close();
              await BojangSmartKey.pc.open();
              await BojangSmartKey.phone.open();
              await BojangSmartKey.phone.submitCode(BojangSmartKey.pc.challenge().code6);
              await BojangSmartKey.phone.approveWithPin('4827');
              await new Promise(r => setTimeout(r, 1400));
              await BojangSmartKey.devices.open();
            }""")
            pg.wait_for_timeout(700)
            pg.screenshot(path=os.path.join(SHOTS, "ui-device-lock-privacy.png"), full_page=False)

            # 콘솔 오류 0 (전 페이지)
            all_errors += app_errors(errors)
            check("콘솔 오류 0", not all_errors, all_errors[:4])

            # 단일 HTML — 보호 빌드
            import subprocess
            subprocess.run([sys.executable, os.path.join(ROOT, "build_single.py"), "--no-protect"], check=True, capture_output=True)
            plain = read(os.path.join(ROOT, "dist", "bojang-guide.single.html"))
            subprocess.run([sys.executable, os.path.join(ROOT, "build_single.py")], check=True, capture_output=True)
            prot = read(os.path.join(ROOT, "dist", "bojang-guide.single.html"))
            check("단일 HTML — v6.0 표기", "v6.0" in prot, len(prot) // 1024)
            check("단일 HTML — 외부 참조 0", not re.findall(r'(?:src|href)="\./', prot), re.findall(r'(?:src|href)="\./', prot))
            check("보호 빌드 — 주석 제거로 더 작음", len(prot) < len(plain), (len(plain), len(prot)))
            check("보호 빌드 — 스마트키 헤더 주석 제거", "smartkey.js)" not in prot, "comment stripped")
            check("보호 빌드 — 빌드 해시 표기", re.search(r"<!-- build [0-9a-f]{12} · protected=true -->", prot) is not None, "build hash")
            check("보호 빌드 — 기능 코드 보존", all(k in prot for k in ("BojangSmartKey", "BojangQRScan", "qr-auth-approve")), "features")
            check("보호 빌드 — 정규식 리터럴 보존", "replace(/\\+ /g" in prot or "replace(/\\+/g" in prot, "regex")

            dist_ctx = browser.new_context(viewport={"width": 430, "height": 932})
            dist_errors = []
            dpg = dist_ctx.new_page()
            dpg.on("pageerror", lambda e: dist_errors.append(str(e)))
            dpg.on("console", lambda m: dist_errors.append(m.text) if m.type == "error" else None)
            dpg.goto(base + "/dist/bojang-guide.single.html", wait_until="load")
            dpg.wait_for_timeout(1400)
            dpg.evaluate("() => { const t = document.getElementById('tour-invite'); if (t) t.hidden = true; }")
            dres = dpg.evaluate("async () => { const r = await BojangSmartKey.pc.open(); return { ok: r.ok, code: (BojangSmartKey.pc.challenge() || {}).code6 }; }")
            check("보호 빌드 — 실행 정상 (챌린지 발급)", dres["ok"] is True and bool(dres["code"]), dres)
            check("보호 빌드 — 콘솔 오류 0", not app_errors(dist_errors), app_errors(dist_errors)[:3])
            dist_ctx.close()

            # =========================================================
            # K. 서버 패키지
            # =========================================================
            mig_path = os.path.join(ROOT, "supabase", "migrations", "003_smartkey_devices.sql")
            mig = read(mig_path)
            parsed = 0
            if pglast:
                try:
                    parsed = len(pglast.parse_sql(mig))
                except Exception as e:
                    parsed = -1
            check("003 마이그레이션 — SQL 파싱", parsed > 20, parsed)
            check("003 — 멱등 DDL", "create table if not exists public.qr_challenges" in mig and "create table if not exists public.registered_devices" in mig, "")
            check("003 — 2기기 유니크 (user_id, kind)", "unique (user_id, kind)" in mig, "")
            check("003 — RLS + 정책", mig.count("enable row level security") == 3 and "create policy devices_own" in mig, "")
            check("003 — 세션 무효 컬럼", "revoked_at" in mig and "consumed_at" in mig, "")

            fn_ch = read(os.path.join(ROOT, "supabase", "functions", "qr-auth-challenge", "index.ts"))
            fn_ap = read(os.path.join(ROOT, "supabase", "functions", "qr-auth-approve", "index.ts"))
            fn_dm = read(os.path.join(ROOT, "supabase", "functions", "device-manage", "index.ts"))
            fn_vi = read(os.path.join(ROOT, "supabase", "functions", "parse-coverage-vision", "index.ts"))
            check("qr-auth-challenge — 180초 TTL", "TTL_SECONDS = 180" in fn_ch, "")
            check("qr-auth-challenge — PC 서명 검증", "verifyPcSignature" in fn_ch and "bad-pc-signature" in fn_ch, "")
            check("qr-auth-challenge — 요청 제한", "RATE_LIMIT_PER_MIN" in fn_ch and "rate-limit" in fn_ch, "")
            check("qr-auth-challenge — 이전 코드 무효화(서명 필요)", '"cancel"' in fn_ch and '"SMK1", "cancel"' in fn_ch, "")
            check("smartkey — 새 코드 시 cancel 서명 전송", "cancel_sig" in read(os.path.join(ROOT, "smartkey.js")), "")
            check("qr-auth-approve — JWT 필수", "requireUser" in fn_ap, "")
            check("qr-auth-approve — 마스터 기기 검증", '"not-master"' in fn_ap and "master" in fn_ap, "")
            check("qr-auth-approve — 단회 원자적 소비", ".eq(\"status\", \"pending\")" in fn_ap and "consumed_at" in fn_ap and ".is(\"consumed_at\", null)" in fn_ap, "")
            check("qr-auth-approve — 만료 검사", "expires_at" in fn_ap and '"expired"' in fn_ap, "")
            check("qr-auth-approve — 릴레이·숫자 검증", "relay-mismatch" in fn_ap and "code-mismatch" in fn_ap, "")
            check("device-manage — 5개 동작", all(k in fn_dm for k in ('"list"', '"bind"', '"evict"', '"revoke"', '"session"')), "")
            check("parse-coverage-vision — 세션 검증", "x-smartkey-session" in fn_vi and "device_revoked" in fn_vi, "")
            backend = read(os.path.join(ROOT, "backend.js"))
            check("backend — sessionToken 공개", "sessionToken," in backend and "function sessionToken" in backend, "")
            check("backend — 비전 호출에 스마트키 세션 헤더", "x-smartkey-session" in backend, "")

            deploy = read(os.path.join(ROOT, "supabase", "DEPLOY.md"))
            check("DEPLOY 문서 — v6.0 함수 안내", "qr-auth-challenge" in deploy and "qr-auth-approve" in deploy and "device-manage" in deploy, "")

            # 정직한 표기
            check("README — 실서버 DDL 미배포 명시", "실서버 DDL·Edge Function 은 이번 배포에 포함되지 않았습니다" in read(os.path.join(ROOT, "README.md")), "")
            check("README — 실기기 미검증 명시", "실기기" in read(os.path.join(ROOT, "README.md")) and "미검증" in read(os.path.join(ROOT, "README.md")), "")
            check("UI — 모의 검증 상태 표시", "모의 검증" in pg.evaluate("() => BojangSmartKey.server.statusText()"), "")

            ctx.close()
            ctx2.close()
            ctx3.close()
            ctx4.close()
            ctx5.close()
            browser.close()
    finally:
        httpd.shutdown()

    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print("\n=== v6.0 테스트 %d/%d 통과 ===" % (passed, total))
    fails = [r for r in results if not r[1]]
    if fails:
        print("실패 항목:")
        for name, _, detail in fails:
            print(" -", name, "·", detail)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
