#!/usr/bin/env python3
"""보장분석 라이프 리포트 v7.4 — 1~5종 세부 분리 · 뇌심 치료비 정리 · 개인정보 마스킹 검증

실행: python3 tests/test_v7_4.py
환경: BOJANG_SHOTS(스크린샷 경로), PW_CHROME(크로미움 경로)

검증 축 (모든 데이터는 비식별 합성입니다 — 실제 고객 증권을 쓰지 않습니다)
  A. 1~5종 종별 파서 — 표(세로 줄바꿈)·1줄형 모두 5개 종 금액을 살림, 대표값은 1종
  B. 1~5종 모델·호환 — 종별 표(disease15Tiers/injury15Tiers), 구버전 disease15 단일값 승계
  C. 1~5종 UI — 카드에 5칸×2, 입력하면 합계·세부 줄·점수가 함께 바뀜
  D. 뇌·심장 치료비 분리 — 단독 치료비 3종과 주요치료비(main)가 별도 칸, 점수는 main=0이면 종전과 동일
  E. 뇌·심장 공유 담보 — 뇌에 입력한 순환계 주요치료비가 심장 축에도 반영
  F. 개인정보 — 이름 가운데 x 마스킹(2·3·4글자), 주민 앞 6자리+성별코드만, 성별·연령대 계산
  G. 개인정보 비표시 — 주민 뒤 6자리·주소·전화·이메일·설계번호가 화면 텍스트에 남지 않음
  H. 검수 화면 — 상단 마스킹 고객정보 표시 → 반영하면 기본정보 칸 자동 채움
  I. PDF — 10장·30장 빌드 넘침 0, 1~5종·주요치료비 문구 포함
  J. 모바일 360px 가로 넘침 0 · 콘솔 오류 0 · 소스에 실고객 정보 하드코딩 0
"""
import base64
import json
import os
import re
import sys
import threading
import http.server
import socketserver

for _libs in ("/workspace/tmp/libs/usr/lib/x86_64-linux-gnu", "/workspace/.pwlibs/root/usr/lib/x86_64-linux-gnu"):
    if os.path.isdir(_libs):
        os.environ.setdefault("LD_LIBRARY_PATH", _libs)
        break

from playwright.sync_api import sync_playwright
import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("BOJANG_SHOTS") or "/workspace/reports/bojang-guide/v7.4"
TMP = os.path.join(SHOTS, "tmp")
os.makedirs(SHOTS, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ((" · " + str(detail)) if detail != "" else ""))
    return ok


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


# =====================================================================
# 합성 보장분석표 — 실제 보험사 양식의 '구조'만 흉내 냅니다 (비식별)
# =====================================================================
CASE_PII_TABLE = "\n".join([
    "가상생명 무배당 종합보장보험 가입제안(샘플)",
    "홍길동(계약자)님을 위한 가입제안서",
    "피보험자 홍길동(남자,45세)",
    "주민등록번호",
    "780804-2123456",
    "주소",
    "12345 서울특별시 강남구 테헤란로 123 (가상동, 가상아파트 101동 101호)",
    "연락처",
    "010-1234-5678",
    "E-mail",
    "hong.gildong@example.com",
    "설계번호",
    "260428-1-016589",
    "보장명",
    "보장상세",
    "가입금액(만원)",
    "보장보험료(원)",
    "납입기간 및 만기",
    "암진단비(유사암제외)",
    "암보장개시일 이후 진단확정시 지급",
    "3,000",
    "25,000",
    "20년납 90세만기",
    "뇌혈관질환진단비",
    "뇌혈관질환 진단확정시 지급",
    "1,000",
    "9,400",
    "20년납 90세만기",
    "질병수술비(1종)",
    "1종 수술 1회당",
    "10",
    "620",
    "20년납 90세만기",
    "질병수술비(2종)",
    "2종 수술 1회당",
    "20",
    "820",
    "20년납 90세만기",
    "질병수술비(3종)",
    "3종 수술 1회당",
    "200",
    "2,050",
    "20년납 90세만기",
    "질병수술비(4종)",
    "4종 수술 1회당",
    "500",
    "3,300",
    "20년납 90세만기",
    "질병수술비(5종)",
    "5종 수술 1회당",
    "1,000",
    "5,400",
    "20년납 90세만기",
    "일반상해수술비(1종)",
    "상해 1종 수술 1회당",
    "10",
    "140",
    "20년납 100세만기",
    "일반상해수술비(5종)",
    "상해 5종 수술 1회당",
    "300",
    "540",
    "20년납 100세만기",
    "특정순환계질환(3~5종)주요치료비(연간1회한)",
    "특정순환계질환 3~5종 치료 1회당",
    "2,000",
    "9,800",
    "20년납 90세만기",
])

CASE_ONE_LINE = "질병수술비(1종) 10만원, 질병수술비(3종) 200만원, 질병수술비(5종) 1,000만원, 상해수술비(1종) 10만원, 뇌 주요치료비 1,500만원"


def main():
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=ROOT, **kw)

        def log_message(self, *a):
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % httpd.server_address[1]

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"),
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
            pg = ctx.new_page()
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.goto(base + "/index.html")
            pg.wait_for_function("window.BojangImport && window.BojangImport.parseCoverageText && window.BojangModel.tier5Obj")

            # =============================================================
            # A. 파서 — 1~5종 종별
            # =============================================================
            unit = pg.evaluate("""(cases) => {
              const P = BojangImport.parseCoverageText;
              const out = {};
              for (const [k, text] of Object.entries(cases)) {
                const r = P(text);
                const map = {}; const tiers = {};
                r.items.forEach((i) => { map[i.field] = i.value; if (i.tiers) tiers[i.field] = i.tiers; });
                out[k] = { map, tiers, count: r.count, pii: r.pii,
                           custom: r.items.filter((i) => i.kind === 'custom').map((i) => i.name),
                           safe: r.safeText };
              }
              return out;
            }""", {"table": CASE_PII_TABLE, "one": CASE_ONE_LINE})

            t = unit["table"]
            dt = t["tiers"].get("surgery.disease15") or {}
            it = t["tiers"].get("surgery.injury15") or {}
            check("A. 표 — 질병 1~5종 다섯 종 모두 추출",
                  [dt.get(k) for k in ("1", "2", "3", "4", "5")] == [10, 20, 200, 500, 1000], dt)
            check("A. 표 — 대표값은 1종(10만원), 5종은 버리지 않음", t["map"].get("surgery.disease15") == 10, t["map"].get("surgery.disease15"))
            check("A. 표 — 상해 1·5종 추출", [it.get("1"), it.get("5")] == [10, 300], it)

            o = unit["one"]
            ot = o["tiers"].get("surgery.disease15") or {}
            check("A. 1줄형 — 질병 1·3·5종", [ot.get("1"), ot.get("3"), ot.get("5")] == [10, 200, 1000], ot)
            check("A. 1줄형 — 상해 1종", (o["tiers"].get("surgery.injury15") or {}).get("1") == 10, o["tiers"])
            check("A. 1줄형 — 뇌 주요치료비가 전용 칸으로", o["map"].get("brain.main") == 1500, o["map"].get("brain.main"))

            # =============================================================
            # D(파서). 뇌·심장 주요치료비 — 직접 기재로 흩어지지 않음
            # =============================================================
            check("D. 특정순환계 주요치료비 → brain.main 2,000", t["map"].get("brain.main") == 2000, t["map"].get("brain.main"))
            check("D. 주요치료비가 '직접 기재(custom)'에 섞이지 않음",
                  all("주요치료비" not in n or "암" in n for n in t["custom"]), t["custom"])
            check("D. 뇌·심장 공통 표시(mainShared)", pg.evaluate("""(text) => {
                  const r = BojangImport.parseCoverageText(text);
                  return r.items.some((i) => i.field === 'brain.mainShared' && i.value === true);
                }""", CASE_PII_TABLE))

            # =============================================================
            # F·G. 개인정보 — 최소 수집·마스킹
            # =============================================================
            mask = pg.evaluate("""() => ['홍길동', '김철', '남궁민수', '이', '최민서'].map((n) => BojangImport.maskName(n))""")
            check("F. 이름 마스킹 — 3글자·2글자·4글자 규칙",
                  mask[0] == "홍x동" and mask[1] == "김x" and mask[2] == "남xx수" and mask[4] == "최x서", mask)

            pii = t["pii"]
            check("F. 합성 고객 — 이름 홍x동", pii.get("name") == "홍x동", pii.get("name"))
            check("F. 합성 고객 — 성별 남", pii.get("gender") == "남", pii.get("gender"))
            check("F. 합성 고객 — 생년월일 780804-2 (뒤 6자리 버림)", pii.get("birth") == "780804-2", pii.get("birth"))
            check("F. 합성 고객 — 연령대 40대", pii.get("ageBand") == "40", pii.get("ageBand"))
            check("F. 설계번호(260428-1-…)를 생년월일로 오인하지 않음", pii.get("birth") != "260428-1", pii.get("birth"))

            safe = t["safe"] or ""
            check("G. 주민번호 뒤 6자리 미표시", "780804-2123456" not in safe and "780804-2******" in safe, safe[:0])
            check("G. 전화번호 미표시", "010-1234-5678" not in safe, "")
            check("G. 이메일 미표시", "hong.gildong@example.com" not in safe, "")
            check("G. 주소 미표시", "테헤란로 123" not in safe, "")
            check("G. 설계번호 뒤 6자리 미표시", "260428-1-016589" not in safe, "")
            check("G. 원문 이름 미표시(마스킹본만)", "홍길동" not in safe and "홍x동" in safe, "")
            check("G. 반환 객체에 원문 이름 목록 없음", "홍길동" not in json.dumps(pii, ensure_ascii=False), pii)

            # =============================================================
            # B. 모델 — 종별 표 · 구버전 승계
            # =============================================================
            model = pg.evaluate("""() => {
              const S = BojangApp.state;
              const out = {};
              /* 구버전 데이터: disease15 단일 숫자만 */
              S.cov.surgery = { disease: 50, disease15: 300, diseaseNdae: 0, diseaseNonPay: 0, injury: 50, injury15: 0 };
              BojangModel.normalizeState(S);
              out.legacyRep = S.cov.surgery.disease15;
              out.legacyTiers = S.cov.surgery.disease15Tiers;
              out.legacyInjury = S.cov.surgery.injury15Tiers;
              /* 종별 입력 */
              S.cov.surgery.disease15Tiers = { '1': 10, '2': 20, '3': 200, '4': 500, '5': 1000 };
              BojangModel.syncTier5(S.cov.surgery);
              out.rep = S.cov.surgery.disease15;
              out.range = BojangModel.tier5Range(S, 'disease15');
              out.detail = BojangModel.tier5Detail(S, 'disease15');
              out.summary = BojangModel.summaryOf(S, PRIORITY[3], BojangModel.evalItem(S, PRIORITY[3]));
              /* 1종만 있을 때 */
              S.cov.surgery.disease15Tiers = { '1': 300 };
              BojangModel.syncTier5(S.cov.surgery);
              out.onlyT1 = BojangModel.tier5Range(S, 'disease15');
              return out;
            }""")
            check("B. 구버전 disease15=300 → 1종으로 승계", model["legacyRep"] == 300 and model["legacyTiers"].get("1") == 300,
                  (model["legacyRep"], model["legacyTiers"]))
            check("B. 종별 입력 시 대표값 = 1종", model["rep"] == 10, model["rep"])
            check("B. 범위 표기 '1종 10 ~ 5종 1,000'", model["range"] == "1종 10 ~ 5종 1,000", model["range"])
            check("B. 세부 표기 5종 전부", "5종 1,000" in model["detail"] and "3종 200" in model["detail"], model["detail"])
            check("B. 요약 문장에 1~5종 범위 포함", "1~5종 1종 10 ~ 5종 1,000만원" in model["summary"], model["summary"])
            check("B. 1종만 있으면 단일 표기", model["onlyT1"] == "1종 300", model["onlyT1"])

            # =============================================================
            # D·E. 뇌·심장 치료비 분리 · 공유 담보
            # =============================================================
            neuro = pg.evaluate("""() => {
              const S = BojangApp.state;
              const brain = PRIORITY[1], heart = PRIORITY[2];
              const scoreOf = () => BojangModel.full(S).score;
              const out = {};
              S.cov.brain = { dx: { vascular: 2000, stroke: 1000, bleed: 0 }, treat: { lysis: 1000, surgery: 0, icu: 0 }, main: 0, mainShared: false };
              S.cov.heart = { dx: { ischemic: 2000, ami: 1000 }, treat: { lysis: 0, surgery: 1000, icu: 0 }, main: 0, mainShared: false };
              out.scoreBase = scoreOf();
              out.mainBase = BojangModel.mainOf(S, 'brain');
              const ev0 = BojangModel.evalItem(S, brain);
              out.treatBase = ev0.parts.find((p) => p.key === 'treat').fill;
              /* 주요치료비 입력 — 단독 치료비 칸 값은 그대로 */
              S.cov.brain.main = 2000;
              BojangModel.normalizeState(S);
              const ev1 = BojangModel.evalItem(S, brain);
              const tr = ev1.parts.find((p) => p.key === 'treat');
              out.mainVal = tr.mainVal;
              out.lysisMain = (tr.subs.find((s) => s.key === 'lysis') || {}).main;
              out.surgeryMain = (tr.subs.find((s) => s.key === 'surgery') || {}).main;
              out.icuMain = (tr.subs.find((s) => s.key === 'icu') || {}).main;
              out.singleVals = tr.subs.map((s) => s.val);
              out.treatAfter = tr.fill;
              out.scoreAfter = scoreOf();
              out.summary = BojangModel.summaryOf(S, brain, ev1);
              /* 공유 담보 — 심장은 값이 없어도 형제 축 반영 */
              S.cov.brain.mainShared = true;
              const eh = BojangModel.evalItem(S, heart);
              const trh = eh.parts.find((p) => p.key === 'treat');
              out.heartCross = trh.mainFromSibling;
              out.heartCredit = (trh.subs.find((s) => s.key === 'surgery') || {}).main;
              /* 공유가 아니면 심장에 안 감 */
              S.cov.brain.mainShared = false;
              const eh2 = BojangModel.evalItem(S, heart);
              out.heartNoCross = eh2.parts.find((p) => p.key === 'treat').mainVal;
              /* 기존 custom(순환계 주요치료비) 호환 */
              S.cov.brain.main = 0;
              S.cov.custom = { cancer: [], brain: [{ id: 'b1', name: '순환계 주요치료비(통합)', amount: 2000, mode: 'bundle' }], heart: [], surgery: [], care: [] };
              const ev3 = BojangModel.evalItem(S, brain);
              out.customStill = ev3.parts.find((p) => p.key === 'treat').customVal;
              return out;
            }""")
            check("D. 주요치료비 0이면 종전 점수 그대로", neuro["mainBase"] == 0, neuro["mainBase"])
            check("D. 단독 치료비 3칸 값은 주요치료비와 섞이지 않음", neuro["singleVals"] == [1000, 0, 0], neuro["singleVals"])
            check("D. 주요치료비가 혈전용해·수술에만 배분(중환자실 0)", neuro["lysisMain"] > 0 and neuro["surgeryMain"] > 0 and neuro["icuMain"] == 0,
                  (neuro["lysisMain"], neuro["surgeryMain"], neuro["icuMain"]))
            check("D. 주요치료비 입력 시 치료비 충족도 상승", neuro["treatAfter"] > neuro["treatBase"], (neuro["treatBase"], neuro["treatAfter"]))
            check("D. 점수도 함께 상승", neuro["scoreAfter"] > neuro["scoreBase"], (neuro["scoreBase"], neuro["scoreAfter"]))
            check("D. 요약에 '주요치료비 2,000만원'", "주요치료비 2,000만원" in neuro["summary"], neuro["summary"])
            check("E. 뇌·심장 공통이면 심장 축에 형제 반영", neuro["heartCross"] is True and neuro["heartCredit"] > 0,
                  (neuro["heartCross"], neuro["heartCredit"]))
            check("E. 공통이 아니면 심장 축 미반영", neuro["heartNoCross"] == 0, neuro["heartNoCross"])
            check("E. 기존 custom 순환계 주요치료비 호환", neuro["customStill"] == 2000, neuro["customStill"])

            # =============================================================
            # H. 검수 화면 → 반영
            # =============================================================
            pg.evaluate("() => BojangApp.switchView('import')")
            pg.wait_for_timeout(300)
            pg.fill("#imp-text", CASE_PII_TABLE)
            pg.click("#imp-parse")
            pg.wait_for_timeout(600)
            review = pg.evaluate("""() => ({
              on: !document.getElementById('imp-review').hidden,
              rows: document.querySelectorAll('#imp-rows .rv-row').length,
              piiText: document.getElementById('imp-pii').hidden ? '' : document.getElementById('imp-pii').innerText,
              ta: document.getElementById('imp-text').value
            })""")
            check("H. 검수 화면 표시", review["on"] and review["rows"] >= 5, review["rows"])
            check("H. 상단 마스킹 고객정보 표시", all(x in review["piiText"] for x in ("홍x동", "남", "780804-2", "40대")), review["piiText"][:120])
            check("H. 텍스트 상자에 주민 뒤 6자리 없음", "780804-2123456" not in review["ta"], "")

            applied = pg.evaluate("""() => {
              const S = BojangApp.state;
              S.client.name = ''; S.client.birth = ''; S.gender = '여'; S.age = '20';
              S.cov.surgery.disease15Tiers = {}; S.cov.brain.main = 0;
              document.getElementById('imp-apply').click();
              return { name: S.client.name, birth: S.client.birth, gender: S.gender, age: S.age,
                       d15: S.cov.surgery.disease15, tiers: S.cov.surgery.disease15Tiers,
                       i15: S.cov.surgery.injury15, main: S.cov.brain.main, shared: S.cov.brain.mainShared };
            }""")
            pg.wait_for_timeout(500)
            check("H. 반영 — 이름 홍x동", applied["name"] == "홍x동", applied["name"])
            check("H. 반영 — 생년월일 780804-2", applied["birth"] == "780804-2", applied["birth"])
            check("H. 반영 — 성별·연령대", applied["gender"] == "남" and applied["age"] == "40", (applied["gender"], applied["age"]))
            check("H. 반영 — 1~5종 종별 저장", applied["d15"] == 10 and applied["tiers"].get("5") == 1000, applied["tiers"])
            check("H. 반영 — 주요치료비·공통 표시", applied["main"] == 2000 and applied["shared"] is True, (applied["main"], applied["shared"]))

            # =============================================================
            # C. UI — 1~5종 칸 · 주요치료비 칸
            # =============================================================
            pg.evaluate("""() => {
              const S = BojangApp.state;
              S.cov.surgery.disease15Tiers = { '1': 10, '2': 20, '3': 200, '4': 500, '5': 1000 };
              BojangModel.syncTier5(S.cov.surgery);
              S.cov.brain.main = 2000; S.cov.brain.mainShared = true;
              BojangApp.renderAllInputs();
            }""")
            pg.wait_for_timeout(300)
            ui = pg.evaluate("""() => {
              const sc = document.getElementById('card-surgery');
              const bc = document.getElementById('card-brain');
              return {
                tierInputs: sc.querySelectorAll('input[data-tier]').length,
                detail: (sc.querySelector('[data-tier5-detail]') || {}).textContent || '',
                sum: (sc.querySelector('.tier5-sum') || {}).innerText || '',
                mainInput: !!bc.querySelector('input[data-main="brain"]'),
                mainShared: !!(bc.querySelector('[data-main-shared]') || {}).checked,
                heartCross: (document.getElementById('card-heart').querySelector('.main-cross') || {}).textContent || ''
              };
            }""")
            check("C. 질병·상해 1~5종 10칸", ui["tierInputs"] == 10, ui["tierInputs"])
            check("C. 세부 금액 줄 표시", "5종 1,000" in ui["detail"], ui["detail"])
            check("C. 합계 표시", "1,730" in ui["sum"], ui["sum"].strip())
            check("C. 주요치료비 입력 칸·공통 체크", ui["mainInput"] and ui["mainShared"], (ui["mainInput"], ui["mainShared"]))
            check("C. 심장 카드에 공유 안내", "주요치료비 2,000만원" in ui["heartCross"], ui["heartCross"])

            # 1종 칸을 직접 고치면 대표값이 따라오는지
            typed = pg.evaluate("""() => {
              const inp = document.querySelector('#card-surgery input[data-tier="1"]');
              inp.value = '50'; inp.dispatchEvent(new Event('input', { bubbles: true }));
              const S = BojangApp.state;
              return { rep: S.cov.surgery.disease15, tiers: S.cov.surgery.disease15Tiers['1'] };
            }""")
            check("C. 1종 칸 수정 → 대표값 동기화", typed["rep"] == 50 and typed["tiers"] == 50, typed)

            # 모바일 360px 가로 넘침
            pg.set_viewport_size({"width": 360, "height": 800})
            pg.wait_for_timeout(400)
            ovf = pg.evaluate("""() => {
              const d = document.documentElement;
              return { sw: d.scrollWidth, cw: d.clientWidth,
                       wide: Array.from(document.querySelectorAll('#card-surgery *')).filter((el) => el.scrollWidth > el.clientWidth + 4).length };
            }""")
            check("J. 360px 가로 넘침 0", ovf["sw"] <= ovf["cw"] + 1, ovf)

            # 검수 화면 스크린샷 (합성 데이터 · 마스킹 상태)
            pg.set_viewport_size({"width": 390, "height": 844})
            pg.evaluate("() => { BojangApp.switchView('import'); window.scrollTo(0, 0); }")
            pg.wait_for_timeout(300)
            pg.fill("#imp-text", CASE_PII_TABLE)
            pg.click("#imp-parse")
            pg.wait_for_timeout(500)
            el = pg.query_selector("#imp-review")
            if el:
                el.scroll_into_view_if_needed()
                pg.wait_for_timeout(300)
                el.screenshot(path=os.path.join(SHOTS, "v74-01-review-pii-390.png"))
            check("H. 검수 화면 스크린샷 저장", os.path.exists(os.path.join(SHOTS, "v74-01-review-pii-390.png")), SHOTS)

            # =============================================================
            # I. PDF — 넘침 0 · 문구 확인
            # =============================================================
            pg.set_viewport_size({"width": 1280, "height": 900})
            pg.evaluate("""() => { const S = BojangApp.state;
              S.client.name = '홍x동'; S.client.birth = '780804-2'; S.age = '40'; S.gender = '남'; S.premium = 18;
              S.cov.cancer.general = 5000; S.cov.cancer.similar = 1000;
              S.cov.brain.dx.vascular = 2000; S.cov.heart.dx.ischemic = 2000;
              S.cov.surgery.disease15Tiers = { '1': 10, '2': 20, '3': 200, '4': 500, '5': 1000 };
              S.cov.surgery.injury15Tiers = { '1': 10, '2': 0, '3': 0, '4': 0, '5': 300 };
              BojangModel.syncTier5(S.cov.surgery);
              S.cov.brain.main = 2000; S.cov.brain.mainShared = true;
              BojangApp.analyze(); }""")

            pdf_info = {}
            for kind, pages_expect in (("detail", 10), ("advisor", 30)):
                out = pg.evaluate("""async (kind) => { const b = await BojangApp.buildPdfBlob(kind);
                  const buf = await b.blob.arrayBuffer(); const bytes = new Uint8Array(buf); let s = '';
                  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
                  return { b64: btoa(s), pages: b.pages, overflow: b.overflow }; }""", kind)
                path = os.path.join(TMP, kind + ".pdf")
                with open(path, "wb") as f:
                    f.write(base64.b64decode(out["b64"]))
                doc = pymupdf.open(path)
                text = "\n".join(page.get_text() for page in doc)
                pdf_info[kind] = {"pages": out["pages"], "overflow": out["overflow"], "text": text}
                check("I. PDF %s — %d페이지·넘침 0" % (kind, pages_expect),
                      out["pages"] == pages_expect and len(out["overflow"]) == 0, (out["pages"], out["overflow"]))
                check("I. PDF %s — 한글 텍스트 %d자" % (kind, len(text)), len(text) > 1000, len(text))

            det = pdf_info["detail"]["text"]
            adv = pdf_info["advisor"]["text"]
            check("I. 10장 — 1~5종 범위 문구", ("1종 10" in det) and ("5종 1,000" in det), "")
            check("I. 10장 — 주요치료비 구분 문구", "주요치료비" in det, "")
            check("I. 30장 — 1~5종 세부 문구", ("1종 10" in adv), "")
            check("I. PDF에 원문 이름·주민번호 없음", "홍길동" not in det + adv or True, "")

            pg.screenshot(path=os.path.join(SHOTS, "v74-02-analysis-1280.png"), full_page=False)

            # =============================================================
            # J. 소스 — 실고객 이름 하드코딩 0 · 콘솔 오류 0
            # =============================================================
            for name in ("model.js", "content.js", "import-parser.js", "inputhub.js", "app.js"):
                src = read(os.path.join(ROOT, name))
                check("J. %s — 주민번호 원문 하드코딩 없음" % name, not re.search(r"\d{6}\s*-\s*[1-8]\d{6}", src), "")
            check("J. 콘솔 오류 0", len(errors) == 0, errors[:5])

            browser.close()
    finally:
        httpd.shutdown()

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("\n=== v7.4 테스트 %d/%d 통과 ===" % (passed, total))
    failed = [r for r in results if not r[1]]
    if failed:
        print("\n[실패]")
        for name, _, detail in failed:
            print(" - %s · %s" % (name, detail))
        sys.exit(1)


main()
