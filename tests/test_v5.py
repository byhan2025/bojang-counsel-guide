#!/usr/bin/env python3
"""보험에 반하다 v5.0 — Playwright 자동 검증.

실행: python3 tests/test_v5.py
로컬 http 서버를 띄워 index.html을 열고, 콘솔 오류·테마·뇌심장 진단비 3단계·
범위 공백 경고·실무 메뉴 4종·30장 슬라이드·PDF 1/10/30장을 검증합니다.
"""
import os
import re
import socket
import subprocess
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out")
os.makedirs(OUT, exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ((" · " + str(detail)) if detail else ""))
    return ok


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def serve(port):
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return proc
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("server not started")


def main():
    port = free_port()
    proc = serve(port)
    base = f"http://127.0.0.1:{port}/index.html"
    errors = []
    try:
        with sync_playwright() as p:
            exe = os.environ.get("PW_CHROME")
            browser = p.chromium.launch(executable_path=exe, args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=2)
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            page.goto(base, wait_until="load")
            page.wait_for_timeout(700)

            # ---------- 1. 브랜드 & 허브 ----------
            title = page.title()
            check("타이틀에 '보험에 반하다' v5.0", "보험에 반하다" in title and "v5.0" in title, title)
            brand = page.inner_text(".brand-text h1")
            check("헤더 워드마크 (보험에 + 반하다)", "보험에" in brand and "반하다" in brand, brand)
            slogan = page.inner_text(".brand-text p")
            check("슬로건 노출", "당신의 삶에 꼭 맞는 보험" in slogan, slogan)
            hh = page.inner_text(".hh-lockup b")
            check("홈 히어로 브랜드 락업", "반하다" in hh, hh)
            values = page.inner_text(".hh-values")
            check("4대 가치 배지", all(v in values for v in ["보장분석", "맞춤설계", "가족보장", "든든한미래"]), values.replace("\n", " "))
            theme = page.evaluate("getComputedStyle(document.body).backgroundColor")
            check("크림·로즈 배경 적용", theme in ("rgb(250, 244, 243)",), theme)
            hdr = page.evaluate("getComputedStyle(document.querySelector('.app-header')).backgroundImage")
            check("와인 헤더 그라데이션", "rgb(58, 38, 40)" in hdr, hdr[:80])

            cards = page.eval_on_selector_all(".home-grid .hg-card", "els => els.map(e => e.innerText.replace(/\\n/g,' '))")
            check("메인 메뉴 12종 (기존 8 + 실무 4)", len(cards) == 12, len(cards))
            check("실무 메뉴 4종 존재", all(any(k in c for c in cards) for k in ["질병코드", "실손 세대별", "고지사항", "적정 보험료"]), cards[-4:])
            page.screenshot(path=os.path.join(OUT, "01-home.png"), full_page=False)

            # ---------- 2. 고객 30장 표지 브랜드 ----------
            page.click('[data-home-go="client"]')
            page.wait_for_timeout(900)
            cover = page.inner_text("#deck .slide[data-no='1']")
            check("30장 표지 브랜드", "보험에" in cover and "반하다" in cover)
            page.screenshot(path=os.path.join(OUT, "02-cover.png"))
            page.click("#deck-home")
            page.wait_for_timeout(500)

            # ---------- 3. 뇌·심장 진단비 3단계 입력 ----------
            page.click('[data-home-go="analysis"]')
            page.wait_for_timeout(500)
            page.click("#wiz-next")
            page.click("#wiz-next")
            page.wait_for_timeout(400)
            brain = page.inner_text("#card-brain")
            check("뇌 진단비 3단계 라벨", all(k in brain for k in ["뇌혈관질환 진단비", "뇌졸중 진단비", "뇌출혈 진단비"]), brain[:80])
            check("뇌 코드 표기", "I60~I69" in brain and "I60~I62" in brain)
            heart = page.inner_text("#card-heart")
            check("심장 진단비 2단계 라벨", "허혈성심장질환 진단비" in heart and "급성심근경색 진단비" in heart)
            check("진단 시 합산 칩", "진단 시 합산" in brain and "뇌경색(I63)" in brain)
            chips = page.eval_on_selector_all('#card-brain .dx-sub[data-sub="vascular"] .quick', "els => els.map(e => e.innerText)")
            check("금액 칩 없음/1,000/2,000/3,000/5,000", chips == ["없음", "1,000", "2,000", "3,000", "5,000"], chips)
            page.screenshot(path=os.path.join(OUT, "03-brain-input.png"), full_page=False)

            # 직접입력
            inp = page.locator('#card-brain input[data-item="brain"][data-part="dx"][data-sub="vascular"]')
            inp.fill("3000")
            page.wait_for_timeout(250)
            core = page.inner_text('#card-brain [data-dxcore]')
            scen = page.inner_text('#card-brain .dx-scen')
            check("직접입력 반영(핵심 3,000)", core == "3,000", core)
            check("합산 금액 갱신(뇌경색 5,000)", "뇌경색(I63)5,000만원" in scen.replace(" ", "").replace("\n", ""), scen.replace("\n", " ")[:90])

            # 칩
            page.click('#card-brain .dx-sub[data-sub="stroke"] .quick[data-set="0"]')
            page.wait_for_timeout(250)
            scen2 = page.inner_text('#card-brain .dx-scen')
            check("칩 클릭 반영(뇌경색 3,000)", "3,000만원" in scen2.replace(" ", ""), scen2.replace("\n", " ")[:90])

            # 범위 공백 경고: 넓은 범위 0 + 좁은 범위 > 0
            page.click('#card-brain .dx-sub[data-sub="vascular"] .quick[data-set="0"]')
            page.click('#card-brain .dx-sub[data-sub="bleed"] .quick[data-set="2000"]')
            page.wait_for_timeout(300)
            warn_visible = page.is_visible("#card-brain .dx-warn.is-on")
            warn_text = page.inner_text("#card-brain .dx-warn")
            check("범위 공백 경고 표시", warn_visible and "범위 공백" in warn_text, warn_text.strip()[:60])
            page.click("#btn-analyze")
            page.wait_for_timeout(700)
            cps = page.inner_text("#result-checkpoints")
            check("진단에 범위 공백 경고 반영", "범위 공백" in cps and "뇌혈관질환" in cps)
            score1 = page.inner_text(".ring-text strong")
            page.screenshot(path=os.path.join(OUT, "04-result-gap.png"), full_page=False)

            # 넓은 범위 채우면 점수 상승
            page.click('#card-brain .dx-sub[data-sub="vascular"] .quick[data-set="2000"]')
            page.wait_for_timeout(600)
            score2 = page.inner_text(".ring-text strong")
            check("넓은 범위 보완 시 점수 상승", int(score2) > int(score1), f"{score1} → {score2}")
            check("범위 공백 경고 해제", not page.is_visible("#card-brain .dx-warn.is-on"))

            # 빠른 입력 표 모드
            page.click("#btn-home")
            page.wait_for_timeout(400)
            page.click('[data-home-go="quick"]')
            page.wait_for_timeout(500)
            quick = page.inner_text("#view-quick")
            check("빠른 입력에 진단비 3단계", "뇌 진단비 3단계" in quick and "심장 진단비 2단계" in quick)

            # ---------- 4. FC 실무 메뉴 4종 ----------
            page.click("#btn-home")
            page.wait_for_timeout(400)
            page.click('[data-home-go="codes"]')
            page.wait_for_timeout(400)
            cnt = page.inner_text("#code-count")
            check("질병코드 사전 로드", "전체" in cnt and int(re.sub(r"[^0-9]", "", cnt) or 0) >= 20, cnt)
            page.fill("#code-q", "I63")
            page.wait_for_timeout(250)
            lst = page.inner_text("#code-list")
            check("코드 검색 I63 → 뇌경색", "뇌경색" in lst, lst[:60])
            page.fill("#code-q", "디스크")
            page.wait_for_timeout(250)
            check("키워드 검색 디스크", "추간판" in page.inner_text("#code-list"))
            page.fill("#code-q", "")
            page.click('[data-codegroup="심장"]')
            page.wait_for_timeout(250)
            check("분류 필터(심장)", page.inner_text("#code-count").startswith("7"), page.inner_text("#code-count"))
            page.screenshot(path=os.path.join(OUT, "05-codes.png"), full_page=False)

            page.click("#btn-home")
            page.wait_for_timeout(350)
            page.click('[data-home-go="silson"]')
            page.wait_for_timeout(400)
            sil = page.inner_text("#sil-tool")
            check("실손 세대 비교표", all(k in sil for k in ["1세대", "3세대", "5세대", "비중증"]))
            check("전환 판단 5기준", "판단 5기준" in sil and sil.count("?") <= 8)
            page.click('[data-silpick="5"]')
            page.wait_for_timeout(300)
            check("세대 선택 반영", "5세대" in page.inner_text(".sil-current"))
            page.screenshot(path=os.path.join(OUT, "06-silson.png"), full_page=False)

            page.click("#btn-home")
            page.wait_for_timeout(350)
            page.click('[data-home-go="disclose"]')
            page.wait_for_timeout(400)
            disc = page.inner_text("#disc-tool")
            check("고지 판정 도우미", "표준체 권장" in disc and "3개월" in disc)
            page.click('[data-disc="y2"]')
            page.wait_for_timeout(250)
            check("간편심사 판정 변경(3·3·5)", "3·3·5" in page.inner_text(".disc-verdict"))
            claim = page.inner_text("#claim-tool")
            check("청구 서류 5대 담보 탭", all(k in claim for k in ["암", "뇌", "심장", "수술비", "간병", "실손"]))
            page.click('[data-claimtab="brain"]')
            page.wait_for_timeout(250)
            claim2 = page.inner_text("#claim-tool")
            check("뇌 청구 서류 내용", "MRI" in claim2 and "판독" in claim2)
            page.screenshot(path=os.path.join(OUT, "07-claim.png"), full_page=False)

            page.click("#btn-home")
            page.wait_for_timeout(350)
            page.click('[data-home-go="premium"]')
            page.wait_for_timeout(400)
            page.fill("#income-input", "450")
            page.wait_for_timeout(500)
            pm = page.inner_text("#premium-tool")
            check("적정 보험료 계산(450만원)", "권장 10%" in pm and "45" in pm, pm[:40])
            check("리모델링 3카드(A/B/C)", pm.count("A ·") == 1 and pm.count("B ·") == 1 and pm.count("C ·") == 1)
            page.screenshot(path=os.path.join(OUT, "08-premium.png"), full_page=False)

            # ---------- 5. 고객 30장 슬라이드 (30장 전수) ----------
            page.click("#btn-home")
            page.wait_for_timeout(350)
            page.click('[data-home-go="client"]')
            page.wait_for_timeout(900)
            total = page.inner_text("#deck-total")
            check("30장 슬라이드", total == "30", total)
            slide_bad = []
            slide_metric = []
            for no in range(1, 31):
                page.evaluate("n => window.BojangDeck.goTo(n)", no)
                page.wait_for_timeout(60)
                m = page.evaluate("""(n) => {
                  const sl = document.querySelector('.slide[data-no="' + n + '"]');
                  const inner = sl.querySelector('.sl-inner');
                  const stage = document.getElementById('deck-stage');
                  const ib = inner.getBoundingClientRect();
                  let xover = 0;
                  inner.querySelectorAll('*').forEach((el) => {
                    const b = el.getBoundingClientRect();
                    if (b.width && (b.right > ib.right + 1 || b.left < ib.left - 1)) xover++;
                  });
                  return { no: n, inner: inner.scrollHeight, stage: stage.clientHeight, xover, sw: sl.scrollWidth, cw: sl.clientWidth };
                }""", no)
                slide_metric.append(m)
                if m["xover"] or m["sw"] > m["cw"] + 2 or m["inner"] > m["stage"] * 1.12:
                    slide_bad.append((m["no"], m["inner"], m["stage"], m["xover"]))
            check("30장 전수 가로·세로 넘침 0", len(slide_bad) == 0, slide_bad[:5])
            worst = max((round(m["inner"] / m["stage"], 3), m["no"]) for m in slide_metric)
            check("슬라이드 최대 세로 배율 1.12 이하", worst[0] <= 1.12, worst)
            for no in [12, 13, 16, 19]:
                page.evaluate("n => window.BojangDeck.goTo(n)", no)
                page.wait_for_timeout(250)
                txt = page.inner_text(f".slide[data-no='{no}']")
                if no == 12:
                    check("12장 뇌 진단비 3단계 금액", "뇌 진단비 3단계" in txt and "2,000만원" in txt and "뇌경색(I63)" in txt)
                elif no == 13:
                    check("13장 뇌 코드표 갱신", "I60~I63·I65~I66" in txt)
                elif no == 16:
                    check("16장 심장 진단비 2단계 금액", "심장 진단비 2단계" in txt and "허혈성심장" in txt)
                else:
                    check("19장 3대 질병 금액 비교", "심장" in txt and "허혈성" in txt and "만원" in txt)
                page.screenshot(path=os.path.join(OUT, f"09-slide{no}.png"))
            radar_clip = page.evaluate("""() => {
              const out = [];
              document.querySelectorAll('.slide .sl-radar').forEach(svg => {
                const vb = svg.viewBox.baseVal;
                svg.querySelectorAll('text').forEach(t => {
                  const bb = t.getBBox();
                  if (bb.x < vb.x - 0.5 || bb.y < vb.y - 0.5 || bb.x + bb.width > vb.x + vb.width + 0.5 || bb.y + bb.height > vb.y + vb.height + 0.5) {
                    out.push(t.textContent + ' ' + Math.round(bb.x) + ',' + Math.round(bb.y) + ' ' + Math.round(bb.width));
                  }
                });
              });
              return out;
            }""")
            check("레이더 축 라벨 잘림 0", len(radar_clip) == 0, radar_clip[:4])

            # ---------- 5-b. 모든 화면 🏠 메인 복귀 ----------
            def home_ok():
                return page.evaluate("() => document.querySelector('#view-home').classList.contains('is-active')")
            page.click("#deck-home")
            page.wait_for_timeout(400)
            views = ["analysis", "quick", "guide", "toolkit", "live", "codes", "silson", "disclose", "premium"]
            back_bad = []
            for v in views:
                page.click(f'[data-home-go="{v}"]')
                page.wait_for_timeout(320)
                tops = page.eval_on_selector_all(f"#view-{v} [data-home]", "els => els.length")
                page.eval_on_selector(f"#view-{v} [data-home]", "el => el.click()")
                page.wait_for_timeout(320)
                if tops < 2:
                    back_bad.append([v, "홈버튼 " + str(tops) + "개"])
                elif not home_ok():
                    back_bad.append([v, "복귀 실패"])
            check("9개 서브화면 상·하단 홈버튼·복귀", len(back_bad) == 0, back_bad)

            # ---------- 6. PDF 1·10·30장 ----------
            for kind, pages in (("summary", 1), ("detail", 10), ("advisor", 30)):
                out = page.evaluate("""async (kind) => {
                  const App = window.BojangApp;
                  const r = await App.buildPdfBlob(kind);
                  return { pages: r.pages, size: r.blob.size, overflow: r.overflow, ms: r.ms };
                }""", kind)
                check(f"PDF {kind} {pages}페이지 · 넘침 0", out["pages"] == pages and len(out["overflow"]) == 0,
                      f"pages={out['pages']} overflow={out['overflow']} {out['size']//1024}KB")

            # ---------- 7. 구버전 세션 마이그레이션 ----------
            legacy_js = "() => {" \
                "const legacy = {" \
                "client: { name: '김고객', birth: '1980-05-01', consultant: '테스트' }," \
                "age: '40', gender: '남', job: '1', silson: '3', premium: 25," \
                "contracts: [], family: [], disc: {}, flags: {}," \
                "cov: {" \
                "cancer: { general: 3000, similar: 500, treatment: 1500, recur: true }," \
                "brain: { scope: 'bleed', treat: true }," \
                "heart: { scope: 'mi', treat: { lysis: 0, surgery: 1000, icu: 0 } }," \
                "surgery: { disease: 50, nDae: 500, injury: 50 }," \
                "care: { daily: 10, basis: 'unknown', family: 'conditional', nursing: false, ltc: false }" \
                "}};" \
                "localStorage.setItem('bojang.session.v4', JSON.stringify(legacy));" \
                "}"
            page.evaluate(legacy_js)
            page.reload(wait_until="load")
            page.wait_for_timeout(800)
            mig = page.evaluate("() => { const c = window.__bojangState.cov;"
                                " return { brain: c.brain.dx, heart: c.heart.dx, treat: c.brain.treat,"
                                " scope: c.brain.scope, notes: (window.__bojangState.migration||{}).notes||[] }; }")
            check("구버전 뇌 범위 → 진단비 2,000 이관", mig["brain"].get("bleed") == 2000 and mig["scope"] is None, mig["brain"])
            check("구버전 심장 범위 → 진단비 2,000 이관", mig["heart"].get("ami") == 2000, mig["heart"])
            check("구버전 치료비 boolean → 3종", mig["treat"].get("lysis") == 1000 and mig["treat"].get("icu") == 1000, mig["treat"])
            check("마이그레이션 안내 문구", any("진단비" in n for n in mig["notes"]), mig["notes"])
            page.click('[data-home-go="analysis"]')
            page.wait_for_timeout(400)
            check("마이그레이션 후 뇌 카드 정상", page.eval_on_selector("#card-brain", "e => e.innerText.includes('뇌혈관질환 진단비')"))

            # ---------- 8. 콘솔 오류 ----------

            real_errors = [e for e in errors if "favicon" not in e.lower()]
            check("콘솔 오류 0", len(real_errors) == 0, real_errors[:3])
            browser.close()
    finally:
        proc.terminate()

    ok = sum(1 for _, o, _ in results if o)
    print(f"\n{ok}/{len(results)} 통과")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
