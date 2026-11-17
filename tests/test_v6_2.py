#!/usr/bin/env python3
"""보장분석 라이프 리포트 v6.2 — 흐름 배너 · 로그인 없는 샘플 체험 · 데이터 흐름 도식 · AI 면책.

실행: python3 tests/test_v6_2.py

검증 축
  A. 버전 v6.2 통일(version.js · sw · manifest · index · README · 단일 HTML)
  B. 첫 화면 흐름 배너 — ①입력 → ②분석 → ③PDF, 3버튼 위 배치, 360px 겹침 0 · 12px 이상
  C. 로그인 없는 샘플 체험 — 30장 슬라이드 즉시 열림, 배지 표시,
     세션(localStorage)·상담 이력(IndexedDB)·클라우드와 완전 격리, 종료 시 원상 복구
  D. 개인정보처리방침 데이터 흐름 1장 도식 — 3단계·보관/삭제 정책, 과장 표현 없음
  E. AI 보조자료 면책 — 분석 결과 화면 + 1·10·30장 PDF 전 페이지 꼬리말
  F. PDF 3종 페이지 수·넘침 0 · 콘솔 오류 0 · 대표 스크린샷 저장
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
SHOTS = "/workspace/reports/bojang-guide/v6.2"
os.makedirs(OUT, exist_ok=True)
os.makedirs(SHOTS, exist_ok=True)

DISCLAIMER = "본 자료는 상담 이해를 돕기 위한 보조 자료이며, 보험회사의 공식 심사·보장 판단·보험금 지급 결정을 대신하지 않습니다."

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


# 실제 상담 1건(샘플 아님) — 샘플 체험 전후로 이 값이 그대로여야 합니다.
REAL_STATE = """() => {
  const s = BojangApp.state;
  s.sample = false; s.sampleMode = false;
  s.client = { name: '박정훈', consultant: '보반 과장', birth: '1979-09-09', dateLabel: '2026년 11월 17일' };
  s.age = '40'; s.gender = '남'; s.job = '2'; s.silson = '2'; s.silson2 = 'early'; s.premium = 31;
  s.cov = { cancer:{ general:4000, similar:0, treatment:{surgery:500,drug:0,radio:0,icu:0,extra:0}, recur:false },
    brain:{ dx:{vascular:0,stroke:1000,bleed:0}, treat:{lysis:0,surgery:0,icu:0} },
    heart:{ dx:{ischemic:1000,ami:0}, treat:{lysis:0,surgery:0,icu:0} },
    surgery:{ disease:20, disease15:50, diseaseNdae:0, diseaseNonPay:0, injury:0, injury15:0 },
    care:{ daily:0, nDaily:0, basis:'unknown', family:'conditional', nursing:false, ltc:false, mode:'normal' },
    custom:{ cancer:[], brain:[], heart:[], surgery:[], care:[] } };
  s.contracts = [{ insurer:'한빛생명', product:'종합보험', premium:11, pay:'납입중', maturity:'100세', renew:false }];
  s.family = ['cancer']; s.flags = { renew: true };
  s.disc = { m5_htn: true };
  BojangModel.normalizeState(s);
  BojangApp.renderAllInputs();
  BojangApp.analyze();
  /* 실제 상담을 세션(localStorage)에 확정 저장 — 샘플 체험은 이 값을 건드리면 안 됩니다 */
  BojangApp.discTouched();
}"""


def main():
    httpd, base = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"),
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
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
            VER = (re.findall(r"const APP_VERSION = '([^']+)'", ver) or [""])[0]
            # v7.0 — 버전 표기는 version.js 상수를 기준으로 읽습니다(이후 버전에서도 회귀 검사로 유지)
            check("version.js 단일 상수", bool(re.fullmatch(r"v\d+\.\d+(\.\d+)?", VER)) and len(re.findall(r"const APP_VERSION = '([^']+)'", ver)) == 1, VER)
            check("window.APP_VERSION = " + VER, pg.evaluate("() => window.APP_VERSION") == VER)
            check("sw 캐시 bojang-guide-" + VER, ("const CACHE = 'bojang-guide-%s';" % VER) in read(os.path.join(ROOT, "sw.js")))
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest " + VER, VER in man.get("name", ""), man.get("name"))
            check("manifest — v6.2 신기능 설명 유지", all(k in man.get("description", "") for k in ("흐름 배너", "샘플 체험", "데이터 흐름", "면책")), man.get("description", "")[-80:])
            check("README v6.2 절", "## v6.2에서 달라진 것" in read(os.path.join(ROOT, "README.md")))
            html = read(os.path.join(ROOT, "index.html"))
            check("index — title " + VER, ("리포트 %s ·" % VER) in html)
            check("index — meta app-version " + VER, ('<meta name="app-version" content="%s">' % VER) in html)
            check("index — 정적 표기 v6.1 잔재 0", "data-app-version-label>v6.1" not in html and "data-app-version>v6.1" not in html)
            check("화면 표기 " + VER, pg.inner_text(".hh-ver").strip().startswith(VER), pg.inner_text(".hh-ver"))

            # =========================================================
            # B. 첫 화면 흐름 배너
            # =========================================================
            pg.evaluate(REAL_STATE)
            pg.wait_for_timeout(500)
            pg.evaluate("() => BojangApp.switchView('home')")
            pg.wait_for_timeout(300)
            banner = pg.evaluate("""() => {
              const fb = document.getElementById('flow-banner');
              const three = document.getElementById('home-three');
              if (!fb) return null;
              return {
                text: fb.innerText,
                steps: fb.querySelectorAll('.fb-step').length,
                arrows: fb.querySelectorAll('.fb-arrow').length,
                beforeThree: !!(fb.compareDocumentPosition(three) & Node.DOCUMENT_POSITION_FOLLOWING),
                inHero: !!fb.closest('.home-hero'),
                visible: fb.getBoundingClientRect().height > 40
              };
            }""")
            check("흐름 배너 존재", banner and banner["visible"], banner)
            check("흐름 배너 3단계 · 화살표 2개", banner and banner["steps"] == 3 and banner["arrows"] == 2, banner and [banner["steps"], banner["arrows"]])
            bt = (banner or {}).get("text", "").replace("\n", " ")
            check("흐름 ① 증권 촬영·간편 입력", "①" in bt and "증권 촬영·간편 입력" in bt, bt[:80])
            check("흐름 ② 5대 담보·약관·KCD 분석", "②" in bt and "5대 담보·약관·KCD 분석" in bt, bt[:120])
            check("흐름 ③ 1·10·30장 PDF·카톡", "③" in bt and "1·10·30장 PDF" in bt and "카톡" in bt, bt[-80:])
            check("흐름 배너가 3버튼 위", bool(banner and banner["beforeThree"] and banner["inHero"]), banner and banner["beforeThree"])
            check("첫 화면 3버튼 순서 유지", pg.evaluate("""() => Array.from(document.querySelectorAll('#home-three .hh-three')).map(b => b.id)""")
                  == ["btn-start-consult", "btn-home-load", "btn-live-start"])

            # 1280 스크린샷(참고) 후 360px 검증
            pg.evaluate("() => { const el=document.getElementById('flow-banner'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 130); }")
            pg.wait_for_timeout(300)
            pg.screenshot(path=os.path.join(SHOTS, "ui-home-banner.png"))

            pg2 = ctx.new_page()
            errs2 = []
            pg2.on("pageerror", lambda e: errs2.append(str(e)))
            pg2.on("console", lambda m: errs2.append(m.text) if m.type == "error" else None)
            pg2.set_viewport_size({"width": 360, "height": 740})
            pg2.goto(base + "/index.html")
            pg2.wait_for_timeout(900)
            pg2.evaluate("() => { const b=document.querySelector('#tour-invite-later'); if(b) b.click(); }")
            pg2.evaluate("() => { const m=document.getElementById('more-menu'); if(m) m.hidden=true; const el=document.getElementById('flow-banner'); el.scrollIntoView({block:'start'}); }")
            pg2.wait_for_timeout(400)
            m360 = pg2.evaluate("""() => {
              const fb = document.getElementById('flow-banner');
              const box = fb.getBoundingClientRect();
              let xover = 0, minFont = 99, minSel = '';
              fb.querySelectorAll('*').forEach((e) => {
                if (!e.textContent.trim()) return;
                const b = e.getBoundingClientRect();
                if (b.width && (b.right > box.right + 0.5 || b.left < box.left - 0.5)) xover++;
                const fs = parseFloat(getComputedStyle(e).fontSize) || 0;
                if (fs && fs < minFont) { minFont = fs; minSel = (e.className || e.tagName) + ''; }
              });
              return { sw: fb.scrollWidth, cw: fb.clientWidth, xover, minFont, minSel,
                       w: Math.round(box.width), h: Math.round(box.height),
                       docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth };
            }""")
            check("360px 배너 가로 넘침 0", m360["xover"] == 0 and m360["sw"] <= m360["cw"] + 2, m360)
            check("360px 배너 글자 12px 이상", m360["minFont"] >= 12, [m360["minFont"], m360["minSel"]])
            check("360px 문서 가로 넘침 0", m360["docOver"] <= 0, m360["docOver"])
            sample_btn = pg2.evaluate("""() => { const b=document.getElementById('btn-sample-demo');
              const r=b.getBoundingClientRect(); return { text: b.innerText, h: Math.round(r.height), w: Math.round(r.width), fs: parseFloat(getComputedStyle(b.querySelector('b')).fontSize) }; }""")
            check("360px 샘플 체험 버튼 노출", "30장 샘플" in sample_btn["text"] and sample_btn["w"] > 280 and sample_btn["h"] > 40, sample_btn)
            check("360px 샘플 버튼 제목 12px 이상", sample_btn["fs"] >= 12, sample_btn["fs"])
            pg2.evaluate("() => { const el=document.getElementById('flow-banner'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 126); }")
            pg2.wait_for_timeout(300)
            pg2.screenshot(path=os.path.join(SHOTS, "ui-home-banner-sample.png"))

            # =========================================================
            # C. 로그인 없는 샘플 체험 (완전 격리)
            # =========================================================
            before = pg.evaluate("""() => ({
              session: localStorage.getItem('bojang.session.v4'),
              name: BojangApp.state.client.name,
              premium: BojangApp.state.premium,
              hist: BojangApp.state.history.length,
              analyzed: BojangApp.state.analyzed
            })""")
            check("샘플 전 — 실제 상담 세션 저장됨", bool(before["session"]) and before["name"] == "박정훈", before["name"])

            # 클라우드 동기화 호출 감시
            pg.evaluate("""() => {
              window.__cloudCalls = 0;
              const B = window.BojangBackend;
              if (B) {
                ['syncConsultation', 'syncClient'].forEach((k) => {
                  if (typeof B[k] === 'function') {
                    const orig = B[k].bind(B);
                    B[k] = (e) => { window.__cloudCalls++; return orig(e); };
                  }
                });
              }
            }""")

            login_off = pg.evaluate("() => !(window.BojangBackend && BojangBackend.hasSession && BojangBackend.hasSession())")
            check("샘플 체험 — 로그인 없이 시작", login_off, login_off)

            pg.click("#btn-sample-demo")
            pg.wait_for_timeout(1200)
            sample = pg.evaluate("""() => {
              const slides = Array.from(document.querySelectorAll('.slide'));
              const cover = document.querySelector('.slide[data-no="1"] .sl-inner');
              return {
                mode: !!BojangApp.state.sampleMode, sample: !!BojangApp.state.sample,
                view: BojangApp.state.view, deck: !document.getElementById('deck').hidden,
                slides: slides.length, total: document.getElementById('deck-total').textContent,
                bar: document.getElementById('sample-bar').hidden ? '' : document.getElementById('sample-bar').innerText,
                barVisible: !document.getElementById('sample-bar').hidden,
                cover: cover ? cover.innerText : '',
                name: BojangApp.state.client.name,
                nextDisabled: document.getElementById('deck-next').disabled
              };
            }""")
            check("샘플 체험 — 로그인 없이 30장 열림", sample["deck"] and sample["view"] == "client" and sample["slides"] == 30, [sample["deck"], sample["view"], sample["slides"]])
            check("샘플 체험 — 배지 '샘플 체험 모드(가상 데이터)'", "샘플 체험 모드(가상 데이터)" in sample["bar"] and sample["barVisible"], sample["bar"])
            check("샘플 체험 — 표지 가상 고객 김서연", "김서연" in sample["cover"], sample["cover"][:60])
            check("샘플 체험 — 표지 샘플 경고", "샘플 데이터" in sample["cover"])
            check("샘플 체험 — 첫 장에서 다음 장 가능", sample["nextDisabled"] is False, sample["nextDisabled"])

            # 7장·23장 넘겨 보기 (30장 전체 동작)
            pg.evaluate("() => { BojangDeck.goTo(7, true); }")
            pg.wait_for_timeout(350)
            d7 = pg.evaluate("""() => ({ text: document.querySelector('.slide[data-no="7"]').innerText,
                                       now: document.getElementById('deck-now').textContent })""")
            check("샘플 체험 — 7장 암 상세 렌더", d7["now"] == "07" and len(d7["text"]) > 80, d7["now"])
            pg.evaluate("() => { BojangDeck.goTo(1, true); }")
            pg.wait_for_timeout(250)

            # 샘플 체험 중 1·10·30장 PDF 바로 열기 (체험 전용 메뉴)
            menu = pg.evaluate("""() => {
              const b = document.getElementById('btn-sample-pdf');
              b.click();
              const m = document.getElementById('sb-menu');
              return { open: !m.hidden, items: Array.from(m.querySelectorAll('[data-sample-pdf]')).map(x => x.dataset.samplePdf),
                       text: m.innerText, expanded: b.getAttribute('aria-expanded') };
            }""")
            check("샘플 체험 — PDF 3종 메뉴 (1·10·30장)", menu["open"] and menu["items"] == ["summary", "detail", "advisor"], menu["items"])
            check("샘플 체험 — PDF 메뉴 문구", all(k in menu["text"] for k in ("1장 요약", "10장 상세", "30장 플랜북")), menu["text"])
            pg.evaluate("() => document.getElementById('btn-sample-pdf').click()")
            pg.wait_for_timeout(200)

            # 저장·이력·클라우드 격리
            iso = pg.evaluate("""() => {
              const B = BojangApp.state;
              /* 샘플 중 상담 저장 버튼을 눌러도 이력·클라우드에 남으면 안 됩니다 */
              const btn = document.getElementById('btn-save');
              if (btn) btn.click();
              return {
                session: localStorage.getItem('bojang.session.v4'),
                hist: B.history.length,
                cloud: window.__cloudCalls || 0,
                toast: document.getElementById('toast').textContent
              };
            }""")
            check("샘플 중 — 세션(localStorage) 덮어쓰지 않음", iso["session"] == before["session"], "session changed")
            check("샘플 중 — 상담 이력 저장 차단", iso["hist"] == before["hist"], [iso["hist"], before["hist"]])
            check("샘플 중 — 클라우드 전송 0건", iso["cloud"] == 0, iso["cloud"])
            check("샘플 중 — 저장 차단 안내", "샘플" in iso["toast"] and "저장" in iso["toast"], iso["toast"])

            hist_db = pg.evaluate("""async () => {
              try { const list = await BojangStore.loadHistory(); return list.length; } catch (e) { return -1; }
            }""")
            check("샘플 중 — IndexedDB 이력 무변경", hist_db == before["hist"], [hist_db, before["hist"]])

            # 샘플 모드에서도 1·10·30장 PDF는 열린다(체험 목적)
            pdf_sample = pg.evaluate("""async () => {
              const b = await BojangApp.buildPdfBlob('summary');
              return { pages: b.pages, overflow: b.overflow.length, name: b.model.client.name };
            }""")
            check("샘플 체험 — 로그인 없이 PDF 생성", pdf_sample["pages"] == 1 and pdf_sample["overflow"] == 0 and pdf_sample["name"] == "김서연", pdf_sample)
            # 직접 buildPdfBlob을 부르면 진행 오버레이가 남으므로 닫아 줍니다(실사용은 doPdf가 닫음)
            pg.evaluate("() => { const o=document.getElementById('pdf-overlay'); if (o) o.hidden = true; }")

            # 종료 → 원상 복구
            pg.click("#btn-sample-exit")
            pg.wait_for_timeout(900)
            after = pg.evaluate("""() => ({
              mode: !!BojangApp.state.sampleMode, view: BojangApp.state.view,
              deckHidden: document.getElementById('deck').hidden,
              barHidden: document.getElementById('sample-bar').hidden,
              name: BojangApp.state.client.name, premium: BojangApp.state.premium,
              hist: BojangApp.state.history.length,
              session: localStorage.getItem('bojang.session.v4'),
              home: document.getElementById('view-home').classList.contains('is-active'),
              bodySample: document.body.classList.contains('is-sample')
            })""")
            check("체험 종료 — 샘플 모드 해제", after["mode"] is False and after["deckHidden"] and after["barHidden"] and not after["bodySample"], after)
            check("체험 종료 — 실제 상담 복원(고객·보험료)", after["name"] == before["name"] and after["premium"] == before["premium"], [after["name"], after["premium"]])
            check("체험 종료 — 세션 원본 유지", after["session"] == before["session"], "session changed")
            check("체험 종료 — 이력·화면 유지", after["hist"] == before["hist"] and after["home"], [after["hist"], after["home"]])

            # 로그인 없이 열린 30장 샘플 — 실제 폰 화면(360px)으로 촬영
            pg2.evaluate("() => BojangApp.openSampleDemo()")
            pg2.wait_for_timeout(1100)
            pg2.evaluate("() => BojangDeck.goTo(1, true)")
            pg2.wait_for_timeout(350)
            pg2.screenshot(path=os.path.join(SHOTS, "ui-sample-30slides.png"))
            m_sample = pg2.evaluate("() => ({ deck: !document.getElementById('deck').hidden, total: document.getElementById('deck-total').textContent, bar: document.getElementById('sample-bar').innerText })")
            check("360px 샘플 체험 — 30장·배지 유지", m_sample["deck"] and m_sample["total"] == "30" and "샘플 체험 모드" in m_sample["bar"], m_sample)
            pg2.evaluate("() => BojangApp.exitSampleDemo()")
            pg2.wait_for_timeout(600)

            # =========================================================
            # D. 데이터 흐름 1장 도식 (개인정보처리방침)
            # =========================================================
            pg.evaluate("() => BojangApp.legal.open('privacy')")
            pg.wait_for_timeout(500)
            flow = pg.evaluate("""() => {
              const host = document.querySelector('#legal-body .lg-flow');
              if (!host) return null;
              return {
                nodes: Array.from(host.querySelectorAll('.lgf-node')).map((n) => n.innerText),
                arrows: host.querySelectorAll('.lgf-arrow').length,
                keeps: Array.from(host.querySelectorAll('.lgf-keep')).map((k) => k.innerText),
                text: host.innerText
              };
            }""")
            check("방침 — 데이터 흐름 도식 존재", bool(flow and len(flow["nodes"]) == 3 and flow["arrows"] == 2), flow and [len(flow["nodes"]), flow["arrows"]])
            n0, n1, n2 = (flow or {}).get("nodes", ["", "", ""])
            check("도식 ① 브라우저 로컬 계산 · IndexedDB", "브라우저 로컬 계산" in n0 and "IndexedDB" in n0, n0[:60])
            check("도식 ② 자체 서버 저장 · Supabase(서울)", "자체 서버 저장" in n1 and "Supabase" in n1 and "서울" in n1, n1[:60])
            # v7.1.1 — 실제 코드(OpenAI 경로 또는 사용자 지정 Gemini 포함 최대 4개 모델 후보)에 맞춘 문구입니다.
            check("도식 ③ 사진 AI 인식 · 실제 전송 경로", "사진 AI 인식" in n2 and "Edge Function" in n2 and "외부 AI" in n2 and "최대 4개 모델 후보" in n2, n2[:80])
            check("도식 — 단계별 보관/삭제 정책 3건", len((flow or {}).get("keeps", [])) == 3 and all("보관" in k or "보증" in k for k in (flow or {}).get("keeps", [])), (flow or {}).get("keeps"))
            check("도식 — 사진 서버 미저장 명시", "저장하지 않고" in n2 or "사진 저장 0건" in n2, n2[:80])
            check("도식 — 즉시 삭제 보증 불가", "보증하지 않음" in n2, n2)
            full_legal = pg.evaluate("() => document.getElementById('legal-body').innerText")
            check("방침 — '1회 전송·즉시 삭제' 단정 없음", "1회 전송" not in full_legal, "")
            check("방침 — 로그인/사진 없으면 ②③ 미사용 명시", "로그인하지 않으면" in full_legal and "사진 AI 인식을 쓰지 않으면" in full_legal, "")
            secs = pg.evaluate("() => document.querySelectorAll('#legal-body .lg-sec').length")
            check("방침 — 기존 8개 조항 유지", secs >= 8, secs)
            # 도식 전체가 한 장에 담기도록 세로로 긴 화면에서 촬영합니다(모달은 그대로)
            pg.set_viewport_size({"width": 900, "height": 1280})
            pg.wait_for_timeout(450)
            pg.evaluate("() => { const b=document.getElementById('legal-body'); if (b) b.scrollTop = 0; }")
            pg.wait_for_timeout(200)
            pg.screenshot(path=os.path.join(SHOTS, "ui-data-flow-modal.png"))
            pg.set_viewport_size({"width": 1280, "height": 900})
            pg.wait_for_timeout(350)
            terms_flow = pg.evaluate("""() => { BojangApp.legal.render('terms'); return document.querySelectorAll('#legal-body .lg-flow').length; }""")
            check("이용약관 탭에는 도식 없음", terms_flow == 0, terms_flow)
            pg.evaluate("() => BojangApp.legal.close()")

            # 360px 모달에서 도식 세로 배치·넘침 0
            pg.evaluate("() => { BojangApp.state.sampleMode = false; }")
            pg2.evaluate("() => BojangApp.legal.open('privacy')")
            pg2.wait_for_timeout(500)
            mflow = pg2.evaluate("""() => {
              const host = document.querySelector('#legal-body .lg-flow');
              if (!host) return null;
              const box = host.getBoundingClientRect();
              let xover = 0;
              host.querySelectorAll('.lgf-node, .lgf-arrow, .lgf-head b').forEach((e) => {
                const b = e.getBoundingClientRect();
                if (b.width && (b.right > box.right + 0.5 || b.left < box.left - 0.5)) xover++;
              });
              const nodes = Array.from(host.querySelectorAll('.lgf-node')).map((n) => Math.round(n.getBoundingClientRect().top));
              return { xover, stacked: nodes[1] > nodes[0] + 10, sw: host.scrollWidth, cw: host.clientWidth };
            }""")
            check("360px 도식 — 세로 배치·넘침 0", mflow and mflow["xover"] == 0 and mflow["stacked"] and mflow["sw"] <= mflow["cw"] + 2, mflow)
            pg2.evaluate("() => BojangApp.legal.close()")
            pg2.screenshot(path=os.path.join(SHOTS, "ui-home-360.png"))

            # =========================================================
            # E. AI 보조자료 면책 — 화면 + PDF 전 페이지
            # =========================================================
            pg.evaluate(REAL_STATE)
            pg.wait_for_timeout(500)
            pg.evaluate("() => BojangApp.switchView('analysis')")
            pg.wait_for_timeout(400)
            screen_disc = pg.evaluate("""() => {
              const el = document.getElementById('ai-disclaimer');
              if (!el) return null;
              const cs = getComputedStyle(el);
              return { text: el.innerText.replace(/\\s+/g, ' ').trim(), visible: el.offsetHeight > 0, fs: parseFloat(cs.fontSize) };
            }""")
            check("결과 화면 — 면책 문구 존재", screen_disc and DISCLAIMER in screen_disc["text"], screen_disc and screen_disc["text"][:60])
            check("결과 화면 — 면책 문구 보임", screen_disc and screen_disc["visible"], screen_disc)

            pdf = pg.evaluate("""async () => {
              const out = {};
              for (const k of ['summary', 'detail', 'advisor']) {
                const b = await BojangApp.buildPdfBlob(k);
                let withDisc = 0, total = 0;
                b.build = BojangReport.build(k, BojangApp.state);
                b.build.pages.forEach((fn, i) => {
                  const sh = new PDFKit.Sheet();
                  let txt = '';
                  const ot = sh.text.bind(sh), op = sh.para.bind(sh);
                  sh.text = (t, ...a) => { txt += String(t) + '\\n'; return ot(t, ...a); };
                  sh.para = (t, ...a) => { txt += String(t) + '\\n'; return op(t, ...a); };
                  fn(sh, i + 1);
                  total++;
                  if (txt.indexOf('공식 심사·보장 판단·보험금 지급 결정을 대신하지 않습니다') >= 0) withDisc++;
                });
                out[k] = { pages: b.pages, overflow: b.overflow.length, total, withDisc };
              }
              return out;
            }""")
            for k, label in (("summary", "1장"), ("detail", "10장"), ("advisor", "30장")):
                v = pdf[k]
                expect = 1 if k == "summary" else (10 if k == "detail" else 30)
                check("PDF %s — %d페이지 · 넘침 0" % (label, expect), v["pages"] == expect and v["overflow"] == 0, v)
                check("PDF %s — 전 페이지 면책 문구" % label, v["withDisc"] == v["total"] == expect, [v["withDisc"], v["total"]])

            # =========================================================
            # F. 스크린샷 · 빌드 · 콘솔
            # =========================================================
            data_url = pg.evaluate("""() => {
              const b = BojangReport.build('summary', BojangApp.state);
              const sh = new PDFKit.Sheet();
              b.pages[0](sh, 1);
              return sh.cv.toDataURL('image/png');
            }""")
            b64 = data_url.split(",", 1)[1]
            with open(os.path.join(SHOTS, "pdf-disclaimer-p1.png"), "wb") as f:
                f.write(base64.b64decode(b64))

            single = os.path.join(ROOT, "dist", "bojang-guide.single.html")
            sh_html = read(single)
            check("단일 HTML — 버전 표기", VER in sh_html and ('content="%s"' % VER) in sh_html, len(sh_html) // 1024)
            check("단일 HTML — 외부 참조 0", sh_html.count('<script src="http') == 0 and sh_html.count('<link href="http') == 0 and sh_html.count('<link rel="stylesheet" href="./') == 0, "")
            check("단일 HTML — 신규 문구 포함", all(k in sh_html for k in ("로그인 없이 30장 샘플 보기", "샘플 체험 모드(가상 데이터)", "DATA FLOW · 1장 요약", "공식 심사·보장 판단")))

            for f in ("ui-home-banner-sample.png", "ui-sample-30slides.png", "ui-data-flow-modal.png", "pdf-disclaimer-p1.png"):
                pth = os.path.join(SHOTS, f)
                check("스크린샷 " + f, os.path.exists(pth) and os.path.getsize(pth) > 12000, os.path.getsize(pth) if os.path.exists(pth) else "missing")

            check("콘솔 오류 0 (데스크톱)", len(errors) == 0, errors[:3])
            check("콘솔 오류 0 (360px)", len(errs2) == 0, errs2[:3])
            browser.close()
    finally:
        httpd.shutdown()

    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print("\n=== v6.2 테스트 %d/%d 통과 ===" % (passed, total))
    fails = [r for r in results if not r[1]]
    if fails:
        print("\n실패:")
        for n, _, d in fails:
            print(" -", n, "·", d)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
