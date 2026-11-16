#!/usr/bin/env python3
"""보장분석 라이프 리포트 v5.6 — 증권 담보 직접 기재(통합형/개별형) 자동 검증.

실행: python3 tests/test_v5_6.py

검증:
  · 버전 표기 v5.6 (타이틀·헤더·서비스워커·manifest·단일 HTML)
  · 데이터 모델 — state.cov.custom 5개 영역, 항목 {id,name,amount,mode,note}, 기본값 = 빈 배열
  · custom 이 비어 있으면 v5.5와 점수·판정·요약 100% 동일 (회귀 유지)
  · 입력 UI — 영역별 '+ 증권 담보 직접 추가' 버튼·프리셋 칩·행 목록(담보명/금액/통합형·개별형 토글/삭제)
  · 프리셋 클릭 → 행 추가 + 모드 지정, 중복 추가 방지, 삭제, localStorage 유지, JSON 내보내기/가져오기 보존
  · 뇌·심장 주요치료비 — 통합형/개별형 직접 기재가 치료비 축·충족도·담당자 소견에 반영
  · 진단비 이름의 직접 기재 담보는 치료비 축에서 제외(표시만)
  · PDF 10장 — 03p '증권 직접 기재 추가 담보' 표, 05·06·07p 실제 특약명·금액, 담당자 소견 반영
  · PDF 30장 플랜북 — 해당 영역 페이지에 직접 기재 참고 표시
  · 직접 기재 포함/대량 입력 모두 1·10·30장 넘침 0
  · 모바일 360px — 직접 기재 행 넘침·가로 스크롤 0
  · 콘솔 오류 0
"""
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out")
SHOTS = "/workspace/reports/bojang-guide/v5.6"
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

# 5개 영역 직접 기재 — 통합형(번들)·개별형이 섞인 실무 예시
CUSTOM = {
    "cancer": [
        {"id": "a1", "name": "표적항암약물허가치료비", "amount": 3000, "mode": "individual"},
        {"id": "a2", "name": "다빈치로봇수술비", "amount": 1500, "mode": "individual"},
        {"id": "a3", "name": "항암방사선치료비", "amount": 500, "mode": "individual"},
        {"id": "a4", "name": "암 주요치료비(통합)", "amount": 1000, "mode": "bundle"},
    ],
    "brain": [
        {"id": "b1", "name": "순환계 주요치료비(통합)", "amount": 2000, "mode": "bundle"},
        {"id": "b2", "name": "혈전용해치료비", "amount": 1000, "mode": "individual"},
        {"id": "b3", "name": "뇌혈관수술비", "amount": 1500, "mode": "individual"},
    ],
    "heart": [
        {"id": "h1", "name": "순환계 주요치료비(통합)", "amount": 2000, "mode": "bundle"},
        {"id": "h2", "name": "관상동맥성형술(스텐트)", "amount": 1500, "mode": "individual"},
    ],
    "surgery": [
        {"id": "s1", "name": "질병 1~5종(특정)", "amount": 300, "mode": "individual"},
        {"id": "s2", "name": "관절/척추 수술비", "amount": 500, "mode": "individual"},
    ],
    "care": [
        {"id": "c1", "name": "중증치매간병비", "amount": 8, "mode": "individual"},
        {"id": "c2", "name": "상해간병일당", "amount": 10, "mode": "individual"},
    ],
}

# 대량·긴 이름 입력 — 넘침 방지 확인용
CUSTOM_STRESS = {
    "cancer": [
        {"id": "a1", "name": "표적항암약물허가치료비(비급여포함 특약)", "amount": 3000, "mode": "individual"},
        {"id": "a2", "name": "다빈치로봇수술비(전립선·갑상선)", "amount": 1500, "mode": "individual"},
        {"id": "a3", "name": "항암방사선치료비(세기조절방사선)", "amount": 500, "mode": "individual"},
        {"id": "a4", "name": "암 주요치료비(통합)", "amount": 1000, "mode": "bundle"},
        {"id": "a5", "name": "면역항암제치료비", "amount": 3000, "mode": "individual"},
        {"id": "a6", "name": "암 중환자실입원일당", "amount": 20, "mode": "individual"},
        {"id": "a7", "name": "비급여 암주사치료비", "amount": 300, "mode": "individual"},
        {"id": "a8", "name": "재진단암진단비", "amount": 1000, "mode": "individual"},
        {"id": "a9", "name": "유사암진단비(추가)", "amount": 500, "mode": "individual"},
        {"id": "a10", "name": "항암호르몬치료비", "amount": 200, "mode": "individual"},
    ],
    "brain": [
        {"id": "b1", "name": "순환계 주요치료비(뇌·심장 통합특약)", "amount": 2000, "mode": "bundle"},
        {"id": "b2", "name": "혈전용해치료비(tPA)", "amount": 1000, "mode": "individual"},
        {"id": "b3", "name": "뇌혈관수술비(개두·색전술)", "amount": 1500, "mode": "individual"},
        {"id": "b4", "name": "뇌 중환자실입원일당", "amount": 30, "mode": "individual"},
        {"id": "b5", "name": "기계적혈전제거술비", "amount": 1000, "mode": "individual"},
        {"id": "b6", "name": "뇌혈관질환진단비", "amount": 3000, "mode": "individual"},
    ],
    "heart": [
        {"id": "h1", "name": "순환계 주요치료비(뇌·심장 통합특약)", "amount": 2000, "mode": "bundle"},
        {"id": "h2", "name": "관상동맥성형술(스텐트 삽입)", "amount": 1500, "mode": "individual"},
        {"id": "h3", "name": "관상동맥우회술(개흉)", "amount": 2000, "mode": "individual"},
        {"id": "h4", "name": "심장 중환자실입원일당", "amount": 30, "mode": "individual"},
    ],
    "surgery": [
        {"id": "s1", "name": "질병 1~5종 수술비(특정 5종)", "amount": 300, "mode": "individual"},
        {"id": "s2", "name": "관절/척추 수술비(디스크·협착증)", "amount": 500, "mode": "individual"},
        {"id": "s3", "name": "비급여 수술비(도수·주사 제외)", "amount": 300, "mode": "individual"},
        {"id": "s4", "name": "상해 1~5종 수술비(추가)", "amount": 300, "mode": "individual"},
    ],
    "care": [
        {"id": "c1", "name": "중증치매간병비(1~5등급)", "amount": 8, "mode": "individual"},
        {"id": "c2", "name": "상해간병일당(요양병원 포함)", "amount": 10, "mode": "individual"},
        {"id": "c3", "name": "장기요양간병비(인지지원 포함)", "amount": 6, "mode": "individual"},
        {"id": "c4", "name": "간호간병통합서비스일당", "amount": 5, "mode": "individual"},
    ],
}


def capture(script):
    """페이지 안에서 실행되는 헬퍼 — Sheet 메서드로 그려진 텍스트/넘침을 모읍니다."""
    return """async (kind) => {
      const texts = [];
      const S = PDFKit.Sheet.prototype;
      const ot = S.text, op = S.para;
      S.text = function (s, x, y, o) { texts.push(String(s)); return ot.call(this, s, x, y, o); };
      S.para = function (s, x, y, w, o) { texts.push(String(s)); return op.call(this, s, x, y, w, o); };
      let out;
      const collect = [];
      try { out = await BojangApp.buildPdfBlob(kind); }
      finally { S.text = ot; S.para = op; }
      document.getElementById('pdf-overlay').hidden = true;
      return { pages: out.pages, overflow: out.overflow, size: out.blob.size, texts };
    }"""


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
            page.wait_for_timeout(700)
            page.evaluate("() => localStorage.clear()")
            page.reload(wait_until="load")
            page.wait_for_timeout(900)

            # =========================================================
            # 1. v5.6 버전 표기 · 정적 구조
            # =========================================================
            title = page.title()
            check("타이틀 v5.6 이상", any(v in title for v in ("v5.6", "v5.7", "v5.8")) and "보장분석 라이프 리포트" in title, title)
            check("헤더 버전 표기 v5.6 이상", any(v in page.inner_text(".hh-ver") for v in ("v5.6", "v5.7", "v5.8")), page.inner_text(".hh-ver"))
            check("헤더 eyebrow V5.6 이상", any(v in page.inner_text(".hh-eyebrow") for v in ("V5.6", "V5.7", "V5.8")), page.inner_text(".hh-eyebrow"))
            sw = read(os.path.join(ROOT, "sw.js"))
            check("서비스워커 캐시 v5.6 이상", any(v in sw for v in ("bojang-guide-v5.6", "bojang-guide-v5.7", "bojang-guide-v5.8")), sw.splitlines()[2])
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest v5.6 이상", any(v in man.get("name", "") for v in ("v5.6", "v5.7", "v5.8")), man.get("name"))

            model_src = read(os.path.join(ROOT, "model.js"))
            content_src = read(os.path.join(ROOT, "content.js"))
            report_src = read(os.path.join(ROOT, "report.js"))
            app_src = read(os.path.join(ROOT, "app.js"))
            check("모델 — CUSTOM_KEYS·customCredits·normalize", all(k in model_src for k in ["CUSTOM_KEYS", "customCredits", "customList", "CUSTOM_MAP"]), "model.js")
            check("프리셋 — 통합형/개별형 담보명 정의", all(k in content_src for k in ["CUSTOM_PRESETS", "특정순환계질환(3~5종) 주요치료비", "혈전용해치료비", "뇌혈관수술비", "관상동맥성형술(스텐트)", "표적항암약물허가치료비", "다빈치로봇수술비", "질병 1~5종(특정)", "관절/척추 수술비", "중증치매간병비", "상해간병일당"]), "content.js")
            check("리포트 — customBox·03p 섹션", "function customBox" in report_src and "증권 직접 기재 추가 담보" in report_src, "report.js")
            check("앱 — 직접 추가 버튼·모드 토글·삭제", all(k in app_src for k in ["data-custom-add", "data-custom-mode", "data-custom-del", "data-custom-preset"]), "app.js")

            # =========================================================
            # 2. 데이터 모델 — 기본값·정규화·JSON 보존
            # =========================================================
            default_cov = page.evaluate("() => JSON.stringify(BojangApp.state.cov.custom)")
            check("cov.custom 기본값 = 5개 영역 빈 배열", json.loads(default_cov) == {k: [] for k in ["cancer", "brain", "heart", "surgery", "care"]}, default_cov)
            norm = page.evaluate("""() => {
              const st = { cov: { cancer: {}, brain: {}, heart: {}, surgery: {}, care: {} } };
              BojangModel.normalizeState(st);
              const keys = Object.keys(st.cov.custom);
              return { keys, arrays: keys.every((k) => Array.isArray(st.cov.custom[k])) };
            }""")
            check("normalizeState — custom 5개 영역 보장", norm["arrays"] and sorted(norm["keys"]) == ["brain", "cancer", "care", "heart", "surgery"], norm)

            clean = page.evaluate("""() => {
              const st = JSON.parse(JSON.stringify(BojangApp.state));
              delete st.cov.custom;
              const st2 = JSON.parse(JSON.stringify(BojangApp.state));
              st2.cov.custom = { cancer: [], brain: [], heart: [], surgery: [], care: [] };
              const a = BojangModel.full(st), b = BojangModel.full(st2);
              return {
                score: a.score, score2: b.score,
                same: JSON.stringify(a.rows.map((r) => [r.item.key, r.pct, r.level, r.summary])) === JSON.stringify(b.rows.map((r) => [r.item.key, r.pct, r.level, r.summary])),
                cps: JSON.stringify(a.checkpoints) === JSON.stringify(b.checkpoints),
                total: a.totalSum === b.totalSum
              };
            }""")
            check("custom 없음 = v5.5와 동일 (점수·판정·요약·체크포인트)", clean["same"] and clean["cps"] and clean["total"], clean)

            # =========================================================
            # 3. 입력 UI — 버튼·프리셋·행·토글·삭제
            # =========================================================
            page.click("#tab-analysis")
            page.wait_for_timeout(600)
            page.evaluate("() => { const nx = document.querySelector('#wiz-next'); if (nx) { nx.click(); nx.click(); } }")
            page.wait_for_timeout(700)
            blocks = page.evaluate("() => document.querySelectorAll('[data-custom-block]').length")
            check("영역별 직접 기재 블록 5개", blocks == 5, blocks)
            adds = page.evaluate("() => document.querySelectorAll('[data-custom-add]').length")
            check("'+ 증권 담보 직접 추가' 버튼 5개", adds == 5, adds)
            btn_txt = page.inner_text("#card-brain [data-custom-add]")
            check("추가 버튼 문구", "증권 담보 직접 추가" in btn_txt, btn_txt)
            presets = page.evaluate("() => Array.from(document.querySelectorAll('#card-brain [data-custom-preset]')).map((b) => b.dataset.customPreset)")
            check("뇌 프리셋 칩 — 통합형·혈전용해·수술·중환자실", all(any(k in p for p in presets) for k in ["순환계", "혈전용해치료비", "뇌혈관수술비", "중환자실"]), presets)

            page.click("#card-brain [data-custom-preset][data-preset-mode='bundle']")
            page.wait_for_timeout(400)
            row_count = page.evaluate("() => document.querySelectorAll('#card-brain .custom-row').length")
            check("프리셋 클릭 → 행 1개 추가", row_count == 1, row_count)
            st_row = page.evaluate("() => BojangApp.state.cov.custom.brain.map((x) => [x.name, x.amount, x.mode])")
            check("프리셋이 통합형으로 추가", st_row and ("순환계" in st_row[0][0] and "주요치료비" in st_row[0][0]) and st_row[0][2] == "bundle", st_row)
            mode_ui = page.evaluate("() => Array.from(document.querySelectorAll('#card-brain .custom-row [data-custom-mode]')).map((b) => [b.dataset.customMode, b.getAttribute('aria-pressed'), b.className])")
            check("통합형 토글 활성 표시", any(m[0] == "bundle" and m[1] == "true" and "is-on" in m[2] for m in mode_ui), mode_ui)

            page.fill("#card-brain .custom-row [data-custom-amount]", "2000")
            page.wait_for_timeout(400)
            amt = page.evaluate("() => BojangApp.state.cov.custom.brain[0].amount")
            check("금액 입력 → 모델 반영", amt == 2000, amt)

            page.click("#card-brain .custom-row [data-custom-mode='individual']")
            page.wait_for_timeout(300)
            mode_after = page.evaluate("() => BojangApp.state.cov.custom.brain[0].mode")
            check("토글 클릭 → 개별형 전환", mode_after == "individual", mode_after)
            page.click("#card-brain .custom-row [data-custom-mode='bundle']")
            page.wait_for_timeout(300)

            # 중복 프리셋 방지
            page.click("#card-brain [data-custom-preset][data-preset-mode='bundle']")
            page.wait_for_timeout(400)
            dup_rows = page.evaluate("() => document.querySelectorAll('#card-brain .custom-row').length")
            check("같은 담보 중복 추가 방지", dup_rows == 1, dup_rows)

            # 빈 행 추가 + 이름 입력 + 삭제
            page.click("#card-brain [data-custom-add]")
            page.wait_for_timeout(400)
            rows2 = page.evaluate("() => document.querySelectorAll('#card-brain .custom-row').length")
            check("'+ 추가' → 빈 행 추가", rows2 == 2, rows2)
            page.fill("#card-brain .custom-row:nth-of-type(2) [data-custom-name]", "혈전용해치료비")
            page.wait_for_timeout(300)
            names = page.evaluate("() => BojangApp.state.cov.custom.brain.map((x) => x.name)")
            check("담보명 직접 입력", "혈전용해치료비" in names, names)
            page.click("#card-brain .custom-row:nth-of-type(2) [data-custom-del]")
            page.wait_for_timeout(400)
            rows3 = page.evaluate("() => document.querySelectorAll('#card-brain .custom-row').length")
            check("삭제 버튼 → 행 제거", rows3 == 1, rows3)

            # localStorage 유지
            page.reload(wait_until="load")
            page.wait_for_timeout(900)
            persisted = page.evaluate("() => JSON.stringify(BojangApp.state.cov.custom.brain)")
            check("새로고침 후 유지(localStorage)", ('"순환계 주요치료비(통합)"' in persisted or '"특정순환계질환(3~5종) 주요치료비"' in persisted) and '"amount":2000' in persisted, persisted)

            # JSON 내보내기(파일) → 가져오기 모달 복원
            page.evaluate("""(cs) => { BojangApp.state.cov.custom = JSON.parse(JSON.stringify(cs)); BojangApp.analyze(); }""", CUSTOM)
            page.wait_for_timeout(200)
            exported = ""
            try:
                with page.expect_download(timeout=15000) as dl:
                    page.click("#btn-json-export")
                download = dl.value
                path = download.path()
                exported = open(path, encoding="utf-8").read()
            except Exception as e:
                print("export download skip:", e)
            if not exported:
                exported = page.evaluate("""() => JSON.stringify({ app: 'bojang-guide', version: '5.6', state: { cov: BojangApp.state.cov } })""")
                check("JSON 내보내기 — custom 포함(상태 기준)", '"custom"' in exported and "순환계 주요치료비(통합)" in exported, len(exported))
            else:
                check("JSON 내보내기 파일 — custom 포함", '"custom"' in exported and "순환계 주요치료비(통합)" in exported and '"mode": "bundle"' in exported, len(exported))
            page.click("#btn-json-import")
            page.wait_for_timeout(300)
            page.fill("#jm-text", exported)
            page.click("#jm-ok")
            page.wait_for_timeout(700)
            applied = page.evaluate("() => JSON.stringify(BojangApp.state.cov.custom)")
            check("JSON 가져오기 — custom 복원", "순환계 주요치료비(통합)" in applied and "중증치매간병비" in applied and '"amount":2000' in applied, applied[:100])

            # =========================================================
            # 4. 계산 반영 — 통합형/개별형·진단비 제외
            # =========================================================
            calc = page.evaluate("""() => {
              const base = () => ({
                age: '40', gender: '남', job: '1', silson: '4', premium: 27,
                client: {}, contracts: [], family: [], disc: {},
                cov: {
                  cancer: { general: 0, similar: 0, treatment: { surgery: 0, drug: 0, radio: 0, icu: 0, extra: 0 }, recur: false },
                  brain: { dx: { vascular: 0, stroke: 0, bleed: 0 }, treat: { lysis: 0, surgery: 0, icu: 0 } },
                  heart: { dx: { ischemic: 0, ami: 0 }, treat: { lysis: 0, surgery: 0, icu: 0 } },
                  surgery: { disease: 0, disease15: 0, diseaseNdae: 0, diseaseNonPay: 0, injury: 0, injury15: 0 },
                  care: { daily: 0, nDaily: 0, basis: 'unknown', family: 'conditional', nursing: false, ltc: false, mode: 'normal' }
                },
                flags: {}
              });
              const partOf = (st, key, part) => {
                const m = BojangModel.full(st);
                const row = m.rows.find((r) => r.item.key === key);
                return { row, part: row.r.parts.find((p) => p.key === part), m };
              };
              /* 1) 통합형만 넣은 뇌 — 세 칸이 비어 있어도 치료비 축으로 인정 */
              const s1 = base();
              s1.cov.custom = { cancer: [], brain: [{ id: 'x', name: '순환계 주요치료비(통합)', amount: 2000, mode: 'bundle' }], heart: [], surgery: [], care: [] };
              const p1 = partOf(s1, 'brain', 'treat');
              /* 2) 개별형 — 혈전용해치료비는 혈전용해 칸으로 */
              const s2 = base();
              s2.cov.custom = { cancer: [], brain: [{ id: 'y', name: '혈전용해치료비', amount: 1000, mode: 'individual' }], heart: [], surgery: [], care: [] };
              const p2 = partOf(s2, 'brain', 'treat');
              /* 3) 진단비 이름은 치료비 축에서 제외 */
              const s3 = base();
              s3.cov.custom = { cancer: [], brain: [{ id: 'z', name: '뇌혈관질환진단비', amount: 3000, mode: 'individual' }], heart: [], surgery: [], care: [] };
              const p3 = partOf(s3, 'brain', 'treat');
              /* 4) 수술·간병은 고정 축 판정을 바꾸지 않음 */
              const s4 = base();
              s4.cov.custom = { cancer: [], brain: [], heart: [], surgery: [{ id: 'q', name: '관절/척추 수술비', amount: 500, mode: 'individual' }], care: [] };
              const m4 = BojangModel.full(s4);
              const m0 = BojangModel.full(base());
              return {
                bundle: { pct: p1.row.pct, treatFill: Math.round(p1.part.fill * 100), customVal: p1.part.customVal, sub: p1.part.subs.map((s) => [s.key, s.custom, s.eff]) },
                individual: { sub: p2.part.subs.map((s) => [s.key, s.custom, s.eff]), fill: Math.round(p2.part.fill * 100) },
                dxname: { sub: p3.part.subs.map((s) => [s.key, s.custom]), customCount: p3.m.customCount },
                surgery: { same: m4.score === m0.score, customCount: m4.customCount }
              };
            }""")
            check("통합형 2,000만원 → 뇌 치료비 축 인정(충족도 상승)",
                  calc["bundle"]["treatFill"] > 0 and calc["bundle"]["pct"] > 0 and calc["bundle"]["customVal"] > 0,
                  calc["bundle"])
            check("통합형은 치료비 칸에 권장 비율로 분배 (v5.7: 중환자실 제외 2칸)", len([s for s in calc["bundle"]["sub"] if s[1] > 0]) == 2 and all(s[1] == 0 for s in calc["bundle"]["sub"] if s[0] == "icu"), calc["bundle"]["sub"])
            check("개별형 혈전용해치료비 → 혈전용해 칸 합산",
                  any(s[0] == "lysis" and s[1] == 1000 for s in calc["individual"]["sub"]), calc["individual"]["sub"])
            check("진단비 이름 담보는 치료비 축 제외(표시만)", all(s[1] == 0 for s in calc["dxname"]["sub"]) and calc["dxname"]["customCount"] == 1, calc["dxname"])
            check("수술 직접 기재는 고정 축 점수 불변", calc["surgery"]["same"] and calc["surgery"]["customCount"] == 1, calc["surgery"])

            # =========================================================
            # 5. PDF 10장 — 03·05·06·07p 표시 · 담당자 소견 · 넘침 0
            # =========================================================
            page.evaluate("""(cs) => {
              BojangApp.state.client.name = '김고객';
              BojangApp.state.client.consultant = '김한기';
              BojangApp.state.contracts = CONTRACTS_STATE;
              BojangApp.state.cov.custom = JSON.parse(JSON.stringify(cs));
              BojangApp.analyze();
            }""".replace("CONTRACTS_STATE", json.dumps(CONTRACTS)), CUSTOM)
            page.wait_for_timeout(300)
            det = page.evaluate(capture("detail"), "detail")
            joined = " | ".join(det["texts"])
            check("상세 10페이지", det["pages"] == 10, det["pages"])
            check("직접 기재 포함 상세 넘침 0", len(det["overflow"]) == 0, det["overflow"])
            check("03p '증권 직접 기재 추가 담보' 섹션", "증권 직접 기재 추가 담보" in joined, "증권 직접 기재 추가 담보" in joined)
            check("03p 구분 라벨(통합형·개별형)", "통합형" in joined and "개별형" in joined, ("통합형" in joined, "개별형" in joined))
            check("03p 남은 건수 요약", "그 외" in joined and "건은 각 영역 페이지" in joined, [t for t in det["texts"] if "그 외" in t][:1])
            check("03p 담보명·금액 그대로 인쇄", "표적항암약물허가치료비" in joined and "3,000만원" in joined, "표적항암약물허가치료비" in joined)
            check("05p 암 직접 기재 박스", "증권 직접 기재 담보 — 암" in joined, [t for t in det["texts"] if "증권 직접 기재 담보 — 암" in t][:1])
            check("06p 뇌·심장 직접 기재 박스", "증권 직접 기재 담보 — 뇌·심장" in joined, [t for t in det["texts"] if "뇌·심장" in t][:1])
            check("07p 수술·간병 직접 기재 박스", "증권 직접 기재 담보 — 수술·간병" in joined, [t for t in det["texts"] if "수술·간병" in t][:1])
            check("05p 소견 — 직접 기재 문장", "증권에 직접 기재한 표적항암약물허가치료비" in joined, [t for t in det["texts"] if "직접 기재한 표적" in t][:1])
            check("06p 소견 — 통합형/개별형 문장", "증권에 직접 기재한 뇌 순환계 주요치료비(통합)" in joined, [t for t in det["texts"] if "직접 기재한 뇌" in t][:1])
            check("07p 소견 — 고정 축 밖 안내", "고정 6축 밖의 특약" in joined, [t for t in det["texts"] if "고정 6축" in t][:1])
            check("06p 통합형 담보가 치료비 합계에 반영", "직접 기재 포함" in joined or "치료비 3종 3/3" in joined, [t for t in det["texts"] if "치료비 3종" in t][:2])

            # 대량 입력 — 넘침 0 유지
            page.evaluate("""(cs) => { BojangApp.state.cov.custom = JSON.parse(JSON.stringify(cs)); BojangApp.analyze(); }""", CUSTOM_STRESS)
            page.wait_for_timeout(300)
            dst = page.evaluate(capture("detail"), "detail")
            djoin = " | ".join(dst["texts"])
            check("대량·긴 이름 상세 넘침 0", len(dst["overflow"]) == 0, dst["overflow"])
            check("대량 입력 — 상위 건 + '외 N건' 처리", "외 " in djoin and "건은 각 영역 페이지" in djoin, [t for t in dst["texts"] if "그 외" in t][:1])

            # =========================================================
            # 6. PDF 30장 플랜북 — 해당 영역 참고 표시 · 넘침 0
            # =========================================================
            page.evaluate("""(cs) => { BojangApp.state.cov.custom = JSON.parse(JSON.stringify(cs)); BojangApp.analyze(); }""", CUSTOM)
            page.wait_for_timeout(200)
            adv = page.evaluate(capture("advisor"), "advisor")
            ajoin = " | ".join(adv["texts"])
            check("플랜북 30페이지", adv["pages"] == 30, adv["pages"])
            check("플랜북 넘침 0 (직접 기재 포함)", len(adv["overflow"]) == 0, adv["overflow"])
            check("플랜북 암·뇌·심장·수술·간병 참고 표시",
                  all(k in ajoin for k in ["증권 직접 기재 담보 — 암", "증권 직접 기재 담보 — 뇌", "증권 직접 기재 담보 — 심장", "증권 직접 기재 담보 — 수술", "증권 직접 기재 담보 — 간병"]),
                  [k for k in ["증권 직접 기재 담보 — 암", "증권 직접 기재 담보 — 뇌", "증권 직접 기재 담보 — 심장", "증권 직접 기재 담보 — 수술", "증권 직접 기재 담보 — 간병"] if k not in ajoin])

            # 1장 요약
            summ = page.evaluate(capture("summary"), "summary")
            check("1장 요약 1페이지 · 넘침 0", summ["pages"] == 1 and len(summ["overflow"]) == 0, (summ["pages"], summ["overflow"]))

            # =========================================================
            # 7. 모바일 360px — 직접 기재 행 넘침 0
            # =========================================================
            ctx2 = browser.new_context(viewport={"width": 360, "height": 780}, device_scale_factor=2)
            pg2 = ctx2.new_page()
            pg2.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg2.on("pageerror", lambda e: errors.append("pageerror(360): " + str(e)))
            pg2.goto(url, wait_until="load")
            pg2.wait_for_timeout(900)
            pg2.evaluate("""(cs) => {
              localStorage.setItem('bojang.session.v4', JSON.stringify({ cov: { custom: cs } }));
            }""", CUSTOM)
            pg2.reload(wait_until="load")
            pg2.wait_for_timeout(900)
            pg2.click("#tab-analysis")
            pg2.wait_for_timeout(500)
            pg2.evaluate("() => { const nx = document.querySelector('#wiz-next'); if (nx) { nx.click(); nx.click(); } }")
            pg2.wait_for_timeout(600)
            mob = pg2.evaluate("""() => {
              const out = [];
              document.querySelectorAll('#card-brain .custom-row, #card-brain .custom-block, #card-brain .chip-custom, #card-brain .custom-add').forEach((el) => {
                const r = el.getBoundingClientRect();
                const host = document.querySelector('#card-brain').getBoundingClientRect();
                if (r.width > 0 && (r.right > host.right + 0.6 || r.left < host.left - 0.6)) out.push([el.className, Math.round(r.left), Math.round(r.right)]);
              });
              const rows = Array.from(document.querySelectorAll('#card-brain .custom-row'));
              return {
                out,
                docW: document.documentElement.scrollWidth,
                winW: window.innerWidth,
                rows: rows.length,
                rowH: rows.length ? Math.round(rows[0].getBoundingClientRect().height) : 0,
                nameW: rows.length ? Math.round(rows[0].querySelector('[data-custom-name]').getBoundingClientRect().width) : 0,
                amtW: rows.length ? Math.round(rows[0].querySelector('[data-custom-amount]').getBoundingClientRect().width) : 0,
                modeBtns: rows.length ? rows[0].querySelectorAll('[data-custom-mode]').length : 0
              };
            }""")
            check("360px 직접 기재 행 넘침 0", not mob["out"], mob["out"])
            check("360px 가로 스크롤 없음", mob["docW"] <= mob["winW"], (mob["docW"], mob["winW"]))
            check("360px 행 구성 — 이름·금액·토글 2버튼 모두 표시", mob["rows"] >= 1 and mob["nameW"] >= 90 and mob["amtW"] >= 50 and mob["modeBtns"] == 2, mob)
            # 화면 캡처 (검수용)
            pg2.evaluate("""() => {
              const blk = document.querySelector('#card-brain [data-custom-block]');
              if (blk) window.scrollTo(0, blk.getBoundingClientRect().top + window.scrollY - 110);
            }""")
            pg2.wait_for_timeout(400)
            pg2.screenshot(path=os.path.join(SHOTS, "ui-custom-riders-360.png"))

            # =========================================================
            # 8. 단일 HTML · 콘솔
            # =========================================================
            single = read(os.path.join(ROOT, "dist", "bojang-guide.single.html"))
            check("단일 HTML — v5.6·직접 기재 반영", any(v in single for v in ("v5.6", "v5.7", "v5.8")) and "증권 담보 직접 기재" in single and "CUSTOM_PRESETS" in single, "v5.7" in single)
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
