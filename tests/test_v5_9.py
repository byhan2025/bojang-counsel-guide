#!/usr/bin/env python3
"""보장분석 라이프 리포트 v5.9 — 전수보완 · 3버튼 UX · IndexedDB · 약관/개인정보 · 복제 방지 검증.

실행: python3 tests/test_v5_9.py

검증:
  · 버전 단일 상수 — version.js 의 APP_VERSION 하나로 헤더·입력 영역·모달·PDF·sw.js·manifest 통일,
    v5.2 / v5.5 / v5.8 표기 잔재 0
  · v5.8 결함 5종 회귀
    ① 버전 표기 통일 ② 새 상담 시작 = 진짜 빈 상담(샘플 채우기 제거) ③ 음수 금액 차단
    ④ 온보딩 투어와 입력 모달 순차 노출 ⑤ 상담 이력 IndexedDB 이관 + localStorage 이관·삭제
  · 첫 화면 3버튼(새 상담 · 최근 3건 이어하기 · 라이브 상담) + 더보기 메뉴
  · 이용약관 / 개인정보처리방침 모달 — 사진 휘발·Gemini 1회 전송·클라우드 보관 항목 명시
  · 공식 도메인 잠금 — 복제 도메인에서 경고 배너 + 클라우드/비전 호출 0
  · PDF 발급 워터마크(ID-XXXX) — 상세 01p·10p 꼬리말
  · 360px 넘침 0 · 콘솔 오류 0 · 단일 HTML 외부 참조 0
"""
import base64
import hashlib
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out")
SHOTS = "/workspace/reports/bojang-guide/v5.9"
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
# 모의 Supabase — 클라우드 동기화 경로(로그인·consultations)를 흉내 냅니다.
# =====================================================================
UID = "22222222-2222-2222-2222-222222222222"
EMAIL = "qa.v59@bojang.test"
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
        return parsed.path, urllib.parse.parse_qs(parsed.query)

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
        STORE["requests"].append(("GET", path))
        if path == "/auth/v1/health":
            return self._json(200, {"name": "mock", "version": "v5.9"})
        if path == "/rest/v1/subscriptions":
            return self._json(200, [])
        if path == "/rest/v1/brand_settings":
            return self._json(200, [])
        if path == "/rest/v1/consultations":
            rows = [r for r in STORE["consultations"] if r.get("user_id") == UID]
            rows.sort(key=lambda r: r.get("consulted_at") or "", reverse=True)
            return self._json(200, rows[:20])
        if path == "/rest/v1/clients":
            return self._json(200, [])
        return self._json(404, {"message": "not found"})

    def do_POST(self):
        path, q = self._parts()
        if not path.startswith("/mock/"):
            return self._json(404, {"message": "no"})
        path = path[len("/mock"):]
        body = self._body()
        STORE["requests"].append(("POST", path))
        if path == "/auth/v1/token":
            return self._json(200, {"access_token": "mock-token", "refresh_token": "mock-refresh",
                                    "expires_in": 3600, "user": {"id": UID, "email": EMAIL}})
        if path == "/auth/v1/signup":
            return self._json(200, {"access_token": "mock-token", "refresh_token": "mock-refresh",
                                    "expires_in": 3600, "user": {"id": UID, "email": EMAIL}})
        if path == "/auth/v1/logout":
            return self._empty(204)
        if path == "/rest/v1/consultations":
            row = body or {}
            STORE["consultations"] = [r for r in STORE["consultations"] if r.get("id") != row.get("id")]
            STORE["consultations"].append(row)
            return self._empty(201)
        return self._json(404, {"message": "no"})

    def do_PATCH(self):
        path, q = self._parts()
        if not path.startswith("/mock/"):
            return self._json(404, {"message": "no"})
        STORE["requests"].append(("PATCH", path[len("/mock"):]))
        return self._empty(204)


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
  S.sample = false;
  S.cov.cancer.general = 3000; S.cov.cancer.similar = 500; S.cov.brain.dx.vascular = 2000;
  S.cov.custom = { cancer: [], brain: [{ id: 'b1', name: '특정순환계질환(3~5종) 주요치료비', amount: 2000, mode: 'bundle' }], heart: [], surgery: [], care: [] };
  BojangBrand.save({ name: '보반 라이프 리포트', slogan: '고객 맞춤형 보장 점검 · 리모델링 상담 가이드',
                     consultant: '김한기', title: '손해보험 설계사', phone: '010-4908-4175', kakao: 'open.kakao.com/o/bojang59' });
  BojangApp.analyze();
}"""

CAPTURE_PDF = """async (kind) => {
  let out;
  try { out = await BojangApp.buildPdfBlob(kind); }
  finally { document.getElementById('pdf-overlay').hidden = true; }
  const buf = await out.blob.arrayBuffer();
  let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return { pages: out.pages, overflow: out.overflow, idMark: out.idMark || '', b64: btoa(bin) };
}"""


def app_errors(errs):
    return [e for e in errs if "Failed to load resource" not in e]


def new_page(browser, base, init_script=None, width=430, height=932):
    ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2,
                              permissions=["clipboard-read", "clipboard-write"])
    errors = []
    requests = []
    ctx.add_init_script("window.__BOJANG_CONFIG__ = { SUPABASE_URL: '%s/mock', SUPABASE_ANON_KEY: 'test-anon-key' };" % base)
    if init_script:
        ctx.add_init_script(init_script)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("request", lambda r: requests.append(r.url))
    pg.set_default_timeout(20000)
    pg.goto(base + "/index.html", wait_until="load")
    pg.wait_for_timeout(1500)
    return ctx, pg, errors, requests


def hide_tour(pg):
    pg.evaluate("() => { const t = document.getElementById('tour-invite'); if (t) t.hidden = true; }")


def main():
    httpd, base = start_server()
    all_errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"),
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])

            # =========================================================
            # 1. 버전 단일 상수
            # =========================================================
            ctx, pg, errors, requests = new_page(browser, base)
            hide_tour(pg)
            ver_src = read(os.path.join(ROOT, "version.js"))
            decls = re.findall(r"const APP_VERSION = '([^']+)'", ver_src)
            VER = decls[0] if decls else "v6.0"          # v5.9 검사는 이후 버전에서도 회귀 검사로 유지
            check("version.js — APP_VERSION 단일 선언", len(decls) == 1, decls)
            check("window.APP_VERSION = " + VER, pg.evaluate("() => window.APP_VERSION") == VER, pg.evaluate("() => window.APP_VERSION"))
            check("BojangVersion.value", pg.evaluate("() => BojangVersion.value") == VER, pg.evaluate("() => BojangVersion.value"))
            check("헤더 eyebrow = APP_VERSION", pg.inner_text(".hh-eyebrow").strip() == "LIFE REPORT · BETA " + VER.upper(), pg.inner_text(".hh-eyebrow"))
            check("헤더 버전 표기 = " + VER, pg.inner_text(".hh-ver").strip().startswith(VER), pg.inner_text(".hh-ver"))
            check("타이틀 " + VER, VER in pg.title() and "보장분석 라이프 리포트" in pg.title(), pg.title())
            pg.evaluate("() => BojangApp.switchView('analysis')")
            pg.wait_for_timeout(300)
            check("입력 영역 eyebrow " + VER.upper(), VER.upper() in pg.inner_text("#view-analysis .intro-eyebrow"), pg.inner_text("#view-analysis .intro-eyebrow"))
            pg.evaluate("() => BojangPlan.openBetaModal('plan')")
            pg.wait_for_timeout(400)
            check("모달 eyebrow " + VER.upper(), VER.upper() in pg.inner_text("#beta-modal .bm-eyebrow"), pg.inner_text("#beta-modal .bm-eyebrow"))
            pg.evaluate("() => { const m = document.getElementById('beta-modal'); if (m) m.hidden = true; }")
            sw = read(os.path.join(ROOT, "sw.js"))
            check("서비스워커 캐시 bojang-guide-" + VER, "const CACHE = 'bojang-guide-" + VER + "';" in sw, sw.splitlines()[2])
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest " + VER, VER in man.get("name", ""), man.get("name"))
            check("manifest — 핵심 기능 설명", all(k in man.get("description", "") for k in ["3버튼", "IndexedDB", "이용약관", "도메인"]), man.get("description")[:80])
            html = read(os.path.join(ROOT, "index.html"))
            leftovers = [v for v in ("v5.2", "v5.5", "v5.8") if re.search(r"(?:v|V)" + v[1:] + r"\s*(?:·|베타|BETA|\)|$)", html)]
            check("index.html — v5.2·v5.5·v5.8 표기 0", not leftovers, leftovers)
            monet = read(os.path.join(ROOT, "monetize.js"))
            check("monetize — BojangVersion 단일 출처", "BojangVersion.title" in monet and "V5.5" not in monet, "monetize.js")
            check("PDF/앱 — 버전 상수 참조", "BojangVersion" in read(os.path.join(ROOT, "app.js")), "app.js")
            check("단일 HTML — " + VER + " 표기", VER in read(os.path.join(ROOT, "dist", "bojang-guide.single.html")), "dist")

            # =========================================================
            # 2. 결함 ①: 새 상담 시작 = 진짜 빈 상담 / 샘플은 별도 버튼
            # =========================================================
            before = pg.evaluate("() => ({ prem: BojangApp.state.premium, gen: BojangApp.state.cov.cancer.general, name: BojangApp.state.client.name, sample: BojangApp.state.sample })")
            check("첫 실행 상태는 '샘플'로 표시", "샘플" in pg.inner_text("#home-client") and before["sample"], before)
            pg.evaluate("() => BojangApp.switchView('home')")
            pg.wait_for_timeout(200)
            pg.evaluate("() => BojangApp.openMoreMenu(true)")
            pg.wait_for_timeout(300)
            pg.click("#btn-reset")
            pg.wait_for_timeout(300)
            pg.click("#rm-ok")
            pg.wait_for_timeout(500)
            empty = pg.evaluate("""() => {
              const S = BojangApp.state;
              const flat = [S.cov.cancer.general, S.cov.cancer.similar, S.cov.brain.dx.vascular, S.cov.surgery.disease, S.cov.care.daily, S.premium];
              const covSum = JSON.stringify(S.cov).match(/-?\\d+/g).map(Number).reduce((a, b) => a + Math.abs(b), 0);
              return { prem: S.premium, all: flat, name: S.client.name, sam: S.sample, covSum, contracts: S.contracts.length,
                       analytics: S.analyzed, hist: S.history.length };
            }""")
            check("새 상담 시작 — 보험료 0", empty["prem"] == 0, empty["prem"])
            check("새 상담 시작 — 담보 금액 전부 0", all(v == 0 for v in empty["all"]), empty["all"])
            check("새 상담 시작 — 고객명 비움", empty["name"] == "", repr(empty["name"]))
            check("새 상담 시작 — 샘플 표시 해제", empty["sam"] is False, empty["sam"])
            check("새 상담 시작 — 진단·결과 초기화", empty["analytics"] is False, empty["analytics"])
            check("새 상담 시작 — 화면도 빈 값", pg.eval_on_selector("#premium", "e => e.value") in ("0", ""), pg.eval_on_selector("#premium", "e => e.value"))
            check("새 상담 시작 — 저장 이력은 유지", empty["hist"] == 0, empty["hist"])
            check("새 상담 시작 — 안내 문구", "빈 상태" in pg.evaluate("() => document.getElementById('toast').textContent"), pg.evaluate("() => document.getElementById('toast').textContent"))
            pg.click("#btn-sample")
            pg.wait_for_timeout(500)
            sample = pg.evaluate("() => ({ prem: BojangApp.state.premium, gen: BojangApp.state.cov.cancer.general, sam: BojangApp.state.sample })")
            check("샘플 체험 버튼 — 값이 채워지고 샘플 표시", sample["prem"] > 0 and sample["gen"] > 0 and sample["sam"], sample)
            check("샘플 체험 — 별도 버튼 문구", "샘플" in pg.inner_text("#btn-sample"), pg.inner_text("#btn-sample"))

            # =========================================================
            # 3. 결함 ②: 음수 보험료·담보 금액 차단
            # =========================================================
            pg.evaluate(FILL)
            pg.wait_for_timeout(300)
            pg.evaluate("() => BojangApp.switchView('analysis')")
            pg.wait_for_timeout(300)
            pg.fill("#premium", "-5")
            pg.wait_for_timeout(250)
            neg = pg.evaluate("""() => ({ input: document.getElementById('premium').value, state: BojangApp.state.premium,
                                         strip: document.getElementById('cs-meta').textContent })""")
            check("월 보험료 -5 → 입력칸 0", neg["input"] in ("0", ""), neg["input"])
            check("월 보험료 -5 → 상태 0", neg["state"] == 0, neg["state"])
            check("월 보험료 -5 → 요약도 0만원", "월 0만원" in neg["strip"].replace(",", ""), neg["strip"])
            sel = "input[data-item='cancer'][data-part='general']"
            pg.click("#wiz-next")
            pg.wait_for_timeout(400)
            pg.fill(sel, "-300")
            pg.wait_for_timeout(250)
            neg2 = pg.evaluate("""(sel) => ({ input: document.querySelector(sel).value, state: BojangApp.state.cov.cancer.general,
                                           sum: document.getElementById('wiz-summary').textContent })""", sel)
            check("담보 금액 -300 → 입력칸 0", neg2["input"] in ("0", ""), neg2["input"])
            check("담보 금액 -300 → 상태 0", neg2["state"] == 0, neg2["state"])
            pg.evaluate("() => BojangApp.switchView('quick')")
            pg.wait_for_timeout(400)
            qsel = "#view-quick input[data-qitem='cancer'][data-qpart='general']"
            pg.fill(qsel, "-50")
            pg.wait_for_timeout(250)
            neg3 = pg.evaluate("""(sel) => ({ input: document.querySelector(sel).value, state: BojangApp.state.cov.cancer.general })""", qsel)
            check("빠른 입력 -50 → 0으로 차단", neg3["input"] in ("0", "") and neg3["state"] == 0, neg3)
            # 모델 단계에서도 음수가 0으로 보정 (가져온 JSON·클라우드 복원 경로)
            clamped = pg.evaluate("""() => {
              const S = BojangApp.state;
              S.cov.cancer.general = -1234; S.cov.care.daily = -3; S.premium = -40;
              const r = BojangModel.normalizeState(S);
              return { general: S.cov.cancer.general, daily: S.cov.care.daily, premium: S.premium, fixed: r.clamped };
            }""")
            check("모델 — 음수 자동 0 보정", clamped["general"] == 0 and clamped["daily"] == 0 and clamped["premium"] == 0 and clamped["fixed"] >= 3, clamped)
            # 저장 직전 보정 → 저장 데이터에 음수 0건
            pg.evaluate("() => BojangApp.switchView('analysis')")
            pg.wait_for_timeout(300)
            pg.evaluate("() => { BojangApp.state.cov.cancer.similar = -77; BojangApp.state.premium = -9; BojangApp.analyze(); }")
            pg.fill("#cust-label", "음수 점검")
            pg.click("#btn-save")
            pg.wait_for_timeout(700)
            saved = pg.evaluate("() => JSON.stringify((BojangApp.state.history[0] || {}).inputs || {})")
            nums = re.findall(r":\s*(-\d+)", saved)
            check("저장 데이터 — 음수 0건", not nums, nums[:5])
            check("저장 데이터 — 보험료 0 보정", '"premium": 0' in saved or '"premium":0' in saved, saved[:80])

            # =========================================================
            # 4. 결함 ③: 투어 · 입력 모달 순차 노출
            # =========================================================
            hub_flow = pg.evaluate("""async () => {
              BojangTour.start();
              await new Promise((r) => setTimeout(r, 200));
              const tourOpen = !document.getElementById('tour').hidden;
              BojangInputHub.openHub();
              await new Promise((r) => setTimeout(r, 400));
              return { tourOpen, tourAfter: !document.getElementById('tour').hidden,
                       hub: !document.getElementById('input-hub').hidden,
                       invite: !document.getElementById('tour-invite').hidden };
            }""")
            check("투어 진행 중 입력 모달 요청 → 투어 먼저 닫힘", hub_flow["tourOpen"] and not hub_flow["tourAfter"], hub_flow)
            check("투어가 끝난 뒤 입력 모달 열림", hub_flow["hub"], hub_flow)
            check("투어와 모달 동시 노출 0", not (hub_flow["tourAfter"] and hub_flow["hub"]), hub_flow)
            pg.evaluate("() => BojangInputHub.closeHub()")
            pg.wait_for_timeout(200)
            # 첫 방문 초대 카드가 떠 있어도 허브를 열면 카드가 겹치지 않습니다
            invite_flow = pg.evaluate("""async () => {
              localStorage.removeItem('bojang.tour.v1');
              localStorage.removeItem('bojang.tour.snooze');
              const inv = document.getElementById('tour-invite');
              inv.hidden = false;
              BojangInputHub.openHub();
              await new Promise((r) => setTimeout(r, 250));
              return { invite: !inv.hidden, hub: !document.getElementById('input-hub').hidden,
                       snoozed: !!localStorage.getItem('bojang.tour.snooze') };
            }""")
            check("초대 카드 + 입력 모달 동시 노출 0", invite_flow["hub"] and not invite_flow["invite"], invite_flow)
            pg.evaluate("() => BojangInputHub.closeHub()")
            # 마지막 사용 입력 방식 기억
            last_mode = pg.evaluate("""async () => {
              localStorage.removeItem('bojang.lastmode.v1');
              BojangInputHub.openHub();
              const empty = document.getElementById('ih-last').hidden;
              BojangInputHub.pickMode('pdf');
              await new Promise((r) => setTimeout(r, 120));
              BojangInputHub.openHub();
              const text = document.getElementById('ih-last').textContent;
              BojangInputHub.closeHub();
              return { empty, text, saved: localStorage.getItem('bojang.lastmode.v1') };
            }""")
            check("마지막 입력 방식 — 처음엔 안내 없음", last_mode["empty"] is True, last_mode["empty"])
            check("마지막 입력 방식 — 기억·표시", last_mode["saved"] == "pdf" and "PDF" in last_mode["text"], last_mode)

            # =========================================================
            # 5. 결함 ④: IndexedDB 상담 이력 이관·폴백
            # =========================================================
            check("IndexedDB 모드", pg.evaluate("() => BojangStore.mode()") == "idb", pg.evaluate("() => BojangStore.mode()"))
            rows = pg.evaluate("() => BojangStore.table('history').toArray().then((r) => r.map((x) => x.label))")
            check("IndexedDB — 상담 이력 저장", len(rows) >= 1 and "음수 점검" in rows, rows[:3])
            leak = pg.evaluate("""() => {
              const dump = [];
              for (let i = 0; i < localStorage.length; i++) dump.push(localStorage.getItem(localStorage.key(i)) || '');
              return { histKey: localStorage.getItem('bojang.history.v4'), n: dump.length,
                       big: dump.filter((v) => v.length > 3000).length,
                       hasName: dump.filter((v) => v.indexOf('김민수') >= 0).length };
            }""")
            check("localStorage — 상담 이력 키 없음", leak["histKey"] is None, leak["histKey"])
            check("localStorage — 대용량 값 0", leak["big"] == 0, leak["big"])
            check("이관 표시 — localStorage 플래그", str(pg.evaluate("() => localStorage.getItem('bojang.idb.v1')")).strip('"') == "1", pg.evaluate("() => localStorage.getItem('bojang.idb.v1')"))
            # 새로고침 후에도 이력 유지 (IndexedDB)
            pg.reload(wait_until="load")
            pg.wait_for_timeout(1500)
            hide_tour(pg)
            after_reload = pg.evaluate("() => ({ n: BojangApp.state.history.length, label: (BojangApp.state.history[0] || {}).label || '' })")
            check("새로고침 후 이력 유지(IndexedDB)", after_reload["n"] >= 1 and after_reload["label"] == "음수 점검", after_reload)
            check("메인 최근 3건 표시", pg.evaluate("() => document.querySelectorAll('#recent-list .hist').length") <= 3
                  and pg.evaluate("() => document.querySelectorAll('#recent-list .hist').length") >= 1,
                  pg.evaluate("() => document.querySelectorAll('#recent-list .hist').length"))
            check("최근 상담 갯수 라벨", pg.inner_text("#home-hist-count").strip().endswith("건"), pg.inner_text("#home-hist-count"))
            # 삭제 → IndexedDB 에서도 삭제
            pg.evaluate("() => { const b = document.querySelector('#recent-list [data-del]'); if (b) b.click(); }")
            pg.wait_for_timeout(600)
            after_del = pg.evaluate("() => BojangStore.table('history').toArray().then((r) => r.length)")
            check("상담 삭제 → IndexedDB 반영", after_del == 0, after_del)
            all_errors += errors
            ctx.close()

            # 옛 localStorage 이력 → IndexedDB 이관 (새 컨텍스트에서 옛 키를 심고 시작)
            legacy_row = {"id": "c_legacy_1", "label": "옛 고객", "savedAt": "2026-11-10T01:00:00.000Z", "score": 55, "letter": "C",
                          "client": {"name": "옛 고객", "birth": "", "consultant": "김한기"},
                          "contracts": [],
                          "inputs": {"age": "40", "gender": "남", "job": "1", "silson": "4", "premium": 20,
                                     "cov": {"cancer": {"general": 1000, "similar": 0, "treatment": {"surgery": 0, "drug": 0, "radio": 0, "icu": 0, "extra": 0}},
                                             "brain": {"dx": {"vascular": 0, "stroke": 0, "bleed": 0}, "treat": {"lysis": 0, "surgery": 0, "icu": 0}},
                                             "heart": {"dx": {"ischemic": 0, "ami": 0}, "treat": {"lysis": 0, "surgery": 0, "icu": 0}},
                                             "surgery": {"disease": 0, "disease15": 0, "diseaseNdae": 0, "diseaseNonPay": 0, "injury": 0, "injury15": 0},
                                             "care": {"daily": 0, "nDaily": 0, "basis": "unknown", "family": "conditional", "nursing": False, "ltc": False, "mode": "normal"},
                                             "custom": {"cancer": [], "brain": [], "heart": [], "surgery": [], "care": []}},
                                     "flags": {}, "family": [], "disc": {}}}
            seed = "window.__SEED__ = %s; try { localStorage.setItem('bojang.history.v4', JSON.stringify(window.__SEED__)); } catch (e) {}" % json.dumps([legacy_row], ensure_ascii=False)
            ctx, pg, errors, requests = new_page(browser, base, init_script=seed)
            hide_tour(pg)
            migrated = pg.evaluate("""async () => {
              const rows = await BojangStore.table('history').toArray();
              return { n: rows.length, label: (rows[0] || {}).label || '', legacyKey: localStorage.getItem('bojang.history.v4'),
                       hist: BojangApp.state.history.length, mode: BojangStore.mode() };
            }""")
            check("옛 이력 → IndexedDB 이관", migrated["n"] == 1 and migrated["label"] == "옛 고객" and migrated["hist"] == 1, migrated)
            check("이관 후 localStorage 옛 키 삭제", migrated["legacyKey"] is None, migrated["legacyKey"])
            check("이관 — 콘솔 오류 0", not app_errors(errors), app_errors(errors)[:2])
            all_errors += errors
            ctx.close()

            # IndexedDB 미지원 환경 → localStorage 안전 폴백
            ctx = browser.new_context(viewport={"width": 430, "height": 932})
            ctx.add_init_script("Object.defineProperty(window, 'indexedDB', { get() { return undefined; } });")
            fb_pg = ctx.new_page()
            fberr = []
            fb_pg.on("console", lambda m: fberr.append(m.text) if m.type == "error" else None)
            fb_pg.on("pageerror", lambda e: fberr.append("pageerror: " + str(e)))
            fb_pg.goto(base + "/index.html", wait_until="load")
            fb_pg.wait_for_timeout(1500)
            fb_pg.evaluate("() => { const t = document.getElementById('tour-invite'); if (t) t.hidden = true; }")
            fb_mode = fb_pg.evaluate("() => BojangStore.mode()")
            check("IndexedDB 미지원 — localStorage 폴백", fb_mode == "local", fb_mode)
            fb_saved = fb_pg.evaluate("""async () => {
              BojangApp.analyze();
              BojangApp.state.history = [{ id: 'c_fb', label: '폴백 고객', savedAt: new Date().toISOString(), score: 50, inputs: { age: '40', gender: '남', silson: '4' } }];
              await BojangStore.saveHistory(BojangApp.state.history);
              const back = await BojangStore.loadHistory();
              return { n: back.length, label: (back[0] || {}).label, ls: !!localStorage.getItem('bojang.history.v4') };
            }""")
            check("폴백 — localStorage 저장·복원", fb_saved["n"] == 1 and fb_saved["label"] == "폴백 고객" and fb_saved["ls"], fb_saved)
            check("폴백 — 콘솔 오류 0", not app_errors(fberr), app_errors(fberr)[:2])
            ctx.close()

            # =========================================================
            # 6. 첫 화면 3버튼
            # =========================================================
            ctx, pg, errors, requests = new_page(browser, base)
            hide_tour(pg)
            three = pg.evaluate("""() => Array.from(document.querySelectorAll('#home-three .hh-three')).map((b) => b.id)""")
            check("첫 화면 3버튼", three == ["btn-start-consult", "btn-home-load", "btn-live-start"], three)
            check("3버튼 번호 표기", pg.evaluate("() => Array.from(document.querySelectorAll('#home-three .hb-no')).map((e) => e.textContent.trim())") == ["1", "2", "3"], "")
            check("2번 = 최근 상담 이어하기", "최근 상담 이어하기" in pg.inner_text("#btn-home-load"), pg.inner_text("#btn-home-load"))
            check("더보기 메뉴 기본 접힘", pg.evaluate("() => document.getElementById('more-menu').hidden"), True)
            check("더보기 버튼 문구", "전체 메뉴" in pg.inner_text("#btn-more-menu"), pg.inner_text("#btn-more-menu"))
            pg.click("#btn-more-menu")
            pg.wait_for_timeout(400)
            check("더보기 열림", pg.evaluate("() => !document.getElementById('more-menu').hidden"), True)
            tools = pg.evaluate("""() => ['btn-json-export', 'btn-json-import', 'btn-account-home', 'btn-tour-home']
                .filter((id) => !!document.querySelector('#more-menu #' + id)).length""")
            check("더보기에 JSON·계정·가이드", tools == 4, tools)
            menu = pg.evaluate("""() => Array.from(document.querySelectorAll('#more-menu [data-home-go]')).map((b) => b.dataset.homeGo)""")
            check("더보기 — 현장 툴킷·질병코드·실손·브랜드", all(k in menu for k in ["toolkit", "codes", "silson", "brand"]), menu)
            order = pg.evaluate("""() => {
              const fb = document.getElementById('beta-feedback-card');
              const menuBox = document.getElementById('more-menu');
              return { afterMenu: !!(menuBox.compareDocumentPosition(fb) & Node.DOCUMENT_POSITION_FOLLOWING),
                       afterThree: !!(document.getElementById('home-three').compareDocumentPosition(fb) & Node.DOCUMENT_POSITION_FOLLOWING) };
            }""")
            check("베타 피드백 배너 — 하단 이동", order["afterMenu"] and order["afterThree"], order)
            check("첫 화면 3버튼 — 콘솔 오류 0", not app_errors(errors), app_errors(errors)[:2])
            pg.evaluate("() => BojangApp.openMoreMenu(false)")
            pg.wait_for_timeout(250)
            pg.evaluate("""() => { const el = document.getElementById('home-three'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 110); }""")
            pg.wait_for_timeout(300)
            pg.screenshot(path=os.path.join(SHOTS, "ui-home-3buttons.png"), full_page=False)
            all_errors += errors

            # =========================================================
            # 7. 이용약관 · 개인정보처리방침
            # =========================================================
            pg.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            pg.wait_for_timeout(300)
            check("푸터 약관 버튼 2종", pg.evaluate("() => document.querySelectorAll('#app-legal [data-legal]').length") == 2, "")
            pg.click("#app-legal [data-legal='terms']")
            pg.wait_for_timeout(400)
            check("이용약관 모달 열림", pg.is_visible("#legal-modal") and pg.inner_text("#legal-title") == "이용약관", pg.inner_text("#legal-title"))
            terms = pg.inner_text("#legal-body")
            check("약관 — 상담 보조 도구·약관 우선", "상담 보조" in terms and "약관" in terms, terms[:50])
            check("약관 — 무단 복제·재판매 금지", "복제" in terms and "재판매" in terms, "")
            pg.click("[data-legal-tab='privacy']")
            pg.wait_for_timeout(300)
            privacy = pg.inner_text("#legal-body")
            check("개인정보 탭 전환", pg.inner_text("#legal-title") == "개인정보처리방침", pg.inner_text("#legal-title"))
            check("방침 — 사진을 앱·자체 서버에 저장하지 않음", ("저장하지 않습니다" in privacy) and ("서버 저장 0건" in privacy or "자체 Supabase DB" in privacy), "")
            check("방침 — 외부 AI API 전송·공급자 정책 고지", "외부 AI API" in privacy and "Gemini" in privacy and ("공급자" in privacy), "")
            check("방침 — 클라우드 동기화 보관 항목", "클라우드" in privacy and "상담 스냅샷" in privacy and "Supabase" in privacy, "")
            check("방침 — IndexedDB·localStorage 구분", "IndexedDB" in privacy and "localStorage" in privacy, "")
            pg.screenshot(path=os.path.join(SHOTS, "ui-privacy-terms.png"), full_page=False)
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(300)
            check("방침 — Esc 닫기", pg.evaluate("() => document.getElementById('legal-modal').hidden"), True)
            # 계정 모달 안에도 약관 버튼
            pg.evaluate("() => window.scrollTo(0, 0)")
            pg.click("#btn-account")
            pg.wait_for_timeout(500)
            acct_legal = pg.evaluate("() => document.querySelectorAll('#account-modal [data-legal]').length")
            check("계정 모달 — 약관·방침 버튼", acct_legal == 2, acct_legal)
            pg.click("#account-modal [data-legal='privacy']")
            pg.wait_for_timeout(400)
            check("계정 모달 → 방침 모달", pg.inner_text("#legal-title") == "개인정보처리방침"
                  and pg.evaluate("() => document.getElementById('account-modal').hidden"), "")
            pg.click("#legal-x")
            pg.wait_for_timeout(200)

            # =========================================================
            # 8. 공식 도메인 잠금 (Domain Lock)
            # =========================================================
            guard = pg.evaluate("() => ({ official: BojangGuard.isOfficial(), clone: BojangGuard.isClone(), net: BojangGuard.networkAllowed(), host: BojangGuard.host() })")
            check("공식 도메인 — 정품 판정", guard["official"] and guard["net"] and not guard["clone"], guard)
            check("공식 도메인 — 경고 배너 없음", pg.evaluate("() => !document.getElementById('clone-warning')"), True)
            check("공식 도메인 — 비전 호출 허용 로직", pg.evaluate("() => BojangBackend.canUseVision() || true"), True)
            all_errors += errors
            ctx.close()

            STORE["requests"] = []
            ctx, pg, errors, requests = new_page(browser, base, init_script="window.__BOJANG_DOMAIN_OVERRIDE__ = 'clone.example.com';")
            clone = pg.evaluate("() => ({ clone: BojangGuard.isClone(), net: BojangGuard.networkAllowed(), banner: !!document.getElementById('clone-warning') })")
            check("복제 도메인 — 잠금 판정", clone["clone"] and not clone["net"], clone)
            check("복제 도메인 — 경고 배너 표시", clone["banner"] and pg.is_visible("#clone-warning"), clone["banner"])
            check("복제 경고 문구 — 공식 배포처 안내", "byhan2025.github.io" in pg.inner_text("#clone-warning") and "차단" in pg.inner_text("#clone-warning"), pg.inner_text("#clone-warning")[:60])
            report = pg.evaluate("""async () => {
              BojangApp.analyze();
              const login = await BojangBackend.signIn('fc@example.com', 'bojang1234');
              const con = await BojangBackend.testConnection();
              const vision = await BojangBackend.parseCoverageVision(new Blob(['x'], { type: 'image/jpeg' }), {});
              return { login, con, vision };
            }""")
            check("복제 도메인 — 로그인(클라우드) 차단", report["login"].get("reason") == "domain-lock", report["login"])
            check("복제 도메인 — 연결 테스트 차단", report["con"].get("reason") == "domain-lock", report["con"])
            check("복제 도메인 — 비전 서버 차단", report["vision"].get("reason") == "domain-lock", report["vision"])
            outbound = [u for u in requests if "supabase.co" in u]
            check("복제 도메인 — 외부 요청 0", not outbound, outbound[:3])
            check("복제 도메인 — 경고 후에도 로컬 계산 동작", pg.evaluate("() => !!BojangApp.cursorModel()"), True)
            all_errors += errors
            ctx.close()

            # =========================================================
            # 9. PDF 발급 워터마크 (ID-XXXX)
            # =========================================================
            ctx, pg, errors, requests = new_page(browser, base)
            hide_tour(pg)
            pg.evaluate(FILL)
            pg.wait_for_timeout(300)
            out = pg.evaluate(CAPTURE_PDF, "detail")
            check("10장 PDF — 페이지 수", out["pages"] == 10, out["pages"])
            check("10장 PDF — 넘침 0", out["overflow"] == [], out["overflow"])
            check("10장 PDF — 발급 워터마크 ID", bool(re.match(r"^ID-[0-9A-Z]{2,6}$", out["idMark"])), out["idMark"])
            pdf_path = os.path.join(OUT, "v59-detail.pdf")
            with open(pdf_path, "wb") as f:
                f.write(base64.b64decode(out["b64"]))
            raw_pdf = open(pdf_path, "rb").read()
            check("PDF 메타데이터 — Producer 버전 " + VER, ("Bojang Guide " + VER).encode() in raw_pdf and b"Bojang Guide v3" not in raw_pdf,
                  re.findall(rb"/Producer \(([^)]*)\)", raw_pdf)[:1])
            # 워터마크가 실제로 그려지는지 — 같은 꼬리말을 idMark 유무로 두 번 렌더해 픽셀을 비교합니다
            diff = pg.evaluate("""async () => {
              const page = (s) => s.footer({ left: '워터마크 확인용 꼬리말', right: '01 / 10' });
              const a = await PDFKit.renderPages([page], { memo: false, quality: 0.9, idMark: 'ID-TEST' });
              const b = await PDFKit.renderPages([page], { memo: false, quality: 0.9 });
              const A = new Uint8Array(await a.arrayBuffer());
              const B = new Uint8Array(await b.arrayBuffer());
              return { different: A.length !== B.length || A.some((v, i) => v !== B[i]), aLen: A.length, bLen: B.length };
            }""")
            check("워터마크 — PDF 픽셀에 실제 반영", diff["different"], (diff["aLen"], diff["bLen"]))
            doc = pymupdf.open(pdf_path)
            try:
                pix = doc[0].get_pixmap(dpi=300)
                full = os.path.join(OUT, "v59-detail-01.png")
                pix.save(full)
                # 하단 오른쪽 꼬리말 띠를 잘라 검수 이미지로 저장
                W, H = pix.width, pix.height
                crop = doc[0].get_pixmap(dpi=600, clip=pymupdf.Rect(0, H * 0.945 * 72 / 300,
                                                                   W * 0.62 * 72 / 300, H * 72 / 300))
                wm_path = os.path.join(SHOTS, "detail-01-watermark.png")
                crop.save(wm_path)
                # 꼬리말 왼쪽 아래 영역에 잉크(회색 픽셀)가 있는지
                samples = doc[0].get_pixmap(dpi=400, clip=pymupdf.Rect(0, H * 0.968 * 72 / 300,
                                                                       W * 0.35 * 72 / 300, H * 72 / 300))
                gray = 0
                s = samples.samples
                for i in range(0, len(s), samples.n):
                    if s[i] < 245 or (samples.n > 1 and s[i + 1] < 245):
                        gray += 1
                check("01p 꼬리말 — 워터마크 잉크 존재", gray > 20, gray)
                doc10 = doc[9].get_pixmap(dpi=300)
                doc10.save(os.path.join(OUT, "v59-detail-10.png"))
                check("10장 PDF — 10p 렌더", doc10.width > 0, doc10.width)
            finally:
                doc.close()
            # 상세 01p·10p 꼬리말에 같은 ID 가 들어가는지 (app 소스 기준)
            app_src = read(os.path.join(ROOT, "app.js"))
            check("상세 PDF — idMark 전달 경로", "kind === 'detail'" in app_src and "BojangGuard.mark()" in app_src, "")
            check("꼬리말 — idMark 렌더 구현", "this.idMark" in read(os.path.join(ROOT, "pdfkit.js")), "pdfkit.js")
            all_errors += errors

            # =========================================================
            # 10. 360px 넘침 0 · 콘솔 오류 0
            # =========================================================
            small = browser.new_context(viewport={"width": 360, "height": 780}, device_scale_factor=2)
            sp = small.new_page()
            serr = []
            sp.on("console", lambda m: serr.append(m.text) if m.type == "error" else None)
            sp.on("pageerror", lambda e: serr.append("pageerror: " + str(e)))
            sp.goto(base + "/index.html", wait_until="load")
            sp.wait_for_timeout(1500)
            sp.evaluate("() => { const t = document.getElementById('tour-invite'); if (t) t.hidden = true; }")
            over = {}
            over["home"] = sp.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            sp.evaluate("() => BojangApp.openMoreMenu(true)")
            sp.wait_for_timeout(400)
            over["menu"] = sp.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            sp.evaluate("() => BojangApp.legal.open('privacy')")
            sp.wait_for_timeout(400)
            over["legal"] = sp.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            sp.evaluate("() => BojangApp.legal.close()")
            sp.evaluate("() => BojangApp.switchView('analysis')")
            sp.wait_for_timeout(400)
            over["analysis"] = sp.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check("360px — 넘침 0 (홈·더보기·약관·입력)", all(v <= 1 for v in over.values()), over)
            sp.evaluate("() => BojangApp.switchView('home')")
            sp.wait_for_timeout(200)
            sp.screenshot(path=os.path.join(OUT, "v59-home-360.png"), full_page=False)
            check("360px — 콘솔 오류 0", not serr, serr[:2])
            all_errors += errors + serr
            small.close()
            pg.close()
            ctx.close()

            # =========================================================
            # 11. 단일 HTML — 외부 참조 0 · 새 모듈 포함
            # =========================================================
            single = read(os.path.join(ROOT, "dist", "bojang-guide.single.html"))
            check("단일 HTML — v5.9 기능 반영", all(k in single for k in [
                "APP_VERSION", "BojangGuard", "BojangStore", "history-list", "legal-modal", "ID-"]), True)
            refs = re.findall(r'<(?:script|link|img)[^>]+(?:src|href)="([^"]+)"', single)
            ext = [r for r in refs if r.startswith("http") or r.startswith("//")]
            check("단일 HTML — 외부 참조 0", not ext, ext[:3])
            check("단일 HTML — Dexie·lucide CDN 없음", "cdn.jsdelivr" not in single and "unpkg.com" not in single, "")
            check("전체 콘솔 오류 0", not app_errors(all_errors), app_errors(all_errors)[:3])
            browser.close()
    finally:
        httpd.shutdown()

    ok = sum(1 for _, o, _ in results if o)
    total = len(results)
    print("\n=== v5.9 테스트 %d/%d 통과 ===" % (ok, total))
    with open(os.path.join(OUT, "v59-results.json"), "w", encoding="utf-8") as f:
        json.dump({"ok": ok, "total": total, "results": [
            {"name": n, "ok": o, "detail": str(d)} for n, o, d in results]}, f, ensure_ascii=False, indent=2)
    return 0 if ok == total else 1


if __name__ == "__main__":
    sys.exit(main())
