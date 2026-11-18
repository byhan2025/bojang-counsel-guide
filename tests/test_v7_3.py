#!/usr/bin/env python3
"""보장분석 라이프 리포트 v7.3 — 범용 표 파서 검증

실행: python3 tests/test_v7_3.py

검증 축 (모든 데이터는 비식별 합성 표입니다 — 실제 고객 증권을 쓰지 않습니다)
  A. 세로 줄바꿈형 표: 담보명 / 가입금액 / 보장보험료 / 납입기간이 각각 다른 줄
  B. 표 머리글 단위(만원·천원) 해석 + 단위 없는 100 미만 숫자(10·20·30) 인정
  C. 가입금액 열 vs 보장보험료 열 혼동 방지(보험료가 더 커도 가입금액을 취함)
  D. 약관 본문(보장상세·[보험금을 지급하지 않는 사유]) 오탐 방지 · 총납입보험료와 월 보험료 구분
  E. 1줄형 · 구분자형(|·탭) 회귀
  F. 1~5종 수술비 대표값(1종 기준) 정책과 안내 문구
  G. 담보명 매칭: 암진단비(유사암제외)·유사암·뇌혈관·허혈성심장·질병수술비·일반상해수술비·골절진단비
  H. SAMPLE_TEXT 회귀(20건 · 월 27만원 · 실손 4세대)
  I. 화면 통합: 붙여넣기 → 검수 화면 → 반영(applyImport)
  J. 범용성: 파서 소스에 특정 보험사·고객 이름 하드코딩 0
"""
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("BOJANG_SHOTS") or "/workspace/reports/bojang-guide/v7.2-parser"
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
# 합성 표 (비식별) — 실제 보험사 양식의 '구조'만 흉내 냅니다
# =====================================================================
CASE_MULTI = "\n".join([
    "가상생명 무배당 종합보장보험 가입제안(샘플)",
    "납입보험료",
    "88,000원",
    "총납입보험료",
    "21,120,000원",
    "보장보험료",
    "88,000원",
    "■ 보장내역(선택계약)",
    "보장명",
    "보장상세",
    "가입금액(만원)",
    "보장보험료(원)",
    "납입기간 및 만기",
    "암진단비(유사암제외)",
    "암보장개시일 이후에 암으로 진단확정시 지급",
    "3,000",
    "25,000",
    "20년납 90세만기",
    "[",
    "보험금을 지급하지 않는 사유",
    "]",
    "보통약관의 (보험금을 지급하지 않는 사유)",
    "1. 건강검진, 예방접종, 인공유산",
    "2. 영양제, 종합비타민제, 호르몬 투여",
    "유사암진단비(연간1회한)",
    "기타피부암·갑상선암 진단확정시 지급",
    "600",
    "3,200",
    "20년납 90세만기",
    "뇌혈관질환진단비",
    "뇌혈관질환으로 진단확정 되었을 때 지급",
    "1,000",
    "9,400",
    "20년납 90세만기",
    "허혈성심장질환진단비",
    "허혈성심장질환으로 진단확정 되었을 때 지급",
    "800",
    "7,100",
    "20년납 90세만기",
    "질병수술비",
    "질병으로 수술을 받은 경우 1회당 지급",
    "20",
    "3,900",
    "20년납 90세만기",
    "질병수술비(1종)",
    "1종 수술 1회당 지급",
    "10",
    "1,700",
    "20년납 90세만기",
    "질병수술비(5종)",
    "5종 수술 1회당 지급",
    "1,000",
    "17,000",
    "20년납 90세만기",
    "일반상해수술비",
    "상해 수술 1회당 지급",
    "50",
    "1,290",
    "20년납 100세만기",
    "일반상해수술비(1종)",
    "상해 1종 수술 1회당 지급",
    "10",
    "134",
    "20년납 100세만기",
    "골절진단비(치아파절제외)",
    "상해로 골절 진단확정시 지급",
    "10",
    "1,069",
    "20년납 100세만기",
    "보험료납입면제대상",
    "납입면제 사유가 발생한 경우 보장보험료 납입면제",
    "100",
    "3,750",
    "20년납 20년만기",
])

CASE_CHEON = "\n".join([
    "보장명",
    "가입금액(천원)",
    "보장보험료(원)",
    "납입기간 및 만기",
    "일반암 진단비",
    "5,000",
    "12,000",
    "20년납 90세만기",
    "질병수술비",
    "300",
    "800",
    "20년납 90세만기",
])

CASE_PIPE = "\n".join([
    "일반암 진단비 | 5,000 | 12,000",
    "유사암 진단비\t600\t4,800",
    "뇌혈관질환 진단비 | 2,000 | 9,000",
])

CASE_ONE_LINE = "암진단비 5,000만원, 유사암 1,000만원, 뇌혈관질환 2,000만원, 허혈성심장질환 2,000만원, 월 보험료 24만원"

CASE_NOISE = "\n".join([
    "보장상세",
    "[보험금을 지급하지 않는 사유]",
    "보통약관의 (보험금을 지급하지 않는 사유)",
    "1. 피보험자가 고의로 자신을 해친 경우",
    "2. 전쟁, 외국의 무력행사, 혁명, 내란, 사변, 폭동",
    "3. 직무상 선박에 탑승하고 있는 동안 사고",
    "이 약관에서 정한 바에 따라 처리합니다",
    "납입면제 사유가 발생한 경우 차회 이후 보장보험료를 납입면제 합니다",
])


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
            pg.wait_for_function("window.BojangImport && window.BojangImport.parseCoverageText")

            # =============================================================
            # A~G. 파서 단위 검증
            # =============================================================
            unit = pg.evaluate("""(cases) => {
              const P = BojangImport.parseCoverageText;
              const out = {};
              for (const [k, text] of Object.entries(cases)) {
                const r = P(text);
                const map = {}; const notes = {};
                r.items.forEach((i) => { map[i.field] = i.value; if (i.note) notes[i.field] = i.note; });
                out[k] = { map, notes, premium: r.premium, silson: r.silson,
                           count: r.count, kinds: r.items.map((i) => i.kind),
                           snips: r.items.map((i) => i.snippet) };
              }
              const sample = P(BojangImport.SAMPLE_TEXT);
              out.sample = { count: sample.items.length, premium: sample.premium, silson: sample.silson };
              return out;
            }""", {
                "multi": CASE_MULTI,
                "cheon": CASE_CHEON,
                "pipe": CASE_PIPE,
                "one": CASE_ONE_LINE,
                "noise": CASE_NOISE,
            })

            m = unit["multi"]
            mm = m["map"]
            check("A. 세로 줄바꿈형 — 일반암 3,000만원", mm.get("cancer.general") == 3000, mm.get("cancer.general"))
            check("A. 세로 줄바꿈형 — 유사암 600만원", mm.get("cancer.similar") == 600, mm.get("cancer.similar"))
            check("A. 세로 줄바꿈형 — 뇌혈관 1,000만원", mm.get("brain.dx.vascular") == 1000, mm.get("brain.dx.vascular"))
            check("A. 세로 줄바꿈형 — 허혈성심장 800만원", mm.get("heart.dx.ischemic") == 800, mm.get("heart.dx.ischemic"))
            check("B. 단위 없는 100 미만 숫자 인정 — 질병수술비 20만원", mm.get("surgery.disease") == 20, mm.get("surgery.disease"))
            check("C. 가입금액 열 우선 — 보험료(3,900)가 아니라 20만원", mm.get("surgery.disease") == 20, mm.get("surgery.disease"))
            check("B. 단위 없는 100 미만 숫자 인정 — 상해 1~5종 1종 10만원", mm.get("surgery.injury15") == 10, mm.get("surgery.injury15"))
            check("G. 일반상해수술비 50만원(1~5종과 별도 축)", mm.get("surgery.injury") == 50, mm.get("surgery.injury"))
            check("G. 골절진단비 10만원", mm.get("living.fracture") == 10, mm.get("living.fracture"))
            check("D. 월 보험료 9만원(총납입보험료 2,112만원 아님)", m["premium"] == 9, m["premium"])
            check("D. 월 보험료 원문 안내", "8.8" in (m["notes"].get("monthlyPremium") or ""), m["notes"].get("monthlyPremium"))
            check("D. 납입면제특약은 담보로 담지 않음",
                  all(v != 100 for k, v in mm.items() if k != 'monthlyPremium')
                  and all("납입면제" not in s for s in m["snips"]), (mm, m["snips"][:3]))

            # 1~5종 대표값 정책
            check("F. 질병 1~5종 — 1종 기준액 10만원", mm.get("surgery.disease15") == 10, mm.get("surgery.disease15"))
            note = m["notes"].get("surgery.disease15") or ""
            check("F. 1~5종 안내 문구(1종·5종 병기)", "1종 10만원" in note and "5종 1000만원" in note, note)

            c = unit["cheon"]["map"]
            check("B. 천원 단위 머리글 — 5,000천원 = 500만원", c.get("cancer.general") == 500, c.get("cancer.general"))
            check("B. 천원 단위 머리글 — 300천원 = 30만원", c.get("surgery.disease") == 30, c.get("surgery.disease"))
            check("B. 단위 표기 스니펫", any("(천원)" in s for s in unit["cheon"]["snips"]), unit["cheon"]["snips"][:2])

            p2 = unit["pipe"]["map"]
            check("E. 구분자형(|) — 일반암 5,000만원", p2.get("cancer.general") == 5000, p2.get("cancer.general"))
            check("E. 구분자형(탭) — 유사암 600만원", p2.get("cancer.similar") == 600, p2.get("cancer.similar"))
            check("E. 구분자형 — 뇌혈관 2,000만원", p2.get("brain.dx.vascular") == 2000, p2.get("brain.dx.vascular"))

            o = unit["one"]
            check("E. 1줄형 회귀 — 5대 담보 4건 + 보험료",
                  o["map"].get("cancer.general") == 5000 and o["map"].get("cancer.similar") == 1000
                  and o["map"].get("brain.dx.vascular") == 2000 and o["map"].get("heart.dx.ischemic") == 2000
                  and o["premium"] == 24, (o["map"], o["premium"]))

            n = unit["noise"]
            check("D. 약관 본문만 있는 텍스트 — 담보 0건", n["count"] == 0, n["count"])

            s = unit["sample"]
            check("H. SAMPLE_TEXT 회귀 — 20건 · 월 27만원 · 실손 4세대",
                  s["count"] == 20 and s["premium"] == 27 and s["silson"] == "4", s)
            check("H. 금액 단위 정규화 회귀",
                  pg.evaluate("""() => ['3,000만원','3천만원','1억원','500만','270,000원','1억 2,000만원','질병 1~5종 수술비 300만원']
                    .map((x) => BojangImport.parseAmounts(x).map((a) => a.value))""")
                  == [[3000], [3000], [10000], [500], [27], [12000], [300]])

            # =============================================================
            # I. 화면 통합 — 붙여넣기 → 검수 화면 → 반영
            # =============================================================
            pg.evaluate("() => { BojangApp.switchView('import'); }")
            pg.wait_for_timeout(300)
            pg.fill("#imp-text", CASE_MULTI)
            pg.click("#imp-parse")
            pg.wait_for_timeout(500)
            review_on = pg.evaluate("() => !document.getElementById('imp-review').hidden")
            rows = pg.evaluate("() => document.querySelectorAll('#imp-rows .rv-row').length")
            summary = pg.evaluate("() => document.getElementById('imp-summary').textContent")
            check("I. 검수 화면 표시", review_on and rows >= 10, (review_on, rows))
            check("I. 검수 요약에 월 보험료", "9만원" in summary, summary)

            applied = pg.evaluate("""() => {
              const S = BojangApp.state;
              S.premium = 0; S.cov.cancer.general = 0; S.cov.surgery.disease15 = 0;
              document.getElementById('imp-apply').click();
              return { premium: S.premium, general: S.cov.cancer.general, similar: S.cov.cancer.similar,
                       vascular: S.cov.brain.dx.vascular, disease15: S.cov.surgery.disease15,
                       injury: S.cov.surgery.injury, frac: S.cov.living.fracture, view: S.view };
            }""")
            pg.wait_for_timeout(600)
            check("I. 반영 — 월 보험료 9만원", applied["premium"] == 9, applied["premium"])
            check("I. 반영 — 일반암 3,000·유사암 600", applied["general"] == 3000 and applied["similar"] == 600, applied)
            check("I. 반영 — 뇌혈관 1,000", applied["vascular"] == 1000, applied["vascular"])
            check("I. 반영 — 질병 1~5종 1종 10만원", applied["disease15"] == 10, applied["disease15"])
            check("I. 반영 — 일반상해수술비 50만원", applied["injury"] == 50, applied["injury"])
            check("I. 반영 후 분석 화면 이동", applied["view"] in ("analysis", "advisor"), applied["view"])

            # 검수 화면 스크린샷 (합성 데이터)
            pg.set_viewport_size({"width": 390, "height": 844})
            pg.evaluate("() => { BojangApp.switchView('import'); window.scrollTo(0, 0); }")
            pg.wait_for_timeout(300)
            pg.fill("#imp-text", CASE_MULTI)
            pg.click("#imp-parse")
            pg.wait_for_timeout(500)
            el = pg.query_selector("#imp-review")
            if el:
                el.scroll_into_view_if_needed()
                pg.wait_for_timeout(300)
                el.screenshot(path=os.path.join(SHOTS, "v73-01-review-390.png"))
            pg.screenshot(path=os.path.join(SHOTS, "v73-02-import-screen-390.png"))
            shot1 = os.path.join(SHOTS, "v73-01-review-390.png")
            check("I. 검수 화면 스크린샷 저장", os.path.exists(shot1) and os.path.getsize(shot1) > 10000, shot1)

            # =============================================================
            # J. 범용성 — 특정 보험사·고객 이름 하드코딩 0
            # =============================================================
            src = read(os.path.join(ROOT, "import-parser.js"))
            check("J. 파서 소스에 NH농협 하드코딩 없음", "NH" not in src and "농협" not in src)
            check("J. 표 머리글·단위·1~5종·직접 기재 규칙 존재",
                  all(k in src for k in ("가입금액", "보장보험료", "TIER_SERIES", "CUSTOM_RULES", "scanTableRows")))
            check("J. 콘솔 오류 0", len(errors) == 0, errors[:5])

            browser.close()
    finally:
        httpd.shutdown()

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("\n=== v7.3 테스트 %d/%d 통과 ===" % (passed, total))
    failed = [r for r in results if not r[1]]
    if failed:
        print("\n[실패]")
        for name, _, detail in failed:
            print(" - %s · %s" % (name, detail))
        sys.exit(1)


main()
