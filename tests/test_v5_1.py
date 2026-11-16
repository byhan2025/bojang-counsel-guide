#!/usr/bin/env python3
"""v5.1 역사 검증 — Free/Pro 잠금 동선.

v5.2 베타에서는 잠금이 모두 해제되어 이 스크립트의 잠금 기대값이 유효하지 않습니다.
기본 실행은 안내 후 종료(exit 0)하고, v5.1 동작을 재현할 때만 BOJANG_LEGACY=1로 실행합니다.
  BOJANG_LEGACY=1 python3 tests/test_v5_1.py

보험에 반하다 v5.1 — Playwright 자동 검증.

실행: python3 tests/test_v5_1.py
검증: Free/Pro 요금제 전환 · 잠금 동선(30장 7번·10/30장 PDF·고객 2명째·FC 도구) ·
      리모델링 Before/After 계산과 비교표 · 화이트라벨(상호·연락처·테마 → 헤더·표지·PDF) ·
      1장 PDF 워터마크 · PDF 1/10/30장 넘침 0 · 30장 전수 넘침 0 · 콘솔 오류 0.
"""
import functools
import http.server
import os
import socket
import socketserver
import sys
import threading
import time

if os.environ.get("BOJANG_LEGACY") != "1":
    print("[SKIP] test_v5_1.py — v5.1 Free/Pro 잠금 동선은 v5.2 베타에서 잠금이 모두 해제되어 더 이상 유효하지 않습니다.")
    print("       v5.2 검증은 tests/test_v5_2.py를 실행하세요. v5.1 동작 재현은 BOJANG_LEGACY=1.")
    sys.exit(0)

# 이 환경의 번들 Chromium은 별도 공유 라이브러리가 필요합니다(없으면 시스템 기본값 사용).
for _libs in ("/workspace/tmp/libs/usr/lib/x86_64-linux-gnu", "/workspace/.pwlibs/root/usr/lib/x86_64-linux-gnu"):
    if os.path.isdir(_libs):
        os.environ.setdefault("LD_LIBRARY_PATH", _libs)
        break

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out")
os.makedirs(OUT, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def start_server(root):
    handler = functools.partial(Quiet, directory=root)
    socketserver.TCPServer.allow_reuse_address = True
    for _ in range(30):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        try:
            httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
        except OSError:
            continue
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        for _ in range(50):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    return httpd, f"http://127.0.0.1:{port}"
            except OSError:
                time.sleep(0.05)
    raise RuntimeError("server start failed")

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ((" · " + str(detail)) if detail else ""))
    return ok


def main():
    httpd, base = start_server(ROOT)
    url = base + "/index.html"
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"), args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=2)
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            page.set_default_timeout(15000)
            page.goto(url, wait_until="load")
            page.wait_for_timeout(700)
            page.evaluate("() => { localStorage.clear(); }")
            page.reload(wait_until="load")
            page.wait_for_timeout(800)

            # =========================================================
            # 1. Free 기본 화면 · 요금제 배지 · 메뉴
            # =========================================================
            title = page.title()
            check("타이틀 v5.1", "보험에 반하다" in title and "v5.1" in title, title)
            check("헤더 브랜드 유지", "반하다" in page.inner_text(".brand-text h1"), page.inner_text(".brand-text h1"))
            cards = page.eval_on_selector_all(".home-grid .hg-card", "els => els.map(e => e.innerText.replace(/\\n/g,' '))")
            check("메인 메뉴 14종 (12 + 리모델링 + 화이트라벨)", len(cards) == 14, len(cards))
            check("v5.1 메뉴 2종 존재", any("리모델링 Before" in c for c in cards) and any("화이트라벨" in c for c in cards), cards[-2:])
            check("플랜 배지 = 무료 체험", page.inner_text("#plan-badge").strip() == "무료 체험", page.inner_text("#plan-badge"))
            banner = page.inner_text("#home-plan-banner")
            check("메인 플랜 배너 Free 안내", "무료 체험" in banner and "Pro로 전환" in banner, banner[:80].replace("\n", " | "))
            locked_pdf = page.eval_on_selector_all(".pdf-btn.is-locked", "e => e.map(x => x.innerText.replace(/\\n/g,' '))")
            check("Free: 10·30장 PDF 버튼 잠금 표시", len(locked_pdf) == 2, locked_pdf)
            page.screenshot(path=os.path.join(OUT, "v51-01-home-free.png"))

            # =========================================================
            # 2. Free 고객 30장 — 7번 잠금 + 페이월
            # =========================================================
            page.click('.viewswitch button[data-mode="client"]')
            page.wait_for_timeout(900)
            check("30장 덱 열림", page.inner_text("#deck-now").strip() == "01", page.inner_text("#deck-now"))
            for _ in range(5):
                page.click("#deck-next")
                page.wait_for_timeout(220)
            check("Free: 6번까지 이동", page.inner_text("#deck-now").strip() == "06", page.inner_text("#deck-now"))
            page.click("#deck-next")
            page.wait_for_timeout(600)
            check("Free: 7번 진입 시 페이월", page.is_visible("#paywall"), page.is_visible("#paywall"))
            check("Free: 7번 잠금 카드", page.is_visible("#slide-7 .slide-lock"), page.is_visible("#slide-7 .slide-lock"))
            blur = page.eval_on_selector("#slide-7 .sl-inner > .sl-head", "e => getComputedStyle(e).filter")
            check("Free: 7번 내용 블러", "blur" in blur, blur)
            check("Free: 잠금 카드 문구", "30장 전체 열기" in page.inner_text("#slide-7 .slide-lock"), page.inner_text("#slide-7 .slide-lock").replace("\n", " | "))
            page.screenshot(path=os.path.join(OUT, "v51-02-deck-locked.png"))
            page.click("#pw-later")
            page.wait_for_timeout(200)
            check("Free: 잠긴 슬라이드에서 다음 잠김", page.is_disabled("#deck-next"), page.inner_text("#deck-now"))
            page.click("#deck-home")
            page.wait_for_timeout(600)

            # =========================================================
            # 3. Free PDF — 1장만 + 워터마크, 10장 페이월
            # =========================================================
            page.click('[data-home-go="analysis"]')
            page.wait_for_timeout(400)
            check("상담자 탭 리모델링 바로가기", page.is_visible("#view-analysis .rm-jump"), page.inner_text("#view-analysis .rm-jump"))
            page.click("#view-analysis .rm-jump")
            page.wait_for_timeout(500)
            check("상담자 탭 → 리모델링 이동", page.is_visible("#view-remodel"), page.is_visible("#view-remodel"))
            page.click("#view-remodel .home-back")
            page.wait_for_timeout(300)
            page.click('[data-home-go="analysis"]')
            page.wait_for_timeout(300)
            page.click("#btn-analyze")
            page.wait_for_timeout(800)
            out = page.evaluate("""async () => {
              const r = await BojangApp.buildPdfBlob('summary');
              return { pages: r.pages, size: r.blob.size, overflow: r.overflow, watermark: r.watermark, meta: window.__lastPdf };
            }""")
            check("Free: 1장 요약 PDF 생성", out["pages"] == 1 and out["size"] > 100000, f"{out['size']//1024}KB")
            check("Free: 1장 PDF 무료 체험판 워터마크", "무료 체험판" in (out["watermark"] or "") and out["meta"]["watermark"], out["watermark"])
            page.evaluate("() => { const el = document.getElementById('pdf-overlay'); if (el) el.hidden = true; }")
            page.click('.pdf-btn[data-pdf="detail"]')
            page.wait_for_timeout(500)
            check("Free: 10장 PDF → 페이월", page.is_visible("#paywall") and "10장" in page.inner_text("#pw-title"), page.inner_text("#pw-title"))
            page.click("#pw-later")
            page.wait_for_timeout(200)
            check("Free: 10장 PDF 미생성", page.evaluate("() => (window.__lastPdf||{}).kind") == "summary", page.evaluate("() => (window.__lastPdf||{}).kind"))

            # =========================================================
            # 4. Free 고객 저장 1명
            # =========================================================
            page.evaluate("() => BojangStore.saveHistory([]).then(() => { BojangApp.state.history = []; BojangApp.renderHistory(); })")
            page.reload(wait_until="load")
            page.wait_for_timeout(800)
            page.click("#btn-plan-dummy", timeout=1000) if False else None
            page.click('[data-home-go="analysis"]')
            page.wait_for_timeout(300)
            page.click("#btn-analyze")
            page.wait_for_timeout(600)
            page.fill("#cust-label", "무료고객1")
            page.click("#btn-save")
            page.wait_for_timeout(400)
            check("Free: 고객 1명 저장", page.inner_text("#home-hist-count").strip() == "1건", page.inner_text("#home-hist-count"))
            page.click("#btn-save")
            page.wait_for_timeout(500)
            check("Free: 2명째 저장 → 페이월", page.is_visible("#paywall") and "고객 저장" in page.inner_text("#pw-title"), page.inner_text("#pw-title"))
            page.click("#pw-later")
            page.wait_for_timeout(200)

            # =========================================================
            # 5. Free FC 도구 — 코드 상세·청구 복사 잠금
            # =========================================================
            page.click("#btn-home")
            page.wait_for_timeout(400)
            page.click('[data-home-go="codes"]')
            page.wait_for_timeout(500)
            total_codes = page.eval_on_selector_all(".code-card", "e => e.length")
            locked_codes = page.eval_on_selector_all(".code-card.is-locked", "e => e.length")
            check("Free: 코드 사전 상위 3개 맛보기", total_codes >= 50 and locked_codes == total_codes - 3, f"{locked_codes}/{total_codes}")
            page.click(".code-card.is-locked .cc-copy")
            page.wait_for_timeout(400)
            check("Free: 코드 복사 → 페이월", page.is_visible("#paywall") and "질병코드" in page.inner_text("#pw-title"), page.inner_text("#pw-title"))
            page.click("#pw-later")
            page.wait_for_timeout(200)
            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.click('[data-home-go="disclose"]')
            page.wait_for_timeout(500)
            page.click("#claim-copy")
            page.wait_for_timeout(400)
            check("Free: 청구 서류 복사 → 페이월", page.is_visible("#paywall") and "청구" in page.inner_text("#pw-title"), page.inner_text("#pw-title"))
            page.click("#pw-later")
            page.wait_for_timeout(200)

            # =========================================================
            # 6. Free 리모델링 — Before만, After 잠금
            # =========================================================
            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.click('[data-home-go="remodel"]')
            page.wait_for_timeout(600)
            kpi = page.inner_text(".rm-hero-grid")
            check("Free: 리모델링 Before 노출", "월 보험료" in kpi and "종합 보장 점수" in kpi, kpi[:70].replace("\n", " | "))
            check("Free: After 점수 잠금", "🔒" in kpi, kpi.replace("\n", " | "))
            check("Free: After 잠금 배너", page.is_visible("[data-rm-upgrade]"), page.is_visible("[data-rm-upgrade]"))
            check("Free: 비교표 After 잠금", page.eval_on_selector_all(".rm-table .rm-mask", "e => e.length") >= 5, page.eval_on_selector_all(".rm-table .rm-mask", "e => e.length"))
            page.screenshot(path=os.path.join(OUT, "v51-03-remodel-free.png"))

            # =========================================================
            # 7. Free 화이트라벨 — 미리보기만
            # =========================================================
            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.click('[data-home-go="brand"]')
            page.wait_for_timeout(500)
            page.fill("#bf-name", "테스트 종합금융")
            page.wait_for_timeout(300)
            check("Free: 브랜드 미리보기 반영", "테스트 종합금융" in page.inner_text("#brand-preview"), page.inner_text("#bp-name"))
            check("Free: 헤더는 그대로(미리보기만)", "보험에" in page.inner_text(".brand-text h1"), page.inner_text(".brand-text h1"))
            page.click("#brand-save")
            page.wait_for_timeout(400)
            check("Free: 브랜드 저장 → 페이월", page.is_visible("#paywall") and "브랜드" in page.inner_text("#pw-title"), page.inner_text("#pw-title"))
            page.screenshot(path=os.path.join(OUT, "v51-04-brand-free.png"))

            # =========================================================
            # 8. Pro 전환 (데모) — 배지·잠금 해제
            # =========================================================
            page.click('[data-pwplan="year"]')
            page.wait_for_timeout(200)
            year_on = page.eval_on_selector('[data-pwplan="year"]', "e => e.classList.contains('is-on')")
            check("연 구독 카드 선택", year_on, year_on)
            page.click("#pw-cta")
            page.wait_for_timeout(900)
            check("Pro: 배지 PRO", page.inner_text("#plan-badge").strip() == "PRO", page.inner_text("#plan-badge"))
            banner = page.inner_text("#home-plan-banner")
            check("Pro: 메인 배너 Pro 안내", "Pro 멤버십" in banner and "30장 전체" in banner, banner[:80].replace("\n", " | "))
            check("Pro: PDF 버튼 잠금 해제", page.eval_on_selector_all(".pdf-btn.is-locked", "e => e.length") == 0, page.eval_on_selector_all(".pdf-btn.is-locked", "e => e.length"))
            if page.is_visible("#paywall"):
                page.click("#pw-later")
            page.evaluate("() => { document.getElementById('paywall').hidden = true; }")

            # 고객 30장 전체 + 전수 넘침
            page.evaluate("() => { window.__bojangState.view = 'advisor'; }")
            page.click("#btn-home")
            page.wait_for_timeout(400)
            page.click('[data-home-go="client"]')
            page.wait_for_timeout(900)
            check("Pro: 7번 잠금 해제", page.get_attribute("#slide-7", "data-locked") == "0", page.get_attribute("#slide-7", "data-locked"))
            slide_bad, slide_metric = [], []
            for no in range(1, 31):
                page.evaluate("n => window.BojangDeck.goTo(n)", no)
                page.wait_for_timeout(45)
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
            check("Pro: 30장 전수 가로·세로 넘침 0", len(slide_bad) == 0, slide_bad[:5])
            worst = max((round(m["inner"] / m["stage"], 3), m["no"]) for m in slide_metric)
            check("Pro: 슬라이드 최대 세로 배율 1.12 이하", worst[0] <= 1.12, worst)
            page.evaluate("n => window.BojangDeck.goTo(n)", 7)
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(OUT, "v51-05-deck-pro-7.png"))
            page.click("#deck-home")
            page.wait_for_timeout(600)

            # =========================================================
            # 9. Pro PDF 1·10·30장 — 넘침 0, 워터마크 없음
            # =========================================================
            page.click('[data-home-go="analysis"]')
            page.wait_for_timeout(400)
            page.click("#btn-analyze")
            page.wait_for_timeout(700)
            for kind, pages in (("summary", 1), ("detail", 10), ("advisor", 30)):
                out = page.evaluate("""async (kind) => {
                  const r = await BojangApp.buildPdfBlob(kind);
                  return { pages: r.pages, size: r.blob.size, overflow: r.overflow, watermark: r.watermark, ms: r.ms };
                }""", kind)
                check(f"Pro: PDF {kind} {pages}페이지 · 넘침 0", out["pages"] == pages and len(out["overflow"]) == 0,
                      f"pages={out['pages']} overflow={out['overflow']} {out['size']//1024}KB")
                check(f"Pro: PDF {kind} 워터마크 없음", not out["watermark"], out["watermark"])
            page.evaluate("() => { document.getElementById('pdf-overlay').hidden = true; }")

            # =========================================================
            # 10. Pro 고객 저장 2명째
            # =========================================================
            page.fill("#cust-label", "프로고객2")
            page.click("#btn-save")
            page.wait_for_timeout(500)
            check("Pro: 고객 2명째 저장", page.inner_text("#home-hist-count").strip() == "2건", page.inner_text("#home-hist-count"))
            check("Pro: 저장 시 페이월 없음", not page.is_visible("#paywall"), page.is_visible("#paywall"))

            # =========================================================
            # 11. Pro 리모델링 — 계약 정리 + 보강 → 보험료·점수 변화
            # =========================================================
            page.evaluate("""() => {
              const st = window.__bojangState;
              st.contracts = [
                { id: 'c1', insurer: 'A화재', product: '갱신형 실손', premium: 4, pay: 'paying', maturity: '100' },
                { id: 'c2', insurer: 'B생명', product: '종신보험', premium: 12, pay: 'paying', maturity: 'life' },
                { id: 'c3', insurer: 'C손보', product: '운전자보험', premium: 3, pay: 'paying', maturity: '80' }
              ];
              st.premium = 27;
              localStorage.setItem('bojang.remodel.v1', JSON.stringify({ acts: {}, cuts: {}, boosts: {}, extra: {}, comment: '' }));
            }""")
            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.click('[data-home-go="remodel"]')
            page.wait_for_timeout(700)
            check("Pro: 계약 정리안 UI", page.eval_on_selector_all(".rm-contract", "e => e.length") == 3, page.eval_on_selector_all(".rm-contract", "e => e.length"))
            page.click('[data-ct="c2"] [data-act="reduce"]')
            page.wait_for_timeout(300)
            page.click('[data-ct="c3"] [data-act="close"]')
            page.wait_for_timeout(300)
            page.fill('[data-boost="care"]', "30")
            page.fill('[data-extra="care"]', "2")
            page.fill('[data-boost="surgery"]', "300")
            page.fill('[data-extra="surgery"]', "1")
            page.wait_for_timeout(600)
            kpi = page.inner_text(".rm-hero-grid")
            check("Pro: 보험료 변화 계산 (27→22만원)", "22" in kpi and "5만원 절감" in kpi, kpi.replace("\n", " | "))
            nums = page.eval_on_selector_all(".rm-kpi-num strong", "e => e.map(x => x.innerText.trim())")
            check("Pro: After 점수 숫자 노출", nums and nums[-1].isdigit(), nums)
            score_delta = page.inner_text(".rm-kpi:nth-child(2) .rm-delta")
            check("Pro: 점수 상승 표시", "상승" in score_delta, score_delta)
            table = page.inner_text(".rm-table")
            check("Pro: 5대 담보 After 수치", "🔒" not in table and table.count("%") >= 10, table.replace("\n", " | ")[:120])
            surgery_after = page.eval_on_selector('.rm-axis[data-axis="surgery"] .rma-bar:nth-child(2) b', "e => e.innerText")
            check("Pro: 수술 After 게이지 갱신", surgery_after.endswith("%") and surgery_after != "68%", surgery_after)
            care_note = page.inner_text('.rm-axis[data-axis="care"] .rma-now')
            check("Pro: 권장선 이상 담보 안내", "이미 권장선 이상" in care_note, care_note)
            page.click("#rm-auto")
            page.wait_for_timeout(300)
            comment = page.input_value("#rm-comment")
            check("Pro: 설계사 한 줄 제안 자동 작성", len(comment) > 25 and "만원" in comment, comment[:80])
            page.screenshot(path=os.path.join(OUT, "v51-06-remodel-pro.png"), full_page=True)

            # 리모델링 1장 PDF
            pdf = page.evaluate("""async () => {
              const old = PDFKit.saveBlob; let saved = null;
              PDFKit.saveBlob = async (blob, name) => { saved = { blob, name }; return 'ok'; };
              await BojangRemodel.pdf();
              PDFKit.saveBlob = old;
              const buf = await saved.blob.arrayBuffer(); const u = new Uint8Array(buf);
              let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
              return { name: saved.name, size: saved.blob.size, data: btoa(s) };
            }""")
            import base64
            with open(os.path.join(OUT, "v51-remodel.pdf"), "wb") as f:
                f.write(base64.b64decode(pdf["data"]))
            check("Pro: 리모델링 비교 PDF 생성", pdf["size"] > 60000 and "리모델링" in pdf["name"], f"{pdf['size']//1024}KB {pdf['name']}")

            # =========================================================
            # 12. Pro 화이트라벨 — 저장 → 헤더·메인·테마·PDF
            # =========================================================
            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.click('[data-home-go="brand"]')
            page.wait_for_timeout(500)
            page.fill("#bf-name", "김한기 종합금융")
            page.fill("#bf-slogan", "가족의 하루를 지키는 보장 설계")
            page.fill("#bf-consultant", "김한기")
            page.fill("#bf-title", "보험설계사")
            page.fill("#bf-phone", "010-4908-4175")
            page.fill("#bf-kakao", "@보험에반하다")
            page.click('[data-theme="navy"]')
            page.wait_for_timeout(300)
            page.click("#brand-save")
            page.wait_for_timeout(700)
            hdr = page.inner_text(".brand-text h1").replace("\n", "")
            check("Pro: 상호 → 헤더 반영", "김한기" in hdr and "종합금융" in hdr, hdr)
            check("Pro: 슬로건 → 헤더 반영", page.inner_text(".brand-text p") == "가족의 하루를 지키는 보장 설계", page.inner_text(".brand-text p"))
            check("Pro: 상호 → 메인 허브 반영", "김한기 종합금융" in page.inner_text("#home-brand-name"), page.inner_text("#home-brand-name"))
            theme = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--rose').trim()")
            check("Pro: 테마 네이비 적용", theme.upper() == "#3A6EA5", theme)
            hdr_bg = page.evaluate("getComputedStyle(document.querySelector('.app-header')).backgroundImage")
            check("Pro: 헤더 그라데이션 네이비", "rgb(22, 41, 62)" in hdr_bg, hdr_bg[:90])
            page.screenshot(path=os.path.join(OUT, "v51-07-brand-pro.png"), full_page=True)

            # PDF 표지·꼬리말에 브랜드 텍스트가 실제로 그려지는지 (Canvas text 호출 캡처)
            texts = page.evaluate("""async () => {
              const orig = PDFKit.Sheet.prototype.text;
              const out = [];
              PDFKit.Sheet.prototype.text = function (s, x, y, o) { out.push(String(s)); return orig.call(this, s, x, y, o); };
              await BojangApp.buildPdfBlob('summary');
              PDFKit.Sheet.prototype.text = orig;
              return out;
            }""")
            joined = " | ".join(texts)
            check("Pro: PDF 표지 상호 반영", "종합금융" in joined, joined[:120])
            check("Pro: PDF 꼬리말·연락처 반영", "010-4908-4175" in joined and "김한기 종합금융" in joined, "010-4908-4175" in joined)
            page.evaluate("() => { document.getElementById('pdf-overlay').hidden = true; }")

            # 30장 덱 표지에도 브랜드
            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.evaluate("() => { window.__bojangState.view = 'client'; }")
            page.click('[data-home-go="client"]')
            page.wait_for_timeout(800)
            cover = page.inner_text("#slide-1")
            check("Pro: 고객 30장 표지 브랜드", "김한기 종합금융" in cover, cover[:80].replace("\n", " | "))
            check("Pro: 표지 연락처 라인", "010-4908-4175" in cover, "010-4908-4175" in cover)
            page.screenshot(path=os.path.join(OUT, "v51-08-cover-brand.png"))
            page.click("#deck-home")
            page.wait_for_timeout(500)

            # =========================================================
            # 13. 산출물 · 서비스워커
            # =========================================================
            sw = open(os.path.join(ROOT, "sw.js"), encoding="utf-8").read()
            check("서비스워커 캐시 v5.1", "bojang-guide-v5.1" in sw and "./monetize.js" in sw, "bojang-guide-v5.1" in sw)
            doc = open(os.path.join(ROOT, "docs", "backend-architecture.md"), encoding="utf-8").read()
            check("백엔드 설계서 존재", all(k in doc for k in ["Supabase", "subscriptions", "RLS", "토스페이먼츠", "Edge Functions", "암호화"]), len(doc))

            real_errors = [e for e in errors if "favicon" not in e.lower()]
            check("콘솔 오류 0", len(real_errors) == 0, real_errors[:3])
            browser.close()
    finally:
        httpd.shutdown()

    ok = sum(1 for _, o, _ in results if o)
    print(f"\n{ok}/{len(results)} 통과")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
