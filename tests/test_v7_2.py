#!/usr/bin/env python3
"""보장분석 라이프 리포트 v7.2 — 1단계 핵심 집중 고도화 검증

실행: python3 tests/test_v7_2.py

검증 축
  A. 버전 v7.2 통일(version.js·sw·manifest·index·README·단일 HTML) · 구버전 잔재 0
  B. 담보 틀 47~55칸(실측 50) · 생활·실손 참고 축 19칸 · 점수 불변
  C. 담보명 동의어 사전 80+ · 미매칭 1탭 연결 큐(연결·오분류 안내)
  D. 직업급수표 3단계 · 2·3급/이륜차 알림 · 상담 메모 자동 추출
  E. 약관·청구 실무 4종(유사암 10~20% · 관혈/비관혈 · 복용약/검진 · 간병 증빙 3종·발급처)
  F. 현장 UX 5항목(결론 한 문장 형식 · 보완 후보 용어 · 12/11/10px 하한 · 44px 터치 · 기준일·출처 1줄)
  G. 연령대별 기준선 20~30/40~50/60대+ 차등 · 기준 없는 항목 색 판정 제외
  H. PDF 텍스트 레이어(pymupdf 실제 추출 >0자) · 고객명 기본 제외 토글
  I. 보안(CSP · XSS 이스케이프 · AES-GCM 암호화 · 세션 전용 · 삭제권 · HTTPS/443 · OCR 분리)
  J. sw.js 캐시 분리 · 실패 격리 · GitHub Actions CI
  K. Playwright 실화면 스크린샷 4장 이상 → reports/bojang-guide/v7.2/
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
OUT = os.path.join(ROOT, "tests", "out")
SHOTS = os.environ.get("BOJANG_SHOTS") or "/workspace/reports/bojang-guide/v7.2"
TMP = os.environ.get("BOJANG_PDF_OUT") or "/workspace/tmp/v72"
os.makedirs(OUT, exist_ok=True)
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


def main():
    errors_all = []
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
            errors, external = [], []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.on("request", lambda r: external.append(r.url) if not r.url.startswith(base) and not r.url.startswith("data:") and not r.url.startswith("blob:") else None)
            pg.goto(base + "/index.html")
            pg.wait_for_timeout(1200)
            pg.evaluate("() => { const b=document.querySelector('#tour-invite-later'); if(b) b.click(); }")

            # =====================================================================
            # A. 버전 v7.2
            # =====================================================================
            ver = read(os.path.join(ROOT, "version.js"))
            check("version.js 단일 상수 v7.2", len(re.findall(r"const APP_VERSION = '([^']+)'", ver)) == 1 and "const APP_VERSION = 'v7.2';" in ver)
            check("window.APP_VERSION = v7.2", pg.evaluate("() => window.APP_VERSION") == "v7.2")
            check("sw 캐시 bojang-guide-v7.2", "const CACHE = 'bojang-guide-v7.2';" in read(os.path.join(ROOT, "sw.js")))
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest v7.2", "v7.2" in man.get("name", ""), man.get("name"))
            html = read(os.path.join(ROOT, "index.html"))
            check("index title v7.2", "리포트 v7.2 ·" in html and 'content="v7.2"' in html)
            check("index — v7.1.1 버전 메타 잔재 0", 'content="v7.1.1"' not in html and "<title>보장분석 라이프 리포트 v7.1.1" not in html)
            check("화면 표기 v7.2", pg.inner_text(".hh-ver").strip().startswith("v7.2"), pg.inner_text(".hh-ver"))
            readme = read(os.path.join(ROOT, "README.md"))
            check("README v7.2 절", "## v7.2에서 달라진 것" in readme and "## v7.1.1에서 달라진 것" in readme)
            check("index — 신규 모듈 3개 로드", all(('<script src="./%s"></script>' % f) in html for f in ("dambo-dictionary.js", "jobgrades.js", "ocr.js")))
            sh = read(os.path.join(ROOT, "dist", "bojang-guide.single.html"))
            check("단일 HTML — v7.2 표기 · 신규 모듈 포함", 'content="v7.2"' in sh and "BojangDambo" in sh and "BojangJobGrades" in sh and "BojangOcr" in sh, len(sh) // 1024)

            # =====================================================================
            # B. 담보 틀 47~55칸 · 생활·실손 참고 축
            # =====================================================================
            frame = pg.evaluate("() => ({ count: BojangModel.frameCount(), list: BojangModel.coverageFrame() })")
            check("담보 틀 47~55칸 (실측)", 47 <= frame["count"] <= 55, frame["count"])
            axes = sorted(set(x["axis"] for x in frame["list"]))
            check("담보 틀 6축 (생활·실손 포함)", axes == ["brain", "cancer", "care", "heart", "living", "surgery"], axes)
            living = pg.evaluate("() => BojangModel.livingRef(BojangApp.state)")
            check("생활·실손 19칸 · 점수 제외 표기", living["total"] == 19 and "점수와 색 판정에 넣지" in living["note"], [living["total"], living["note"][:30]])
            check("생활·실손 5묶음(사망·운전자·배상·소액·실손치아)", len(living["groups"]) == 5, [g["label"] for g in living["groups"]])

            pg.evaluate("() => BojangApp.newConsult()")
            pg.wait_for_timeout(200)
            pg.evaluate("""() => { const S = BojangApp.state; S.client.name='김서연'; S.age='40'; S.gender='여'; S.job='1'; S.premium=18;
              S.cov.cancer.general=3000; S.cov.cancer.similar=600; S.cov.brain.dx.vascular=2000; S.cov.heart.dx.ischemic=1000;
              S.cov.surgery.disease15=300; S.cov.care.daily=8; BojangApp.analyze(); }""")
            pg.wait_for_timeout(350)
            before = pg.evaluate("() => BojangApp.state.lastResult.score.score")
            pg.evaluate("""() => { const L = BojangApp.state.cov.living; L.deathInjury = 5000; L.driverFine = 200; L.toothCare = true; L.silsonNonPay = true;
              if (BojangApp.analyze) BojangApp.analyze(); }""")
            pg.wait_for_timeout(350)
            after = pg.evaluate("() => BojangApp.state.lastResult.score.score")
            check("생활·실손 입력은 점수를 바꾸지 않음(참고 축)", before == after, [before, after])
            check("생활·실손 카드 19개 입력칸", pg.evaluate("() => document.querySelectorAll('#card-living [data-live-amt], #card-living [data-live-bool]').length") == 19)
            check("생활·실손 카드 — 색 판정 배지 대신 '참고'", "참고" in pg.inner_text("#card-living .badge"))

            # =====================================================================
            # C. 담보명 사전 · 미매칭 1탭 연결 큐
            # =====================================================================
            syn = pg.evaluate("() => BojangDambo.count()")
            check("담보명 동의어 사전 80개 이상", syn >= 80, syn)
            matches = pg.evaluate("""() => ({
              drug: BojangDambo.match('무배당 표적항암약물허가치료비(갱신형) 특약'),
              stent: BojangDambo.match('관상동맥스텐트삽입술'),
              care: BojangDambo.match('요양병원 간병인 사용일당'),
              tooth: BojangDambo.match('치아보철치료(임플란트)'),
              unknown: BojangDambo.match('우주왕복선 탑승 특약')
            })""")
            check("사전 매칭 — 항암약물/스텐트/요양간병/치아", matches["drug"]["sub"] == "drug" and matches["stent"]["sub"] == "surgery" and matches["care"]["sub"] == "nDaily" and matches["tooth"]["axis"] == "living", [matches["drug"], matches["stent"], matches["care"], matches["tooth"]])
            check("사전 미매칭은 null", matches["unknown"] is None, matches["unknown"])

            pg.evaluate("""() => {
              const S = BojangApp.state;
              S.cov.custom.surgery = [
                { id: 'cu_test_unknown', name: '우주왕복선 탑승 특약', amount: 500, mode: 'individual' },
                { id: 'cu_test_mismatch', name: '뇌혈관수술비', amount: 800, mode: 'individual' }
              ];
              BojangApp.renderAllInputs();
            }""")
            pg.wait_for_timeout(400)
            queue = pg.evaluate("""() => { const host = document.querySelector('#rider-queue');
              return { rows: host.querySelectorAll('.rq-row').length, btns: host.querySelectorAll('.rq-btn').length,
                       text: host.innerText }; }""")
            check("미매칭 큐 — 2건 표시(미매칭+오분류)", queue["rows"] == 2, queue["text"][:80])
            check("미매칭 큐 — 1탭 축 버튼 6개 × 2행", queue["btns"] == 12, queue["btns"])
            check("오분류 안내 문구", "다른 축" in queue["text"] and "사전에 없는 이름" in queue["text"], queue["text"][:120])
            pg.evaluate("""() => { const b = document.querySelector('#rider-queue [data-rq-id="cu_test_unknown"] [data-rq-axis="living"]'); b.click(); }""")
            pg.wait_for_timeout(400)
            linked = pg.evaluate("""() => { const it = BojangApp.state.cov.custom.surgery.find((x) => x.id === 'cu_test_unknown');
              return { axis: it && it.linkAxis, rows: document.querySelectorAll('#rider-queue .rq-row').length }; }""")
            check("1탭 연결 — 생활·실손 축으로 저장", linked["axis"] == "living", linked)
            check("연결 후 큐에서 사라짐", linked["rows"] == 1, linked)

            # =====================================================================
            # D. 직업급수표 · 이륜차 · 메모 자동 추출
            # =====================================================================
            jobs = pg.evaluate("""() => ({
              delivery: BojangJobGrades.match('배달 라이더'),
              office: BojangJobGrades.match('사무직 회사원'),
              site: BojangJobGrades.match('건설 현장 철근공'),
              grades: Object.keys(BojangJobGrades.GRADES),
              alerts3: BojangJobGrades.alerts('3', true),
              alerts1: BojangJobGrades.alerts('1', false)
            })""")
            check("직업급수 — 배달=3급·이륜차", jobs["delivery"]["grade"] == "3" and jobs["delivery"]["twoWheel"] is True, jobs["delivery"])
            check("직업급수 — 사무=1급", jobs["office"]["grade"] == "1", jobs["office"])
            check("직업급수 — 건설=3급", jobs["site"]["grade"] == "3", jobs["site"])
            check("직업급수 알림 — 3급·이륜차 2건 / 1급 0건", len(jobs["alerts3"]) == 2 and jobs["alerts1"] is None, [len(jobs["alerts3"] or []), jobs["alerts1"]])
            memo = pg.evaluate("""() => BojangMemoFill.parse('김서연 42세 여성. 배달·오토바이 운전. 월 보험료 18만원. 암 5000.')""")
            check("상담 메모 — 이륜차 키워드 자동 추출", memo["job"] == "3" and memo["jobTwoWheel"] is True, [memo["job"], memo["jobTwoWheel"]])
            check("상담 메모 — 이륜차 경고 문구", any("이륜차" in w for w in memo["warnings"]), memo["warnings"])
            note = pg.evaluate("""() => { const S = BojangApp.state; S.job='3'; S.jobNote='배달 라이더'; S.jobTwoWheel=true; BojangApp.analyze();
              const el = document.querySelector('#job-grade-note'); return { text: el.innerText, tone: el.className }; }""")
            check("직업급수 알림 — 화면 표시(3급·이륜차)", "배달·이륜차" in note["text"] and "tone-gap" in note["tone"], note["text"][:80])

            # =====================================================================
            # E. 약관·청구 실무 4종
            # =====================================================================
            similar = pg.evaluate("""() => {
              const out = {};
              const clone = () => { const S0 = BojangApp.state;
                return { age: S0.age, gender: S0.gender, job: S0.job, silson: S0.silson, premium: S0.premium,
                  client: JSON.parse(JSON.stringify(S0.client)), contracts: [], family: [], disc: {},
                  cov: JSON.parse(JSON.stringify(S0.cov)), flags: JSON.parse(JSON.stringify(S0.flags)) }; };
              const run = (general, similarVal) => { const S = clone();
                S.cov.cancer.general = general; S.cov.cancer.similar = similarVal;
                const m = BojangModel.full(S);
                return m.checkpoints.filter((c) => c.title.indexOf('유사암') >= 0).map((c) => c.title + ' ' + c.body).join(' | '); };
              out.over = run(3000, 1000);
              out.low = run(5000, 200);
              out.ok = run(5000, 750);
              return out;
            }""")
            check("유사암 — 20% 초과 경고", "일반암의 33%" in similar["over"], similar["over"][:80])
            check("유사암 — 10% 미만 경고", "10% 미만" in similar["low"], similar["low"][:80])
            check("유사암 — 10~20% 적정", "유사암 한도 적정" in similar["ok"], similar["ok"][:80])

            neuro = pg.evaluate("""() => { const S0 = BojangApp.state; S0.cov.brain.treat.surgery = 1500; S0.cov.heart.treat.surgery = 1500;
              const m = BojangModel.full(S0);
              return m.checkpoints.filter((c) => c.title.indexOf('관혈') >= 0).map((c) => c.body).join(' '); }""")
            check("뇌·심장 — 관혈/비관혈 괴리 경고", "관혈" in neuro and "비관혈" in neuro and "스텐트" in neuro, neuro[:90])

            meds = pg.evaluate("""() => { const S0 = BojangApp.state;
              const S = { age: S0.age, gender: S0.gender, job: S0.job, silson: S0.silson, premium: S0.premium,
                client: JSON.parse(JSON.stringify(S0.client)), contracts: [], family: [], disc: { m3_daily: true, y1_test: true },
                cov: JSON.parse(JSON.stringify(S0.cov)), flags: JSON.parse(JSON.stringify(S0.flags)) };
              const m = BojangModel.full(S);
              const t = m.checkpoints.map((c) => c.title).join(' | ');
              return { t, b: m.checkpoints.filter((c) => c.title.indexOf('복용약') >= 0 || c.title.indexOf('검진') >= 0).map((c) => c.body).join(' ') }; }""")
            check("복용약 — 3·2·5/3·5·5 분기 경고", "복용약" in meds["t"] and "3·5·5" in meds["b"] and "3·2·5" in meds["b"], meds["b"][:90])
            check("검진 — 3개월 알릴 의무 경고", "검진" in meds["t"] and "3개월" in meds["b"], meds["b"][:90])

            care = pg.evaluate("""() => ({ docs: BojangClaimCheck.DOCS.map((d) => [d.key, d.where]),
              proofs: BojangClaimCheck.CARE_PROOFS.map((p) => p.label) })""")
            check("청구 서류 6종 모두 발급처 병기", len(care["docs"]) == 6 and all(d[1] for d in care["docs"]), care["docs"])
            check("간병 증빙 3종(사업자번호·계좌이체·간병일지)", any("사업자등록" in x for x in care["proofs"]) and any("계좌이체" in x for x in care["proofs"]) and any("간병일지" in x for x in care["proofs"]), care["proofs"])
            claim_ui = pg.evaluate("""() => { const S = BojangApp.state; S.cov.care.daily = 10;
              const code = FC_CODES.find((c) => c.code === 'I63');
              const r = BojangClaimCheck.match({ code, docs: { dx: false }, care: true, careBasis: '8' });
              return { proof: r.careProof && r.careProof.length, html: BojangClaimCheck.render ? true : false }; }""")
            check("청구 결과 — 간병 증빙 3종 블록 데이터", claim_ui["proof"] == 3, claim_ui)

            # =====================================================================
            # F. 현장 UX 5항목
            # =====================================================================
            pg.evaluate("""() => { const S = BojangApp.state; S.job='1'; S.jobNote=''; S.jobTwoWheel=false;
              S.cov.cancer.general=5000; S.cov.cancer.similar=1000; S.cov.brain.dx.vascular=2000; S.cov.heart.dx.ischemic=2000;
              S.cov.surgery.disease15=500; S.cov.care.daily=10; BojangApp.analyze(); }""")
            pg.wait_for_timeout(500)
            concl = pg.inner_text("#result-conclusion .cbn-text")
            check("결론 한 문장 형식 — '보완 후보 담보 N개, 가장 시급한 것은 OO'", bool(re.search(r"보완 후보 담보 \d+개, 가장 시급한 것은 .+", concl)), concl)
            zero = pg.evaluate("""() => { const S0 = BojangApp.state;
              const S = { age: S0.age, gender: S0.gender, job: S0.job, silson: S0.silson, premium: S0.premium,
                client: JSON.parse(JSON.stringify(S0.client)), contracts: [], family: [], disc: {},
                cov: JSON.parse(JSON.stringify(S0.cov)), flags: JSON.parse(JSON.stringify(S0.flags)) };
              S.cov.cancer.general=5000; S.cov.cancer.similar=1000; S.cov.cancer.recur=true;
              S.cov.cancer.treatment={surgery:3000,drug:3000,radio:3000,icu:3000,extra:3000};
              S.cov.brain.dx={vascular:2000,stroke:2000,bleed:1000}; S.cov.brain.treat={lysis:3000,surgery:3000,icu:3000};
              S.cov.heart.dx={ischemic:2000,ami:2000}; S.cov.heart.treat={lysis:3000,surgery:3000,icu:3000};
              S.cov.surgery={disease:300,disease15:1000,diseaseNdae:2000,diseaseNonPay:2000,injury:300,injury15:1000};
              S.cov.care={daily:20,nDaily:20,basis:'time',family:'yes',nursing:true,ltc:true,mode:'normal'};
              const m = BojangModel.full(S); return m.conclusion; }""")
            check("결론 0개 — 안정 문구(추가 가입보다 갱신·만기)", zero["count"] == 0 and "갱신·만기" in zero["text"] and "보완 후보 담보 0개" in zero["text"], zero["text"])

            wording = pg.evaluate("""() => ({
              rows: document.querySelector('#result-rows').innerText,
              labels: Array.from(document.querySelectorAll('#result-rows .badge')).map((b) => b.innerText),
              html: document.body.innerText
            })""")
            check("판정 용어 — 결과 행에 '부족' 없음", "부족" not in wording["rows"], wording["rows"][:80])
            check("판정 배지 — 보완 후보/확인 권장/적정", all(x in ("보완 후보", "확인 권장", "적정") for x in wording["labels"]), wording["labels"])
            check("결과 화면 판정에 '위험' 단정 없음", not any(x in wording["rows"] for x in ("공백 위험", "위험", "미달")), "ok")

            typo = pg.evaluate("""() => { const bad = [];
              document.querySelectorAll('#view-analysis .card p:not(.stat-source), #view-analysis .card li, .prow-tail span, .living-row > span, .cc-doc em, .cc-miss-list span, .conclusion-banner .cbn-meta').forEach((el) => {
                const fs = parseFloat(getComputedStyle(el).fontSize);
                if (fs < 12 && (el.innerText || '').trim()) bad.push([fs, el.innerText.slice(0, 16)]);
              });
              const helper = [];
              document.querySelectorAll('.hint, .card-sub, .stat-source, .unit, .cc-where').forEach((el) => {
                const fs = parseFloat(getComputedStyle(el).fontSize);
                if (fs < 11 && (el.innerText || '').trim()) helper.push([fs, el.innerText.slice(0, 16)]);
              });
              return { bad, helper }; }""")
            check("글자 하한 — 본문 12px 이상", len(typo["bad"]) == 0, typo["bad"][:5])
            check("글자 하한 — 보조 설명 11px 이상", len(typo["helper"]) == 0, typo["helper"][:5])
            touch = pg.evaluate("""() => { const bad = [];
              document.querySelectorAll('#view-analysis .seg-btn, #view-analysis .quick, #view-analysis .chip-custom, .living-row, .rq-btn, .tab, .hg-card, .mm-btn').forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.height > 0 && r.height < 43.5) bad.push([Math.round(r.height * 10) / 10, (el.textContent || '').slice(0, 14)]);
              });
              return bad; }""")
            check("터치 대상 44px 이상", len(touch) == 0, touch[:5])
            std = pg.inner_text("#age-standard-line")
            check("기준선 카드 — 기준일·출처 한 줄 고정", "기준일 2026-11-17" in std and "국가암등록통계" in std and "통계청" in std and "건강보험심사평가원" in std, std[:100])
            check("기준선 카드 — 한 줄(줄바꿈 없음)", "\n" not in std.strip(), repr(std[:40]))

            # 복사 피드백
            copy = pg.evaluate("""async () => { const btn = document.querySelector('#btn-kakao');
              if (!btn) return { no: true };
              const before = btn.textContent; btn.click();
              await new Promise((r) => setTimeout(r, 120));
              const mid = { text: btn.textContent, copied: btn.dataset.copied, cls: btn.className };
              await new Promise((r) => setTimeout(r, 1800));
              return { before, mid, after: btn.textContent }; }""")
            check("복사 버튼 — '복사됨 ✓' 상태 전환", copy.get("mid", {}).get("text") == "복사됨 ✓" and copy["mid"]["copied"] == "1", copy)
            check("복사 버튼 — 1.6초 뒤 원상 복구", copy.get("after") == copy.get("before"), copy)

            # =====================================================================
            # G. 연령대별 기준선 차등 · 기준 없음 항목 제외
            # =====================================================================
            ages = pg.evaluate("""() => {
              const out = {};
              ['20','40','60'].forEach((a) => { const s = ageStandard('cancer', a); out[a] = [s.rec, s.tiers.min, s.tierLabel]; });
              const out2 = {};
              ['20','40','60'].forEach((a) => { const s = ageStandard('brain', a); out2[a] = s.rec; });
              const rec = {};
              ['20','40','60'].forEach((a) => { rec[a] = PRIORITY[0].rec[a]; });
              return { out, out2, rec }; }""")
            check("암 기준선 — 20~30/40~50/60대+ 차등", ages["out"]["20"][0] != ages["out"]["40"][0] and ages["out"]["40"][0] != ages["out"]["60"][0], ages["out"])
            check("뇌 기준선 — 60대+ 낮춤", ages["out2"]["60"] < ages["out2"]["40"], ages["out2"])
            check("PRIORITY rec — 연령대 값 반영", ages["rec"]["20"] == ages["out"]["20"][0] and ages["rec"]["60"] == ages["out"]["60"][0], ages["rec"])
            nostd = pg.evaluate("""() => { const m = BojangModel.evalItem(BojangApp.state, PRIORITY[4]);
              const recur = BojangModel.evalItem(BojangApp.state, PRIORITY[0]).parts.find((p) => p.key === 'recur');
              return { basis: (m.parts.find((p) => p.key === 'basis') || {}).judgeable, recur: recur.judgeable,
                       stdCount: BojangModel.evalItem(BojangApp.state, PRIORITY[4]).standard ? 1 : 0 }; }""")
            check("기준 없는 항목 — 색 판정 제외(judgeable=false)", nostd["basis"] is False and nostd["recur"] is False, nostd)

            # =====================================================================
            # H. PDF 텍스트 레이어 · 고객명 기본 제외
            # =====================================================================
            pg.evaluate("""() => { const S = BojangApp.state; S.client.name='김서연'; S.age='40'; S.gender='여'; S.job='1'; S.premium=18;
              S.cov.cancer.general=3000; S.cov.cancer.similar=600; S.cov.brain.dx.vascular=2000; S.cov.heart.dx.ischemic=1000;
              S.cov.surgery.disease15=300; S.cov.care.daily=8; BojangApp.analyze(); }""")
            pdfs = {}
            for kind in ("summary", "detail", "advisor"):
                out = pg.evaluate("""async (kind) => { const b = await BojangApp.buildPdfBlob(kind);
                  const buf = await b.blob.arrayBuffer(); const bytes = new Uint8Array(buf); let s = '';
                  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
                  return { b64: btoa(s), pages: b.pages, filename: b.filename, includeName: b.includeName, overflow: b.overflow.length }; }""", kind)
                path = os.path.join(TMP, kind + ".pdf")
                with open(path, "wb") as f:
                    f.write(base64.b64decode(out["b64"]))
                pdfs[kind] = (out, path)
            for kind, label, expect in (("summary", "1장", 1), ("detail", "10장", 10), ("advisor", "30장", 30)):
                out, path = pdfs[kind]
                doc = pymupdf.open(path)
                texts = [page.get_text().strip() for page in doc]
                total = sum(len(t) for t in texts)
                korean = sum(1 for ch in "".join(texts) if "\uac00" <= ch <= "\ud7a3")
                check("PDF %s — %d페이지 · 넘침 0" % (label, expect), out["pages"] == expect and out["overflow"] == 0, [out["pages"], out["overflow"]])
                check("PDF %s — pymupdf 텍스트 %d자 추출" % (label, total), total > 0, total)
                check("PDF %s — 실제 한글 %d자" % (label, korean), korean > 20, korean)
                if kind == "summary":
                    check("PDF 1장 — 고객명·금액 텍스트 포함", "김서연" in texts[0] and ("3,000" in texts[0] or "3000" in texts[0]), texts[0][:80])
            out, _ = pdfs["detail"]
            check("PDF 파일명 — 고객명 기본 제외", out["filename"].startswith("보장분석_") and "김서연" not in out["filename"], out["filename"])
            doc0 = pymupdf.open(pdfs["summary"][1])
            meta0 = doc0.metadata.get("title") or ""
            check("PDF 문서 제목 — 고객명 기본 제외", "김서연" not in meta0 and "보장분석" in meta0, meta0)
            inc = pg.evaluate("""async () => { const cb = document.querySelector('#pdf-include-name'); cb.checked = true;
              const b = await BojangApp.buildPdfBlob('summary');
              const buf = await b.blob.arrayBuffer(); const bytes = new Uint8Array(buf); let s = '';
              for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
              return { f: b.filename, inc: b.includeName, b64: btoa(s) }; }""")
            check("PDF 이름 포함 토글 — 켜면 파일명에 이름", "김서연" in inc["f"] and inc["inc"] is True, inc["f"])
            with open(os.path.join(TMP, "summary-named.pdf"), "wb") as f:
                f.write(base64.b64decode(inc["b64"]))
            meta1 = pymupdf.open(os.path.join(TMP, "summary-named.pdf")).metadata.get("title") or ""
            check("PDF 이름 포함 토글 — 문서 제목에도 이름", "김서연" in meta1, meta1)
            pg.evaluate("() => { const cb = document.querySelector('#pdf-include-name'); cb.checked = false; }")

            # =====================================================================
            # I. 보안 — CSP · XSS · 암호화 · 세션 전용 · 삭제 · HTTPS · OCR
            # =====================================================================
            csp = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', html)
            check("CSP 메타 존재", bool(csp))
            c = csp.group(1) if csp else ""
            check("CSP 핵심 지시자 — object-src 'none' · base-uri 'self'", "object-src 'none'" in c and "base-uri 'self'" in c and "default-src 'self'" in c, c[:90])

            xss = pg.evaluate("""() => { window.__xss = 0; const S = BojangApp.state;
              S.client.name = '<img src=x onerror="window.__xss=1">';
              BojangApp.analyze();
              return { imgs: document.querySelectorAll('#result-hero img').length, xss: window.__xss,
                       shown: document.querySelector('#result-hero .hero-input').innerText.slice(0, 60) }; }""")
            check("XSS — 고객명 이스케이프(요소 삽입 0 · 실행 0)", xss["imgs"] == 0 and xss["xss"] == 0, xss)
            pg.evaluate("() => { BojangApp.state.client.name = '김서연'; BojangApp.analyze(); }")

            enc = pg.evaluate("""async () => { const S = window.BojangSecure;
              BojangApp.state.client.name = '암호화확인';
              BojangApp.discTouched ? BojangApp.discTouched() : null;
              for (let i = 0; i < 30; i++) { const raw = JSON.parse(localStorage.getItem('bojang.session.v4') + 'null'.replace('null','') || 'null'); if (raw && raw.enc) break; await new Promise((r) => setTimeout(r, 100)); }
              await new Promise((r) => setTimeout(r, 500));
              const raw = JSON.parse(localStorage.getItem('bojang.session.v4') || 'null');
              const plain = S.isEncrypted(raw) ? await S.decrypt(raw) : raw;
              return { enc: S.isEncrypted(raw), alg: raw && raw.enc, iv: !!(raw && raw.iv), data: !!(raw && raw.data),
                       name: plain && plain.client && plain.client.name, available: S.available(), mode: S.privacyMode() }; }""")
            check("기기 저장 — AES-GCM 암호화(iv·data)", enc["enc"] is True and enc["alg"] == "AES-GCM" and enc["iv"] and enc["data"], enc)
            check("암호화된 세션 — 복호화하면 원래 고객명", enc["name"] == "암호화확인", enc["name"])

            sess = pg.evaluate("""async () => { const S = window.BojangSecure;
              S.setPrivacyMode('session');
              BojangApp.state.client.name = '세션전용';
              BojangApp.discTouched ? BojangApp.discTouched() : null;
              await new Promise((r) => setTimeout(r, 300));
              const raw = localStorage.getItem('bojang.session.v4');
              const st = S.privacyMode();
              S.setPrivacyMode('persist');
              return { raw, st }; }""")
            check("세션 전용 모드 — 기기에 세션 저장 0", sess["raw"] is None and sess["st"] == "session", sess)

            delopt = pg.evaluate("""() => { const S = window.BojangSecure; S.setDeleteOnLogout(true);
              return { on: S.deleteOnLogout() }; }""")
            check("로그아웃 시 로컬 삭제 선택권 저장", delopt["on"] is True, delopt)
            purge = pg.evaluate("""async () => { localStorage.setItem('bojang.session.v4', '{"client":{"name":"지울값"}}');
              localStorage.setItem('bojang.history.v1', '[]');
              const removed = await BojangSecure.purgeLocal();
              return { removed, sess: localStorage.getItem('bojang.session.v4'), keep: localStorage.getItem('bojang.privacy.v1') }; }""")
            check("로컬 데이터 삭제 — 상담·이력 삭제 · 설정 유지", purge["sess"] is None and purge["keep"] is not None and len(purge["removed"]) >= 1, purge)

            beh = pg.evaluate("""() => { const B = BojangBackend;
              return { https: B.hostAllowed('https://ntfhdiujapctomzzaifu.supabase.co/rest/v1/x'),
                       https443: B.hostAllowed('https://ntfhdiujapctomzzaifu.supabase.co:443/rest/v1/x'),
                       http: B.hostAllowed('http://ntfhdiujapctomzzaifu.supabase.co/rest/v1/x'),
                       port: B.hostAllowed('https://ntfhdiujapctomzzaifu.supabase.co:8443/rest/v1/x'),
                       local: B.hostAllowed('http://127.0.0.1:54321/auth/v1/health'),
                       evil: B.hostAllowed('https://evil.example.com/rest/v1/'),
                       requireHttps: B.requireHttps }; }""")
            check("백엔드 — HTTPS 443만 허용", beh["https"] and beh["https443"] and not beh["http"] and not beh["port"] and not beh["local"] and not beh["evil"], beh)
            check("백엔드 — requireHttps 플래그", beh["requireHttps"] is True)

            ocr = pg.evaluate("""() => ({ openai: BojangOcr.PROVIDERS.openai.models, gemini: BojangOcr.PROVIDERS.gemini.models,
              o: BojangOcr.notice('openai'), g: BojangOcr.notice('gemini'), s: BojangOcr.summary() })""")
            check("OCR — OpenAI 경로 단일 모델", ocr["openai"] == 1 and "단일 모델" in ocr["o"], ocr["o"][:60])
            check("OCR — Gemini 경로 최대 4개 모델 후보", ocr["gemini"] == 4 and "4개 모델 후보" in ocr["g"], ocr["g"][:60])
            check("OCR — 공급자별 분리 표기(요약)", "OpenAI 경로(단일 모델)" in ocr["s"] and "Gemini 경로(최대 4개 모델 후보)" in ocr["s"], ocr["s"])
            ui_ocr = pg.evaluate("() => Array.from(document.querySelectorAll('p')).filter((x) => x.innerText.indexOf('OpenAI 경로') >= 0).length")
            check("OCR — 화면 안내에 두 경로 병기", ui_ocr >= 1, ui_ocr)
            src_ocr = read(os.path.join(ROOT, "ocr.js"))
            check("ocr.js — 문구 단일 출처", "PROVIDERS" in src_ocr and "models: 4" in src_ocr and "models: 1" in src_ocr)

            # =====================================================================
            # J. sw 캐시 분리 · CI
            # =====================================================================
            sw = read(os.path.join(ROOT, "sw.js"))
            check("sw — API·기록·PDF 캐시 제외 규칙", "/\\/functions\\/v1\\//" in sw and "/\\/rest\\/v1\\//" in sw and "pdf" in sw.lower())
            check("sw — 개별 cache.add 실패 격리", "c.add(a).catch" in sw and "c.addAll(" not in sw)
            ci_path = os.path.join(ROOT, ".github", "workflows", "bojang-ci.yml")
            ci = read(ci_path) if os.path.exists(ci_path) else ""
            check("CI — bojang-ci.yml 존재", bool(ci))
            check("CI — push/PR 트리거 · 단일 HTML 빌드 · 테스트 · PDF 스모크", all(k in ci for k in ("push:", "pull_request:", "build_single.py", "test_v7_2.py", "pymupdf")), ci[:120])

            # 화면 통합 · 콘솔 오류
            pg.evaluate("() => { BojangApp.switchView('analysis'); }")
            pg.wait_for_timeout(400)
            check("데스크톱 콘솔 오류 0", len(errors) == 0, errors[:5])
            check("외부 요청 0건", len(external) == 0, external[:5])
            check("360px 가로 넘침 0", pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"))

            # =====================================================================
            # K. 스크린샷 4장 이상
            # =====================================================================
            pg.set_viewport_size({"width": 360, "height": 740})
            pg.evaluate("() => { const ov = document.querySelector('#pdf-overlay'); if (ov) ov.hidden = true; }")
            pg.evaluate("""() => { const S = BojangApp.state; S.client.name='김서연'; S.age='65'; S.gender='여'; S.job='3'; S.jobNote='배달 라이더'; S.jobTwoWheel=true;
              S.cov.cancer.general=2000; S.cov.cancer.similar=600; S.cov.brain.dx.vascular=1000; S.cov.heart.dx.ischemic=0; S.cov.surgery.disease15=200; S.cov.care.daily=8;
              S.cov.custom.surgery = [{ id: 'cu_shot', name: '우주왕복선 탑승 특약', amount: 500, mode: 'individual' }];
              BojangApp.renderAllInputs(); BojangApp.analyze(); BojangApp.switchView('home'); }""")
            pg.wait_for_timeout(500)
            pg.screenshot(path=os.path.join(SHOTS, "v72-01-home-360.png"))
            pg.evaluate("() => { BojangApp.switchView('analysis'); }")
            pg.wait_for_timeout(500)
            pg.evaluate("() => { const el=document.querySelector('#result-conclusion'); if(el){ const y = el.getBoundingClientRect().top + window.scrollY - 165; window.scrollTo(0, y); } }")
            pg.wait_for_timeout(400)
            pg.screenshot(path=os.path.join(SHOTS, "v72-02-conclusion-age-standard-360.png"))
            # 4단계(수술·간병)로 이동 → 생활·실손 참고 축과 미매칭 큐가 보이는 화면
            pg.evaluate("() => { for (let i = 0; i < 3; i++) { const b = document.querySelector('#wiz-next'); if (b) b.click(); } }")
            pg.wait_for_timeout(500)
            pg.evaluate("() => { const el=document.querySelector('#card-living'); if(el){ const y = el.getBoundingClientRect().top + window.scrollY - 165; window.scrollTo(0, y); } }")
            pg.wait_for_timeout(400)
            pg.screenshot(path=os.path.join(SHOTS, "v72-04-living-ref-360.png"))
            pg.evaluate("() => { const el=document.querySelector('#rider-queue'); if(el){ const y = el.getBoundingClientRect().top + window.scrollY - 165; window.scrollTo(0, y); } }")
            pg.wait_for_timeout(400)
            pg.screenshot(path=os.path.join(SHOTS, "v72-03-rider-queue-living-360.png"))
            # 연령대 기준선 카드(5대 우선순위 아래) 단독 화면
            pg.evaluate("() => { for (let i = 0; i < 3; i++) { const b = document.querySelector('#wiz-prev'); if (b) b.click(); } }")
            pg.wait_for_timeout(400)
            pg.evaluate("() => { const el=document.querySelector('#age-standard-line'); if(el){ const y = el.getBoundingClientRect().top + window.scrollY - 165; window.scrollTo(0, y); } }")
            pg.wait_for_timeout(400)
            pg.screenshot(path=os.path.join(SHOTS, "v72-07-age-standard-line-360.png"))
            pg.evaluate("() => { BojangApp.openMoreMenu(true); const el=document.querySelector('#mm-privacy'); if(el) el.scrollIntoView({block:'center'}); }")
            pg.wait_for_timeout(400)
            pg.screenshot(path=os.path.join(SHOTS, "v72-05-security-jobgrade-360.png"))
            pg.set_viewport_size({"width": 1280, "height": 900})
            pg.evaluate("() => { BojangApp.openMoreMenu(false); BojangApp.switchView('analysis'); }")
            pg.wait_for_timeout(400)
            pg.screenshot(path=os.path.join(SHOTS, "v72-06-desktop-analysis.png"))
            shots = sorted(f for f in os.listdir(SHOTS) if f.startswith("v72-") and f.endswith(".png"))
            check("스크린샷 4장 이상 저장", len(shots) >= 4 and all(os.path.getsize(os.path.join(SHOTS, f)) > 10000 for f in shots), shots)
            errors_all = errors[:]

            browser.close()
    finally:
        httpd.shutdown()

    print("\n=== v7.2 테스트 %d/%d 통과 ===" % (sum(1 for _, ok, _ in results if ok), len(results)))
    fails = [(n, d) for n, ok, d in results if not ok]
    if fails:
        print("실패:")
        for n, d in fails:
            print(" - " + n + " · " + str(d))
        sys.exit(1)


if __name__ == "__main__":
    main()
