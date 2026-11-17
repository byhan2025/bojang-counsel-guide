#!/usr/bin/env python3
"""보장분석 라이프 리포트 v7.1 — 공공데이터(k-skill) 실무 연동 · 이 고객 다음 할 일 · v7.0 결함 3건.

실행: python3 tests/test_v7_1.py

검증 축
  A. 버전 v7.1 통일(version.js · sw · manifest · index · README · 단일 HTML)
  B. KCD 코드 칩 클릭 — data-cm-code → dataset.cmCode 로 실제 클릭 매칭이 동작
  C. 간병인 사용일당 표기 통일 + 8시간제·6시간제·구 계약 금액제(8만원 미만 50%) 3분기
  D. 고객 표지(01/30) 360px — 플로팅 버튼(가림 모드·자물쇠)과 하단 문구 비겹침 · 스크롤 없이 한 장
  E. 결과 화면 '이 고객 다음 할 일' 띠 — 큰 글씨 날짜·D-day · 없을 때 계약일 유도 · 공휴일 보정
  F. 복용약 고지 누락 체크 — 내장 사전·질환군·문항 상태·기간 분기·오프라인(외부 요청 0)
  G. 맞춤 공식 통계 — 출처·기준연도·대상 1줄 고정 · 성별·가족력·연령대 반영 · 약관 괴리 5건
  H. 특일 달력 — 2026·2027 확정/2028 잠정 · 직전·다음 영업일 보정 · 범위 밖 안내
  I. 화면 통합 — F 카드 3블록 · 3칸·3버튼 무손상 · 콘솔 오류 0(데스크톱·360px)
  J. 스크린샷 4종 → reports/bojang-guide/v7.1/
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
SHOTS = "/workspace/reports/bojang-guide/v7.1"
os.makedirs(OUT, exist_ok=True)
os.makedirs(SHOTS, exist_ok=True)

DISCLAIMER_CLAIM = "본 결과는 상담 참고용이며 최종 지급 여부는 상품 약관 및 보험사 심사에 따릅니다."

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


def main():
    httpd, base = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"),
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
            pg = ctx.new_page()
            errors, external = [], []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.on("request", lambda r: external.append(r.url) if not r.url.startswith(base) and not r.url.startswith("data:") else None)
            pg.goto(base + "/index.html")
            pg.wait_for_timeout(1000)
            pg.evaluate("() => { const b=document.querySelector('#tour-invite-later'); if(b) b.click(); }")

            # =========================================================
            # A. 버전
            # =========================================================
            ver = read(os.path.join(ROOT, "version.js"))
            VER = (re.findall(r"const APP_VERSION = '([^']+)'", ver) or [""])[0]
            check("version.js 단일 상수 v7.1", VER == "v7.1" and len(re.findall(r"const APP_VERSION = '([^']+)'", ver)) == 1, VER)
            check("window.APP_VERSION = v7.1", pg.evaluate("() => window.APP_VERSION") == "v7.1")
            check("sw 캐시 bojang-guide-v7.1", "const CACHE = 'bojang-guide-v7.1';" in read(os.path.join(ROOT, "sw.js")))
            check("sw — publicdata.js 캐시", "'./publicdata.js'" in read(os.path.join(ROOT, "sw.js")))
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest v7.1", "v7.1" in man.get("name", ""), man.get("name"))
            check("manifest — 공공데이터 설명", all(k in man.get("description", "") for k in ("공공데이터", "복용약", "공휴일")), man.get("description", "")[-60:])
            readme = read(os.path.join(ROOT, "README.md"))
            check("README v7.1 절", "## v7.1에서 달라진 것" in readme and "## v7.0에서 달라진 것" in readme)
            check("README — k-skill 공공데이터 절", "F · PUBLIC DATA" in readme and "약관 괴리" in readme)
            html = read(os.path.join(ROOT, "index.html"))
            check("index — title v7.1", "리포트 v7.1 ·" in html)
            check("index — meta app-version v7.1", '<meta name="app-version" content="v7.1">' in html)
            check("index — publicdata.js 로드", '<script src="./publicdata.js"></script>' in html)
            check("화면 표기 v7.1", pg.inner_text(".hh-ver").strip().startswith("v7.1"), pg.inner_text(".hh-ver"))

            # =========================================================
            # B. KCD 코드 칩 클릭 (data-cm-code → dataset.cmCode)
            # =========================================================
            src_cc = read(os.path.join(ROOT, "claimcheck.js"))
            check("claimcheck — dataset.cmCode 로 읽음", "b.dataset.cmCode" in src_cc)
            check("claimcheck — 없는 ccCode 참조 0", "dataset.ccCode" not in src_cc)
            pg.evaluate("() => BojangApp.switchView('toolkit')")
            pg.wait_for_timeout(400)
            pg.evaluate("""() => { const q=document.querySelector('#cc-q'); q.value='I63';
              q.dispatchEvent(new Event('input', {bubbles:true})); }""")
            pg.wait_for_timeout(250)
            chip_sel = '#cm-codes [data-cm-code="I63"]'
            check("claim — I63 코드 칩 렌더", pg.eval_on_selector_all(chip_sel, "els => els.length") == 1)
            pg.eval_on_selector(chip_sel, "el => el.scrollIntoView({block:'center'})")
            pg.click(chip_sel)
            pg.wait_for_timeout(350)
            clicked = pg.evaluate("""() => {
              const s = BojangClaimCheck.selected();
              const on = document.querySelector('#cm-codes [data-cm-code="I63"]');
              return { code: s ? s.code : null, name: s ? s.name : null,
                       on: on ? on.classList.contains('is-on') : false,
                       out: document.querySelector('#cc-out').innerText.slice(0, 80) };
            }""")
            check("칩 클릭 → 질환 선택됨(dataset.cmCode 수정)", clicked["code"] == "I63", clicked["code"])
            check("칩 클릭 → is-on 표시", clicked["on"] is True)
            check("칩 클릭 → 후보 담보 즉시 계산", "확인할 후보 담보" in clicked["out"] and "뇌혈관질환" in clicked["out"], clicked["out"])
            pg.evaluate("""() => { document.querySelector('[data-cc-doc="dx"]').click();
              document.getElementById('cc-rider-care').checked = true; BojangClaimCheck.run(); }""")
            pg.wait_for_timeout(250)
            claim_ui = pg.evaluate("() => ({ rows: Array.from(document.querySelectorAll('#cc-out .cm-row b')).map(e=>e.innerText), out: document.querySelector('#cc-out').innerText })")
            check("칩 클릭 후 서류 체크 → '서류 준비됨' 반영", "서류 준비됨" in claim_ui["out"], claim_ui["rows"][:4])

            # =========================================================
            # C. 간병인 사용일당 3분기
            # =========================================================
            check("표기 통일 — '간병인 사용일당' 사용", "간병인 사용일당" in src_cc)
            check("표기 통일 — '8만원 기준' 고정 표기 제거", "8만원 기준" not in html and "8만원 기준" not in src_cc)
            care = pg.evaluate("""() => {
              const C = BojangClaimCheck;
              const code = FC_CODES.find((c) => c.code === 'I63');
              const mk = (basis) => C.match({ code, docs: { dx: true, admit: true }, care: true, careBasis: basis });
              const rows = {};
              ['8', '6', 'old'].forEach((b) => {
                const r = mk(b);
                rows[b] = (r.rows.find((x) => x.kind === '간병') || {}).why || '';
              });
              return { rows, labels: Array.from(document.querySelectorAll('#cc-care-basis option')).map(o => [o.value, o.textContent]),
                       dambo: (mk('8').rows.find((x) => x.kind === '간병') || {}).dambo,
                       notes: mk('8').notes };
            }""")
            check("간병 3분기 — 8시간제 설명", "8시간" in care["rows"]["8"] and "가입금액" in care["rows"]["8"], care["rows"]["8"][:40])
            check("간병 3분기 — 6시간제 설명", "6시간" in care["rows"]["6"], care["rows"]["6"][:40])
            check("간병 3분기 — 구 계약 금액제 50% 감액", "8만원 미만" in care["rows"]["old"] and "50%" in care["rows"]["old"], care["rows"]["old"][:50])
            check("간병 — 지급기준 선택 3종", [o[0] for o in care["labels"]] == ["8", "6", "old"], care["labels"])
            check("간병 — 담보명 '간병인 사용일당'", care["dambo"] == "간병인 사용일당", care["dambo"])
            check("간병 — 메모에 시간제·금액제 구분", any("시간제" in n and "금액제" in n for n in care["notes"]), care["notes"][:2])

            # =========================================================
            # D. 고객 표지 플로팅 버튼 비겹침 (360px)
            # =========================================================
            pg.evaluate("() => { BojangApp.newConsult(); }")
            pg.wait_for_timeout(300)
            pg.evaluate("""() => {
              const S = BojangApp.state;
              S.client.name='김서연'; S.client.birth='1988-05-14'; S.age='30'; S.silson='4'; S.premium=19;
              S.cov.cancer.general=5000; S.cov.cancer.similar=1000;
              S.cov.brain.dx.vascular=2000; S.cov.heart.dx.ischemic=2000;
              S.cov.surgery.disease15=300; S.cov.care.daily=10;
              BojangApp.analyze(); }""")
            pg.set_viewport_size({"width": 360, "height": 740})
            pg.wait_for_timeout(300)
            pg.evaluate("""() => { BojangApp.state.view='client'; BojangDeck.show(BojangApp.state);
              const c=document.querySelector('#sk-privacy-chip'); if(c){c.hidden=false;} }""")
            pg.wait_for_timeout(500)
            cover = pg.evaluate("""() => {
              const r = (el) => el ? el.getBoundingClientRect().toJSON() : null;
              const inter = (a, b) => !!(a && b) && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
              const slide = document.querySelector('.slide[data-no="1"]');
              const foot = slide.querySelector('.cover-foot'), sample = slide.querySelector('.cover-sample');
              const chip = r(document.querySelector('#sk-privacy-chip')), fab = r(document.querySelector('#sk-lock-fab'));
              const stage = r(document.querySelector('#deck-stage'));
              const f = r(foot), s = r(sample);
              return { footIn: inter(f, chip) || inter(f, fab), sampleIn: inter(s, chip) || inter(s, fab),
                       scrollH: slide.scrollHeight, clientH: slide.clientHeight,
                       stageBottom: stage ? stage.bottom : null, chipTop: chip ? chip.top : null, fabTop: fab ? fab.top : null,
                       chip: chip, fab: fab, foot: f };
            }""")
            check("360px 표지 — 하단 문구 ↔ 가림 칩 비겹침", cover["footIn"] is False, cover["foot"])
            check("360px 표지 — 샘플 안내 ↔ 플로팅 비겹침", cover["sampleIn"] is False)
            check("360px 표지 — 스크롤 없이 한 장", cover["scrollH"] <= cover["clientH"] + 1, [cover["scrollH"], cover["clientH"]])
            check("360px — 플로팅 버튼이 덱 바 위(스테이지 안)", cover["chipTop"] is not None and cover["chipTop"] >= cover["stageBottom"] - 60, [cover["chipTop"], cover["stageBottom"]])
            pg.screenshot(path=os.path.join(SHOTS, "ui-cover-no-overlap.png"))
            check("스크린샷 ui-cover-no-overlap.png", os.path.getsize(os.path.join(SHOTS, "ui-cover-no-overlap.png")) > 10000)
            # 390px 도 같은 조건
            pg.set_viewport_size({"width": 390, "height": 844})
            pg.wait_for_timeout(350)
            cover390 = pg.evaluate("""() => {
              const r = (el) => el ? el.getBoundingClientRect().toJSON() : null;
              const inter = (a, b) => !!(a && b) && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
              const slide = document.querySelector('.slide[data-no="1"]');
              const foot = r(slide.querySelector('.cover-foot'));
              const chip = r(document.querySelector('#sk-privacy-chip')), fab = r(document.querySelector('#sk-lock-fab'));
              return { hit: inter(foot, chip) || inter(foot, fab), scrollH: slide.scrollHeight, clientH: slide.clientHeight };
            }""")
            check("390px 표지 — 비겹침·한 장", cover390["hit"] is False and cover390["scrollH"] <= cover390["clientH"] + 1, cover390)
            pg.evaluate("() => { BojangDeck.hide(); }")
            pg.set_viewport_size({"width": 360, "height": 740})

            # =========================================================
            # E. '이 고객 다음 할 일' 띠
            # =========================================================
            pg.evaluate("""() => { BojangApp.state.view='advisor'; BojangApp.switchView('analysis');
              BojangApp.state.client.contract=''; BojangApp.state.client.birth=''; BojangApp.renderNextAction(); }""")
            pg.wait_for_timeout(300)
            empty = pg.evaluate("""() => { const el=document.querySelector('#next-action');
              return { txt: el.innerText, hasInput: !!document.querySelector('#na-contract'), cls: el.className,
                       beforePost: (el.compareDocumentPosition(document.querySelector('#post-care')) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 }; }""")
            check("띠 — 상담 후 챙길 것 3칸 바로 위", empty["beforePost"] is True)
            check("띠 — 계약일 없을 때 입력 유도", "이 고객 다음 할 일" in empty["txt"] and "계약일" in empty["txt"] and empty["hasInput"], empty["txt"][:40])
            pg.evaluate("""() => { const S=BojangApp.state; S.client.contract='2026-08-20'; S.client.birth='1988-05-14';
              BojangApp.renderNextAction(); }""")
            pg.wait_for_timeout(300)
            strip = pg.evaluate("""() => {
              const A = BojangAftercare;
              const exp = A.calc({ contract: '2026-08-20', birth: '1988-05-14' });
              const el = document.querySelector('#next-action');
              const dateEl = el.querySelector('.na-date'), ddayEl = el.querySelector('.na-dday');
              return { txt: el.innerText, date: dateEl ? dateEl.innerText : null, dday: ddayEl ? ddayEl.innerText : null,
                       expDate: exp.nextCheck.date, expDday: A.date.ddayText(exp.nextCheck.days),
                       fontSize: dateEl ? parseFloat(getComputedStyle(dateEl).fontSize) : 0,
                       stateContract: BojangApp.state.client.contract,
                       acContract: (document.querySelector('#ac-contract') || {}).value || null };
            }""")
            check("띠 — '다음 점검' + 가장 가까운 점검일", "다음 점검" in strip["txt"] and strip["date"] == strip["expDate"], [strip["date"], strip["expDate"]])
            check("띠 — D-day 표기", strip["dday"] == strip["expDday"] and strip["dday"].startswith("D-"), strip["dday"])
            check("띠 — 날짜가 큰 글씨(20px 이상)", strip["fontSize"] >= 20, strip["fontSize"])
            check("띠 — 그다음 점검 병기", "그다음" in strip["txt"], strip["txt"][-40:])
            check("띠 — 계약일이 state 에 저장", strip["stateContract"] == "2026-08-20", strip["stateContract"])
            pg.evaluate("""() => { document.querySelector('#na-contract').value='2026-09-26';
              document.querySelector('#na-contract').dispatchEvent(new Event('change', {bubbles:true})); }""")
            pg.wait_for_timeout(350)
            holiday = pg.evaluate("""() => { const el=document.querySelector('#next-action');
              return { txt: el.innerText, contract: BojangApp.state.client.contract,
                       ac: (document.querySelector('#ac-contract')||{}).value,
                       fix: el.querySelector('.na-fix') ? el.querySelector('.na-fix').innerText : '' }; }""")
            check("띠 — 입력한 계약일이 툴킷 계약일과 동기화", holiday["ac"] == "2026-09-26" and holiday["contract"] == "2026-09-26", [holiday["ac"], holiday["contract"]])
            check("띠 — 공휴일과 겹치면 직전 영업일 병기", "직전 영업일" in holiday["fix"] and "2026-12-24" in holiday["fix"], holiday["fix"])
            pg.evaluate("() => document.querySelector('#next-action').scrollIntoView({block:'center'})")
            pg.wait_for_timeout(250)
            pg.screenshot(path=os.path.join(SHOTS, "ui-next-action-strip.png"))
            check("스크린샷 ui-next-action-strip.png", os.path.getsize(os.path.join(SHOTS, "ui-next-action-strip.png")) > 8000)

            # =========================================================
            # F. 복용약 고지 누락 체크
            # =========================================================
            med = pg.evaluate("""() => {
              const P = BojangPublicData;
              const one = P.drugs.search('아스피린');
              const brand = P.drugs.search('리바로');
              const t3 = P.drugs.check('아스피린', { period: '3m' });
              const tLong = P.drugs.check('씬지로이드', { period: 'long' });
              const vit = P.drugs.check('비타민', {});
              const multi = P.drugs.check('메트포르민, 자렐토, 모르는약', {});
              return {
                size: P.drugs.list.length,
                aspirin: one[0] ? [one[0].n, one[0].g] : null,
                brand: brand[0] ? [brand[0].n, brand[0].g] : null,
                t3: t3.groups.map(g => [g.label, g.items.map(i => [i.key, i.state])]),
                tLong: tLong.groups.map(g => g.items.map(i => [i.key, i.state])),
                vit: [vit.groups.map(g => g.label), vit.groups[0] ? vit.groups[0].items.length : null],
                unknown: multi.unknown,
                caution: (t3.groups[0] ? t3.groups[0].note : ''),
                disc: t3.disclaimer
              };
            }""")
            check("약 사전 — 70여 성분 이상", med["size"] >= 65, med["size"])
            check("약 → 아스피린 = 관상동맥(협심증·심근경색)", med["aspirin"] and med["aspirin"][1] == "cad", med["aspirin"])
            check("약 — 브랜드명(리바로)으로도 검색", med["brand"] and med["brand"][1] == "lipid", med["brand"])
            check("약 — 3개월 이내는 '상시 복용' 지금 확인", any(k == "m3_daily" and st == "now" for k, st in med["t3"][0][1]), med["t3"])
            check("약 — 1년 이상은 3개월 문항이 '지난 기간'", any(k == "m3_daily" and st == "past" for k, st in med["tLong"][0]), med["tLong"])
            check("약 — 영양제는 '고지 대상 아님'", med["vit"][0] and "고지 대상 아님" in med["vit"][0][0], med["vit"])
            check("약 — 사전에 없는 약은 따로 안내", med["unknown"] == ["모르는약"], med["unknown"])
            check("약 — '약만으로 고지 대상 아님' 경고 문구", "약만으로" in read(os.path.join(ROOT, "publicdata.js")))
            check("약 — 면책 문구", med["disc"] == DISCLAIMER_CLAIM, med["disc"][:30])

            ext_before = len(external)
            ui_med = pg.evaluate("""() => {
              BojangApp.switchView('toolkit');
              const q = document.querySelector('#pd-med-q');
              q.value = '메트포르민'; BojangPublicData.applyMeds();
              const sel = document.querySelector('#pd-med-period'); sel.value = '3m';
              sel.dispatchEvent(new Event('change', {bubbles:true}));
              return { out: document.querySelector('#pd-med-out').innerText, groups: document.querySelectorAll('#pd-med-out .pd-group').length,
                       chips: Array.from(document.querySelectorAll('#pd-med-out .pd-chip')).map(e => e.innerText) };
            }""")
            check("약 화면 — 질환군 카드·문항 칩 렌더", ui_med["groups"] >= 1 and len(ui_med["chips"]) >= 3, [ui_med["groups"], ui_med["chips"][:4]])
            check("약 화면 — 당뇨병 카드 + KCD", "당뇨병" in ui_med["out"] and "E10~E14" in ui_med["out"], ui_med["out"][:40])
            check("약 — 오프라인 기본(외부 요청 0)", len(external) == ext_before, external[:3])
            check("약 — 프록시 기본값 없음", pg.evaluate("() => BojangPublicData.proxy.get()") == "")

            # =========================================================
            # G. 맞춤 공식 통계 + 약관 괴리
            # =========================================================
            stats = pg.evaluate("""() => {
              const P = BojangPublicData;
              const male = P.stats.forClient({ age: '40', gender: '남', family: [] });
              const female = P.stats.forClient({ age: '40', gender: '여', family: ['cancer'] });
              const old = P.stats.forClient({ age: '70', gender: '여', family: ['dementia'] });
              return {
                n: male.cards.length,
                lines: male.cards.map(c => c.line),
                ids: male.cards.map(c => c.id),
                maleOwn: (male.cards.find(c => c.id === 'cancer') || {}).own,
                femaleOwn: (female.cards.find(c => c.id === 'cancer') || {}).own,
                famBadge: (female.cards.find(c => c.id === 'cancer') || {}).badge,
                famNote: female.famNote,
                ltcOld: (old.cards.find(c => c.id === 'ltc') || {}).relevance,
                ltcMid: (male.cards.find(c => c.id === 'ltc') || {}).relevance,
                gaps: male.gaps.map(g => [g.id, Object.keys(g)]),
                gapText: male.gaps.map(g => g.pub + ' ' + g.clause).join(' '),
                basis: male.basis
              };
            }""")
            check("통계 — 4종 카드", stats["n"] == 4 and set(stats["ids"]) == {"death", "cancer", "stroke", "ltc"}, stats["ids"])
            check("통계 — 모든 카드에 출처·기준연도·대상 1줄", all(("출처" in l and "기준연도" in l and "대상" in l) for l in stats["lines"]), stats["lines"][0])
            check("통계 — 남성 암 발생확률 44.6% 반영", "44.6" in (stats["maleOwn"] or ""), stats["maleOwn"])
            check("통계 — 여성 암 발생확률 38.2% 반영", "38.2" in (stats["femaleOwn"] or ""), stats["femaleOwn"])
            check("통계 — 가족력 암 배지 + 안내", stats["famBadge"] == "가족력" and "가족력" in (stats["famNote"] or ""), stats["famBadge"])
            check("통계 — 연령대 반영(70대는 장기요양 high)", stats["ltcOld"] == "high" and stats["ltcMid"] == "mid", [stats["ltcOld"], stats["ltcMid"]])
            check("약관 괴리 — 5건", len(stats["gaps"]) == 5, stats["gaps"])
            check("약관 괴리 — I65·I66·I20 병기", all(k in stats["gapText"] for k in ("I65", "I66", "I20")), stats["gapText"][:80])
            check("약관 괴리 — 공공통계 ↔ 약관 대조 문구", "약관" in stats["gapText"] and "공공 통계" in stats["gapText"] and "급성심근경색" in stats["gapText"], stats["gapText"][:40])
            check("통계 — 자체 우선순위 기준 명시", "자체 기준" in stats["basis"], stats["basis"][:40])
            ui_stat = pg.evaluate("""() => {
              BojangApp.state.age='60'; BojangApp.state.gender='여'; BojangApp.state.family=['dementia'];
              BojangPublicData.refresh();
              const el = document.querySelector('#pd-stat-out');
              return { txt: el.innerText, cards: el.querySelectorAll('.pd-stat').length, gaps: el.querySelectorAll('.pd-gap').length,
                       lines: el.querySelectorAll('.pd-stat-line').length, profile: el.querySelector('.pd-profile') ? el.querySelector('.pd-profile').innerText : '' };
            }""")
            check("통계 화면 — 카드 4 · 괴리 5 · 출처줄 4", ui_stat["cards"] == 4 and ui_stat["gaps"] == 5 and ui_stat["lines"] == 4, [ui_stat["cards"], ui_stat["gaps"], ui_stat["lines"]])
            check("통계 화면 — 고객 조건 표시", "60대 이상 여" in ui_stat["profile"] and "가족력" in ui_stat["profile"], ui_stat["profile"])

            # =========================================================
            # H. 특일 달력 · 영업일 보정
            # =========================================================
            cal = pg.evaluate("""() => {
              const C = BojangPublicData.calendar;
              const gaecheon = C.correct('2026-10-05');
              const xmas = C.correct('2026-12-25');
              const normal = C.correct('2026-11-17');
              const sat = C.correct('2026-12-26');
              const seol27 = C.correct('2027-02-09');
              const chuseok28 = C.correct('2028-10-05');
              return {
                gaecheon, xmas, normal, sat, seol27, chuseok28,
                isH_day: C.isHoliday('2026-10-05'), isB_day: C.isBusinessDay('2026-10-05'),
                bdays: C.businessDays('2026-12-24', '2026-12-28'),
                bdays2: C.businessDays('2026-12-21', '2026-12-24'),
                covered: [C.covered('2026-01-01'), C.covered('2028-12-31'), C.covered('2029-01-02')],
                evalDay: C.isHoliday('2026-06-03'),
                count2026: Object.keys(BojangPublicData.calendar.holidays).filter((k) => k.startsWith('2026')).length,
                count2027: Object.keys(BojangPublicData.calendar.holidays).filter((k) => k.startsWith('2027')).length
              };
            }""")
            check("달력 — 2026 대체공휴일(개천절) 인식", cal["isH_day"] and "대체공휴일" in cal["gaecheon"]["reason"], cal["gaecheon"])
            check("달력 — 직전·다음 영업일(10/5 → 10/2 · 10/6)", cal["gaecheon"]["prev"] == "2026-10-02" and cal["gaecheon"]["next"] == "2026-10-06", [cal["gaecheon"]["prev"], cal["gaecheon"]["next"]])
            check("달력 — 성탄절 직전 영업일 12/24", cal["xmas"]["ok"] is False and cal["xmas"]["prev"] == "2026-12-24", cal["xmas"]["prev"])
            check("달력 — 평일은 보정 없음", cal["normal"]["ok"] is True and cal["normal"]["prev"] == "2026-11-17", cal["normal"])
            check("달력 — 토요일 보정(12/26 → 직전 12/24 · 다음 12/28)", cal["sat"]["prev"] == "2026-12-24" and cal["sat"]["next"] == "2026-12-28", [cal["sat"]["prev"], cal["sat"]["next"]])
            check("달력 — 2027 대체공휴일(설날) 2/9", cal["seol27"]["ok"] is False and "대체공휴일" in cal["seol27"]["reason"], cal["seol27"])
            check("달력 — 2028 잠정 표시", cal["chuseok28"]["provisional"] is True, cal["chuseok28"])
            check("달력 — 2026 공휴일 22일 · 2027 24일", cal["count2026"] == 22 and cal["count2027"] == 24, [cal["count2026"], cal["count2027"]])
            check("달력 — 영업일 수(12/24~12/28 = 0일 · 전부 주말·공휴일)", cal["bdays"] == 0 and cal["bdays2"] == 2, [cal["bdays"], cal["bdays2"]])
            check("달력 — 내장 범위(2026~2028) 판정", cal["covered"] == [True, True, False], cal["covered"])
            check("달력 — 지방선거일(2026-06-03) 공휴일", cal["evalDay"] is True)
            ui_cal = pg.evaluate("""() => {
              const d = document.querySelector('#pd-cal-date'), k = document.querySelector('#pd-cal-kind');
              k.value = 'claim3y'; d.value = '2023-12-26';
              document.querySelector('#pd-cal-run').click();
              return { out: document.querySelector('#pd-cal-out').innerText, kindOptions: k.options.length };
            }""")
            check("달력 화면 — 기한 종류 4종", ui_cal["kindOptions"] == 4, ui_cal["kindOptions"])
            check("달력 화면 — 휴일 마감이면 직전 영업일 안내", "직전 영업일" in ui_cal["out"] and "출처" in ui_cal["out"], ui_cal["out"][:80])

            # =========================================================
            # I. 화면 통합 · 무손상
            # =========================================================
            integ = pg.evaluate("""() => ({
              card: !!document.querySelector('#card-publicdata'),
              subheads: Array.from(document.querySelectorAll('#card-publicdata > .subhead')).map(e => e.innerText.slice(0, 4)),
              post: document.querySelectorAll('#post-care .pc-cell').length,
              hero: document.querySelectorAll('#view-home .home-actions button, #view-home .hero-actions button, #view-home [data-home-go]').length,
              hasSourceNote: !!document.querySelector('#card-publicdata .source-note')
            })""")
            check("F 카드 존재 · 3블록", integ["card"] and integ["subheads"] == ["F-1 ", "F-2 ", "F-3 "], integ["subheads"])
            check("F 카드 — 출처·한계 각주", integ["hasSourceNote"])
            check("기존 3칸 무손상", integ["post"] == 3, integ["post"])
            pg.evaluate("() => BojangApp.switchView('home')")
            pg.wait_for_timeout(300)
            home = pg.evaluate("""() => ({ start: !!document.querySelector('#btn-start-consult'), resume: !!document.querySelector('#btn-home-load'), live: !!document.querySelector('#btn-live-start') })""")
            check("첫 화면 3버튼 무손상(새 상담·이어하기·라이브)", home["start"] and home["resume"] and home["live"], home)
            pg.evaluate("() => BojangApp.switchView('toolkit')")
            pg.wait_for_timeout(400)
            pg.evaluate("() => document.querySelector('#card-publicdata').scrollIntoView({block:'start'})")
            pg.wait_for_timeout(800)
            pg.evaluate("""() => { window.__hid = [];
              document.querySelectorAll('.app-header, .tabbar, #toast, .sk-privacy-chip, .sk-lock-fab, .view-homebar')
                .forEach((el) => { window.__hid.push([el, el.style.display]); el.style.display = 'none'; }); }""")
            pg.wait_for_timeout(200)
            pg.locator("#card-publicdata").screenshot(path=os.path.join(SHOTS, "ui-public-data-ks.png"))
            pg.evaluate("() => { (window.__hid || []).forEach(([el, v]) => { el.style.display = v; }); window.__hid = []; }")
            check("스크린샷 ui-public-data-ks.png", os.path.getsize(os.path.join(SHOTS, "ui-public-data-ks.png")) > 12000)
            pg.evaluate("""() => { BojangApp.switchView('toolkit');
              const q=document.querySelector('#cc-q'); q.value='I63'; q.dispatchEvent(new Event('input',{bubbles:true}));
              BojangClaimCheck.pick('I63'); document.querySelector('[data-cc-doc="dx"]').click();
              document.getElementById('cc-date').value='2026-09-15'; BojangClaimCheck.run();
              document.querySelector('#card-claimcheck').scrollIntoView({block:'start'}); }""")
            pg.wait_for_timeout(800)
            pg.evaluate("""() => { window.__hid2 = [];
              document.querySelectorAll('.app-header, .tabbar, #toast, .sk-privacy-chip, .sk-lock-fab, .view-homebar')
                .forEach((el) => { window.__hid2.push([el, el.style.display]); el.style.display = 'none'; }); }""")
            pg.wait_for_timeout(200)
            pg.locator("#card-claimcheck").screenshot(path=os.path.join(SHOTS, "ui-claim-chip-fixed.png"))
            pg.evaluate("() => { (window.__hid2 || []).forEach(([el, v]) => { el.style.display = v; }); window.__hid2 = []; }")
            check("스크린샷 ui-claim-chip-fixed.png", os.path.getsize(os.path.join(SHOTS, "ui-claim-chip-fixed.png")) > 12000)

            # =========================================================
            # K. 4호 보고서 — 네트워크 가드 fail-closed · 메모 저장 경계 · 청구 결함 2건 · 간병 면책
            # =========================================================
            guard0 = pg.evaluate("""() => ({ allowed: BojangGuard.networkAllowed(), reason: BojangGuard.networkReason(),
              g: !!(window.bojangDomainGuard && typeof window.bojangDomainGuard.allowed === 'function') })""")
            check("가드 — 공식(127.0.0.1) 호스트는 허용", guard0["allowed"] is True and guard0["reason"] == "" and guard0["g"], guard0)
            ext_before = len(external)
            no_guard = pg.evaluate("""async () => {
              const saved = window.bojangDomainGuard;
              const before = BojangGuard.blocked();
              window.bojangDomainGuard = null;
              const allowed = BojangGuard.networkAllowed();
              const reason = BojangGuard.networkReason();
              let code = '';
              try { await fetch('https://example.invalid/leak'); } catch (e) { code = e.code || ''; }
              const vision = await BojangBackend.parseCoverageVision(new Blob(['x'], { type: 'image/jpeg' }), {});
              const blocked = BojangGuard.blocked() - before;
              window.bojangDomainGuard = {};
              const methodMissing = BojangGuard.networkAllowed();
              window.bojangDomainGuard = saved;
              return { allowed, reason, code, vision: vision.reason, blocked, methodMissing };
            }""")
            check("가드 — 가드 객체가 없으면(fail-closed) 차단", no_guard["allowed"] is False and no_guard["reason"] == "no-guard", no_guard["reason"])
            check("가드 — 외부 fetch가 GUARD_BLOCKED로 거부", no_guard["code"] == "GUARD_BLOCKED" and no_guard["blocked"] >= 1, no_guard)
            check("가드 — 가드가 없으면 사진 AI 전송 0회", no_guard["vision"] == "domain-lock", no_guard["vision"])
            check("가드 — 판정 메서드가 없으면 차단", no_guard["methodMissing"] is False)
            check("가드 — 차단된 요청은 네트워크로 나가지 않음", len(external) == ext_before, external[ext_before:ext_before + 3])

            card_flow = pg.evaluate("() => { BojangApp.legal.open('privacy'); const t = document.getElementById('legal-body').innerText; BojangApp.legal.close(); return t; }")
            check("방침 — 사진 실제 경로(브라우저→Edge Function→외부 AI)", "Edge Function" in card_flow and "Gemini" in card_flow and "브라우저" in card_flow)
            check("방침 — 대체 모델 최대 3회 재전송 명시", "최대 3회" in card_flow)
            check("방침 — fail-closed 차단 명시", "fail-closed" in card_flow or "외부 요청을 0건" in card_flow)

            memo_txt = pg.evaluate("() => document.querySelector('#view-analysis .mf-note').innerText")
            check("메모 — 원문 미저장 명시", "메모 원문은 저장되지 않습니다" in memo_txt, memo_txt[:40])
            check("메모 — 추출값은 저장·클라우드 동기화 대상임을 구분 표기", all(k in memo_txt for k in ("localStorage", "클라우드 동기화", "Supabase")), memo_txt[:90])

            docs_case = pg.evaluate("""() => {
              const C = BojangClaimCheck;
              const code = FC_CODES.find((c) => c.code === 'C18');
              const onlySurgery = C.match({ code, docs: { surgery: true }, surgery: true });
              const both = C.match({ code, docs: { surgery: true, path: true }, surgery: true });
              const row = (r) => r.rows.filter((x) => x.kind === '수술비').map((x) => ({ ok: x.ok, lack: x.lack || [] }));
              return { only: row(onlySurgery), both: row(both),
                       htmlOnly: C.preview({ code, docs: { surgery: true }, surgery: true }) };
            }""")
            check("청구 — 수술확인서만으로는 '서류 준비됨' 아님", all(r["ok"] is False for r in docs_case["only"]) and any("병리조직결과지" in (r["lack"] or []) for r in docs_case["only"]), docs_case["only"])
            check("청구 — 빠진 서류 이름 표시", "빠진 서류" in docs_case["htmlOnly"] and "병리조직결과지" in docs_case["htmlOnly"])
            check("청구 — 병리까지 있으면 '서류 준비됨'", all(r["ok"] is True for r in docs_case["both"]), docs_case["both"])

            bad_dates = pg.evaluate("""() => {
              const C = BojangClaimCheck;
              const f = (s) => { const r = C.expiryOf(s); return { ok: r.ok, reason: r.reason || '', label: r.label || '', tone: r.tone || '', msg: r.message || '' }; };
              const html = C.preview({ code: FC_CODES.find((c) => c.code === 'C18'), docs: { dx: true }, accident: '2026-02-31' });
              const future = C.preview({ code: FC_CODES.find((c) => c.code === 'I63'), docs: { dx: true }, accident: '2027-06-01' });
              return { feb31: f('2026-02-31'), m13: f('2026-13-40'), future: f('2027-06-01'), good: f('2026-09-15'), html, futureHtml: future };
            }""")
            check("청구 — 없는 날짜는 시효 판정 안 함", bad_dates["feb31"]["ok"] is False and bad_dates["feb31"]["reason"] == "invalid" and bad_dates["m13"]["reason"] == "invalid", [bad_dates["feb31"], bad_dates["m13"]])
            check("청구 — 미래 날짜 차단", bad_dates["future"]["ok"] is False and bad_dates["future"]["reason"] == "future", bad_dates["future"]["reason"])
            check("청구 — 유효한 날짜는 정상 계산", bad_dates["good"]["ok"] is True and bad_dates["good"]["label"] == "여유", bad_dates["good"])
            check("청구 화면 — 잘못된 날짜는 '긴급' 대신 안내", "날짜가 올바르지 않습니다" in bad_dates["html"] and "긴급" not in bad_dates["html"], bad_dates["html"][:60])
            check("청구 화면 — 미래 날짜 안내", "오늘" in bad_dates["futureHtml"] and "뒤입니다" in bad_dates["futureHtml"])

            care_advisory = pg.evaluate("""() => {
              const C = BojangClaimCheck;
              const r = C.match({ code: FC_CODES.find((c) => c.code === 'I63'), docs: { admit: true }, care: true, careBasis: 'old' });
              const row = r.rows.find((x) => x.kind === '간병') || {};
              return { advisory: row.advisory, why: row.why || '', notes: r.notes };
            }""")
            check("간병 — '후보·참고' 표시(확정 판정 아님)", care_advisory["advisory"] is True and "참고" in care_advisory["why"] and "확정" in care_advisory["why"], care_advisory["why"][-40:])
            check("간병 — 메모에도 참고 안내", any("참고" in n and "간병인 사용일당" in n for n in care_advisory["notes"]))

            meta_cover = pg.evaluate("""() => {
              const r = (el) => el ? el.getBoundingClientRect().toJSON() : null;
              const inter = (a, b) => !!(a && b) && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
              const chip = r(document.querySelector('#sk-privacy-chip'));
              const fab = r(document.querySelector('#sk-lock-fab'));
              const rows = Array.from(document.querySelectorAll('.slide[data-no="1"] .cover-meta > div')).map(r);
              const foot = r(document.querySelector('.slide[data-no="1"] .cover-foot'));
              return { n: rows.length, hit: rows.filter((x) => inter(x, chip) || inter(x, fab)).length,
                       footHit: inter(foot, chip) || inter(foot, fab) };
            }""")
            check("360px 표지 — 보장 항목 4행도 가려지지 않음", meta_cover["n"] == 4 and meta_cover["hit"] == 0, meta_cover)
            check("360px 표지 — 하단 면책 문구도 가려지지 않음", meta_cover["footHit"] is False)

            pd_notice = pg.evaluate("() => ({ js: BojangPublicData.PROXY_NOTICE, ui: document.querySelector('#pd-proxy-note').innerText })")
            check("공공데이터 — 프록시 안내: 제3자·Cloudflare·국외 이전", all(k in pd_notice["js"] for k in ("제3자", "Cloudflare", "국외 이전")), pd_notice["js"][:60])
            check("공공데이터 — 프록시 안내: 최대 5분 캐시", "5분 캐시" in pd_notice["js"])
            check("공공데이터 — 공공데이터는 확정 판정 아님", "확정 판정하지 않습니다" in pd_notice["js"], pd_notice["js"][-60:])
            check("공공데이터 — 화면에도 같은 경계 표기", "국외 이전" in pd_notice["ui"] and "확정 판정하지 않습니다" in pd_notice["ui"])
            pd_live = pg.evaluate("""async () => {
              const before = BojangGuard.blocked();
              const off = await BojangPublicData.proxy.fetchDrug('아스피린');
              BojangPublicData.proxy.set('https://proxy.example.kr/k-skill');
              const saved = window.bojangDomainGuard;
              window.bojangDomainGuard = null;
              const blocked = await BojangPublicData.proxy.fetchDrug('아스피린');
              window.bojangDomainGuard = saved;
              BojangPublicData.proxy.set('');
              return { off: off.reason, blocked: blocked.reason, delta: BojangGuard.blocked() - before };
            }""")
            check("공공데이터 — 프록시 미설정이면 외부 요청 없음", pd_live["off"] == "off", pd_live)
            check("공공데이터 — 가드 차단 시 실시간 조회도 0회", pd_live["blocked"] == "blocked", pd_live["blocked"])

            check("콘솔 오류 0 (데스크톱)", len(errors) == 0, errors[:3])

            # 단일 HTML
            sh = os.path.join(ROOT, "dist", "bojang-guide.single.html")
            sh_html = read(sh)
            check("단일 HTML — v7.1 표기", "v7.1" in sh_html and 'content="v7.1"' in sh_html, len(sh_html) // 1024)
            check("단일 HTML — 공공데이터 모듈 포함", "BojangPublicData" in sh_html and "복용약" in sh_html)
            check("단일 HTML — 외부 참조 0", len(re.findall(r'(?:src|href)="\./', sh_html)) == 0)

            # 단일 HTML 360px 콘솔 오류
            errs2 = []
            ctx2 = browser.new_context(viewport={"width": 360, "height": 740})
            pg2 = ctx2.new_page()
            files_requests = []
            pg2.on("request", lambda r: files_requests.append(r.url))
            pg2.on("pageerror", lambda e: errs2.append(str(e)))
            pg2.on("console", lambda m: errs2.append(m.text) if m.type == "error" else None)
            pg2.goto("file://" + sh)
            pg2.wait_for_timeout(1200)
            pg2.evaluate("""() => { const b=document.querySelector('#tour-invite-later'); if(b) b.click();
              BojangApp.switchView('toolkit'); }""")
            pg2.wait_for_timeout(500)
            pd2 = pg2.evaluate("""() => { BojangPublicData.applyMeds();
              const q=document.querySelector('#pd-med-q'); q.value='아스피린';
              const r=BojangPublicData.applyMeds();
              return { groups: r.groups.length, stats: document.querySelectorAll('#pd-stat-out .pd-stat').length,
                       toc: document.documentElement.scrollWidth <= 361 }; }""")
            check("단일 HTML — 공공데이터 동작(오프라인 파일)", pd2["groups"] >= 1 and pd2["stats"] == 4, pd2)
            check("단일 HTML 360px — 가로 넘침 0", pd2["toc"] is True, pd2["toc"])
            guard_file = pg2.evaluate("""async () => {
              const base = { allowed: BojangGuard.networkAllowed(), reason: BojangGuard.networkReason(),
                g: !!(window.bojangDomainGuard && typeof window.bojangDomainGuard.allowed === 'function') };
              let code = '';
              try { await fetch('https://supabase.co/rest/v1/leak'); } catch (e) { code = e.code || ''; }
              const login = await BojangBackend.signIn('fc@example.com', 'bojang1234');
              const vision = await BojangBackend.parseCoverageVision(new Blob(['x'], { type: 'image/jpeg' }), {});
              const calc = !!BojangApp.cursorModel();
              const pdLive = await BojangPublicData.proxy.fetchDrug('아스피린');
              return { base, code, login: login.reason, vision: vision.reason, calc, pdLive: pdLive.reason,
                       blocked: BojangGuard.blocked() };
            }""")
            check("파일 실행 — file: 프로토콜은 네트워크 차단(fail-closed)", guard_file["base"]["allowed"] is False and guard_file["base"]["reason"] == "file-protocol", guard_file["base"])
            check("파일 실행 — 외부 fetch GUARD_BLOCKED", guard_file["code"] == "GUARD_BLOCKED", guard_file["code"])
            check("파일 실행 — 로그인·사진 AI 차단", guard_file["login"] == "domain-lock" and guard_file["vision"] == "domain-lock", [guard_file["login"], guard_file["vision"]])
            check("파일 실행 — 실시간 조회도 차단", guard_file["pdLive"] == "blocked", guard_file["pdLive"])
            check("파일 실행 — 기기 안 계산은 그대로", guard_file["calc"] is True)
            file_ext = [u for u in files_requests if not u.startswith("file:") and not u.startswith("data:")]
            check("파일 실행 — 외부 요청 0건", len(file_ext) == 0, file_ext[:3])
            check("콘솔 오류 0 (단일 HTML · 360px)", len(errs2) == 0, errs2[:3])
            ctx2.close()
            ctx.close()
            browser.close()
    finally:
        httpd.shutdown()

    passed = sum(1 for r in results if r[1])
    total = len(results)
    print("\n=== v7.1 테스트 %d/%d 통과 ===" % (passed, total))
    if passed != total:
        print("실패:")
        for n, ok, d in results:
            if not ok:
                print(" -", n, "·", d)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
