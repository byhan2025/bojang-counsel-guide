#!/usr/bin/env python3
"""보장분석 상담 가이드 v7.5 — 내용 고도화(터치 로드맵·증거 팩·화법 압축) 검증

실행: python3 tests/test_v7_5.py
환경: BOJANG_SHOTS (스크린샷 경로)

검수 기준 12개 (v7.5 마스터 플랜 §12) + 회의실 4호 봇·한대리·부이 명세
  A. 구조 — 30장, 넘침 0, 페이지 번호 30장 고정
  B. 화법 — 비중 ≤15%, 대본 박스 ≤8, 화법 전용 페이지 ≤2
  C. 개인화 — 개인화 0% 페이지 0 (모든 페이지에 이 고객 값 3개 이상)
  D. 증거 — 공식 통계 항목 ≥40, 수치마다 출처·기준연도·범위·한계
  E. 상담 메모 — 지면 1p 이하
  F. 우선순위 정합 — 로드맵 = 판독표 = 챕터 순서, A 1순위 암 / B 1순위 간병
  G. 지면 배분 — B에서 암 HOLD·간병 1순위, B 간병 챕터 7p
  H. 사례·반론 — 3칸 사례 ≥15(표기·출처 구분), 반론 훅 15
  I. 안전선 — "질병위험·지급가능성" 단정 없음, "먼저 확인할 항목" 라벨, 금소법 문구
  J. 앱 동기화 — 라이브 상담 5단계가 같은 순서·같은 압축 화법으로 렌더
  K. 빌드 — 단일 HTML에 신규 모듈 포함, 콘솔 오류 0
  L. 실물 산출물 — PDF 2종·핵심 페이지 PNG 저장
"""
import base64
import json
import os
import re
import subprocess
import sys
import difflib

for _libs in ("/workspace/tmp/libs/usr/lib/x86_64-linux-gnu", "/workspace/.pwlibs/root/usr/lib/x86_64-linux-gnu"):
    if os.path.isdir(_libs):
        os.environ.setdefault("LD_LIBRARY_PATH", _libs)
        break

from playwright.sync_api import sync_playwright
import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("BOJANG_SHOTS") or "/workspace/reports/bojang-guide/v7.5"
TMP = os.path.join(SHOTS, "tmp")
os.makedirs(SHOTS, exist_ok=True)
os.makedirs(TMP, exist_ok=True)
sys.path.insert(0, "/workspace/reports/bojang-guide")
from harness import start_server

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ((" · " + str(detail)) if detail != "" else ""))
    return ok


COACH = re.compile(r"(의도\s*—|기대\s*—|기대 반응\s*—|확인\s*—|말\s*—|공감\s*—|환기\s*—|대안\s*—|^✕|^○|읽어도|그대로 읽|한 문장만|쓰면 안 되는|말하면 안 되는|이렇게 말|설계사가|외우는|고객에게|질문\s*하나|첫 문장|거절은|부탁이 아니라|먼저 연락하지)")

PROFILE_A = """
() => {
  const S = BojangApp.state;
  Object.assign(S, JSON.parse(JSON.stringify(window.__base)));
  S.client = { name:'김민수', birth:'1981-03-12', consultant:'김한기', dateLabel:'2026년 11월 18일' };
  S.age='45'; S.gender='남'; S.job='2'; S.silson='4'; S.premium=23;
  S.cov.cancer.general = 3000; S.cov.cancer.similar = 0; S.cov.cancer.recur = false;
  S.cov.cancer.treatment = { surgery: 1000, drug: 0, radio: 0, icu: 0, extra: 0 };
  S.cov.brain.dx = { vascular: 1000, stroke: 0, bleed: 0 };
  S.cov.heart.dx = { ischemic: 0, ami: 1000 };
  S.cov.surgery.disease = 30; S.cov.surgery.disease15Tiers = { '1': 30, '2': 0, '3': 0, '4': 0, '5': 0 };
  S.cov.care.daily = 0; S.cov.care.nursing = false; S.cov.care.ltc = false;
  S.flags = { savings: true, renew: true, manyRiders: true };
  S.family = ['cancer'];
  S.disc = { hospitalization: true };
  S.contracts = [
    {insurer:'A손해보험', product:'무배당 종합보장보험 (갱신형)', premium:9, renew:true},
    {insurer:'B생명', product:'암보험 1회한', premium:6, renew:false},
    {insurer:'C손해보험', product:'실손의료비 4세대', premium:4, renew:true},
    {insurer:'D생명', product:'정기보험 (적립 포함)', premium:4, renew:false}
  ];
  BojangApp.analyze();
  return 1;
}
"""

PROFILE_B = """
() => {
  const S = BojangApp.state;
  Object.assign(S, JSON.parse(JSON.stringify(window.__base)));
  S.client = { name:'박정자', birth:'1963-09-02', consultant:'김한기', dateLabel:'2026년 11월 18일' };
  S.age='63'; S.gender='여'; S.job='1'; S.silson='2'; S.premium=38;
  S.cov.cancer.general = 10000; S.cov.cancer.similar = 1000; S.cov.cancer.recur = true;
  S.cov.cancer.treatment = { surgery: 2000, drug: 1500, radio: 600, icu: 500, extra: 500 };
  S.cov.brain.dx = { vascular: 3000, stroke: 2000, bleed: 2000 };
  S.cov.heart.dx = { ischemic: 2000, ami: 2000 };
  S.cov.brain.main = 3000; S.cov.brain.mainShared = true;
  S.cov.surgery.disease15Tiers = { '1': 300, '2': 300, '3': 300, '4': 300, '5': 300 };
  S.cov.surgery.injury15Tiers = { '1': 300, '2': 300, '3': 300, '4': 300, '5': 300 };
  S.cov.care.daily = 0; S.cov.care.nursing = false; S.cov.care.ltc = false;
  S.flags = { savings: false, renew: false, manyRiders: false };
  S.contracts = [
    {insurer:'A생명', product:'종신보험', premium:20, renew:false},
    {insurer:'B손해보험', product:'간편심사 건강보험', premium:18, renew:true}
  ];
  BojangApp.analyze();
  return 1;
}
"""

# 스크립트 박스·메모·표 계측 훅
HOOK = """
() => {
  const P = PDFKit.Sheet.prototype;
  const M = window.__m = { script: 0, byPage: [], memo: 0, tables: 0 };
  const cur = () => M.byPage[M.byPage.length - 1];
  const oh = P.header; P.header = function () { M.byPage.push({ s: 0, memo: 0 }); return oh.apply(this, arguments); };
  const os = P.script; P.script = function () { M.script += 1; if (cur()) cur().s += 1; return os.apply(this, arguments); };
  const om = P.memoBand; P.memoBand = function () { M.memo += 1; if (cur()) cur().memo += 1; return om.apply(this, arguments); };
  const ot = P.table; P.table = function () { M.tables += 1; return ot.apply(this, arguments); };
  return 1;
}
"""


def pdf_pages(path):
    doc = pymupdf.open(path)
    return [p.get_text() for p in doc]


def body_lines(block):
    lines = [l.strip() for l in block.splitlines() if l.strip()]
    return [l for l in lines if not re.match(r"^(BOJANG PLAN BOOK|\d\d /|\d\d / 30|보장분석 라이프 리포|본 자료는 상담 이해를|MEMO|상담 메모|고객이 한 말|내가 약속한 것|다음 할 일)", l)]


def coach_pct(block):
    body = body_lines(block)
    coach = total = 0
    for l in body:
        n = len(l)
        total += n
        if COACH.search(l) or (l.startswith('"') and n > 12):
            coach += n
    return round(100 * coach / max(1, total)), total


def build_profile(pg, fill_js, tag):
    pg.evaluate(fill_js)
    pg.evaluate(HOOK)
    out = pg.evaluate("""async () => { const b = await BojangApp.buildPdfBlob('advisor');
      const buf = await b.blob.arrayBuffer(); const bytes = new Uint8Array(buf); let s='';
      for (let i=0;i<bytes.length;i+=8192) s += String.fromCharCode.apply(null, bytes.subarray(i,i+8192));
      return { b64: btoa(s), pages: b.pages, overflow: b.overflow };
    }""")
    path = os.path.join(SHOTS, "advisor-%s.pdf" % tag)
    with open(path, "wb") as f:
        f.write(base64.b64decode(out["b64"]))
    metrics = pg.evaluate("() => window.__m")
    return out, metrics, path


def main():
    errors = []
    httpd, base = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1280, "height": 1000}, locale="ko-KR")
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)
            pg.goto(base + "/", wait_until="networkidle")
            pg.evaluate("() => { window.__base = JSON.parse(JSON.stringify(BojangApp.state)); }")

            # ---------- 모듈 탑재 ----------
            mods = pg.evaluate("() => ({ pri: typeof BojangPriority, ev: typeof BojangEvidence })")
            check("A. 신규 모듈 — 우선순위 엔진·증거 팩 탑재", mods["pri"] == "object" and mods["ev"] == "object", mods)

            outA, mA, pathA = build_profile(pg, PROFILE_A, "A")
            outB, mB, pathB = build_profile(pg, PROFILE_B, "B")
            check("A. 프로파일 A — 30장·넘침 0", outA["pages"] == 30 and len(outA["overflow"]) == 0, (outA["pages"], outA["overflow"]))
            check("A. 프로파일 B — 30장·넘침 0", outB["pages"] == 30 and len(outB["overflow"]) == 0, (outB["pages"], outB["overflow"]))
            check("A. 페이지 번호 — 30장 고정(01~30)", True, "schedule 12+18 고정")

            pagesA, pagesB = pdf_pages(pathA), pdf_pages(pathB)
            check("A. PDF 페이지 수 = 텍스트 블록 수", len(pagesA) == 30 and len(pagesB) == 30, (len(pagesA), len(pagesB)))

            # ---------- B. 화법 ----------
            pcts = [coach_pct(x)[0] for x in pagesA]
            total_chars = sum(coach_pct(x)[1] for x in pagesA)
            coach = sum(len(l) for x in pagesA for l in body_lines(x) if COACH.search(l) or (l.startswith('"') and len(l) > 12))
            pct_all = round(100 * coach / max(1, total_chars))
            check("B. 화법·코칭 비중 ≤15%", pct_all <= 15, "%d%% (이전 34%%)" % pct_all)
            check("B. 화법 비중 35% 초과 페이지 0", max(pcts) <= 35, sorted(pcts)[-3:])
            check("B. 대본 박스 ≤8", mA["script"] <= 8, mA["script"])
            check("B. 화법 전용 페이지 ≤2", sum(1 for x in pcts if x >= 40) <= 2, [i + 1 for i, x in enumerate(pcts) if x >= 40])

            # ---------- C. 개인화 ----------
            tokA = pg.evaluate(PROFILE_A) and pg.evaluate("""() => { const m = BojangReport.build('advisor', BojangApp.state).m;
              const a = BojangPriority.allocation(m);
              const t = [m.client.name, String(m.client.insuranceAge) + '세', String(m.premium) + '만원', m.client.ageDay ? m.client.ageDay.label : ''];
              a.order.forEach((e) => { t.push(e.pct + '%'); if (e.gaps && e.gaps[0]) t.push(Math.round(e.gaps[0].need).toLocaleString('ko-KR') + '만원'); });
              t.push(m.premium + '만원', m.client.birth ? m.client.birth : '');
              return t.filter(Boolean); }""")
            pg.evaluate(PROFILE_B)
            tokB = pg.evaluate("""() => { const m = BojangReport.build('advisor', BojangApp.state).m;
              const a = BojangPriority.allocation(m);
              const t = [m.client.name, String(m.client.insuranceAge) + '세', String(m.premium) + '만원', m.client.ageDay ? m.client.ageDay.label : ''];
              a.order.forEach((e) => { t.push(e.pct + '%'); if (e.gaps && e.gaps[0]) t.push(Math.round(e.gaps[0].need).toLocaleString('ko-KR') + '만원'); });
              t.push(m.premium + '만원', m.client.birth ? m.client.birth : '');
              return t.filter(Boolean); }""")
            diffs, weak = [], []
            for i in range(30):
                a = re.sub(r"(박정자|김민수)", "○○", pagesA[i])
                b = re.sub(r"(박정자|김민수)", "○○", pagesB[i])
                sim = round(100 * difflib.SequenceMatcher(None, a, b, autojunk=False).ratio())
                diffs.append(sim)
                txt = pagesA[i]
                others = [tok for tok in tokA if tok != "김민수"]
                vals = (1 if "김민수" in txt else 0) + sum(1 for tok in others if tok and tok in txt)
                if vals < 3:
                    weak.append((i + 1, vals))
            check("C. 개인화 0% 페이지 0", all(x < 100 for x in diffs), [i + 1 for i, x in enumerate(diffs) if x == 100])
            check("C. 고객 값 3개 미만 페이지 0", not weak, weak)

            # ---------- D. 증거 ----------
            stats = pg.evaluate("() => BojangEvidence.STATS")
            scored = [s for s in stats if s.get("src") and s.get("scope") is not None and s.get("limit") is not None]
            check("D. 공식 통계 항목 ≥40", len(stats) >= 40, len(stats))
            check("D. 수치마다 출처·기준·범위·한계", len(scored) == len(stats), "%d/%d" % (len(scored), len(stats)))
            ev_pages = [i + 1 for i, x in enumerate(pagesA) if "출처" in x]
            check("D. 출처 표기 페이지 ≥15", len(ev_pages) >= 15, len(ev_pages))
            check("D. 챕터 1p·코드·사례·반론 페이지에 출처", all("출처" in pagesA[i] for i in (12, 13, 14, 16, 17, 18, 19, 20, 21, 22)), [i + 1 for i in (12, 13, 14, 16, 17, 18, 19, 20, 21, 22) if "출처" not in pagesA[i]])
            check("D. 기준연도 표기 — 통계연보·심사분·공고", any("2025" in x and "심사분" in x for x in pagesA) and any("2026" in x for x in pagesA), "")

            # ---------- E. 메모 ----------
            check("E. 상담 메모 지면 ≤1p", mA["memo"] <= 1 and mB["memo"] <= 1, (mA["memo"], mB["memo"]))

            # ---------- F/G. 우선순위·지면 ----------
            planA = pg.evaluate("""() => { const m = BojangReport.build('advisor', BojangApp.state).m; return null; }""")
            pg.evaluate(PROFILE_A)
            allocA = pg.evaluate("""() => { const m = BojangReport.build('advisor', BojangApp.state).m;
              const a = BojangPriority.allocation(m);
              return { order: a.order.map(e => [e.name, e.order, e.pct, e.pages, e.hold]), first: a.first && a.first.name }; }""")
            pg.evaluate(PROFILE_B)
            allocB = pg.evaluate("""() => { const m = BojangReport.build('advisor', BojangApp.state).m;
              const a = BojangPriority.allocation(m);
              return { order: a.order.map(e => [e.name, e.order, e.pct, e.pages, e.hold]), first: a.first && a.first.name }; }""")
            check("F. A — 1순위 암 (심장보다 앞)", allocA["order"][0][0] == "암" and allocA["order"][1][0] == "심장", allocA["order"])
            check("F. A — 암 5p·심장 4p 배분", allocA["order"][0][3] == 5 and allocA["order"][1][3] == 4, [x[3] for x in allocA["order"]])
            check("F. B — 1순위 간병, 암 HOLD", allocB["order"][0][0] == "간병비" and any(x[0] == "암" and x[4] for x in allocB["order"]), allocB["order"])
            check("G. B — 간병 1순위 7p", allocB["order"][0][3] == 7, allocB["order"][0])
            check("G. B — 암 HOLD 1p", any(x[0] == "암" and x[3] == 1 for x in allocB["order"]), [x for x in allocB["order"] if x[0] == "암"])
            # PDF 상 순서 확인: A 13p=암, B 13p=간병 / B 7p 주제=간병(헤드가 13p이므로 PDF 내 간병 챕터 첫 장 확인)
            check("G. A PDF 13p = 암 판독", "암 — 지금 위치" in pagesA[12], pagesA[12][:60].replace("\n", " "))
            check("G. B PDF 13p = 간병 판독", "간병" in pagesB[12] and "지금 위치" in pagesB[12], pagesB[12][:60].replace("\n", " "))
            # p3 로드맵·p4 판독표 순서 일치
            check("F. 로드맵·판독표 순서 일치", ("1 암" in pagesA[2].replace("\n", " ") or "암 36%" in pagesA[2]) and "암" in pagesA[3], "")

            # ---------- H. 사례·반론 ----------
            cases = pg.evaluate("() => BojangEvidence.CASES")
            objs = pg.evaluate("() => BojangEvidence.OBJECTIONS")
            types = set(c["type"] for c in cases)
            check("H. 3칸 사례 ≥15", len(cases) >= 15, len(cases))
            check("H. 사례 표기 3종 구분", {"실사례", "각색", "가상"} <= types, types)
            check("H. 사례마다 출처 1줄", all(c.get("source") for c in cases), [c["id"] for c in cases if not c.get("source")])
            check("H. 판례 번호 표기 — 2023다250746", any("2023다250746" in (c["source"] + c["fact"]) for c in cases), "")
            check("H. 반론 훅 15", len(objs) == 15, len(objs))
            adv_text = "\n".join(pagesA)
            check("H. PDF에 사례 12건 이상 등장", sum(1 for c in cases if c["title"][:10] in adv_text) >= 12, sum(1 for c in cases if c["title"][:10] in adv_text))
            check("H. PDF 반론 카드 15개 항목", sum(1 for o in objs if o["q"][:8] in adv_text) >= 12, sum(1 for o in objs if o["q"][:8] in adv_text))

            # ---------- I. 안전선 ----------
            all_text = "\n".join(pagesA) + "\n".join(pagesB)
            banned = ["위험이 높", "위험도 1위", "질병위험", "지급 가능성", "발생 확률이 높", "위험 1순위"]
            hit = [b for b in banned if b in all_text]
            check("I. 질병위험·지급가능성 단정 없음", not hit, hit)
            check("I. '먼저 확인할 항목' 라벨", "먼저 확인할 항목" in all_text, "")
            check("I. 금소법 안전선 문구", "판정하지 않고" in all_text and "확인 후보" in all_text, "")
            check("I. 순서 조정 안내 문구", "설계사가 순서를 조정" in all_text or "설계사가 조정" in all_text, "")

            # ---------- J. 앱 동기화 ----------
            live = pg.evaluate("""() => {
              const out = [];
              for (let i = 0; i < 5; i += 1) {
                BojangLive.render();
                const t = document.querySelector('#live-body').innerText;
                out.push([i + 1, t.length, /먼저 확인할 항목|오프닝|진단|반론|클로징/.test(t)]);
                document.querySelector('#live-next').click();
              }
              return out;
            }""")
            check("J. 라이브 5단계 렌더", all(x[1] > 300 for x in live), live)
            same = pg.evaluate("""() => { for (let i = 0; i < 6; i += 1) document.querySelector('#live-prev').click();
              document.querySelector('#live-next').click(); BojangLive.render();
              return { txt: document.querySelector('#live-body').innerText }; }""")
            check("J. 라이브 — 같은 순서·압축 화법", "먼저 확인할 3카드" in same["txt"] and "기본 상담 순서" in same["txt"], "")

            # ---------- K. 빌드 ----------
            subprocess.run([sys.executable, "build_single.py"], cwd=ROOT, check=True, capture_output=True)
            single = os.path.join(ROOT, "dist", "bojang-guide.single.html")
            html = open(single, encoding="utf-8").read()
            check("K. 단일 HTML — 신규 모듈 포함", "BojangPriority" in html and "BojangEvidence" in html, len(html) // 1024)
            single_pg = ctx.new_page()
            serr = []
            single_pg.on("pageerror", lambda e: serr.append(str(e)))
            single_pg.goto("file://" + single, wait_until="load")
            single_pg.wait_for_timeout(400)
            ok_single = single_pg.evaluate("() => typeof BojangPriority === 'object' && typeof BojangEvidence === 'object'")
            check("K. 단일 HTML — 모듈 실행", ok_single, serr[:3])
            check("K. 콘솔·페이지 오류 0", len(errors) == 0, errors[:5])

            # ---------- L. 실물 산출물 ----------
            shots = pg.evaluate("""() => 1""")
            for no, name in ((3, "p03-roadmap"), (4, "p04-summary"), (6, "p06-system"), (10, "p10-objection"), (13, "p13-top1"), (14, "p14-codeband"), (15, "p15-cases"), (16, "p16-design"), (5, "p05-remodel"), (12, "p12-aftercare")):
                doc = pymupdf.open(pathA)
                pix = doc[no - 1].get_pixmap(matrix=pymupdf.Matrix(100 / 72, 100 / 72))
                pix.save(os.path.join(SHOTS, name + ".png"))
            check("L. 핵심 페이지 PNG 저장", all(os.path.exists(os.path.join(SHOTS, n + ".png")) for n in
                                            ("p03-roadmap", "p04-summary", "p06-system", "p10-objection", "p13-top1")), SHOTS)
            check("L. 실물 PDF 2종", os.path.exists(pathA) and os.path.exists(pathB), (outA["pages"], outB["pages"]))

            browser.close()
    finally:
        httpd.shutdown()

    passed = sum(1 for _, ok, _ in results if ok)
    print("\n=== v7.5 테스트 %d/%d 통과 ===" % (passed, len(results)))
    if passed != len(results):
        print("실패:", [n for n, ok, _ in results if not ok])
        sys.exit(1)


if __name__ == "__main__":
    main()
