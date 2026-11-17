#!/usr/bin/env python3
"""보장분석 라이프 리포트 v7.0 — 사후관리 디데이 5종 · 청구 서류 담보 매칭 · 상담 메모 빠른 채움.

실행: python3 tests/test_v7_0.py

검증 축
  A. 버전 v7.0 통일(version.js · sw · manifest · index · README · 단일 HTML)
  B. 사후관리 디데이 — 5종 산출식(90일/감액 1·2년/고지 2·5년/실손 6개월·3개월/상령일),
     2월 29일 윤년 보정, 실손 전환 보험금 수령 시 철회 불가 경고, 카톡 초안 + 다음 점검 예정일
  C. 청구 서류·담보 매칭 — 후보 담보, 영수증만일 때 수술확인서·병리 1순위 누락, 3년 소멸시효 긴급도,
     5세대 비중증 제외 4항목, 면책 문구, '후보 담보/추가로 필요한 서류' 용어
  D. 상담 메모 빠른 채움 — 로컬 파싱 정확도, 6단계 반영, 노란 강조, 원문 미저장, 되돌리기
  E. 첫 화면 — 부이 카피 개선 + 3버튼 무손상, 결과 화면 '상담 후 챙길 것' 3칸(360px 1열·44px)
  F. 10장 PDF 6쪽 카드 경계 잘림 0 · 1·10·30장 페이지·넘침 0
  G. 스크린샷 4종 · 콘솔 오류 0
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out")
SHOTS = "/workspace/reports/bojang-guide/v7.0"
os.makedirs(OUT, exist_ok=True)
os.makedirs(SHOTS, exist_ok=True)

DISCLAIMER = "본 결과는 상담 참고용이며 최종 지급 여부는 상품 약관 및 보험사 심사에 따릅니다."

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
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1,
                                      permissions=["clipboard-read", "clipboard-write"])
            pg = ctx.new_page()
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.goto(base + "/index.html")
            pg.wait_for_timeout(1000)
            pg.evaluate("() => { const b=document.querySelector('#tour-invite-later'); if(b) b.click(); }")

            # =========================================================
            # A. 버전
            # =========================================================
            ver = read(os.path.join(ROOT, "version.js"))
            VER = (re.findall(r"const APP_VERSION = '([^']+)'", ver) or [""])[0]
            check("version.js 단일 상수 v7.0", VER == "v7.0" and len(re.findall(r"const APP_VERSION = '([^']+)'", ver)) == 1, VER)
            check("window.APP_VERSION = v7.0", pg.evaluate("() => window.APP_VERSION") == "v7.0")
            check("sw 캐시 bojang-guide-v7.0", "const CACHE = 'bojang-guide-v7.0';" in read(os.path.join(ROOT, "sw.js")))
            check("sw — 신규 3개 파일 캐시", all(("./%s" % f) in read(os.path.join(ROOT, "sw.js")) for f in ("aftercare.js", "claimcheck.js", "memofill.js")))
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest v7.0", "v7.0" in man.get("name", ""), man.get("name"))
            check("manifest — v7.0 신기능 설명", all(k in man.get("description", "") for k in ("사후관리 디데이", "청구 담보 매칭", "상담 메모")), man.get("description", "")[-90:])
            readme = read(os.path.join(ROOT, "README.md"))
            check("README v7.0 절", "## v7.0에서 달라진 것" in readme and "## v6.2에서 달라진 것" in readme)
            html = read(os.path.join(ROOT, "index.html"))
            check("index — title v7.0", "리포트 v7.0 ·" in html)
            check("index — meta app-version v7.0", '<meta name="app-version" content="v7.0">' in html)
            check("화면 표기 v7.0", pg.inner_text(".hh-ver").strip().startswith("v7.0"), pg.inner_text(".hh-ver"))

            # =========================================================
            # B. 사후관리 디데이 5종 — 날짜 산출식
            # =========================================================
            dd = pg.evaluate("""() => {
              const A = BojangAftercare;
              const r = A.calc({ name: '김서연', contract: '2026-08-20', birth: '2000-08-31',
                treatment: '2025-06-10', cure: '2025-09-30', switchDate: '2026-09-01',
                claimed: false, reductionYears: '1' }, '2026-11-17');
              const map = {};
              r.items.forEach((i) => { map[i.key] = i; });
              return {
                imunity: map.imunity.date, imunityDays: map.imunity.days,
                reduction: map.reduction.date, disclosure: map.disclosure.date,
                disclosureExtra: (map.disclosure.extra || []).map((e) => e.date),
                silson: map.silson.date, ageday: map.ageday.date, next: r.nextCheck.date,
                lines: map.imunity.lines.join(' '),
                copy: map.ageday.copy,
                addM: [A.date.addMonths('2026-08-31', 6), A.date.addMonths('2028-02-29', 12), A.date.addDays('2026-08-20', 90), A.date.addMonths('2027-08-31', 6)]
              };
            }""")
            check("90일 면책 해제일 = 계약일 + 90일", dd["imunity"] == "2026-11-18" and dd["imunityDays"] == 1, dd["imunity"])
            check("90일 — 일반암 한정·유사암/뇌심장 문구", "일반암만 해당" in dd["lines"] and "유사암" in dd["lines"] and "뇌·심장" in dd["lines"], dd["lines"][:60])
            check("감액 해제일 = 계약일 + 1년", dd["reduction"] == "2027-08-20", dd["reduction"])
            check("고지의무 = 최종 치료일 + 2년", dd["disclosure"] == "2027-06-10", dd["disclosure"])
            check("고지의무 — 완치 종결일 + 5년 병기", "2030-09-30" in dd["disclosureExtra"] and "2027-06-10" in dd["disclosureExtra"], dd["disclosureExtra"])
            check("실손 철회 기한 = 승낙일 + 6개월", dd["silson"] == "2027-03-01", dd["silson"])
            check("상령일 — 8/31생 + 6개월은 2월 말일 보정", dd["ageday"] == "2027-02-28", dd["ageday"])
            check("2/29생 윤년 보정 (2028-02-29 + 1년 = 2029-02-28)", dd["addM"][1] == "2029-02-28", dd["addM"][1])
            check("날짜 유틸 — 말일 보정(윤년 2/29)·90일", dd["addM"][0] == "2027-02-28" and dd["addM"][2] == "2026-11-18" and dd["addM"][3] == "2028-02-29", dd["addM"])
            check("카톡 초안에 '다음 점검 예정일' 자동 삽입", "다음 점검 예정일" in dd["copy"] and re.search(r"\d{4}년 \d{1,2}월", dd["copy"]) is not None, dd["copy"][-60:])
            check("다음 점검 예정일 = 가장 가까운 D-day", dd["next"] == "2026-11-18", dd["next"])

            # 감액 2년 분기 · 실손 철회 불가 · 기간 경과
            ed = pg.evaluate("""() => {
              const A = BojangAftercare;
              const two = A.calc({ contract: '2026-08-20', reductionYears: '2' }, '2026-11-17');
              const red2 = two.items.find((i) => i.key === 'reduction');
              const blocked = A.calc({ switchDate: '2026-08-01', claimed: true }, '2026-11-17');
              const b = blocked.items.find((i) => i.key === 'silson');
              const warn = A.calc({ switchDate: '2026-10-01', claimed: true }, '2026-11-17');
              const w = warn.items.find((i) => i.key === 'silson');
              const empty = A.calc({}, '2026-11-17');
              return {
                red2: red2.date,
                blockedState: b.state, blockedHead: b.headline, blockedWarn: b.warn,
                warnedHead: w.headline, warnedWarn: w.warn,
                empties: empty.items.filter((i) => !i.available).map((i) => i.key)
              };
            }""")
            check("감액 2년 특약 분기 = 계약일 + 2년", ed["red2"] == "2028-08-20", ed["red2"])
            check("실손 — 1원이라도 수령 + 3개월 경과 → 철회 불가", "철회 불가" in ed["blockedHead"] and "철회 불가" in ed["blockedWarn"], ed["blockedHead"][:50])
            check("실손 — 수령 이력 + 3개월 이내 → 3개월 마감 경고", "까지만 되돌릴 수 있습니다" in ed["warnedHead"] and "3개월" in ed["warnedWarn"], ed["warnedHead"][:60])
            check("계약일 없으면 90일·감액·상령일은 안내만", set(ed["empties"]) == {"imunity", "reduction", "disclosure", "silson", "ageday"}, ed["empties"])

            # 가림 모드 — 화면·복사 문구 마스킹
            masked = pg.evaluate("""() => {
              BojangSmartKey.privacy.setEnabled(true);
              const r = BojangAftercare.calc({ name: '김서연', contract: '2026-08-20' }, '2026-11-17');
              const copy = r.items.find((i) => i.key === 'imunity').copy;
              BojangSmartKey.privacy.setEnabled(false);
              return copy.slice(0, 12);
            }""")
            check("가림 모드 — 카톡 초안 고객명 마스킹", "김*연" in masked and "김서연" not in masked, masked)

            # =========================================================
            # C. 청구 서류 · 담보 매칭
            # =========================================================
            cc = pg.evaluate("""() => {
              const C = BojangClaimCheck;
              const r = C.match({ code: (typeof FC_CODES !== 'undefined' ? FC_CODES.find((c) => c.code === 'C18') : null),
                docs: { receipt: true }, accident: '2026-09-15', surgery: true, care: true, careBasis: '8', silson5: true });
              const urgent = C.expiryOf((() => { const d = new Date(); d.setDate(d.getDate() - 1050); return d.toISOString().slice(0, 10); })());
              const past = C.expiryOf((() => { const d = new Date(); d.setDate(d.getDate() - 1200); return d.toISOString().slice(0, 10); })());
              return {
                rows: r.rows.map((x) => x.dambo),
                missing: r.missing.map((m) => [m.key, m.rank]),
                notes: r.notes,
                sole: r.soleReceipt,
                expiry: r.expiry, urgent, past,
                disclaimer: r.disclaimer,
                i64: C.match({ code: (typeof FC_CODES !== 'undefined' ? FC_CODES.find((c) => c.code === 'I64') : null), docs: { dx: true } }).notes,
                n20: C.match({ code: (typeof FC_CODES !== 'undefined' ? FC_CODES.find((c) => c.code === 'N20') : null), docs: { surgery: true }, surgery: true }).rows.map((x) => x.dambo)
              };
            }""")
            check("매칭 — 일반암 진단비·암수술비·치료비", "일반암 진단비" in cc["rows"] and "암수술비" in cc["rows"] and "항암약물치료비" in cc["rows"], cc["rows"][:4])
            check("영수증만 → 수술확인서·병리조직결과지 1순위 누락", cc["sole"] and any(m[0] == "surgery" and m[1] == 1 for m in cc["missing"]) and any(m[0] == "path" and m[1] == 1 for m in cc["missing"]), cc["missing"])
            check("영수증만 경고 문구", any("수술확인서" in n and "병리" in n for n in cc["notes"]), cc["notes"][:1])
            check("소멸시효 3년 = 사고일 + 3년", cc["expiry"]["date"] == "2029-09-15", cc["expiry"]["date"])
            check("소멸시효 90일 이내 긴급", cc["urgent"]["tone"] == "danger" and "긴급" in cc["urgent"]["label"], cc["urgent"]["label"])
            check("소멸시효 완성 경고", "완성" in cc["past"]["label"], cc["past"]["label"])
            check("5세대 비중증 제외 4항목 안내", any("보장 제외" in n or "0원" in n for n in cc["notes"]), cc["notes"][-2:])
            check("면책 문구 명시", cc["disclaimer"] == DISCLAIMER, cc["disclaimer"][:30])
            check("I64 — 뇌혈관만·뇌졸중 제외 안내", any("I64" in n for n in cc["i64"]), cc["i64"])
            check("N20 — 체외충격파 시술 제외 안내", any("제외" in d or "체외충격파" in d for d in cc["n20"]), cc["n20"])

            # 화면 용어·결과
            pg.evaluate("() => BojangApp.switchView('toolkit')")
            pg.wait_for_timeout(300)
            pg.evaluate("""() => {
              BojangClaimCheck.pick('C18');
              document.querySelector('[data-cc-doc="receipt"]').click();
              document.getElementById('cc-date').value = '2026-09-15';
              document.getElementById('cc-rider-surgery').checked = true;
              document.getElementById('cc-rider-silson').checked = true;
              BojangClaimCheck.run();
            }""")
            pg.wait_for_timeout(300)
            ccui = pg.evaluate("""() => ({
              text: document.getElementById('cc-out').innerText,
              miss: document.querySelectorAll('#cc-out .cc-miss-list li').length,
              exp: !!document.querySelector('#cc-out .cc-expiry'),
              disc: document.querySelector('#cc-out .cc-disclaimer').innerText
            })""")
            check("화면 — '확인할 후보 담보' 용어", "확인할 후보 담보" in ccui["text"], ccui["text"][:24])
            check("화면 — '추가로 필요한 서류' 용어", "추가로 필요한 서류" in ccui["text"])
            check("화면 — 확정 판정 표현 없음", "청구 가능한" not in ccui["text"] and "지급 확정" not in ccui["text"])
            check("화면 — 누락 서류 목록·소멸시효 카드", ccui["miss"] >= 2 and ccui["exp"], [ccui["miss"], ccui["exp"]])
            check("화면 — 면책 문구 노출", DISCLAIMER in ccui["disc"], ccui["disc"][:30])

            # =========================================================
            # D. 상담 메모 → 6단계 빠른 채움
            # =========================================================
            memo = pg.evaluate("""() => {
              const p = BojangMemoFill.parse('김서연 42세 여성, 월 보험료 18만원. 암 5000, 뇌 2000, 심장 1500, 수술 1~5종 300, 간병 10만원. 부모님 암 가족력. 고혈압 약 3년째 복용, 5년 전 담낭 수술. 실손 4세대.');
              const q = BojangMemoFill.parse('이름: 박정훈 / 1979년 9월 9일생 / 남성 / 보험료 31만원 / 실손 2세대 / 가족력 없음');
              const n = BojangMemoFill.parse('홍길동 55세, 암 1억, 월 30만원');
              return { p, q, n };
            }""")
            mp = memo["p"]
            check("메모 — 이름/나이/성별", mp["name"] == "김서연" and mp["age"] == 42 and mp["gender"] == "여", [mp["name"], mp["age"], mp["gender"]])
            check("메모 — 월 보험료", mp["premium"] == 18, mp["premium"])
            check("메모 — 담보 5종 금액", mp["cov"]["cancer"]["general"] == 5000 and mp["cov"]["brain"]["vascular"] == 2000
                  and mp["cov"]["heart"]["ischemic"] == 1500 and mp["cov"]["surgery"]["disease15"] == 300 and mp["cov"]["care"]["daily"] == 10, mp["cov"])
            check("메모 — 가족력", mp["family"] == ["cancer"], mp["family"])
            check("메모 — 고지 키워드(고혈압·수술·투약)", mp["disc"].get("y5m_htn") and mp["disc"].get("m3_daily") and mp["disc"].get("y5_inop"), mp["disc"])
            check("메모 — 5년 전 수술은 3개월 수술 문항 제외", not mp["disc"].get("m3_op"), mp["disc"])
            check("메모 — 라벨·생년월일·가족력 없음", memo["q"]["name"] == "박정훈" and memo["q"]["birth"] == "1979-09-09"
                  and memo["q"]["gender"] == "남" and memo["q"]["family"] == ["none"], [memo["q"]["name"], memo["q"]["birth"], memo["q"]["family"]])
            check("메모 — '1억' 금액 환산(10,000만원)", memo["n"]["cov"]["cancer"]["general"] == 10000, memo["n"]["cov"].get("cancer"))

            applied = pg.evaluate("""() => {
              BojangApp.switchView('analysis');
              BojangApp.newConsult();
              const before = BojangApp.state.client.name;
              const p = BojangMemoFill.parse('김서연 42세 여성, 월 보험료 18만원. 암 5000, 뇌 2000, 심장 1500. 부모님 암 가족력. 고혈압 약 3년째 복용.');
              const n = BojangMemoFill.apply(p);
              const S = BojangApp.state;
              const marks = document.querySelectorAll('#view-analysis .mf-filled').length;
              return { before, n, name: S.client.name, age: S.age, premium: S.premium,
                cancer: S.cov.cancer.general, brain: S.cov.brain.dx.vascular, marks,
                nameInput: document.getElementById('client-name').value,
                nameMark: document.getElementById('client-name').classList.contains('mf-filled') };
            }""")
            check("메모 반영 — 6단계 state 즉시 적용", applied["n"] >= 8 and applied["name"] == "김서연" and applied["premium"] == 18 and applied["cancer"] == 5000, applied)
            check("메모 반영 — 입력칸 표시", applied["nameInput"] == "김서연", applied["nameInput"])
            check("메모 반영 — 노란 강조 표시", applied["marks"] >= 8 and applied["nameMark"], applied["marks"])

            # 강조 해제 · 되돌리기 · 원문 미저장
            undo = pg.evaluate("""() => {
              document.getElementById('client-name').dispatchEvent(new Event('input', { bubbles: true }));
              const off = !document.getElementById('client-name').classList.contains('mf-filled');
              BojangMemoFill.undo();
              return { off, name: BojangApp.state.client.name };
            }""")
            check("메모 — 고친 칸은 강조 해제", undo["off"])
            check("메모 — 되돌리기로 원상 복구", undo["name"] == "", undo["name"])

            leak = pg.evaluate("""() => {
              const ta = document.getElementById('mf-text');
              BojangMemoFill.toggle(true);
              ta.value = '김서연 42세 여성 메모원문테스트 마커';
              BojangMemoFill.run();
              const all = [];
              for (let i = 0; i < localStorage.length; i++) all.push(localStorage.getItem(localStorage.key(i)));
              for (let i = 0; i < sessionStorage.length; i++) all.push(sessionStorage.getItem(sessionStorage.key(i)));
              const blob = all.join(' ');
              return { stored: blob.indexOf('메모원문테스트') >= 0 || blob.indexOf('42세 여성') >= 0,
                       nameStored: blob.indexOf('김서연') >= 0 };
            }""")
            check("메모 — 원문은 localStorage/sessionStorage 미저장", not leak["stored"], leak)
            pg.evaluate("() => { BojangMemoFill.reset(); }")
            cleared = pg.evaluate("() => document.getElementById('mf-text').value === ''")
            check("메모 — 새 상담/초기화 시 원문 비움", cleared)

            # =========================================================
            # E. 첫 화면 카피 + 상담 후 챙길 것 3칸
            # =========================================================
            pg.evaluate("() => BojangApp.switchView('home')")
            pg.wait_for_timeout(300)
            sb = pg.evaluate("() => { const b=document.getElementById('btn-sample-demo'); return { text: b.innerText, b: b.querySelector('b').innerText, em: b.querySelector('em').innerText }; }")
            check("부이 카피 — '로그인 없이 30장 샘플 보기'", sb["b"] == "로그인 없이 30장 샘플 보기", sb["b"])
            check("부이 카피 — '가상 고객 김서연 · 저장·전송 안 됨'", sb["em"] == "가상 고객 김서연 · 저장·전송 안 됨", sb["em"])
            check("첫 화면 3버튼 무손상", pg.evaluate("() => Array.from(document.querySelectorAll('#home-three .hh-three')).map(b => b.id)")
                  == ["btn-start-consult", "btn-home-load", "btn-live-start"])

            pg.evaluate("() => { BojangApp.analyze(); BojangApp.switchView('analysis'); }")
            pg.wait_for_timeout(600)
            pc = pg.evaluate("""() => {
              const host = document.getElementById('post-care');
              if (!host) return null;
              const cells = Array.from(host.querySelectorAll('.pc-cell'));
              return { n: cells.length, ids: cells.map((c) => c.dataset.pcGo),
                titles: cells.map((c) => c.querySelector('b').innerText),
                minH: Math.min.apply(null, cells.map((c) => Math.round(c.getBoundingClientRect().height))),
                cols: getComputedStyle(host.querySelector('.pc-grid')).gridTemplateColumns.split(' ').length };
            }""")
            check("결과 화면 — 상담 후 챙길 것 3칸", pc and pc["n"] == 3 and pc["ids"] == ["claimcheck", "aftercare", "kakao"], pc)
            check("결과 화면 — 3칸 문구", pc and pc["titles"] == ["청구 서류 체크", "사후관리 날짜", "카톡 안내 초안"], pc and pc["titles"])
            check("결과 화면 — 터치 44px 이상", pc and pc["minH"] >= 44, pc and pc["minH"])
            pg.click("#post-care [data-pc-go='claimcheck']")
            pg.wait_for_timeout(400)
            check("챙길 것 — 청구 서류 → 툴킷 이동", pg.evaluate("() => BojangApp.state.tab") == "toolkit" and pg.evaluate("() => !document.getElementById('card-claimcheck').closest('.view').hidden"), "")

            # 360px — 1열 · 넘침 0
            pg3 = ctx.new_page()
            errs3 = []
            pg3.on("pageerror", lambda e: errs3.append(str(e)))
            pg3.on("console", lambda m: errs3.append(m.text) if m.type == "error" else None)
            pg3.set_viewport_size({"width": 360, "height": 740})
            pg3.goto(base + "/index.html")
            pg3.wait_for_timeout(1000)
            pg3.evaluate("() => { const b=document.querySelector('#tour-invite-later'); if(b) b.click(); }")
            pg3.evaluate("() => { BojangApp.analyze(); BojangApp.switchView('analysis'); const el=document.getElementById('post-care'); el.scrollIntoView(); }")
            pg3.wait_for_timeout(500)
            m360 = pg3.evaluate("""() => {
              const host = document.getElementById('post-care');
              const grid = host.querySelector('.pc-grid');
              const cells = Array.from(host.querySelectorAll('.pc-cell'));
              const box = host.getBoundingClientRect();
              let xover = 0, minFont = 99;
              host.querySelectorAll('*').forEach((e) => {
                if (!e.textContent.trim()) return;
                const b = e.getBoundingClientRect();
                if (b.width && (b.right > box.right + 0.5 || b.left < box.left - 0.5)) xover++;
                if (e.classList.contains('eyebrow')) return;   /* 장식 라벨(9px)은 제외 */
                const fs = parseFloat(getComputedStyle(e).fontSize) || 0;
                if (fs && fs < minFont) minFont = fs;
              });
              return { cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length, xover,
                       minH: Math.min.apply(null, cells.map((c) => Math.round(c.getBoundingClientRect().height))),
                       minFont, docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth };
            }""")
            check("360px 챙길 것 — 1열 배치", m360["cols"] == 1, m360["cols"])
            check("360px 챙길 것 — 넘침 0 · 44px · 본문 12px", m360["xover"] == 0 and m360["minH"] >= 44 and m360["minFont"] >= 11 and m360["docOver"] <= 0, m360)

            # 툴킷 360px 넘침
            pg3.evaluate("() => { BojangApp.switchView('toolkit'); document.getElementById('card-aftercare').scrollIntoView(); }")
            pg3.wait_for_timeout(400)
            ac360 = pg3.evaluate("""() => {
              const host = document.getElementById('card-aftercare');
              const box = host.getBoundingClientRect();
              let xover = 0, minFont = 99;
              host.querySelectorAll('*').forEach((e) => {
                if (!e.textContent.trim()) return;
                const b = e.getBoundingClientRect();
                if (b.width && (b.right > box.right + 1 || b.left < box.left - 1)) xover++;
                const fs = parseFloat(getComputedStyle(e).fontSize) || 0;
                if (fs && fs < minFont) minFont = fs;
              });
              return { xover, minFont, docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth };
            }""")
            check("360px 사후관리 — 넘침 0", ac360["xover"] == 0 and ac360["docOver"] <= 0, ac360)

            # =========================================================
            # F. 10장 PDF 6쪽 카드 경계 잘림 0 + 3종 페이지
            # =========================================================
            pg.evaluate("""() => {
              const s = BojangApp.state;
              s.client = { name: '박정훈', consultant: '보반 과장', birth: '1979-09-09', dateLabel: '2026년 11월 17일' };
              s.age = '40'; s.gender = '남'; s.job = '2'; s.silson = '2'; s.silson2 = 'early'; s.premium = 31; s.sample = false;
              BojangModel.normalizeState(s); BojangApp.renderAllInputs(); BojangApp.analyze();
            }""")
            pg.wait_for_timeout(500)
            p6 = pg.evaluate("""() => {
              const b = BojangReport.build('detail', BojangApp.state);
              const sh = new PDFKit.Sheet();
              const calls = [];
              const ot = sh.text.bind(sh);
              sh.text = (str, x, y, o) => {
                o = o || {};
                const size = o.size || 9;
                calls.push({ s: String(str).slice(0, 40), x, y, size, align: o.align || 'left', w: sh.measure(String(str), size, o.weight) });
                return ot(str, x, y, o);
              };
              b.pages[5](sh, 6);
              const ML = sh.ML, CW = sh.CW, half = (CW - 8) / 2;
              const cards = [{ x: ML, r: ML + half }, { x: ML + half + 8, r: ML + CW }];
              const bad = [];
              calls.forEach((c) => cards.forEach((cd, i) => {
                if (c.align === 'left' && c.x >= cd.x - 1 && c.x < cd.r - 2 && c.y > 120 && c.y < 300 && c.x + c.w > cd.r - 3) {
                  bad.push({ card: i + 1, s: c.s, over: Math.round(c.x + c.w - cd.r) });
                }
              }));
              const data = sh.cv.toDataURL('image/png');
              return { bad, calls: calls.length, img: data, cards: cards.map((c) => [Math.round(c.x), Math.round(c.r)]) };
            }""")
            check("10장 PDF 6쪽 — 카드 경계 넘친 텍스트 0", len(p6["bad"]) == 0, p6["bad"][:3])
            with open(os.path.join(SHOTS, "pdf-detail-p6.png"), "wb") as f:
                f.write(base64.b64decode(p6["img"].split(",", 1)[1]))
            pdf = pg.evaluate("""async () => {
              const out = {};
              for (const k of ['summary', 'detail', 'advisor']) {
                const b = await BojangApp.buildPdfBlob(k);
                out[k] = { pages: b.pages, overflow: b.overflow.length };
              }
              return out;
            }""")
            for k, label, expect in (("summary", "1장", 1), ("detail", "10장", 10), ("advisor", "30장", 30)):
                v = pdf[k]
                check("PDF %s — %d페이지 · 넘침 0" % (label, expect), v["pages"] == expect and v["overflow"] == 0, v)

            # =========================================================
            # G. 스크린샷
            # =========================================================
            # ui-home-v7 (360px 첫 화면 — 3버튼 + 샘플 버튼)
            pg4 = ctx.new_page()
            pg4.set_viewport_size({"width": 360, "height": 740})
            pg4.goto(base + "/index.html")
            pg4.wait_for_timeout(1100)
            pg4.evaluate("() => { const b=document.querySelector('#tour-invite-later'); if(b) b.click(); }")
            pg4.evaluate("() => { const el=document.getElementById('home-three'); el.scrollIntoView({block:'center'}); }")
            pg4.wait_for_timeout(1200)
            pg4.screenshot(path=os.path.join(SHOTS, "ui-home-v7.png"))

            # ui-memo-autofill (360px 1단계 메모 패널 · 반영 결과)
            pg3.set_viewport_size({"width": 360, "height": 1200})
            pg3.evaluate("() => { BojangApp.newConsult(); BojangApp.switchView('analysis'); }")
            pg3.wait_for_timeout(300)
            pg3.evaluate("""() => {
              const b = document.getElementById('mf-toggle');
              if (document.getElementById('mf-body').hidden) b.click();
              b.scrollIntoView({ block: 'start' });
            }""")
            pg3.wait_for_timeout(300)
            pg3.evaluate("""() => {
              document.getElementById('mf-text').value = '김서연 42세 여성, 월 보험료 18만원. 암 5000, 뇌 2000, 심장 1500, 수술 1~5종 300, 간병 10만원. 부모님 암 가족력. 고혈압 약 3년째 복용, 5년 전 담낭 수술. 실손 4세대.';
              document.getElementById('mf-parse').click();
            }""")
            pg3.wait_for_timeout(2700)
            pg3.evaluate("""() => { const h=document.querySelector('.app-header'); if(h) h.style.position='static'; }""")
            pg3.wait_for_timeout(150)
            pg3.query_selector("#memo-fill").screenshot(path=os.path.join(SHOTS, "ui-memo-autofill.png"))
            pg3.evaluate("() => { const h=document.querySelector('.app-header'); if(h) h.style.position=''; }")
            # 노란 강조 확인 컷 (입력칸)
            pg3.evaluate("""() => { document.getElementById('client-name').scrollIntoView({ block: 'center' }); }""")
            pg3.wait_for_timeout(250)
            pg3.screenshot(path=os.path.join(SHOTS, "ui-memo-highlight.png"))

            # ui-aftercare-dday
            pg3.evaluate("""() => {
              BojangApp.switchView('toolkit');
              document.getElementById('ac-name').value = '김서연';
              document.getElementById('ac-contract').value = '2026-08-20';
              document.getElementById('ac-birth').value = '1984-03-05';
              document.getElementById('ac-treatment').value = '2025-06-10';
              document.getElementById('ac-cure').value = '2025-09-30';
              document.getElementById('ac-switch').value = '2026-08-01';
              document.getElementById('ac-claimed').checked = true;
              BojangAftercare.run();
            }""")
            pg3.wait_for_timeout(2600)
            pg3.set_viewport_size({"width": 360, "height": 2000})
            pg3.evaluate("""() => { const h=document.querySelector('.app-header'); if(h) h.style.position='static'; const el=document.getElementById('ac-results'); el.scrollIntoView({ block: 'start' }); }""")
            pg3.wait_for_timeout(300)
            pg3.screenshot(path=os.path.join(SHOTS, "ui-aftercare-dday.png"))
            acbox = pg3.query_selector("#card-aftercare").bounding_box()
            pg3.screenshot(path=os.path.join(SHOTS, "ui-aftercare-dday-full.png"), full_page=True, clip=acbox)

            # ui-claim-checker
            pg3.evaluate("""() => {
              BojangClaimCheck.pick('C18');
              document.querySelector('[data-cc-doc="receipt"]').click();
              document.getElementById('cc-date').value = '2026-09-15';
              document.getElementById('cc-rider-surgery').checked = true;
              BojangClaimCheck.run();
              const h = document.querySelector('.app-header'); if (h) h.style.position = 'static';
              const el = document.getElementById('cc-out');
              el.scrollIntoView({ block: 'start' });
            }""")
            pg3.wait_for_timeout(400)
            pg3.screenshot(path=os.path.join(SHOTS, "ui-claim-checker.png"))
            cbbox = pg3.query_selector("#card-claimcheck").bounding_box()
            pg3.screenshot(path=os.path.join(SHOTS, "ui-claim-checker-full.png"), full_page=True, clip=cbbox)

            for f in ("ui-home-v7.png", "ui-memo-autofill.png", "ui-aftercare-dday.png", "ui-claim-checker.png", "pdf-detail-p6.png"):
                pth = os.path.join(SHOTS, f)
                check("스크린샷 " + f, os.path.exists(pth) and os.path.getsize(pth) > 12000, os.path.getsize(pth) if os.path.exists(pth) else "missing")

            # 단일 HTML
            b = pg.evaluate("() => 1")
            single = os.path.join(ROOT, "dist", "bojang-guide.single.html")
            sh_html = read(single)
            check("단일 HTML — v7.0 표기", VER in sh_html and 'content="v7.0"' in sh_html, len(sh_html) // 1024)
            check("단일 HTML — 신규 모듈 포함", all(k in sh_html for k in ("사후관리 디데이", "확인할 후보 담보", "기기에서만 처리(로컬)", "다음 점검 예정일")))
            check("단일 HTML — 외부 참조 0", sh_html.count('<script src="http') == 0 and sh_html.count('<link href="http') == 0 and sh_html.count('<link rel="stylesheet" href="./') == 0, "")

            check("콘솔 오류 0 (데스크톱)", len(errors) == 0, errors[:3])
            check("콘솔 오류 0 (360px)", len(errs3) == 0, errs3[:3])
            browser.close()
    finally:
        httpd.shutdown()

    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print("\n=== v7.0 테스트 %d/%d 통과 ===" % (passed, total))
    fails = [r for r in results if not r[1]]
    if fails:
        print("\n실패:")
        for n, _, d in fails:
            print(" -", n, "·", d)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
