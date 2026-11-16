#!/usr/bin/env python3
"""보장분석 라이프 리포트 v5.2 베타 — Playwright 자동 검증.

실행: python3 tests/test_v5_2.py
검증:
  · 중립 기본값(서비스명·부제·Classic Navy 테마, 특정 브랜드 미노출)
  · 베타 기간 전 기능 무료(30장 전체·1/10/30장 PDF·고객 30명·코드 상세·청구 복사·리모델링 After·브랜드 저장)
  · 베타 배너/모달 문구, 정식 출시 예정가 월 5,000원 / 연 50,000원 (29,000원 표기 부재)
  · 베타 피드백 Google Form 링크(target=_blank rel=noopener noreferrer)와 추첨 사은품 문구
  · 화이트라벨 로고 업로드(파일 → DataURL → 미리보기 → 헤더·고객 표지·PDF)
  · 30장 전수 넘침 0 · PDF 1/10/30장 넘침 0 · 리모델링 보험료/점수 계산 · 콘솔 오류 0
  · 대표 스크린샷 4장을 reports/bojang-guide/screenshots/에 저장
"""
import base64
import functools
import http.server
import os
import re
import socket
import socketserver
import sys
import threading
import time

# 이 환경의 번들 Chromium은 별도 공유 라이브러리가 필요합니다(없으면 시스템 기본값 사용).
for _libs in ("/workspace/tmp/libs/usr/lib/x86_64-linux-gnu", "/workspace/.pwlibs/root/usr/lib/x86_64-linux-gnu"):
    if os.path.isdir(_libs):
        os.environ.setdefault("LD_LIBRARY_PATH", _libs)
        break

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out")
SHOTS = "/workspace/reports/bojang-guide/screenshots"
os.makedirs(OUT, exist_ok=True)
os.makedirs(SHOTS, exist_ok=True)

FEEDBACK_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc2euPXcpWELiGYsBMod8tdC6cWWhPP_I3WgwIfc8zp6aRXUg/viewform"
GIFT = "피드백 참여 시 추첨을 통해 1년 무료 이용권 1매 · 1개월 무료 이용권 10매를 드립니다"


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


def make_logo(path):
    """업로드 테스트용 160×160 PNG 로고 (네이비 사각 + 흰 글자)."""
    try:
        from PIL import Image, ImageDraw
    except Exception:
        # PIL이 없으면 1×1 PNG라도 사용합니다.
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        with open(path, "wb") as f:
            f.write(png)
        return
    img = Image.new("RGB", (160, 160), "#16293E")
    d = ImageDraw.Draw(img)
    d.rectangle([18, 18, 142, 142], outline="#9CC3E6", width=6)
    d.text((46, 62), "HR", fill="#FFFFFF")
    img.save(path)


def main():
    logo_path = os.path.join(OUT, "v52-logo.png")
    make_logo(logo_path)
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
            page.wait_for_timeout(600)
            page.evaluate("() => { localStorage.clear(); }")
            page.reload(wait_until="load")
            page.wait_for_timeout(900)

            # =========================================================
            # 1. 중립 기본값 — 서비스명·부제·네이비·특정 브랜드 미노출
            # =========================================================
            title = page.title()
            check("타이틀 v5.2 이상 · 중립 서비스명", "보장분석 라이프 리포트" in title and re.search(r"v\d+\.\d+", title) is not None, title)
            h1 = page.inner_text(".brand-text h1").replace("\n", "")
            check("헤더 기본 브랜드 = 보장분석 라이프 리포트", h1 == "보장분석 라이프 리포트", h1)
            sub = page.inner_text(".brand-text p")
            check("헤더 부제", sub == "고객 맞춤형 보장 점검 · 리모델링 상담 가이드", sub)
            check("메인 허브 브랜드", page.inner_text("#home-brand-name").replace("\n", "") == "보장분석 라이프 리포트", page.inner_text("#home-brand-name"))
            check("메인 허브 슬로건", page.inner_text("#home-brand-slogan") == sub, page.inner_text("#home-brand-slogan"))
            body = page.inner_text("body")
            check("특정 브랜드 기본 노출 0", "보험에 반하다" not in body and "보험에반하다" not in body, "보험에 반하다" in body)
            theme = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--rose').trim()")
            check("기본 테마 네이비 (#3A6EA5)", theme.upper() == "#3A6EA5", theme)
            check("data-brand-theme=navy", page.evaluate("document.documentElement.dataset.brandTheme") == "navy", page.evaluate("document.documentElement.dataset.brandTheme"))
            hdr_bg = page.evaluate("getComputedStyle(document.querySelector('.app-header')).backgroundImage")
            check("헤더 그라데이션 네이비", "rgb(12, 27, 44)" in hdr_bg or "rgb(22, 41, 62)" in hdr_bg, hdr_bg[:90])
            cards = page.eval_on_selector_all(".home-grid .hg-card", "els => els.map(e => e.innerText.replace(/\\n/g,' '))")
            check("메인 메뉴 14종", len(cards) == 14, len(cards))
            check("Pro 예정 카드 2종에 BETA 무료 뱃지", page.eval_on_selector_all(".hg-card.pro-card em", "e => e.map(x => x.innerText.trim())") == ["BETA 무료", "BETA 무료"], page.eval_on_selector_all(".hg-card.pro-card em", "e => e.map(x => x.innerText)"))
            page.screenshot(path=os.path.join(SHOTS, "v52-01-home.png"))

            # =========================================================
            # 2. 베타 배너 · 플랜 배지 · 전 기능 무료
            # =========================================================
            check("플랜 배지 = 베타 무료", page.inner_text("#plan-badge").strip() == "베타 무료", page.inner_text("#plan-badge"))
            bar = page.inner_text("#beta-bar")
            check("상단 베타 배너 문구", "베타 테스트 기간" in bar and "무료" in bar and "베타 피드백 남기기" in bar, bar.replace("\n", " | "))
            banner = page.inner_text("#home-plan-banner")
            check("메인 베타 배너 문구", "베타 기간" in banner and "Pro 전 기능 무료" in banner and "정식 출시 전 베타 테스트 기간으로 Pro 전 기능을 무료로 제공하고 있습니다" in banner, banner.replace("\n", " | ")[:120])
            check("베타: PDF 버튼 잠금 0", page.eval_on_selector_all(".pdf-btn.is-locked", "e => e.length") == 0, page.eval_on_selector_all(".pdf-btn.is-locked", "e => e.length"))
            check("베타: 최대 30건 저장 안내", "30건" in page.inner_text("#home-load-sub"), page.inner_text("#home-load-sub"))
            content = page.content()
            check("29,000원 표기 제거", "29,000" not in content and "290,000" not in content, "29,000" in content)

            # 피드백 링크 (상단 바 + 메인 카드)
            links = page.eval_on_selector_all("[data-feedback]", "els => els.map(a => ({href:a.getAttribute('href'), target:a.getAttribute('target'), rel:a.getAttribute('rel'), text:a.innerText.trim()}))")
            check("피드백 링크 2곳 이상", len(links) >= 2, len(links))
            check("피드백 링크 URL", all(l["href"] == FEEDBACK_URL for l in links), [l["href"] for l in links])
            check("피드백 링크 새 탭 · noopener", all(l["target"] == "_blank" and "noopener" in (l["rel"] or "") and "noreferrer" in (l["rel"] or "") for l in links), links)
            card = page.inner_text("#beta-feedback-card")
            check("메인 피드백 카드 · 추첨 사은품 문구", GIFT in card, card.replace("\n", " | ")[:120])
            check("메인 피드백 링크 버튼", page.is_visible("#beta-feedback-card a[data-feedback]"), page.inner_text("#beta-feedback-card a"))

            # =========================================================
            # 3. 베타 안내 모달 — 문구 · 요금제 · 피드백 · 사은품
            # =========================================================
            # v5.4부터 플랜 배지는 계정/구독 모달을 엽니다 - 베타 안내 모달은 BojangPlan.openBetaModal 로 직접 확인
            page.click("#plan-badge")
            page.wait_for_timeout(500)
            check("플랜 배지 → 계정/구독 모달", page.is_visible("#account-modal") or page.is_visible("#beta-modal"), (page.is_visible("#account-modal"), page.is_visible("#beta-modal")))
            page.evaluate("() => { if (window.BojangPlan && BojangPlan.closePlanModal) BojangPlan.closePlanModal(); const el = document.getElementById('account-modal'); if (el) el.hidden = true; }")
            page.evaluate("() => BojangPlan.openBetaModal('plan')")
            page.wait_for_timeout(300)
            check("베타 모달 열림", page.is_visible("#beta-modal"), page.is_visible("#beta-modal"))
            modal = page.inner_text("#beta-modal")
            check("베타 모달 무료 문구", "정식 출시 전 베타 테스트 기간으로 Pro 전 기능을 무료로 제공하고 있습니다" in modal, modal[:120].replace("\n", " | "))
            check("베타 모달 월 5,000원", "월 5,000원" in modal, "월 5,000원" in modal)
            check("베타 모달 연 50,000원", "연 50,000원" in modal, "연 50,000원" in modal)
            check("베타 모달 추첨 사은품", GIFT in modal, GIFT in modal)
            mlink = page.eval_on_selector("#beta-modal [data-feedback]", "a => ({href:a.getAttribute('href'), target:a.getAttribute('target'), rel:a.getAttribute('rel')})")
            check("베타 모달 피드백 링크", mlink["href"] == FEEDBACK_URL and mlink["target"] == "_blank" and "noopener" in mlink["rel"], mlink)
            page.screenshot(path=os.path.join(SHOTS, "v52-02-beta-modal.png"))
            page.click("#bm-close")
            page.wait_for_timeout(200)
            check("베타 모달 닫힘", not page.is_visible("#beta-modal"), page.is_visible("#beta-modal"))

            # =========================================================
            # 4. 고객 30장 — 베타 전 기능 무료(7번 잠금 0, 페이월 0)
            # =========================================================
            page.click('.viewswitch button[data-mode="client"]')
            page.wait_for_timeout(900)
            check("30장 덱 열림", page.inner_text("#deck-now").strip() == "01", page.inner_text("#deck-now"))
            check("베타: 7번 잠금 해제", page.get_attribute("#slide-7", "data-locked") == "0", page.get_attribute("#slide-7", "data-locked"))
            check("베타: 잠금 카드 0", page.eval_on_selector_all(".slide-lock", "e => e.length") == 0, page.eval_on_selector_all(".slide-lock", "e => e.length"))
            for _ in range(6):
                page.click("#deck-next")
                page.wait_for_timeout(160)
            check("베타: 7번까지 이동 · 페이월 없음", page.inner_text("#deck-now").strip() == "07" and not page.is_visible("#paywall") and not page.is_visible("#beta-modal"), (page.inner_text("#deck-now"), page.is_visible("#paywall")))
            slide_bad, slide_metric = [], []
            for no in range(1, 31):
                page.evaluate("n => window.BojangDeck.goTo(n)", no)
                page.wait_for_timeout(40)
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
            check("베타: 30장 전수 가로·세로 넘침 0", len(slide_bad) == 0, slide_bad[:5])
            worst = max((round(m["inner"] / m["stage"], 3), m["no"]) for m in slide_metric)
            check("베타: 슬라이드 최대 세로 배율 1.12 이하", worst[0] <= 1.12, worst)
            page.click("#deck-home")
            page.wait_for_timeout(500)

            # =========================================================
            # 5. 베타 PDF — 1·10·30장 모두 무료, 워터마크 없음
            # =========================================================
            page.evaluate("() => BojangApp.openMoreMenu(true)")
            page.wait_for_timeout(120)
            page.click('[data-home-go="analysis"]')
            page.wait_for_timeout(400)
            page.click("#btn-analyze")
            page.wait_for_timeout(800)
            for kind, pages in (("summary", 1), ("detail", 10), ("advisor", 30)):
                out = page.evaluate("""async (kind) => {
                  const r = await BojangApp.buildPdfBlob(kind);
                  return { pages: r.pages, size: r.blob.size, overflow: r.overflow, watermark: r.watermark, meta: window.__lastPdf };
                }""", kind)
                check(f"베타: PDF {kind} {pages}페이지 · 넘침 0", out["pages"] == pages and len(out["overflow"]) == 0,
                      f"pages={out['pages']} overflow={out['overflow']} {out['size']//1024}KB")
                check(f"베타: PDF {kind} 워터마크 없음", not out["watermark"] and not out["meta"]["watermark"], out["watermark"])
            page.evaluate("() => { document.getElementById('pdf-overlay').hidden = true; }")
            check("베타: 10·30장 PDF 잠금 안내 없음", not page.is_visible("#paywall"), page.is_visible("#paywall"))
            neutral_texts = page.evaluate("""async () => {
              const out = [];
              const orig = PDFKit.Sheet.prototype.text;
              PDFKit.Sheet.prototype.text = function (s, x, y, o) { out.push(String(s)); return orig.call(this, s, x, y, o); };
              await BojangApp.buildPdfBlob('summary');
              PDFKit.Sheet.prototype.text = orig;
              return out.join(' | ');
            }""")
            check("PDF 표지·꼬리말 중립 상호", "보장분석 라이프 리포트" in neutral_texts and "보험에 반하다" not in neutral_texts, neutral_texts[:160])
            page.evaluate("() => { document.getElementById('pdf-overlay').hidden = true; }")

            # =========================================================
            # 6. 베타 고객 저장 — 2명째도 저장
            # =========================================================
            page.evaluate("() => BojangStore.saveHistory([]).then(() => { BojangApp.state.history = []; BojangApp.renderHistory(); })")
            page.reload(wait_until="load")
            page.wait_for_timeout(700)
            page.evaluate("() => BojangApp.openMoreMenu(true)")
            page.wait_for_timeout(120)
            page.click('[data-home-go="analysis"]')
            page.wait_for_timeout(300)
            page.click("#btn-analyze")
            page.wait_for_timeout(600)
            page.fill("#cust-label", "베타고객1")
            page.click("#btn-save")
            page.wait_for_timeout(400)
            page.click("#btn-save")
            page.wait_for_timeout(500)
            check("베타: 고객 2명째 저장 · 페이월 없음", page.inner_text("#home-hist-count").strip() == "2건" and not page.is_visible("#paywall"), (page.inner_text("#home-hist-count"), page.is_visible("#paywall")))

            # =========================================================
            # 7. 베타 FC 도구 — 코드 상세·청구 복사 전부 무료
            # =========================================================
            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.evaluate("() => BojangApp.openMoreMenu(true)")
            page.wait_for_timeout(120)
            page.click('[data-home-go="codes"]')
            page.wait_for_timeout(500)
            total_codes = page.eval_on_selector_all(".code-card", "e => e.length")
            locked_codes = page.eval_on_selector_all(".code-card.is-locked", "e => e.length")
            check("베타: 질병코드 전체 열람", total_codes >= 50 and locked_codes == 0, f"{locked_codes}/{total_codes}")
            check("베타: 코드 복사 버튼 잠금 없음", page.eval_on_selector_all(".cc-copy.is-locked", "e => e.length") == 0, page.eval_on_selector_all(".cc-copy.is-locked", "e => e.length"))
            page.click(".code-card .cc-copy")
            page.wait_for_timeout(300)
            check("베타: 코드 복사 시 페이월 없음", not page.is_visible("#paywall"), page.is_visible("#paywall"))
            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.evaluate("() => BojangApp.openMoreMenu(true)")
            page.wait_for_timeout(120)
            page.click('[data-home-go="disclose"]')
            page.wait_for_timeout(500)
            claim_label = page.inner_text("#claim-copy")
            check("베타: 청구 복사 잠금 없음", "🔒" not in claim_label, claim_label)
            page.click("#claim-copy")
            page.wait_for_timeout(300)
            check("베타: 청구 복사 시 페이월 없음", not page.is_visible("#paywall"), page.is_visible("#paywall"))

            # =========================================================
            # 8. 베타 리모델링 — After 전체 + 계산
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
            page.evaluate("() => BojangApp.openMoreMenu(true)")
            page.wait_for_timeout(120)
            page.click('[data-home-go="remodel"]')
            page.wait_for_timeout(700)
            kpi = page.inner_text(".rm-hero-grid")
            check("베타: 리모델링 After 점수 노출", "🔒" not in kpi and page.eval_on_selector_all(".rm-kpi-num strong", "e => e.map(x => x.innerText.trim())")[-1].isdigit(), kpi.replace("\n", " | ")[:90])
            check("베타: After 잠금 배너 없음", page.eval_on_selector_all("[data-rm-upgrade]", "e => e.length") == 0, page.eval_on_selector_all("[data-rm-upgrade]", "e => e.length"))
            check("베타: 비교표 After 잠금 0", page.eval_on_selector_all(".rm-table .rm-mask", "e => e.length") == 0, page.eval_on_selector_all(".rm-table .rm-mask", "e => e.length"))
            page.click('[data-ct="c2"] [data-act="reduce"]')
            page.wait_for_timeout(250)
            page.click('[data-ct="c3"] [data-act="close"]')
            page.wait_for_timeout(250)
            page.fill('[data-boost="care"]', "30")
            page.fill('[data-extra="care"]', "2")
            page.fill('[data-boost="surgery"]', "300")
            page.fill('[data-extra="surgery"]', "1")
            page.wait_for_timeout(600)
            kpi = page.inner_text(".rm-hero-grid")
            check("베타: 보험료 변화 계산 (27→22만원)", "22" in kpi and "5만원 절감" in kpi, kpi.replace("\n", " | "))
            nums = page.eval_on_selector_all(".rm-kpi-num strong", "e => e.map(x => x.innerText.trim())")
            check("베타: After 점수 숫자", nums and nums[-1].isdigit(), nums)
            score_delta = page.inner_text(".rm-kpi:nth-child(2) .rm-delta")
            check("베타: 점수 상승 표시", "상승" in score_delta, score_delta)
            table = page.inner_text(".rm-table")
            check("베타: 5대 담보 After 수치", "🔒" not in table and table.count("%") >= 10, table.replace("\n", " | ")[:120])
            page.click("#rm-auto")
            page.wait_for_timeout(300)
            comment = page.input_value("#rm-comment")
            check("베타: 설계사 한 줄 제안 자동 작성", len(comment) > 25 and "만원" in comment, comment[:80])
            page.eval_on_selector(".rm-hero-grid", "e => e.scrollIntoView({ block: 'center' })")
            page.wait_for_timeout(400)
            page.screenshot(path=os.path.join(SHOTS, "v52-04-remodel.png"))
            pdf = page.evaluate("""async () => {
              const old = PDFKit.saveBlob; let saved = null;
              PDFKit.saveBlob = async (blob, name) => { saved = { blob, name }; return 'ok'; };
              await BojangRemodel.pdf();
              PDFKit.saveBlob = old;
              return { name: saved.name, size: saved.blob.size };
            }""")
            check("베타: 리모델링 비교 PDF 생성", pdf["size"] > 60000 and "리모델링" in pdf["name"], f"{pdf['size']//1024}KB {pdf['name']}")

            # =========================================================
            # 9. 화이트라벨 — 프리셋 · 로고 업로드 · 저장 → 헤더/표지/PDF
            # =========================================================
            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.evaluate("() => BojangApp.openMoreMenu(true)")
            page.wait_for_timeout(120)
            page.click('[data-home-go="brand"]')
            page.wait_for_timeout(500)
            check("브랜드 기본 초안 = 중립", page.input_value("#bf-name") == "보장분석 라이프 리포트", page.input_value("#bf-name"))
            check("프리셋 4종", page.eval_on_selector_all("[data-brand-preset]", "e => e.map(x => x.innerText.trim())") == ["기본 중립", "로즈 리포트", "에메랄드 리포트", "차콜 리포트"], page.eval_on_selector_all("[data-brand-preset]", "e => e.map(x => x.innerText)"))
            page.click('[data-brand-preset="rose"]')
            page.wait_for_timeout(300)
            rose_prev = page.eval_on_selector("#brand-preview", "e => e.style.getPropertyValue('--bp-accent').trim()")
            check("프리셋 로즈 리포트 적용 (미리보기)", page.input_value("#bf-name") == "로즈 라이프 리포트" and rose_prev.upper() == "#D96B70", (page.input_value("#bf-name"), rose_prev))
            page.click('[data-brand-preset="neutral"]')
            page.wait_for_timeout(300)
            check("프리셋 기본 중립 복귀", page.input_value("#bf-name") == "보장분석 라이프 리포트", page.input_value("#bf-name"))

            page.set_input_files("#bf-logo", logo_path)
            page.wait_for_timeout(700)
            thumb = page.eval_on_selector("#bf-logo-thumb img", "e => e.getAttribute('src') || ''")
            check("로고 미리보기 (base64 DataURL)", thumb.startswith("data:image/") and len(thumb) > 200, thumb[:40] + f" len={len(thumb)}")
            page.click("#bf-logo-clear")
            page.wait_for_timeout(250)
            check("로고 제거 → 기본 마크", page.inner_text("#bf-logo-thumb").strip() == "기본 마크" and page.eval_on_selector_all("#bp-logo img", "e => e.length") == 0, page.inner_text("#bf-logo-thumb"))
            page.set_input_files("#bf-logo", [])
            page.wait_for_timeout(150)
            page.set_input_files("#bf-logo", logo_path)
            page.wait_for_timeout(600)
            check("로고 재업로드", page.eval_on_selector_all("#bf-logo-thumb img", "e => e.length") == 1, page.inner_text("#bf-logo-thumb")[:30])
            page.fill("#bf-name", "김한기 종합금융")
            page.fill("#bf-slogan", "가족의 하루를 지키는 보장 설계")
            page.fill("#bf-consultant", "김한기")
            page.fill("#bf-title", "보험설계사")
            page.fill("#bf-phone", "010-4908-4175")
            page.fill("#bf-kakao", "@hanqi_channel")
            page.wait_for_timeout(200)
            page.click("#brand-save")
            page.wait_for_timeout(900)
            check("브랜드 저장 · 페이월 없음", not page.is_visible("#paywall") and not page.is_visible("#beta-modal"), (page.is_visible("#paywall"), page.is_visible("#beta-modal")))
            hdr = page.inner_text(".brand-text h1").replace("\n", "")
            check("상호 → 헤더 반영", "김한기" in hdr and "종합금융" in hdr, hdr)
            check("로고 → 헤더 반영", page.eval_on_selector(".brand-mark img.brand-logo", "e => (e.getAttribute('src')||'').startsWith('data:image/')"), page.eval_on_selector_all(".brand-mark img", "e => e.length"))
            check("로고 저장값 (base64)", page.evaluate("() => BojangBrand.get().logo.startsWith('data:image/')"), page.evaluate("() => BojangBrand.get().logo.slice(0,24)"))
            check("로고 미리보기 카드 반영", page.eval_on_selector_all("#bp-logo img", "e => e.length") == 1 and page.eval_on_selector("#bp-logo img", "e => (e.getAttribute('src')||'').startsWith('data:image/')"), page.eval_on_selector_all("#bp-logo img", "e => e.length"))
            check("상호 → 메인 허브 반영", "김한기 종합금융" in page.inner_text("#home-brand-name"), page.inner_text("#home-brand-name"))
            page.wait_for_timeout(3200)  # 저장 토스트가 사라진 뒤 대표 화면을 찍습니다
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(300)
            page.screenshot(path=os.path.join(SHOTS, "v52-03-whitelabel.png"))

            # PDF 표지·꼬리말 + 로고 픽셀 드로잉
            pdfinfo = page.evaluate("""async () => {
              const img = window.__brandLogoImg;
              let logoDraws = 0;
              const proto = CanvasRenderingContext2D.prototype;
              const od = proto.drawImage;
              proto.drawImage = function (...a) { if (img && a[0] === img) logoDraws++; return od.apply(this, a); };
              const texts = [];
              const ot = PDFKit.Sheet.prototype.text;
              PDFKit.Sheet.prototype.text = function (s, x, y, o) { texts.push(String(s)); return ot.call(this, s, x, y, o); };
              const out = await BojangApp.buildPdfBlob('summary');
              PDFKit.Sheet.prototype.text = ot; proto.drawImage = od;
              return { logo: !!img, logoDraws, pages: out.pages, overflow: out.overflow, texts: texts.join(' | ') };
            }""")
            check("PDF: 로고 이미지 실제 드로잉", pdfinfo["logo"] and pdfinfo["logoDraws"] >= 1 and pdfinfo["pages"] == 1 and len(pdfinfo["overflow"]) == 0, f"logo={pdfinfo['logo']} draws={pdfinfo['logoDraws']} pages={pdfinfo['pages']}")
            check("PDF: 표지·꼬리말 상호 반영", "김한기 종합금융" in pdfinfo["texts"], pdfinfo["texts"][:150])
            check("PDF: 꼬리말 연락처 반영", "010-4908-4175" in pdfinfo["texts"], "010-4908-4175" in pdfinfo["texts"])
            page.evaluate("() => { document.getElementById('pdf-overlay').hidden = true; }")

            page.click("#btn-home")
            page.wait_for_timeout(300)
            page.evaluate("() => BojangApp.openMoreMenu(true)")
            page.wait_for_timeout(120)
            page.click('[data-home-go="client"]')
            page.wait_for_timeout(900)
            cover = page.inner_text("#slide-1")
            check("고객 30장 표지 브랜드", "김한기 종합금융" in cover, cover[:80].replace("\n", " | "))
            check("고객 30장 표지 로고", page.eval_on_selector("#slide-1 .cb-heart img.brand-logo", "e => (e.getAttribute('src')||'').startsWith('data:image/')"), page.eval_on_selector_all("#slide-1 .cb-heart img", "e => e.length"))
            check("고객 표지 연락처", "010-4908-4175" in cover, "010-4908-4175" in cover)
            page.click("#deck-home")
            page.wait_for_timeout(400)

            # =========================================================
            # 10. 산출물 · 서비스워커 · 단일 HTML
            # =========================================================
            sw = open(os.path.join(ROOT, "sw.js"), encoding="utf-8").read()
            check("서비스워커 캐시 v5.2 이상", re.search(r"bojang-guide-v\d+\.\d+", sw) is not None, sw.strip().splitlines()[2] if sw else sw)
            doc = open(os.path.join(ROOT, "docs", "backend-architecture.md"), encoding="utf-8").read()
            check("백엔드 설계서 요금제 5,000/50,000", "5,000원/월" in doc and "50,000원/년" in doc and "29,000원" not in doc, [k for k in ("5,000원/월", "50,000원/년") if k in doc])
            single = os.path.join(ROOT, "dist", "bojang-guide.single.html")
            if os.path.exists(single):
                html = open(single, encoding="utf-8").read()
                check("단일 HTML: 중립·베타 반영", "보장분석 라이프 리포트" in html and "BETA 무료" in html and "29,000" not in html and "bojang-guide-v5.2" not in html and "bojang-guide-v5.3" not in html and "bojang-guide-v5.4" not in html, f"{len(html)//1024}KB")
                check("단일 HTML: 외부 참조 0", 'src="./' not in html and 'href="./' not in html, 'src="./' in html)
            else:
                check("단일 HTML 존재", False, single)

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
