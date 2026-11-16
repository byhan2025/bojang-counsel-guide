#!/usr/bin/env python3
"""보장분석 라이프 리포트 v5.7 — 시니어·차트·QR·온보딩 자동 검증.

실행: python3 tests/test_v5_7.py

검증:
  · 버전 v5.7 (타이틀·헤더·서비스워커·manifest·단일 HTML·외부 참조 0)
  · 현업 도메인 — 뇌·심장 프리셋 1순위 '특정순환계질환(3~5종) 주요치료비',
    키워드(특정순환계·3~5종·3-5종·순환계 주요치료비)가 치료비 2칸에만 배분(중환자실 제외)
  · 시니어 큰 글씨 모드 — 토글·클래스·폰트 확대·세로 카드 정렬·localStorage 유지·360px 넘침 0
  · 불완전판매 방지 경고 — 암·뇌·심장·간병·리모델링 문구가 고객 화면과 10장 PDF 05·06·07·09p에 표시
  · 갱신형 vs 비갱신형 20년 차트 — 앱 SVG(슬라이드 27)와 08p PDF, 교차점·범례·각주, 08p 넘침 0
  · 명함 QR — 순수 JS 생성기, 01p·10p·리모델링 1장 PDF에 인쇄되고 스캔값이 카카오 상담 링크와 일치
  · 4단계 퀵 가이드 투어 — 첫 방문 초대 → ①입력 ②5대 담보 ③리모델링 ④PDF, localStorage 완료 기록
  · 1·10·30장 넘침 0, 콘솔 오류 0
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
SHOTS = "/workspace/reports/bojang-guide/v5.7"
os.makedirs(OUT, exist_ok=True)
os.makedirs(SHOTS, exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ((" · " + str(detail)) if detail else ""))
    return ok


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass


def start_server():
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return httpd, f"http://127.0.0.1:{port}"
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("server start failed")


CONTRACTS = [
    {"id": "c1", "insurer": "A생명", "product": "무배당 종신보험", "premium": 12, "maturity": "100세", "renew": False, "pay": "납입중"},
    {"id": "c2", "insurer": "B화재", "product": "운전자보험", "premium": 5, "maturity": "80세", "renew": True, "pay": "납입중"},
    {"id": "c3", "insurer": "C손해", "product": "실손의료비", "premium": 3, "maturity": "100세", "renew": True, "pay": "납입중"},
]

FILL_STATE = """
() => {
  const S = BojangApp.state;
  S.client = { name: '김민수', birth: '1983-03-12', consultant: '김한기', dateLabel: '2026년 11월 16일' };
  S.age = '40'; S.gender = '남'; S.job = '2'; S.silson = '2'; S.premium = 28;
  S.cov.cancer = { general: 3000, similar: 500, treatment: { surgery: 1000, drug: 1000, radio: 500, icu: 0, extra: 500 }, recur: true };
  S.cov.brain = { dx: { vascular: 2000, stroke: 2000, bleed: 1000 }, treat: { lysis: 1000, surgery: 500, icu: 0 } };
  S.cov.heart = { dx: { ischemic: 2000, ami: 1000 }, treat: { lysis: 0, surgery: 1000, icu: 0 } };
  S.cov.surgery = { disease: 50, disease15: 300, diseaseNdae: 300, diseaseNonPay: 0, injury: 50, injury15: 300 };
  S.cov.care = { daily: 10, nDaily: 0, basis: 'time', family: 'conditional', nursing: true, ltc: false, mode: 'normal' };
  S.cov.custom = {
    cancer: [{ id: 'a1', name: '표적항암약물허가치료비', amount: 3000, mode: 'individual' }],
    brain: [{ id: 'b1', name: '특정순환계질환(3~5종) 주요치료비', amount: 2000, mode: 'bundle' }],
    heart: [{ id: 'h1', name: '특정순환계질환(3~5종) 주요치료비', amount: 2000, mode: 'bundle' }],
    surgery: [{ id: 's1', name: '질병 1~5종(특정)', amount: 300, mode: 'individual' }],
    care: [{ id: 'c1', name: '중증치매간병비', amount: 8, mode: 'individual' }]
  };
  S.flags = { savings: true, renew: true, manyRiders: true };
  S.contracts = %s;
  BojangBrand.save({ name: '보반 라이프 리포트', slogan: '고객 맞춤형 보장 점검 · 리모델링 상담 가이드',
                     consultant: '김한기', title: '손해보험 설계사', phone: '010-4908-4175', kakao: 'open.kakao.com/o/bojang57' });
  BojangApp.analyze();
}
""" % json.dumps(CONTRACTS, ensure_ascii=False)

CAPTURE = """async (kind) => {
  const texts = [];
  const S = PDFKit.Sheet.prototype;
  const ot = S.text, op = S.para;
  S.text = function (s, x, y, o) { texts.push(String(s)); return ot.call(this, s, x, y, o); };
  S.para = function (s, x, y, w, o) { texts.push(String(s)); return op.call(this, s, x, y, w, o); };
  let out;
  try { out = await BojangApp.buildPdfBlob(kind); }
  finally { S.text = ot; S.para = op; }
  document.getElementById('pdf-overlay').hidden = true;
  const buf = await out.blob.arrayBuffer();
  let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return { pages: out.pages, overflow: out.overflow, texts, b64: btoa(bin) };
}"""


def pdf_png(blob_path, page_no, out_path, dpi=150):
    doc = pymupdf.open(blob_path)
    pix = doc[page_no - 1].get_pixmap(dpi=dpi)
    pix.save(out_path)
    return pix


def decode_qr(png_path):
    if not zxingcpp:
        return None
    import numpy as np
    import cv2
    img = cv2.imread(png_path)
    res = zxingcpp.read_barcodes(img)
    return res[0].text if res else ""


def main():
    httpd, base = start_server()
    url = base + "/index.html"
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"), args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=2, accept_downloads=True)
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            page.set_default_timeout(20000)
            page.goto(url, wait_until="load")
            page.wait_for_timeout(600)
            page.evaluate("() => localStorage.clear()")
            page.reload(wait_until="load")
            page.wait_for_timeout(1500)

            # =========================================================
            # 1. 버전 · 정적 구조
            # =========================================================
            title = page.title()
            check("타이틀 v5.7 이상", any(v in title for v in ("v5.7", "v5.8")) and "보장분석 라이프 리포트" in title, title)
            check("헤더 버전 표기 v5.7 이상", any(v in page.inner_text(".hh-ver") for v in ("v5.7", "v5.8")), page.inner_text(".hh-ver"))
            check("헤더 eyebrow V5.7 이상", any(v in page.inner_text(".hh-eyebrow") for v in ("V5.7", "V5.8")), page.inner_text(".hh-eyebrow"))
            sw = read(os.path.join(ROOT, "sw.js"))
            check("서비스워커 캐시 v5.7 이상", any(v in sw for v in ("bojang-guide-v5.7", "bojang-guide-v5.8")), sw.splitlines()[2])
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest v5.7 이상", any(v in man.get("name", "") for v in ("v5.7", "v5.8")), man.get("name"))
            check("manifest — 새 기능 설명", "특정순환계질환" in man.get("description", "") and "QR" in man.get("description", ""), man.get("description")[:60])

            content_src = read(os.path.join(ROOT, "content.js"))
            model_src = read(os.path.join(ROOT, "model.js"))
            report_src = read(os.path.join(ROOT, "report.js"))
            client_src = read(os.path.join(ROOT, "client.js"))
            app_src = read(os.path.join(ROOT, "app.js"))
            qr_src = read(os.path.join(ROOT, "qr.js"))

            check("도메인 — 프리셋 1순위 교체", content_src.count("특정순환계질환(3~5종) 주요치료비") >= 2, content_src.count("특정순환계질환(3~5종) 주요치료비"))
            check("도메인 — model 키워드 4종", "['main', /특정순환계" in model_src and model_src.count("'main'") >= 3 and "순환계" in model_src, "model.js")
            check("경고 문구 — 5개 영역 정의", all(k in content_src for k in ["SALE_WARNINGS", "cancer:", "brain:", "heart:", "surgery:", "care:", "remodel:"]), "content.js")
            check("QR — 외부 라이브러리 없는 자체 생성기", "BojangQR" in qr_src and "rsEncode" in qr_src and "http" not in qr_src.replace("https:", ""), "qr.js")
            check("리포트 — 경고 스트립·차트·QR 헬퍼", all(k in report_src for k in ["function warnStrip", "function renewChart", "function qrBlock", "function qrInfo"]), "report.js")
            check("고객 화면 — 시니어·경고·차트", all(k in client_src for k in ["applySenior", "warnCard", "renewChartSVG"]), "client.js")
            check("앱 — 4단계 투어", all(k in app_src for k in ["TOUR_STEPS", "bojang.tour.v1", "tourPlace"]), "app.js")

            # =========================================================
            # 2. 첫 방문 4단계 퀵 가이드 투어
            # =========================================================
            inv = page.evaluate("() => !document.getElementById('tour-invite').hidden")
            check("첫 방문 — 가이드 초대 표시", inv, inv)
            page.click("#tour-invite-start")
            page.wait_for_timeout(500)
            step1 = page.evaluate("""() => ({
              open: !document.getElementById('tour').hidden,
              step: document.getElementById('tour-step').textContent,
              title: document.getElementById('tour-title').textContent,
              view: (document.querySelector('.view.is-active') || {}).id,
              spot: (() => { const r = document.getElementById('tour-spot').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()
            })""")
            check("투어 시작 — 1/4 입력 허브", step1["open"] and step1["step"].startswith("1 /") and "입력" in step1["title"], step1)
            check("투어 스포트라이트 크기 유효", step1["spot"][0] > 60 and step1["spot"][1] > 30, step1["spot"])
            page.click("#tour-next")
            page.wait_for_timeout(600)
            step2 = page.evaluate("""() => ({
              step: document.getElementById('tour-step').textContent,
              title: document.getElementById('tour-title').textContent,
              view: (document.querySelector('.view.is-active') || {}).id,
              target: (() => { const r = document.getElementById('tour-spot').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; })()
            })""")
            check("투어 2단계 — 5대 담보·직접 기재", "2 /" in step2["step"] and "5대 담보" in step2["title"] and step2["view"] == "view-analysis", step2)
            page.screenshot(path=os.path.join(SHOTS, "ui-tour.png"))
            page.click("#tour-next")
            page.wait_for_timeout(600)
            step3 = page.evaluate("() => ({ step: document.getElementById('tour-step').textContent, view: (document.querySelector('.view.is-active') || {}).id })")
            check("투어 3단계 — 리모델링 비교기", "3 /" in step3["step"] and step3["view"] == "view-remodel", step3)
            page.click("#tour-next")
            page.wait_for_timeout(700)
            step4 = page.evaluate("() => ({ step: document.getElementById('tour-step').textContent, view: (document.querySelector('.view.is-active') || {}).id, txt: document.getElementById('tour-next').textContent })")
            check("투어 4단계 — PDF 저장", "4 /" in step4["step"] and step4["view"] == "view-analysis" and "완료" in step4["txt"], step4)
            page.click("#tour-next")
            page.wait_for_timeout(400)
            done = page.evaluate("() => ({ open: !document.getElementById('tour').hidden, mark: localStorage.getItem('bojang.tour.v1') })")
            check("투어 완료 — 닫힘 + localStorage 기록", (not done["open"]) and done["mark"] == "1", done)
            page.reload(wait_until="load")
            page.wait_for_timeout(1400)
            again = page.evaluate("() => !document.getElementById('tour-invite').hidden")
            check("재방문 — 초대 다시 뜨지 않음", not again, again)
            page.click("#btn-tour")
            page.wait_for_timeout(400)
            manual = page.evaluate("() => (!document.getElementById('tour').hidden) && document.getElementById('tour-step').textContent")
            check("상단 ? 가이드 버튼 — 재시작", "1 /" in str(manual), manual)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            check("Esc — 투어 닫기", page.evaluate("() => document.getElementById('tour').hidden"), "")
            check("닫으면 7일 스누즈 기록", page.evaluate("() => !!localStorage.getItem('bojang.tour.snooze')"), "")

            # =========================================================
            # 3. 현업 도메인 — 프리셋 · 키워드 배분
            # =========================================================
            page.evaluate("() => { BojangTour.mark(); document.getElementById('tour-invite').hidden = true; }")
            page.evaluate(FILL_STATE)
            page.wait_for_timeout(300)
            page.evaluate("() => BojangApp.switchView('analysis')")
            page.wait_for_timeout(300)
            page.evaluate("() => { const nx = document.querySelector('#wiz-next'); if (nx) { nx.click(); nx.click(); } }")
            page.wait_for_timeout(600)
            chips = page.evaluate("() => Array.from(document.querySelectorAll('#card-brain [data-custom-preset]')).map((b) => [b.dataset.customPreset, b.dataset.presetMode])")
            check("뇌 프리셋 1순위 — 특정순환계질환(3~5종)", chips and chips[0][0] == "특정순환계질환(3~5종) 주요치료비" and chips[0][1] == "bundle", chips[:2])
            heart_chips = page.evaluate("() => Array.from(document.querySelectorAll('#card-heart [data-custom-preset]')).map((b) => b.dataset.customPreset)")
            check("심장 프리셋 1순위 — 특정순환계질환(3~5종)", heart_chips and heart_chips[0] == "특정순환계질환(3~5종) 주요치료비", heart_chips[:2])

            kw = page.evaluate("""() => {
      const mk = (name) => {
        const S = { age: '40', cov: { brain: { dx: {}, treat: {} }, custom: { brain: [{ id: 'x', name, amount: 2000, mode: 'bundle' }] } } };
        const subs = BojangModel.NEURO_SUBS.map((s) => ({ key: s.key, rec: BojangModel.treatRec(2000, s) }));
        const r = BojangModel.customCredits(S, 'brain', subs);
        const row = r.rows[0] || {};
        return { sub: row.sub, byKey: r.byKey };
      };
      return {
        a: mk('특정순환계질환(3~5종) 주요치료비'),
        b: mk('특정순환계 3~5종 주요치료비'),
        c: mk('특정순환계 3-5종 주요치료비'),
        d: mk('순환계 주요치료비'),
        e: mk('뇌혈관수술비')
      };
    }""")
            check("키워드 '특정순환계질환(3~5종)' → 통합 배분", all(v["sub"] == "main" for k, v in kw.items() if k != "e"), {k: v["sub"] for k, v in kw.items()})
            check("통합 담보는 혈전용해·수술에만 배분(중환자실 0)", all(v["byKey"].get("icu", 0) == 0 and v["byKey"].get("lysis", 0) > 0 and v["byKey"].get("surgery", 0) > 0 for k, v in kw.items() if k != "e"), kw["a"]["byKey"])
            check("개별 담보 '뇌혈관수술비'는 수술 칸 단독", kw["e"]["sub"] == "surgery" and kw["e"]["byKey"].get("surgery") == 2000, kw["e"])

            # =========================================================
            # 4. 고객 화면 — 시니어 큰 글씨 모드 · 경고 · 차트
            # =========================================================
            page.evaluate("() => { BojangApp.state.view = 'advisor'; document.querySelector(\".viewswitch button[data-mode='client']\").click(); }")
            page.wait_for_timeout(700)
            check("고객 화면 진입", page.evaluate("() => !document.getElementById('deck').hidden"), "")
            base_font = page.evaluate("""() => { BojangDeck.goTo(27); const h = document.querySelector('.slide.is-current .sl-head h2'); return parseFloat(getComputedStyle(h).fontSize); }""")
            page.click("#deck-senior")
            page.wait_for_timeout(400)
            senior = page.evaluate("""() => ({
              cls: document.getElementById('deck').classList.contains('senior'),
              aria: document.getElementById('deck-senior').getAttribute('aria-pressed'),
              ls: localStorage.getItem('bojang.senior.v1'),
              font: parseFloat(getComputedStyle(document.querySelector('.slide.is-current .sl-head h2')).fontSize),
              cols: getComputedStyle(document.querySelector('.slide.is-current .grid2')).gridTemplateColumns
            })""")
            check("큰 글씨 모드 — 클래스·aria·저장", senior["cls"] and senior["aria"] == "true" and senior["ls"] == "1", senior)
            check("큰 글씨 모드 — 제목 폰트 확대", senior["font"] > base_font * 1.15, (base_font, senior["font"]))
            check("큰 글씨 모드 — 세로 1열 정렬", " " not in senior["cols"].strip(), senior["cols"])
            page.evaluate("() => BojangDeck.goTo(23)")
            page.wait_for_timeout(350)
            page.screenshot(path=os.path.join(SHOTS, "ui-senior-large.png"))
            page.evaluate("() => BojangDeck.goTo(27)")
            page.wait_for_timeout(350)

            chart = page.evaluate("""() => {
      const sl = document.querySelector('#slide-27');
      const svg = sl.querySelector('svg.sl-chart, .sl-chart svg');
      return {
        has: !!svg,
        lines: svg ? svg.querySelectorAll('polyline').length : 0,
        txt: svg ? svg.textContent : '',
        cap: sl.querySelector('.sl-chart figcaption') ? sl.querySelector('.sl-chart figcaption').textContent : ''
      };
    }""")
            check("앱 차트 — 20년 추이 SVG(곡선 2개)", chart["has"] and chart["lines"] == 2, chart["lines"])
            check("앱 차트 — 교차·범례·각주", ("역전" in chart["txt"]) and ("갱신형" in chart["txt"]) and ("예시 시뮬레이션" in chart["cap"]), chart["txt"][:80])
            page.screenshot(path=os.path.join(SHOTS, "ui-renew-chart.png"))

            warn_ui = page.evaluate("""() => {
      const out = {};
      [8, 13, 18, 23, 30].forEach((n) => {
        const w = document.querySelector('#slide-' + n + ' .sl-warn');
        out[n] = w ? w.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) : null;
      });
      return out;
    }""")
            check("고객 화면 — 5개 슬라이드 경고 배지", all(warn_ui[str(n)] for n in (8, 13, 18, 23, 30)), warn_ui)
            check("고객 화면 — 암 경고 문구(90일·50%)", "90일" in (warn_ui["8"] or "") and "50%" in (warn_ui["8"] or ""), warn_ui["8"])
            check("고객 화면 — 간병 경고 문구(8시간·업체 등록)", "8시간" in (warn_ui["23"] or "") and "업체 등록" in (warn_ui["23"] or ""), warn_ui["23"])
            check("고객 화면 — 리모델링 경고 문구(해지환급금)", "해지환급금" in (warn_ui["30"] or ""), warn_ui["30"])

            deck_scroll = page.evaluate("""() => {
      const out = [];
      [1, 8, 13, 23, 27, 30].forEach((n) => {
        BojangDeck.goTo(n);
        out.push([n, document.documentElement.scrollWidth, window.innerWidth]);
      });
      return out;
    }""")
            check("고객 화면 — 가로 스크롤 0", all(d[1] <= d[2] for d in deck_scroll), deck_scroll)

            # 360px — 시니어 모드 넘침
            ctx360 = browser.new_context(viewport={"width": 360, "height": 780}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="ko-KR")
            pg360 = ctx360.new_page()
            pg360.goto(url, wait_until="load")
            pg360.wait_for_timeout(400)
            pg360.evaluate("() => { localStorage.setItem('bojang.tour.v1','1'); localStorage.setItem('bojang.senior.v1','1'); }")
            pg360.reload(wait_until="load")
            pg360.wait_for_timeout(800)
            pg360.evaluate(FILL_STATE)
            pg360.evaluate("() => { BojangApp.state.view = 'advisor'; document.querySelector(\".viewswitch button[data-mode='client']\").click(); }")
            pg360.wait_for_timeout(700)
            mob = pg360.evaluate("""() => {
      const out = [];
      [8, 13, 23, 27, 30].forEach((n) => {
        BojangDeck.goTo(n);
        const el = document.querySelector('.slide.is-current .sl-inner');
        const over = [];
        el.querySelectorAll('*').forEach((x) => { const r = x.getBoundingClientRect(); if (r.right > window.innerWidth + 0.5 && !x.closest('.timeline, .sil-table, .code-table')) over.push((x.className || x.tagName) + ':' + Math.round(r.right)); });
        out.push([n, document.documentElement.scrollWidth, window.innerWidth, over.slice(0, 3)]);
      });
      return out;
    }""")
            check("360px 시니어 — 가로 넘침 0", all(m[1] <= m[2] and not m[3] for m in mob), mob)
            pg360.evaluate("() => document.querySelector('.viewswitch button[data-mode=\"advisor\"]').click()")
            pg360.wait_for_timeout(300)
            pg360.click("#btn-tour")
            pg360.wait_for_timeout(400)
            tour360 = pg360.evaluate("""() => { const r = document.getElementById('tour-card').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), window.innerWidth]; }""")
            check("360px 투어 카드 — 화면 안", tour360[0] >= 0 and tour360[1] <= tour360[2], tour360)
            ctx360.close()

            # =========================================================
            # 5. 10장 상세 PDF — 경고 · 08p 차트 · 01/10p QR
            # =========================================================
            detail = page.evaluate(CAPTURE, "detail")
            joined = "\n".join(detail["texts"])
            check("상세 10페이지", detail["pages"] == 10, detail["pages"])
            check("상세 넘침 0 (경고·차트 포함)", len(detail["overflow"]) == 0, detail["overflow"])
            check("05p 암 경고 스트립", "불완전판매 방지 · 암" in joined and "보장개시일 90일" in joined, [t for t in detail["texts"] if "불완전판매" in t][:3])
            check("06p 뇌·심장 경고 스트립", "불완전판매 방지 · 뇌" in joined and "혈전용해제 치료와 혈전제거술" in joined, "")
            check("07p 간병 경고 스트립", "불완전판매 방지 · 간병" in joined and "하루 8시간 기준" in joined, "")
            check("09p 리모델링 경고 스트립", "불완전판매 방지 · 리모델링" in joined and "해지환급금" in joined, "")
            check("08p 차트 제목·범례·각주", "20년 예상 보험료 추이" in joined and "갱신형" in joined and "예시 시뮬레이션" in joined, "")
            check("08p 차트 교차점 문구", "년 뒤 역전" in joined, [t for t in detail["texts"] if "역전" in t][:1])
            check("08p 기존 섹션 유지", "노후 체크포인트" in joined and "계약 납입 · 만기 현황" in joined, "")
            check("특정순환계 담보가 06p에 그대로 인쇄", "특정순환계질환(3~5종) 주요치료비" in joined, "")

            detail_pdf = os.path.join(OUT, "detail57.pdf")
            open(detail_pdf, "wb").write(base64.b64decode(detail["b64"]))
            pdf_png(detail_pdf, 8, os.path.join(SHOTS, "detail-08-renew-chart.png"), dpi=150)
            png10 = os.path.join(SHOTS, "detail-10-qr-card.png")
            pdf_png(detail_pdf, 10, png10, dpi=200)
            qr10 = decode_qr(png10)
            check("10p 명함 QR — 스캔값 = 카카오 상담 링크", qr10 == "https://open.kakao.com/o/bojang57", qr10)
            png1 = os.path.join(OUT, "p01.png")
            pdf_png(detail_pdf, 1, png1, dpi=200)
            qr1 = decode_qr(png1)
            check("01p 명함 QR — 스캔값 일치", qr1 == "https://open.kakao.com/o/bojang57", qr1)

            # 전화번호만 있는 브랜드 → tel: QR
            tel = page.evaluate("""() => {
      BojangBrand.save({ name: '보반 라이프 리포트', consultant: '김한기', phone: '010-4908-4175', kakao: '' });
      return BojangReport.qrInfo({ client: { name: '김민수' } });
    }""")
            check("QR 내용 — 전화번호는 tel:", tel and tel["text"] == "tel:01049084175", tel)
            vq = page.evaluate("""() => {
      const a = BojangQR.matrix('tel:01049084175');
      const b = BojangQR.matrix('https://open.kakao.com/o/bojang57');
      const long = BojangQR.matrix('https://example.com/very/long/path/that/needs/a/bigger/version/for/sure?x=1234567890');
      return { a: [a.size, a.version], b: [b.size, b.version], long: long ? [long.size, long.version] : null, det: JSON.stringify(a.modules) === JSON.stringify(BojangQR.matrix('tel:01049084175').modules) };
    }""")
            check("QR — 버전 자동 선택(길이별)", vq["a"][1] < vq["b"][1] <= vq["long"][1], vq)
            check("QR — 동일 입력 동일 매트릭스", vq["det"], vq["det"])
            page.evaluate("""() => BojangBrand.save({ name: '보반 라이프 리포트', slogan: '고객 맞춤형 보장 점검 · 리모델링 상담 가이드',
                     consultant: '김한기', title: '손해보험 설계사', phone: '010-4908-4175', kakao: 'open.kakao.com/o/bojang57' })""")

            summary = page.evaluate(CAPTURE, "summary")
            check("1장 요약 — 1페이지 · 넘침 0", summary["pages"] == 1 and len(summary["overflow"]) == 0, (summary["pages"], summary["overflow"]))

            # =========================================================
            # 6. 리모델링 1장 PDF — 경고 · 명함 QR
            # =========================================================
            rem = page.evaluate("""async () => {
      const texts = [];
      const S = PDFKit.Sheet.prototype;
      const ot = S.text, op = S.para;
      S.text = function (s, x, y, o) { texts.push(String(s)); return ot.call(this, s, x, y, o); };
      S.para = function (s, x, y, w, o) { texts.push(String(s)); return op.call(this, s, x, y, w, o); };
      let got = null;
      const orig = PDFKit.saveBlob;
      PDFKit.saveBlob = async (blob) => { got = blob; return 'saved'; };
      try { await BojangRemodel.pdf(); } finally { PDFKit.saveBlob = orig; S.text = ot; S.para = op; }
      const buf = await got.arrayBuffer(); let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      return { texts, b64: btoa(bin), size: got.size };
    }""")
            rj = "\n".join(rem["texts"])
            check("리모델링 PDF — 불완전판매 방지 안내", "불완전판매 방지" in rj and "해지환급금" in rj and "90일 면책" in rj, rj[-200:])
            rem_pdf = os.path.join(OUT, "remodel57.pdf")
            open(rem_pdf, "wb").write(base64.b64decode(rem["b64"]))
            rem_png = os.path.join(OUT, "remodel57.png")
            pdf_png(rem_pdf, 1, rem_png, dpi=200)
            check("리모델링 1장 PDF — 명함 QR 스캔", decode_qr(rem_png) == "https://open.kakao.com/o/bojang57", decode_qr(rem_png))

            # =========================================================
            # 7. 30장 플랜북 · 단일 HTML · 콘솔
            # =========================================================
            adv = page.evaluate("""async () => {
      const build = BojangReport.build('advisor', BojangApp.state);
      const overflow = [];
      await PDFKit.renderPages(build.pages, { overflow, memo: false });
      return { pages: build.pages.length, overflow };
    }""")
            check("플랜북 30페이지 · 넘침 0", adv["pages"] == 30 and len(adv["overflow"]) == 0, (adv["pages"], adv["overflow"]))

            single = read(os.path.join(ROOT, "dist", "bojang-guide.single.html"))
            check("단일 HTML — v5.7 기능 반영", all(k in single for k in ["v5.7", "BojangQR", "SALE_WARNINGS", "sl-warn", "tour-card", "renewTrend"]), "v5.7" in single)
            check("단일 HTML — 외부 참조 0", single.count('src="./') == 0 and single.count('href="./') == 0, (single.count('src="./'), single.count('href="./')))
            console_errors = [e for e in errors if "favicon" not in e.lower()]
            check("콘솔 오류 0", len(console_errors) == 0, console_errors[:3])
            browser.close()
    finally:
        httpd.shutdown()

    passed = sum(1 for _, ok, _ in results if ok)
    print("\n%d/%d 통과" % (passed, len(results)))
    if passed != len(results):
        print("실패:")
        for n, ok, d in results:
            if not ok:
                print(" -", n, "|", d)
        sys.exit(1)


if __name__ == "__main__":
    main()
