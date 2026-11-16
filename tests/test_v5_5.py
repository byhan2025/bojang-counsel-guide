#!/usr/bin/env python3
"""보장분석 라이프 리포트 v5.5 — PDF 프리미엄 리포트 자동 검증.

실행: python3 tests/test_v5_5.py

검증:
  · 고객용 10장 상세에서 설계사 코칭 문구 0 (고객에게 이렇게 말합니다 · 외우지 말고 · s.script)
  · 30장 플랜북의 설계사 스크립트는 그대로 유지
  · 05·06·07·08·09p '담당자 소견' 박스 — 실제 고객 데이터 기반, 담당자 이름 표기
  · 10장 상세 ↔ 리모델링 비교기 자동 연동 (조정안 없음 = 권장 시뮬레이션 / 있음 = Before·After)
  · 실손 1·2세대 선택형 할인 특약 vs 5세대 전환 비교 카드
  · 화이트라벨 테마 색 통일 — 네이비 빌드에 옛 로즈 색 0, 로즈 빌드에 네이비 색 0
  · 표지·끝장 담당자 명함 (상호·슬로건·담당자·연락처·카톡·로고·총평)
  · 02p 진단비 합계 분해 정확도(암·치료비·뇌심장·수술 = 합계) · 월 보험료 적정성 안내
  · 05·06·07p 현실 치료비·간병비 근거
  · 1·10·30장 PDF 넘침 0 · 리모델링 1장 PDF 프리미엄 구성·넘침 0
  · v5.5 버전 표기(타이틀·헤더·sw·manifest) · 단일 HTML 최신 반영 · 콘솔 오류 0
"""
import functools
import http.server
import json
import os
import re
import socket
import socketserver
import sys
import threading
import time

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

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ((" · " + str(detail)) if detail else ""))
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
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return httpd, f"http://127.0.0.1:{port}"
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("server start failed")


BRAND_PHONE = "010-4908-4175"
BRAND_KAKAO = "@beopiskimjeu3"
BRAND_NAME = "김한기 종합금융"
BRAND = {
    "name": BRAND_NAME,
    "slogan": "고객의 하루를 지키는 보장 점검 · 리모델링 상담",
    "consultant": "김한기",
    "title": "보험설계사 · FC",
    "phone": BRAND_PHONE,
    "kakao": BRAND_KAKAO,
    "theme": "navy",
    "logo": "",
}
CONTRACTS = [
    {"id": "c1", "insurer": "A생명", "product": "무배당 종신보험", "premium": 12, "maturity": "100세", "renew": False, "pay": "납입중"},
    {"id": "c2", "insurer": "B화재", "product": "운전자보험", "premium": 5, "maturity": "80세", "renew": True, "pay": "납입중"},
    {"id": "c3", "insurer": "C손해", "product": "실손의료비", "premium": 3, "maturity": "100세", "renew": True, "pay": "납입중"},
]
REMODEL = {"acts": {"c1": "close", "c2": "reduce"}, "cuts": {"c2": 3},
           "boosts": {"cancer": 8000, "care": 15}, "extra": {"cancer": 12, "care": 4}, "comment": ""}
LEGACY_ROSE = ["#3A2628", "#E7CDC9", "#F0DEDB", "#5A3C3E", "#8C3A40", "#FDF5F4", "#FDF0F0",
               "#F3DCDB", "#FDF9F8", "#FDF2F1", "#FFF7F3", "#FFD47A", "#FFB4AC", "#E8A39B", "#D96B70"]
NAVY = ["#16293E", "#24476B", "#3A6EA5", "#EAF1F8", "#F5F8FB", "#9CC3E6", "#C4D8EA", "#2B5580"]


def make_logo(path):
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return ""
    img = Image.new("RGB", (160, 160), "#16293E")
    d = ImageDraw.Draw(img)
    d.rectangle([18, 18, 142, 142], outline="#9CC3E6", width=6)
    d.text((60, 62), "HK", fill="#FFFFFF")
    img.save(path)
    return path


def capture(script):
    """페이지 안에서 실행되는 헬퍼 — Sheet 메서드에 전달된 색과 텍스트를 모읍니다."""
    return """async (kind) => {
      const texts = [], colors = [], scripts = [];
      let imgs = 0;
      const C2D = CanvasRenderingContext2D.prototype;
      const odi = C2D.drawImage;
      C2D.drawImage = function () { if (this && this.canvas && this.canvas.width === PDFKit.PXW) imgs++; return odi.apply(this, arguments); };
      const S = PDFKit.Sheet.prototype;
      const ot = S.text, op = S.para, orc = S.rect, ol = S.line, os = S.script, od = S.donut;
      S.text = function (s, x, y, o) { texts.push(String(s)); if (o && o.color) colors.push(String(o.color)); return ot.call(this, s, x, y, o); };
      S.para = function (s, x, y, w, o) { texts.push(String(s)); if (o && o.color) colors.push(String(o.color)); return op.call(this, s, x, y, w, o); };
      S.rect = function (x, y, w, h, o) { if (o && o.fill) colors.push(String(o.fill)); if (o && o.stroke) colors.push(String(o.stroke)); return orc.call(this, x, y, w, h, o); };
      S.line = function (a, b, c, d, o) { if (o && o.color) colors.push(String(o.color)); return ol.call(this, a, b, c, d, o); };
      S.donut = function (cx, cy, r, segs, o) { (segs || []).forEach((s) => colors.push(String(s.color))); return od.call(this, cx, cy, r, segs, o); };
      S.script = function (x, y, w, o) { scripts.push(String((o && o.title) || 'script')); return os.call(this, x, y, w, o); };
      let out;
      try { out = await BojangApp.buildPdfBlob(kind); }
      finally { S.text = ot; S.para = op; S.rect = orc; S.line = ol; S.script = os; S.donut = od; }
      document.getElementById('pdf-overlay').hidden = true;
      C2D.drawImage = odi;
      return { pages: out.pages, overflow: out.overflow, size: out.blob.size, texts, colors, scripts, imgs };
    }"""


def main():
    logo_path = make_logo(os.path.join(OUT, "v55-logo.png"))
    httpd, base = start_server()
    url = base + "/index.html"
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"), args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=2)
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            page.set_default_timeout(20000)
            page.goto(url, wait_until="load")
            page.wait_for_timeout(600)
            page.evaluate("() => localStorage.clear()")
            page.reload(wait_until="load")
            page.wait_for_timeout(900)

            # =========================================================
            # 1. v5.5 버전 표기
            # =========================================================
            title = page.title()
            check("타이틀 v5.5 이상", any(v in title for v in ("v5.5", "v5.6", "v5.7", "v5.8", "v5.9")) and "보장분석 라이프 리포트" in title, title)
            check("헤더 버전 표기 v5.5 이상", any(v in page.inner_text(".hh-ver") for v in ("v5.5", "v5.6", "v5.7", "v5.8", "v5.9")), page.inner_text(".hh-ver"))
            check("헤더 eyebrow V5.5 이상", any(v in page.inner_text(".hh-eyebrow") for v in ("V5.5", "V5.6", "V5.7", "V5.8", "V5.9")), page.inner_text(".hh-eyebrow"))
            sw = read(os.path.join(ROOT, "sw.js"))
            check("서비스워커 캐시 v5.5 이상", any(v in sw for v in ("bojang-guide-v5.5", "bojang-guide-v5.6", "bojang-guide-v5.7", "bojang-guide-v5.8", "bojang-guide-v5.9")), sw.splitlines()[2])
            man = json.loads(read(os.path.join(ROOT, "manifest.json")))
            check("manifest v5.5 이상", any(v in man.get("name", "") for v in ("v5.5", "v5.6", "v5.7", "v5.8", "v5.9")), man.get("name"))

            # 소스 정적 검사 — 옛 로즈/와인 하드코딩 색 제거
            rep_src = read(os.path.join(ROOT, "report.js"))
            kit_src = read(os.path.join(ROOT, "pdfkit.js"))
            legacy_in_rep = [h for h in LEGACY_ROSE if ("'" + h + "'") in rep_src]
            check("report.js 옛 로즈 색 하드코딩 0", not legacy_in_rep, legacy_in_rep)
            check("detailPages 에 s.script 호출 0",
                  "s.script" not in rep_src[rep_src.index("function detailPages"):rep_src.index("function PLAYBOOK_CODES")],
                  "s.script" in rep_src[rep_src.index("function detailPages"):rep_src.index("function PLAYBOOK_CODES")])
            check("pdfkit 팔레트 토큰(hero·tint) 존재", "C.hero" in kit_src and "C.tint" in kit_src and "refreshTone" in kit_src, "hero/tint/refreshTone")

            # =========================================================
            # 2. 고객 세팅 — 계약·로그·브랜드
            # =========================================================
            brand = dict(BRAND)
            # 로고는 실제 업로드 경로(브랜드 화면 → 파일 선택 → DataURL 저장)로 넣습니다
            page.evaluate("() => BojangBrand.save(Object.assign({}, BojangBrand.get(), {name: '%s', slogan: '%s', consultant: '%s', title: '%s', phone: '%s', kakao: '%s', theme: 'navy'}), {silent: true})" % (
                BRAND_NAME, BRAND["slogan"], BRAND["consultant"], BRAND["title"], BRAND_PHONE, BRAND_KAKAO))
            page.evaluate("() => BojangApp.switchView('brand')")
            page.wait_for_timeout(500)
            if logo_path and page.query_selector("#bf-logo"):
                page.set_input_files("#bf-logo", logo_path)
                page.wait_for_timeout(1000)
                check("로고 파일 → DataURL 미리보기", page.evaluate("() => !!document.querySelector('#bp-logo img')"), page.evaluate("() => !!document.querySelector('#bp-logo img')"))
                page.click("#brand-save")
                page.wait_for_timeout(800)
            saved_logo = page.evaluate("() => !!(BojangBrand.get().logo || '').startsWith('data:image/')")
            check("로고 업로드 → 저장(DataURL)", saved_logo, page.evaluate("() => String(BojangBrand.get().logo).slice(0, 30)"))
            page.evaluate("() => BojangApp.switchView('home')")
            page.wait_for_timeout(400)
            check("브랜드 저장 — 상호·담당자·연락처", page.evaluate("() => { const b = BojangBrand.get(); return b.name === '%s' && b.consultant === '%s' && b.phone === '%s' && b.kakao === '%s'; }" % (BRAND_NAME, BRAND["consultant"], BRAND_PHONE, BRAND_KAKAO)), page.evaluate("() => JSON.stringify({n:BojangBrand.get().name,c:BojangBrand.get().consultant,p:BojangBrand.get().phone})"))
            page.wait_for_timeout(200)

            page.evaluate("""(cs) => {
              BojangApp.state.client.name = '김고객';
              BojangApp.state.client.consultant = '김한기';
              BojangApp.state.contracts = cs;
              BojangApp.analyze();
            }""", CONTRACTS)
            page.wait_for_timeout(300)

            # =========================================================
            # 3. 10장 상세 — 코칭 문구 제거 · 담당자 소견 · 현실 근거
            # =========================================================
            det = page.evaluate(capture("detail"), "detail")
            joined = " | ".join(det["texts"])
            check("상세 10페이지", det["pages"] == 10, det["pages"])
            check("상세 넘침 0", len(det["overflow"]) == 0, det["overflow"])
            check("코칭 문구 0 — '고객에게 이렇게 말합니다'", "고객에게 이렇게 말합니다" not in joined, "고객에게 이렇게 말합니다" in joined)
            check("코칭 문구 0 — '이렇게 말합니다'", "이렇게 말합니다" not in joined, "이렇게 말합니다" in joined)
            check("코칭 문구 0 — '외우지 말고'", "외우지 말고" not in joined, "외우지 말고" in joined)
            check("상세에 s.script 박스 0", len(det["scripts"]) == 0, det["scripts"])
            note_n = joined.count("담당자 소견")
            check("담당자 소견 4곳 이상(05·06·07·08·09p)", note_n >= 4, note_n)
            check("담당자 소견에 담당자 이름", "김한기 · " in joined, "김한기 ·" in joined)
            check("표지 명함 — 상호·담당자", BRAND_NAME in joined and "담당 설계사" in joined, "담당 설계사" in joined)
            check("표지·끝장 명함 — 연락처·카카오", BRAND_PHONE in joined and BRAND_KAKAO in joined, (BRAND_PHONE in joined, BRAND_KAKAO in joined))
            check("끝장 담당자 총평", "담당자 총평" in joined, "담당자 총평" in joined)
            check("명함 로고 픽셀 드로잉(표지·끝장)", det["imgs"] >= 2, det["imgs"])

            # 진단비 합계 정확도
            m = page.evaluate("() => { const b = BojangReport.build('detail', BojangApp.state); return { total: b.m.totalSum, prem: b.m.premium, score: b.m.score }; }")
            check("02p 주요 진단비 합계 표기", f"{m['total']:,}만원" in joined, m["total"])
            check("02p 진단비 분해 라벨", all(k in joined for k in ["암 진단비", "암 치료비 5종", "뇌·심장 진단비", "수술비 6축", "합계"]), [k for k in ["암 진단비", "암 치료비 5종", "뇌·심장 진단비", "수술비 6축"] if k not in joined])
            dx_acc = page.evaluate("""() => {
              const b = BojangReport.build('detail', BojangApp.state);
              const st = b.m.state, dd = b.m.dx;
              const cancer = Number(st.cov.cancer.general || 0) + Number(st.cov.cancer.similar || 0);
              const treat = BojangModel.treatSum(st);
              const neuro = Number(dd.brain.core || 0) + Number(dd.heart.core || 0);
              const sg = st.cov.surgery;
              const surg = ['disease','disease15','diseaseNdae','diseaseNonPay','injury','injury15'].reduce((a,k)=>a+Number(sg[k]||0),0);
              return { sum: cancer + treat + neuro + surg, total: b.m.totalSum };
            }""")
            check("진단비 분해 합 = 총합", dx_acc["sum"] == dx_acc["total"], dx_acc)
            check("월 보험료 적정성 안내(소득 7~10%)", "세후 월 소득의 7~10%" in joined or "세후 월 소득 약" in joined, "세후 월 소득 약" in joined)

            # 현실 비용 근거
            check("05p 표적·면역항암 근거", "표적항암제" in joined and "면역항암제" in joined, (표적 := "표적항암제" in joined, "면역항암제" in joined))
            check("05p 연 수천만 원대 표기", "연 수천만" in joined, "연 수천만" in joined)
            check("06p 뇌경색 입원 62.7일·2,562만원", "62.7일" in joined and "2,562만원" in joined, ("62.7일" in joined, "2,562만원" in joined))
            check("07p 간병 일당 12~15만원", "12~15만원" in joined, "12~15만원" in joined)
            check("07p 월 360~450만원", "360~450만원" in joined, "360~450만원" in joined)
            check("07p 2026년 7월 8시간 기준", "하루 8시간" in joined and "2026.7" in joined, ("하루 8시간" in joined, "2026.7" in joined))

            # 리모델링 자동 연동 (조정안 없음 → 권장 시뮬레이션)
            check("09p 리모델링 페이지", "리모델링 Before / After" in joined, "리모델링 Before / After" in joined)
            check("조정안 없음 → 권장 시뮬레이션 안내", "시뮬레이션" in joined and "권장 시뮬레이션" in joined, "권장 시뮬레이션" in joined)
            check("09p 5대 담보 Before/After 표", "Before" in joined and "After" in joined and "After 충족도" in joined, "After 충족도" in joined)
            check("09p 리모델링 3원칙", "리모델링 3원칙" in joined and "해지가 아니라 재배치" in joined, "리모델링 3원칙" in joined)

            # =========================================================
            # 4. 리모델링 조정안 입력 → Before/After 자동 반영
            # =========================================================
            page.evaluate("""(rm) => {
              localStorage.setItem('bojang.remodel.v1', JSON.stringify(rm));
              localStorage.setItem('bojang.brand.v1', JSON.stringify(BojangBrand.get()));
            }""", REMODEL)
            page.reload(wait_until="load")
            page.wait_for_timeout(900)
            page.evaluate("""(cs) => {
              BojangApp.state.client.name = '김고객';
              BojangApp.state.client.consultant = '김한기';
              BojangApp.state.contracts = cs;
              BojangApp.analyze();
            }""", CONTRACTS)
            page.wait_for_timeout(300)
            rem = page.evaluate(capture("detail"), "detail")
            rj = " | ".join(rem["texts"])
            calc = page.evaluate("() => { const c = BojangRemodel.calc(); return { before: c.beforePrem, after: c.afterPrem, dScore: c.scoreDelta, acts: c.contractRows.map(r => r.act) }; }")
            check("리모델링 조정안 → 09p 월 보험료 Before→After", f"{calc['before']} → {calc['after']}" in rj, (f"{calc['before']} → {calc['after']}" in rj, calc))
            check("09p 계약 정리안 배지(정리·감액)", "정리" in rj and "감액" in rj and "유지" in rj, ("정리" in rj, "감액" in rj))
            check("09p 보강 설계안", "보강 설계안" in rj and "추가 보험료" in rj, "보강 설계안" in rj)
            check("09p 소견이 조정안 반영 문장", "조정안" in rj and "늘어나는 부담" in rj, "늘어나는 부담" in rj)
            check("조정안 반영 상세 넘침 0", len(rem["overflow"]) == 0, rem["overflow"])

            # =========================================================
            # 5. 실손 1·2세대 → 선택형 할인 특약 vs 5세대 전환
            # =========================================================
            page.evaluate("() => { BojangApp.state.silson = '2'; BojangApp.state.premium = 31; BojangApp.analyze(); }")
            page.wait_for_timeout(200)
            sil = page.evaluate(capture("detail"), "detail")
            sj = " | ".join(sil["texts"])
            check("실손 2세대 → 두 갈래 비교 카드", "선택형 할인 특약" in sj and "5세대 전환" in sj, ("선택형 할인 특약" in sj, "5세대 전환" in sj))
            check("실손 비교 — 보험료·내용·되돌리기·주의", all(k in sj for k in ["보험료:", "내용:", "되돌리기:", "주의:"]), [k for k in ["보험료:", "내용:", "되돌리기:", "주의:"] if k not in sj])
            check("실손 2세대 제목", "실손 2세대 — 두 가지 선택" in sj, "실손 2세대 — 두 가지 선택" in sj)
            check("실손 2세대 상세 넘침 0", len(sil["overflow"]) == 0, sil["overflow"])

            # =========================================================
            # 6. 테마 색 통일 — 네이비 빌드 / 로즈 빌드
            # =========================================================
            page.evaluate("() => { BojangApp.state.silson = '4'; BojangApp.state.premium = 27; BojangApp.analyze(); }")
            page.wait_for_timeout(150)
            navy_build = page.evaluate(capture("detail"), "detail")
            navy_colors = set(navy_build["colors"])
            bad_navy = sorted([c for c in navy_colors if c.upper() in LEGACY_ROSE and c.upper() not in ("#3A6EA5",)])
            # 네이비 테마의 wine 은 #16293E 이므로 옛 로즈 색이 남아 있으면 잡힙니다
            check("네이비 빌드에 옛 로즈 색 0", not bad_navy, bad_navy)
            check("네이비 빌드 대표색 = 테마 네이비", "#16293E" in {c.upper() for c in navy_colors} and "#3A6EA5" in {c.upper() for c in navy_colors}, sorted({c.upper() for c in navy_colors})[:12])

            page.evaluate("() => BojangBrand.save(Object.assign({}, BojangBrand.get(), { theme: 'rose' }), {silent: true})")
            page.wait_for_timeout(300)
            rose_build = page.evaluate(capture("detail"), "detail")
            rose_colors = {c.upper() for c in rose_build["colors"]}
            bad_rose = sorted([c for c in rose_colors if c in NAVY])
            check("로즈 빌드에 네이비 잔재 0", not bad_rose, bad_rose)
            check("로즈 빌드 히어로 = 테마 와인(#3A2628)", "#3A2628" in rose_colors, "#3A2628" in rose_colors)
            check("로즈 빌드 포인트 = 테마 로즈(#D96B70)", "#D96B70" in rose_colors, "#D96B70" in rose_colors)
            check("로즈 빌드 넘침 0", len(rose_build["overflow"]) == 0, rose_build["overflow"])
            page.screenshot(path=os.path.join(SHOTS, "v55-01-home-rose.png"))

            # =========================================================
            # 7. 30장 플랜북 — 설계사 스크립트 유지 · 넘침 0
            # =========================================================
            page.evaluate("() => BojangBrand.save(Object.assign({}, BojangBrand.get(), { theme: 'navy' }), {silent: true})")
            page.wait_for_timeout(300)
            adv = page.evaluate(capture("advisor"), "advisor")
            aj = " | ".join(adv["texts"])
            check("30장 플랜북 30페이지", adv["pages"] == 30, adv["pages"])
            check("플랜북 넘침 0", len(adv["overflow"]) == 0, adv["overflow"])
            check("플랜북 설계사 스크립트 유지", len(adv["scripts"]) >= 5 and ("이렇게 말합니다" in aj or "판독" in aj), (len(adv["scripts"]), "이렇게 말합니다" in aj))
            check("플랜북 상호·담당자 유지", BRAND_NAME in aj and "설계사용" in aj, "설계사용" in aj)

            # 요약 1장
            summ = page.evaluate(capture("summary"), "summary")
            check("1장 요약 1페이지 · 넘침 0", summ["pages"] == 1 and len(summ["overflow"]) == 0, (summ["pages"], summ["overflow"]))

            # =========================================================
            # 8. 리모델링 1장 PDF — 프리미엄 구성 · 넘침 0
            # =========================================================
            page.evaluate("""(rm) => { localStorage.setItem('bojang.remodel.v1', JSON.stringify(rm)); }""", REMODEL)
            page.reload(wait_until="load")
            page.wait_for_timeout(900)
            page.evaluate("""(cs) => { BojangApp.state.client.name = '김고객'; BojangApp.state.client.consultant = '김한기'; BojangApp.state.contracts = cs; BojangApp.analyze(); }""", CONTRACTS)
            page.wait_for_timeout(200)
            rp = page.evaluate("""async () => {
              const texts = [], over = [];
              const S = PDFKit.Sheet.prototype, ot = S.text, op = S.para;
              S.text = function (s, x, y, o) { texts.push(String(s)); return ot.call(this, s, x, y, o); };
              S.para = function (s, x, y, w, o) { texts.push(String(s)); return op.call(this, s, x, y, w, o); };
              const old = PDFKit.saveBlob; let saved = null;
              PDFKit.saveBlob = async (blob, name) => { saved = { size: blob.size, name }; return 'ok'; };
              const orp = PDFKit.renderPages;
              PDFKit.renderPages = async (drawers, opts) => { const r = await orp(drawers, opts); over.push(...(opts.overflow || [])); return r; };
              try { await BojangRemodel.pdf(); } finally { PDFKit.saveBlob = old; PDFKit.renderPages = orp; S.text = ot; S.para = op; }
              return { saved, over, texts };
            }""")
            rtj = " | ".join(rp["texts"])
            check("리모델링 PDF 생성", rp["saved"] and rp["saved"]["size"] > 60000 and "리모델링" in rp["saved"]["name"], rp["saved"])
            check("리모델링 PDF 넘침 0", not rp["over"], rp["over"])
            check("리모델링 PDF — 담당자 제안·3원칙·확인", all(k in rtj for k in ["담당자 제안", "리모델링 3원칙", "진행 전 확인할 것"]), [k for k in ["담당자 제안", "리모델링 3원칙", "진행 전 확인할 것"] if k not in rtj])
            check("리모델링 PDF — 명함·연락처", BRAND_NAME in rtj and BRAND_PHONE in rtj and BRAND_KAKAO in rtj, (BRAND_NAME in rtj, BRAND_PHONE in rtj, BRAND_KAKAO in rtj))

            # =========================================================
            # 9. 단일 HTML 반영 · 콘솔
            # =========================================================
            single = read(os.path.join(ROOT, "dist", "bojang-guide.single.html"))
            check("단일 HTML — v5.5 이상 문구", any(v in single for v in ("v5.5", "v5.6", "v5.7", "v5.8", "v5.9")) and "리모델링 Before / After" in single and "담당자 소견" in single, "v5.6" in single)
            check("단일 HTML — 외부 참조 0", single.count('src="./') == 0 and single.count('href="./') == 0, (single.count('src="./'), single.count('href="./')))
            console_errors = [e for e in errors if "favicon" not in e.lower()]
            check("콘솔 오류 0", len(console_errors) == 0, console_errors[:3])

            browser.close()
    finally:
        httpd.shutdown()

    passed = sum(1 for _, ok, _ in results if ok)
    print("\n%d/%d 통과" % (passed, len(results)))
    if passed != len(results):
        print("실패:")
        for n, ok, d in results:
            if not ok:
                print(" -", n, "|", d)
        sys.exit(1)


if __name__ == "__main__":
    main()
