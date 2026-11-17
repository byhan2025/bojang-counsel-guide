#!/usr/bin/env python3
"""보장분석 라이프 리포트 v6.1 — 통합 고도화 · 치명결함 · 보안 검증.

실행: python3 tests/test_v6_1.py

검증 축
  A. 버전 v6.1 통일(version.js · sw · manifest · index · README) · 단일 HTML 빌드
  B. S1 파생값 단일화(effSum/effCnt/gapOf) — 직접 기재 담보가 1·10·30장·PDF에 같은 값으로
  C. S2 고지의무 표준 5문항 단일 엔진 — 4케이스 판정(혈압약·2년 수술·5년 전 고혈압·1년 재검사),
     도구 탭과 6단계가 같은 state.disc를 쓰는지
  D. 1~5종 수술비 종수(1종 소액~5종 고액) · 뇌·심장 90일 면책 문구 정정
  E. 특정순환계(3~5종) 통합 담보 — 뇌·심장 양쪽 축 동시 반영·금액 이중 계산 없음
  F. S3 공백/가장 얇은 축 분리 · 간병 요건 미확인 상한
  G. S4 배분 라벨 · 실손 2세대 초기/후기 · 4세대 재가입 · 5세대 제외 4항목
  H. S5 계약 외 N건 · 2/29 상령일 · I64 · 23p 제목 · 샘플 배지
  I. P1 판례·662조·I20.1·직업급수 · 간병 v2 · 반론 화법 · 과보장 5종 · 신규 기능 2종
  J. UX 가림 모드 전 영역 · 폰트 12px 이상 · 360px 넘침 0
  K. 보안 — billing test 우회 차단 · QR peek rate limit/폐기 · approve2 transcript · RLS 쓰기 제거 · fail-closed
  L. PDF 3종 넘침 0 · 스크린샷 저장
  M. v6.1.1 — 수술비 종수 역전·3·3·5 잔재 · 가림 모드 입력창/PDF · 소멸시효 통일 · live 폰트 · QR 세션 한정 폐기 · 비추출 키
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
OUT = os.path.join(ROOT, "tests", "out")
SHOTS = "/workspace/reports/bojang-guide/v6.1"
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


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass


def start_server():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d" % httpd.server_address[1]


STATE = """() => {
  const s=BojangApp.state;
  s.sample=false;
  s.client={ name:'김민수', consultant:'보반 과장', birth:'1983-03-12', dateLabel:'2026년 11월 17일' };
  s.age='40'; s.gender='남'; s.job='2'; s.silson='2'; s.silson2='early'; s.premium=28;
  s.cov={ cancer:{ general:3000, similar:0, treatment:{surgery:500,drug:0,radio:0,icu:0,extra:0}, recur:false },
    brain:{ dx:{vascular:0,stroke:2000,bleed:1000}, treat:{lysis:0,surgery:0,icu:0} },
    heart:{ dx:{ischemic:2000,ami:0}, treat:{lysis:0,surgery:0,icu:0} },
    surgery:{ disease:30, disease15:100, diseaseNdae:0, diseaseNonPay:0, injury:0, injury15:0 },
    care:{ daily:0, nDaily:0, basis:'unknown', family:'conditional', nursing:false, ltc:false, mode:'normal' },
    custom:{ cancer:[{id:'c1',name:'표적항암약물허가치료비',amount:2000,mode:'individual'}],
      brain:[{id:'c2',name:'특정순환계질환(3~5종) 주요치료비',amount:3000,mode:'bundle'}],
      heart:[], surgery:[], care:[] } };
  s.contracts=Array.from({length:12},(_,i)=>({insurer:'보험사'+(i+1), product:'상품 '+(i+1), premium:2+i, pay: i%3?'납입중':'납입완료', maturity: i%4?'100세':'90세', renew: i%2===0 }));
  s.family=['cancer']; s.flags={renew:true};
  s.disc={ m3_med:true };
  BojangModel.normalizeState(s);
  BojangApp.renderAllInputs(); BojangApp.analyze();
}"""


def main():
    httpd, base = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"),
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1,
                                      permissions=["clipboard-read", "clipboard-write"])
            pg = ctx.new_page()
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.goto(base + "/index.html")
            pg.wait_for_timeout(900)
            pg.evaluate("() => { const b=document.querySelector('#tour-invite-later'); if(b) b.click(); }")

            # =========================================================
            # A. 버전
            # =========================================================
            ver = read(os.path.join(ROOT, "version.js"))
            # v6.2 — 버전 검사는 version.js 상수를 기준으로 읽습니다(이후 버전에서도 회귀 검사로 유지)
            VER = (re.findall(r"const APP_VERSION = '([^']+)'", ver) or [""])[0]
            check("version.js 단일 상수 선언", len(re.findall(r"const APP_VERSION = '([^']+)'", ver)) == 1, VER)
            check("version.js 버전 형식", bool(re.fullmatch(r"v\d+\.\d+(\.\d+)?", VER)), VER)
            check("window.APP_VERSION = " + VER, pg.evaluate("() => window.APP_VERSION") == VER, pg.evaluate("() => window.APP_VERSION"))
            check("sw 캐시 bojang-guide-" + VER, ("const CACHE = 'bojang-guide-%s';" % VER) in read(os.path.join(ROOT, "sw.js")))
            check("manifest " + VER, VER in read(os.path.join(ROOT, "manifest.json")))
            check("README v6.1 절", "## v6.1에서 달라진 것" in read(os.path.join(ROOT, "README.md")))
            html = read(os.path.join(ROOT, "index.html"))
            check("index — v6.0 표기 잔재 0", "v6.0" not in html, "v6.0" in html)
            check("index — v6.1 기준점 문구", "v6.1 기준점" in html)

            # =========================================================
            # B. S1 파생값 단일화
            # =========================================================
            pg.evaluate(STATE)
            pg.wait_for_timeout(800)
            s1 = pg.evaluate("""() => {
              const s = BojangApp.state;
              s.cov.cancer.general = 0; s.cov.cancer.similar = 0;
              s.cov.cancer.treatment = {surgery:0,drug:0,radio:0,icu:0,extra:0};
              s.cov.brain.treat = {lysis:0,surgery:0,icu:0};
              s.cov.heart.treat = {lysis:0,surgery:0,icu:0};
              s.cov.custom = { cancer:[{id:'a',name:'표적항암약물허가치료비',amount:2000,mode:'individual'}],
                brain:[{id:'b',name:'특정순환계질환(3~5종) 주요치료비',amount:3000,mode:'bundle'}], heart:[], surgery:[], care:[] };
              const m = BojangModel.full(s);
              const cr = m.rows.find(x=>x.item.key==='cancer');
              const tp = cr.r.parts.find(p=>p.key==='treatment');
              const br = m.rows.find(x=>x.item.key==='brain'), hr = m.rows.find(x=>x.item.key==='heart');
              const btp = br.r.parts.find(p=>p.key==='treat'), htp = hr.r.parts.find(p=>p.key==='treat');
              const gapsTreat = cr.gaps.find(g=>g.label==='암 주요치료비 5종');
              return { eff: BojangModel.effSum(tp), cnt: BojangModel.effCnt(tp), level: cr.level,
                gapNeed: gapsTreat && gapsTreat.need, bTreat: BojangModel.effSum(btp), hTreat: BojangModel.effSum(htp),
                hFill: Math.round(btp.fill*100), heartFill: Math.round(htp.fill*100),
                bCross: btp.crossVal, hCross: htp.crossVal, total: m.totalSum };
            }""")
            check("S1 직접 기재 합계 = 2,000", s1["eff"] == 2000, s1)
            check("S1 직접 기재 종수 = 1", s1["cnt"] == 1, s1["cnt"])
            check("S1 부족분이 실효값 기준(2,500)", s1["gapNeed"] == 2500, s1["gapNeed"])
            check("S1 일반암 0원 → 공백 위험", s1["level"] == "gap", s1["level"])
            check("S1 통합 담보가 뇌 치료비 축 반영", s1["bTreat"] == 3000, s1["bTreat"])
            check("S1 통합 담보가 심장 축에도 반영(교차)", s1["hCross"] == 3000 and s1["heartFill"] > 0, [s1["hCross"], s1["heartFill"]])
            check("S1 금액 이중 계산 없음(심장 own=0)", s1["hTreat"] == 0, s1["hTreat"])

            pg.evaluate(STATE)
            pg.wait_for_timeout(700)
            deck7 = pg.evaluate("""() => {
              BojangDeck.show(BojangApp.state); BojangDeck.goTo(7, true);
              const el = document.querySelector('.slide[data-no="7"]');
              return el ? el.innerText : '';
            }""")
            check("S1 고객 7p — 치료비 2,500·2/5", "2,500만원" in deck7 and "2/5" in deck7, deck7[:120])
            check("S1 고객 7p — '없음 100%' 모순 없음", "없음 100%" not in deck7)
            check("S1 고객 7p — 직접 기재 표기", "직접 기재" in deck7)

            # =========================================================
            # C. S2 고지 단일 엔진
            # =========================================================
            prof = read(os.path.join(ROOT, "content.js"))
            check("S2 표준 5문항 — 투약·상시복용 문항", "m3_med" in prof and "m3_daily" in prof and "상시 복용" in prof)
            check("S2 2년 문항", "y2_inop" in prof and "2년" in prof)
            check("S2 10대 질병 10개", "DISCLOSURE_MAJOR10" in prof and prof.count("label: '") >= 10)
            cases = pg.evaluate("""() => {
              const J = (d) => BojangModel.disclosureJudge({ disc: d });
              return {
                med: J({ m3_med: true }).code,
                two: J({ y2_inop: true }).code,
                htn: J({ y5m_htn: true }).code,
                y1: J({ y1_test: true }).label,
                none: J({}).code,
                legacy: J({ d3_dx: true }).code
              };
            }""")
            check("S2 혈압약(3개월 투약) → 3·2·5 검토", cases["med"] == "simple325", cases["med"])
            check("S2 2년 이내 입원·수술 → 3·2·5·3·5·5 모두 불가", cases["two"] == "review", cases["two"])
            check("S2 5년 전 고혈압 → 일반 고지·간편 3·2·5 검토", cases["htn"] == "simple325", cases["htn"])
            check("S2 1년 재검사 → 3·5·5가 아니라 3·2·5", "3·2·5" in cases["y1"], cases["y1"])
            check("S2 입력 없음 → 표준체(입력 기준)", cases["none"] == "standard", cases["none"])
            check("S2 v6.0 키(d3_dx) 호환", cases["legacy"] in ("hold", "simple325"), cases["legacy"])

            # 도구 탭 ↔ 6단계 같은 저장소
            pg.evaluate("() => BojangApp.switchView('disclose')")
            pg.wait_for_timeout(400)
            pg.evaluate("() => { const b=document.querySelector(\"#disc-tool [data-disc='m3_dx']\"); if (b) b.click(); }")
            pg.wait_for_timeout(400)
            same = pg.evaluate("""async () => {
              /* v7.2 — 세션은 AES-GCM 암호화되어 저장됩니다. 복호화해서 확인합니다. */
              const raw = JSON.parse(localStorage.getItem('bojang.session.v4') || 'null');
              const S = window.BojangSecure;
              const obj = (S && S.isEncrypted(raw)) ? await S.decrypt(raw) : raw;
              return { state: !!BojangApp.state.disc.m3_dx,
                step6: !!document.querySelector('#disclosure-checks [data-disc="m3_dx"].is-on'),
                saved: !!(obj && obj.disc && obj.disc.m3_dx === true),
                encrypted: !!(S && S.isEncrypted(raw)) };
            }""")
            check("S2 도구 탭 체크 → state.disc", same["state"], same)
            check("S2 도구 탭 체크 → 6단계도 켜짐", same["step6"], same)
            check("S2 도구 탭 체크 → 저장", same["saved"], same)
            pg.evaluate("() => { const b=document.querySelector('#disc-reset'); if (b) b.click(); }")
            pg.wait_for_timeout(200)

            # =========================================================
            # D. 1~5종 · 90일
            # =========================================================
            check("D 1종 소액·5종 고액(가이드)", "1종(내시경·카테터 등 소액)" in prof and "5종(개두·개흉·개복 등 대수술)" in prof)
            check("D 1종 고액 표기 잔재 0", "1종 고액" not in prof.replace("1종 소액 ~ 5종 고액", ""))
            check("D 뇌 90일 면책 없음", "뇌는 90일 면책이 없습니다" in prof)
            check("D 심장 90일 면책 없음", "심장은 90일 면책이 없습니다" in prof)
            check("D 암은 90일 면책 유지", "보장개시일 = 계약일 또는 90일 경과" in prof)

            # =========================================================
            # E. S3 위험도
            # =========================================================
            s3 = pg.evaluate("""() => {
              const J = (patch) => { const base = Object.assign({}, BojangApp.state); delete base.lastResult; const s = JSON.parse(JSON.stringify(base)); patch(s); const m = BojangModel.full(s);
                return { rows: m.rows.map(r=>[r.item.key, r.level, r.pct]), thinnest: m.thinnest && m.thinnest.item.key, first: m.first && m.first.item.key }; };
              const a = J(s => { s.cov.cancer.general = 0; s.cov.cancer.similar = 500; });
              const b = J(s => { s.cov.care.daily = 0; s.cov.care.nDaily = 10; s.cov.care.basis = 'unknown'; });
              return { cancer: a.rows.find(x=>x[0]==='cancer'), care: b.rows.find(x=>x[0]==='care'), thinFirst: [a.thinnest, a.first] };
            }""")
            check("S3 일반암 0 + 유사암 500 → 공백", s3["cancer"][1] == "gap", s3["cancer"])
            check("S3 간병 요양만 + 기준 미확인 → 70% 이하", s3["care"][2] <= 70, s3["care"])
            check("S3 thinnest ≠ first 분리", s3["thinFirst"][0] != s3["thinFirst"][1], s3["thinFirst"])

            # =========================================================
            # F. S4 배분·실손
            # =========================================================
            pg.evaluate("() => { BojangDeck.goTo(5, true); }")
            pg.wait_for_timeout(250)
            d5 = pg.evaluate("() => document.querySelector('.slide[data-no=\"5\"]').innerText")
            check("S4 5p 배분 — '이 고객의 배분이 아님' 명시", "이 고객의 현재 배분이 아닙니다" in d5, d5[:80])
            check("S4 5p 배분 — 권장 예시 라벨", "권장 배분" in d5 or "권장 예시" in d5)
            pg.evaluate("() => BojangDeck.goTo(26, true)")
            pg.wait_for_timeout(250)
            d26 = pg.evaluate("() => document.querySelector('.slide[data-no=\"26\"]').innerText")
            check("S4 26p 2세대 초기/후기 구분", "초기 2세대" in d26 and "2013.4" in d26, d26[:100])
            check("S4 26p 철회 조건", "6개월" in d26 and "무사고" in d26)
            check("S4 26p 실손 시뮬레이터", pg.is_visible("#ss-out") and "5세대에서 새로 비는 금액" in d26)
            sim = pg.evaluate("""() => { const i=document.getElementById('ss-dose'); i.value='20'; i.dispatchEvent(new Event('input',{bubbles:true}));
              return document.getElementById('ss-out').innerText; }""")
            check("S4 시뮬레이터 즉시 반영", "5세대 자기부담" in sim and sim != d26, sim[:80])
            sil4 = pg.evaluate("""() => { const s=BojangApp.state; s.silson='4'; BojangApp.renderAllInputs(); const m=BojangModel.full(s);
              return m.checkpoints.map(c=>c.title).join(' | '); }""")
            check("S4 4세대 재가입 안내", "재가입" in sil4, sil4[:100])
            sil5 = pg.evaluate("""() => { const s=BojangApp.state; s.silson='5'; const m=BojangModel.full(s);
              return m.checkpoints.map(c=>c.body).join(' | '); }""")
            check("S4 5세대 제외 4항목", "보장 제외" in sil5 and "도수" in sil5 and "미등재" in sil5, sil5[:100])

            # =========================================================
            # G. S5 보고서
            # =========================================================
            pages = pg.evaluate("""async () => {
              const out = {};
              for (const k of ['summary','detail','advisor']) {
                const b = await BojangApp.buildPdfBlob(k);
                out[k] = { pages: b.pages, overflow: b.overflow.length };
              }
              return out;
            }""")
            check("S5 계약 외 N건 인쇄", pg.evaluate("""() => { const b=BojangReport.build('detail', BojangApp.state);
              const s=new PDFKit.Sheet(); let txt='';
              const orig=s.text.bind(s); s.text=(t,...a)=>{ txt+=String(t)+' '; return orig(t,...a); };
              b.pages[2](s,2); return txt.indexOf('외 7건')>=0; }"""), "")
            check("S5 2/29 상령일 8/29", pg.evaluate("() => BojangModel.nextAgeDay('1990-02-29', new Date(2027,1,1)).label") == "2027-08-29",
                  pg.evaluate("() => BojangModel.nextAgeDay('1990-02-29', new Date(2027,1,1)).label"))
            check("S5 I64 표준 분류 제외 표기", "표준 뇌졸중 분류표" in prof and "I64 제외" in prof)
            pg.evaluate("() => { BojangApp.state.sample = true; BojangApp.renderAllInputs(); BojangDeck.refresh(BojangApp.state, {reset:true}); BojangDeck.show(BojangApp.state); BojangDeck.goTo(1,true); }")
            pg.wait_for_timeout(300)
            check("S5 30장 샘플 배지", "샘플 데이터" in pg.evaluate("() => document.querySelector('.slide[data-no=\"1\"]').innerText"))
            pg.evaluate("() => { BojangApp.state.sample = false; }")
            check("S5 고객 23p 제목", "매일 나가는 여섯 칸" in pg.evaluate("() => { BojangDeck.refresh(BojangApp.state,{reset:true}); BojangDeck.goTo(23,true); return document.querySelector('.slide[data-no=\"23\"]').innerText; }"))

            # =========================================================
            # H. P1 전문성 + 신규 기능
            # =========================================================
            check("H 판례 결론(일반암 기준·차액)", "일반암 기준으로 지급" in prof and "차액" in prof and "2023다250746" in prof)
            check("H 상법 662조", "상법 제662조" in prof)
            check("H I20.1 변이형 협심증", "I20.1" in prof and "변이형 협심증" in prof)
            check("H 기계적 혈전제거술 구분", "기계적 혈전제거술" in prof)
            check("H 상해 직업급수 비례보상", "직업급수" in prof and "비례보상" in prof)
            check("H 간병 v2 — 시간제/금액제", "CARE_RATES" in prof and "하루 8시간" in prof)
            check("H 간병 v2 — 통합병동·사설 실손 불가", "2만 3,620" in prof and "사설 간병비는 실손 청구가 불가" in prof)
            check("H 반론 — '저도 같은 자리면' 제거", "저도 같은 자리면" not in read(os.path.join(ROOT, "content.js")) and "저도 같은 자리면" not in read(os.path.join(ROOT, "playbook.js")))
            check("H 팔지 않는 상담(90%)", "SELL_LESS" in prof and "90%" in prof and "추가 가입을 권하지 않습니다" in prof)
            check("H 과보장 5종", "OVER_COVERAGE" in prof)
            tl = pg.evaluate("() => { const t=BojangModel.oneTimeTimeline(BojangApp.state); return { once: t.totals.once, annual: t.totals.annual, ratio: t.ratio }; }")
            check("H 1회한 vs 연1회한 10년 10배", tl["annual"] == tl["once"] * 10 and tl["ratio"] == 10, tl)
            pg.evaluate("() => BojangDeck.goTo(11, true)")
            pg.wait_for_timeout(250)
            check("H 11p 타임라인 표", "1회한 vs 연 1회한" in pg.evaluate("() => document.querySelector('.slide[data-no=\"11\"]').innerText"))
            ss = pg.evaluate("() => BojangModel.silsonCompare({dose:12,dosePrice:15,shot:6,shotPrice:20,mri:2,mriPrice:60})")
            check("H 실손 시뮬 — 5세대 도수·주사 0원", ss["five"]["excluded"] == 300 and ss["gap"] > 0, ss["five"])

            # =========================================================
            # I. UX · 가림 모드 · 폰트 · 360
            # =========================================================
            pg.evaluate("() => { BojangDeck.show(BojangApp.state); BojangSmartKey.privacy.setEnabled(true); }")
            pg.wait_for_timeout(600)
            masked_deck = pg.evaluate("() => { BojangDeck.goTo(1,true); return document.querySelector('.slide[data-no=\"1\"]').innerText; }")
            check("I 가림 — 고객 화면 실명 마스킹", "김민수" not in masked_deck and "김*수" in masked_deck, masked_deck[:60])
            pg.evaluate("() => { BojangDeck.hide(); BojangApp.switchView('live'); }")
            pg.wait_for_timeout(700)
            masked_live = pg.evaluate("() => document.querySelector('#view-live').innerText")
            check("I 가림 — 라이브 대본 실명 마스킹", "김민수" not in masked_live and "김*수" in masked_live, masked_live[:80])

            # v6.1.1 — 입력창(고객명 <input>)까지 가림
            pg.evaluate("() => { BojangDeck.hide(); BojangApp.switchView('analysis'); }")
            pg.wait_for_timeout(400)
            masked_input = pg.evaluate("""() => {
              BojangSmartKey.privacy.setEnabled(true);
              BojangApp.renderAllInputs();
              BojangSmartKey.privacy.refresh();
              const el = document.querySelector('#client-name');
              const q = document.querySelector('#q-name');
              return { client: el ? el.value : null, quick: q ? q.value : null, state: BojangApp.state.client.name };
            }""")
            check("I 가림 — 고객명 입력창 마스킹", masked_input["client"] == "김*수" and masked_input["state"] == "김민수", masked_input)
            check("I 가림 — 간편 입력창도 마스킹", masked_input["quick"] in ("김*수", ""), masked_input)
            check("I 가림 — 원문 데이터 무손상", masked_input["state"] == "김민수", masked_input["state"])
            focus_val = pg.evaluate("""() => {
              const el = document.querySelector('#client-name');
              el.scrollIntoView({block:'center'});
              el.click(); el.focus(); const onFocus = el.value;
              el.blur(); BojangSmartKey.privacy.syncInputs();
              return { onFocus, onBlur: el.value };
            }""")
            check("I 가림 — 포커스 시 원문·블러 시 재마스킹", focus_val["onFocus"] == "김민수" and focus_val["onBlur"] == "김*수", focus_val)

            # v6.1.1 — 가림 모드 ON이면 1·10·30장 PDF 본문·머리글·꼬리글도 마스킹
            pdf_mask = pg.evaluate("""() => {
              const out = {};
              ['summary','detail','advisor'].forEach((k) => {
                const b = BojangReport.build(k, BojangApp.state);
                let txt = '';
                b.pages.forEach((fn, i) => {
                  const sh = new PDFKit.Sheet();
                  const ot = sh.text.bind(sh), op = sh.para.bind(sh);
                  sh.text = (t, ...a) => { txt += String(t) + ' '; return ot(t, ...a); };
                  sh.para = (t, ...a) => { txt += String(t) + ' '; return op(t, ...a); };
                  fn(sh, i + 1);
                });
                out[k] = { real: txt.indexOf('김민수') >= 0, masked: txt.indexOf('김*수') >= 0, pages: b.pages.length, model: b.m.client.name };
              });
              return out;
            }""")
            for k, v in pdf_mask.items():
                check("I 가림 — %s PDF 실명 없음" % k, not v["real"] and v["masked"] and v["model"] == "김*수", v)
            check("I 가림 — PDF 페이지 수 유지", [v["pages"] for v in pdf_mask.values()] == [1, 10, 30], [v["pages"] for v in pdf_mask.values()])

            restored = pg.evaluate("""() => {
              BojangSmartKey.privacy.setEnabled(false);
              return { value: document.querySelector('#client-name').value, state: BojangApp.state.client.name };
            }""")
            check("I 가림 해제 — 입력창 원문 복원", restored["value"] == "김민수" and restored["state"] == "김민수", restored)
            fonts = pg.evaluate("""() => {
              BojangApp.switchView('client'); BojangDeck.show(BojangApp.state);
              const out = {};
              [7,11,23,26,30].forEach((n) => {
                BojangDeck.goTo(n, true);
                const el = document.querySelector('.slide[data-no="'+n+'"] .sl-inner');
                const p = el.querySelector('.sl-note, .t5-l, .ot-note, .ss-gap, .care-card .cc-note, .today-one p');
                out[n] = p ? parseFloat(getComputedStyle(p).fontSize) : 0;
              });
              return out;
            }""")
            check("J 고객 화면 본문 폰트 12px 이상", all(v >= 12 for v in fonts.values()), fonts)
            pg.evaluate("() => BojangDeck.hide()")
            pg.close()

            pg2 = ctx.new_page()
            pg2.set_viewport_size({"width": 360, "height": 740})
            pg2.goto(base + "/index.html")
            pg2.wait_for_timeout(900)
            pg2.evaluate("() => { const b=document.querySelector('#tour-invite-later'); if(b) b.click(); }")
            pg2.evaluate(STATE)
            pg2.wait_for_timeout(700)
            pg2.evaluate("() => BojangDeck.show(BojangApp.state)")
            pg2.wait_for_timeout(400)
            over = []
            for no in (7, 11, 23, 26, 30):
                pg2.evaluate("(n) => BojangDeck.goTo(n, true)", no)
                pg2.wait_for_timeout(220)
                o = pg2.evaluate("""() => { const el=document.querySelector('.slide.is-current .sl-inner');
                  let xover=0; el.querySelectorAll('*').forEach(e=>{const b=e.getBoundingClientRect(); const ib=el.getBoundingClientRect();
                  if (b.width && (b.right>ib.right+1 || b.left<ib.left-1)) xover++;});
                  return { sw:el.scrollWidth, cw:el.clientWidth, xover }; }""")
                over.append((no, o))
            check("J 360px 가로 넘침 0", all(o["xover"] == 0 and o["sw"] <= o["cw"] + 2 for _, o in over), over)
            pg2.screenshot(path=os.path.join(SHOTS, "deck360-26.png"))

            # =========================================================
            # K. 보안
            # =========================================================
            billing = read(os.path.join(ROOT, "supabase/functions/billing-subscribe/index.ts"))
            check("K billing — non-prod 환경 게이트", "function testModeAllowed" in billing and "nonProdEnv" in billing)
            check("K billing — test 우회 403", "test_bypass_blocked" in billing and "403" in billing)
            check("K billing — 클라이언트 test 값만으로 불가", 'String(body.test ?? "") === "true"' in billing and "&& nonProdEnv()" in billing)
            chal = read(os.path.join(ROOT, "supabase/functions/qr-auth-challenge/index.ts"))
            check("K QR — peek rate limit", "PEEK_LIMIT_PER_MIN" in chal and "peekGuard" in chal)
            check("K QR — 시도 초과 시 챌린지 폐기", "discarded" in chal and 'update({ status: "discarded" })' in chal)
            appr = read(os.path.join(ROOT, "supabase/functions/qr-auth-approve/index.ts"))
            check("K approve — approve2 transcript", '"approve2"' in appr and "phonePubHash" in appr and "ctHash" in appr)
            mig = read(os.path.join(ROOT, "supabase/migrations/003_smartkey_devices.sql"))
            check("K RLS — 기기 직접 쓰기 제거", "devices_own_read" in mig and "for all using (user_id = auth.uid()) with check" not in mig)
            check("K RLS — 세션 직접 쓰기 제거", "sessions_own_read" in mig and "revoke insert, update, delete on public.pc_sessions" in mig)
            check("K RLS — discarded 상태", "discarded" in mig)
            sk = read(os.path.join(ROOT, "smartkey.js"))
            check("K fail-closed — 데모 모드만 모의", "failClosed()" in sk and "demo()" in sk and "viaServer" in sk)
            check("K 개인키 — localStorage 평문 저장 없음", "priv: priv" not in sk and "key_store" in sk and "'idb'" in sk and "devicePriv" in sk)
            check("K PIN — 생체/파일 차단", "이 환경(file://)에서는 PIN 승인을 사용할 수 없습니다" in sk)
            check("K PIN — 5회/30초 제한", "_pinTries" in sk)
            check("K PIN — 최초 확인 단계(UI)", "submitPin" in sk and "PIN을 이 값으로 설정합니다" in sk)

            # =========================================================
            # M. v6.1.1 — 회의실 지적 잔여 결함 4종
            # =========================================================
            pb = read(os.path.join(ROOT, "playbook.js"))
            check("M 수술비 종수 — 복강경/개복 역전 제거", "5종 안팎" not in pb and "복강경은 3종 안팎" in pb and "개복으로 전환하면 5종" in pb)
            check("M 수술비 종수 — 1종 소액·5종 고액 기준 유지", "1종(내시경·카테터)일수록 소액" in pb and "5종(개두·개흉·개복)일수록 고액" in pb)
            check("M 수술비 종수 — 관혈=저종 역전 0", "관혈)에 해당하는 경우가 많음" not in prof and "관혈 수술 — 상해 1~2종" not in prof)
            rd335 = [ln for ln in read(os.path.join(ROOT, "README.md")).splitlines() if "3·3·5" in ln]
            check("M 3·3·5 표기 잔재 0", "3·3·5" not in html and all("잔재" in ln for ln in rd335), rd335)
            check("M 간편심사 현행 표기(3·2·5 / 3·5·5)", "3·2·5" in html and "3·5·5" in html)
            lv = read(os.path.join(ROOT, "live.js"))
            check("M 라이브 대본 인라인 폰트 12px 이상", "font-size:10.5px" not in lv and "font-size:11.5px" not in lv and "font-size:12.5px" in lv)
            check("M content 405 — 약관 수술 정의·분류표 맥락", '"수술"이 아닌 "처치"로 분류되는 경우가 많아' not in prof and "수술분류표" in prof)
            check("M 소멸시효 기준 통일(상법 제662조)", "진단일부터 3년" not in prof and "수술일 기준으로 관리" not in prof and prof.count("상법 제662조") >= 4, prof.count("상법 제662조"))
            check("M QR — 전역 폐기 제거·IP 세션 한정", 'eq("issued_at", tenAgo)' not in chal and '.in("id", ids)' in chal and "smartkey.challenge" in chal)
            check("M QR — 차단은 요청 IP 단위", "qr-peek|" in chal and "PEEK_FAIL_LIMIT_10MIN" in chal)
            check("M smartkey — 비추출 키 우선 생성", "genEcdsaNonextractable" in sk and "securityWarn" in sk and "mem-extractable" in sk)
            check("M smartkey — 폴백 시 보안 경고 노출", "보안 경고" in sk and "securityWarnings" in sk)

            # =========================================================
            # L. PDF · 빌드
            # =========================================================
            check("L 1장 PDF 1p · 넘침 0", pages["summary"]["pages"] == 1 and pages["summary"]["overflow"] == 0, pages["summary"])
            check("L 10장 PDF 10p · 넘침 0", pages["detail"]["pages"] == 10 and pages["detail"]["overflow"] == 0, pages["detail"])
            check("L 30장 PDF 30p · 넘침 0", pages["advisor"]["pages"] == 30 and pages["advisor"]["overflow"] == 0, pages["advisor"])
            single = os.path.join(ROOT, "dist", "bojang-guide.single.html")
            if os.path.exists(single):
                sh = read(single)
                check("L 단일 HTML — 버전 표기", VER in sh, VER)
                check("L 단일 HTML — 표시 버전 " + VER,
                      ('content="%s"' % VER) in sh and "<title>" in sh and (VER + " · 고객 맞춤형") in sh, VER)
            else:
                check("L 단일 HTML 생성 필요", False, "build_single.py 미실행")
            check("J 콘솔 오류 0", len(errors) == 0, errors[:3])

            browser.close()
    finally:
        httpd.shutdown()

    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print("\n=== v6.1 테스트 %d/%d 통과 ===" % (passed, total))
    fails = [r for r in results if not r[1]]
    if fails:
        print("\n실패:")
        for n, _, d in fails:
            print(" -", n, "·", d)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
