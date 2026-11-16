#!/usr/bin/env python3
"""보장분석 라이프 리포트 v5.3 — Playwright 자동 검증.

실행: python3 tests/test_v5_3.py

검증:
  · 입력 방식 허브 3종(수기 · 사진 즉시 촬영 · PDF/텍스트) 선택 UI와 각 진입점
  · 사진 촬영 입력의 capture="environment" · 촬영 전 보안 고지 문구
  · 촬영본 처리 후 메모리 파기 배지 · localStorage/sessionStorage/IndexedDB 저장 0건
  · 실제 텍스트가 담긴 PDF(FlateDecode + UTF-16BE 16진 / ToUnicode CMap) 로컬 추출
  · 추출 결과 검수 화면 → state 반영 → 점수 재계산
  · 이미지 스캔 PDF(글자 없음) 안내
  · 한국어 보장분석표 텍스트 파싱 단위 검증(금액 단위 정규화 포함)
  · v5.2 회귀: 30장 넘침 0 · PDF 1/10/30장 넘침 0 · 리모델링 · 화이트라벨 · 콘솔 오류 0
  · 단일 HTML(dist) 외부 참조 0 · file:// 오프라인 동작
  · 대표 스크린샷 3장
"""
import base64
import functools
import http.server
import json
import os
import socket
import socketserver
import sys
import threading
import time
import zlib

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

SEC_NOTICE = ("이름·주민등록번호 등 민감정보는 가리고 담보표만 촬영해 주세요. "
              "촬영된 사진은 기기·서버 어디에도 저장되지 않고 분석 직후 메모리에서 즉시 파기됩니다.")
BADGE = "원본 사진 메모리 파기 완료 ✓ (저장 기록 0건)"
BETA_NOTE_KEYS = ["정적 베타", "95% 이상", "PDF 파일 올리기", "텍스트 붙여넣기"]


# =========================================================
# 테스트용 PDF 생성 (실제 텍스트가 든 PDF)
# =========================================================
def _obj(num, body):
    return f"{num} 0 obj\n{body}\nendobj\n"


def _stream_obj(num, dict_body, data):
    return (f"{num} 0 obj\n<< {dict_body} /Length {len(data)} >>\nstream\n".encode("latin-1")
            + data + b"\nendstream\nendobj\n")


def _assemble(objs, root=1):
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for num, chunk in objs:
        offsets[num] = len(out)
        out += chunk if isinstance(chunk, bytes) else chunk.encode("latin-1")
    xref = len(out)
    total = max(offsets) + 1
    out += f"xref\n0 {total}\n0000000000 65535 f \n".encode("latin-1")
    for i in range(1, total):
        out += f"{offsets.get(i, 0):010d} 00000 n \n".encode("latin-1")
    out += f"trailer\n<< /Size {total} /Root {root} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("latin-1")
    return bytes(out)


def _base_objs(resources):
    return [
        (1, _obj(1, "<< /Type /Catalog /Pages 2 0 R >>")),
        (2, _obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")),
        (3, _obj(3, f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << {resources} >> /Contents 4 0 R >>")),
    ]


def make_pdf_utf16(path, lines):
    """Type0 폰트 + FlateDecode 압축 + 16진(UTF-16BE) 문자열."""
    ops = ["BT", "/F1 11 Tf", "14 TL", "40 800 Td"]
    for ln in lines:
        ops.append(f"<{ln.encode('utf-16-be').hex().upper()}> Tj T*")
    ops.append("ET")
    content = zlib.compress("\n".join(ops).encode("latin-1"))
    objs = _base_objs("/Font << /F1 5 0 R >>") + [
        (5, _obj(5, "<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium /Encoding /Identity-H /DescendantFonts [6 0 R] >>")),
        (6, _obj(6, "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /HYSMyeongJo-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>")),
        (4, _stream_obj(4, "/Filter /FlateDecode", content)),
    ]
    objs.sort(key=lambda x: x[0])
    with open(path, "wb") as f:
        f.write(_assemble(objs))


def make_pdf_tounicode(path, lines):
    """ToUnicode CMap(1바이트 코드) + FlateDecode — 실제 한글 PDF의 흔한 구조."""
    chars = []
    for ln in lines:
        for ch in ln:
            if ch not in chars:
                chars.append(ch)
    mapping = {i + 1: ch for i, ch in enumerate(chars)}
    cmap = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
            "/CMapName /Adobe-Identity-UCS def", "1 begincodespacerange", "<00> <FF>", "endcodespacerange",
            f"{len(mapping)} beginbfchar"]
    for code, ch in mapping.items():
        cmap.append(f"<{code:02X}> <{ch.encode('utf-16-be').hex().upper()}>")
    cmap += ["endbfchar", "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
    cmap_data = "\n".join(cmap).encode("latin-1")

    rev = {v: c for c, v in mapping.items()}
    ops = ["BT", "/F1 11 Tf", "14 TL", "40 800 Td"]
    for ln in lines:
        ops.append(f"<{''.join(f'{rev[ch]:02X}' for ch in ln)}> Tj T*")
    ops.append("ET")
    content = zlib.compress("\n".join(ops).encode("latin-1"))
    objs = _base_objs("/Font << /F1 5 0 R >>") + [
        (5, _obj(5, "<< /Type /Font /Subtype /Type0 /BaseFont /NanumGothic /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>")),
        (6, _obj(6, "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NanumGothic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>")),
        (4, _stream_obj(4, "/Filter /FlateDecode", content)),
        (7, _stream_obj(7, "", cmap_data)),
    ]
    objs.sort(key=lambda x: x[0])
    with open(path, "wb") as f:
        f.write(_assemble(objs))


def make_pdf_image_only(path):
    """텍스트 스트림 없이 이미지만 있는(스캔) PDF."""
    fake_jpeg = bytes.fromhex("FFD8FFE000104A46494600010100000100010000FFD9")
    content = b"q 595 0 0 842 0 0 cm /Im0 Do Q"
    objs = _base_objs("/XObject << /Im0 5 0 R >>") + [
        (5, (f"5 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB "
             f"/BitsPerComponent 8 /Filter /DCTDecode /Length {len(fake_jpeg)} >>\nstream\n").encode("latin-1")
            + fake_jpeg + b"\nendstream\nendobj\n"),
        (4, _stream_obj(4, "", content)),
    ]
    objs.sort(key=lambda x: x[0])
    with open(path, "wb") as f:
        f.write(_assemble(objs))


def make_photo(path):
    """촬영 시뮬레이션용 담보표 사진."""
    try:
        from PIL import Image, ImageDraw
    except Exception:
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        with open(path, "wb") as f:
            f.write(png)
        return
    img = Image.new("RGB", (1200, 1600), "#ffffff")
    d = ImageDraw.Draw(img)
    d.text((80, 60), "COVERAGE TABLE", fill="#111111")
    for i in range(22):
        d.line([(80, 130 + i * 66), (1120, 130 + i * 66)], fill="#1b1b1b", width=5)
    img.save(path, "JPEG", quality=90)


# =========================================================
# 서버 · 검사 도우미
# =========================================================
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
    utf16_pdf = os.path.join(OUT, "v53-utf16.pdf")
    cmap_pdf = os.path.join(OUT, "v53-cmap.pdf")
    scan_pdf = os.path.join(OUT, "v53-scan.pdf")
    photo = os.path.join(OUT, "v53-photo.jpg")

    sample_lines = [
        "보장분석표 (샘플)",
        "일반암 진단비 4,000만원",
        "유사암 진단비 800만원",
        "뇌혈관질환 진단비 2,000만원",
        "월 보험료 21만원",
    ]
    make_pdf_utf16(utf16_pdf, sample_lines)
    make_pdf_tounicode(cmap_pdf, sample_lines)
    make_pdf_image_only(scan_pdf)
    make_photo(photo)

    httpd, base = start_server(ROOT)
    url = base + "/index.html"
    errors = []
    external = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME"),
                                        args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=2)
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            page.on("request", lambda r: external.append(r.url) if not r.url.startswith(base) and not r.url.startswith("data:") else None)
            page.set_default_timeout(15000)
            page.goto(url, wait_until="load")
            page.wait_for_timeout(600)
            page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
            page.reload(wait_until="load")
            page.wait_for_timeout(900)

            # =========================================================
            # 1. 버전 · 입력 방식 허브
            # =========================================================
            title = page.title()
            check("타이틀 v5.3 이상", ("v5.3" in title or "v5.4" in title or "v5.5" in title) and "보장분석 라이프 리포트" in title, title)
            check("메인 eyebrow V5.3 이상", ("V5.3" in page.inner_text(".hh-eyebrow") or "V5.4" in page.inner_text(".hh-eyebrow") or "V5.5" in page.inner_text(".hh-eyebrow")), page.inner_text(".hh-eyebrow"))
            check("메인 버전 표기", ("v5.3" in page.inner_text(".hh-ver") or "v5.4" in page.inner_text(".hh-ver") or "v5.5" in page.inner_text(".hh-ver")), page.inner_text(".hh-ver"))
            check("새 상담 시작 = 입력 방식 허브", "새 상담 시작" in page.inner_text("#btn-start-consult")
                  and page.get_attribute("#btn-start-consult", "data-inputhub") == "1", page.inner_text("#btn-start-consult"))

            page.click("#btn-start-consult")
            page.wait_for_timeout(350)
            check("허브 모달 열림", page.is_visible("#input-hub"), page.is_visible("#input-hub"))
            hub_text = page.inner_text("#input-hub")
            check("허브 제목", "어떻게 입력할까요?" in hub_text, page.inner_text("#ih-title"))
            opts = page.eval_on_selector_all("#input-hub .hub-opt", "els => els.map(e => e.getAttribute('data-mode'))")
            check("허브 3종 선택", opts == ["manual", "camera", "pdf"], opts)
            check("수기 입력 항목 문구", "수기 입력" in hub_text and "6단계 입력실" in hub_text and "한 화면 빠른 입력" in hub_text, hub_text[:60].replace("\n", " "))
            check("사진 즉시 촬영 · 휘발 표기", "사진 즉시 촬영" in hub_text and "휘발" in hub_text and "미저장" in hub_text, "휘발" in hub_text)
            check("PDF · 텍스트 항목 문구", "보장분석 PDF" in hub_text and "100% 로컬" in hub_text, "100% 로컬" in hub_text)
            page.screenshot(path=os.path.join(SHOTS, "v53-01-input-hub.png"))

            # 수기 입력 → 2가지 방식
            page.click('#input-hub [data-mode="manual"]')
            page.wait_for_timeout(250)
            check("수기 입력 선택 시 2방식 노출", page.is_visible("#ih-manual")
                  and page.inner_text("#ih-manual").count("입력") >= 2, page.inner_text("#ih-manual").replace("\n", " | "))
            page.click('#ih-manual [data-manual="quick"]')
            page.wait_for_timeout(500)
            check("한 화면 빠른 입력으로 이동", page.is_visible("#view-quick"), page.is_visible("#view-quick"))
            page.click("#view-quick [data-inputhub]")
            page.wait_for_timeout(250)
            page.click('#input-hub [data-mode="manual"]')
            page.wait_for_timeout(150)
            page.click('#ih-manual [data-manual="analysis"]')
            page.wait_for_timeout(500)
            check("6단계 입력실로 이동", page.is_visible("#view-analysis"), page.is_visible("#view-analysis"))
            check("입력실 상단 진입점", page.is_visible("#view-analysis .view-homebar [data-inputhub]"), True)
            check("위저드 상단 진입점", page.is_visible("#wizard [data-inputhub]"), True)
            check("빠른 입력 상단 진입점", page.eval_on_selector_all("#view-quick .view-homebar [data-inputhub]", "e => e.length") == 1, True)

            # =========================================================
            # 2. 사진 즉시 촬영 · 휘발
            # =========================================================
            page.click("#view-analysis [data-inputhub]")
            page.wait_for_timeout(250)
            page.click('#input-hub [data-mode="camera"]')
            page.wait_for_timeout(400)
            check("촬영 화면 열림", page.is_visible("#view-capture"), page.is_visible("#view-capture"))
            notice = page.inner_text("#cap-notice")
            check("촬영 전 보안 고지 문구", SEC_NOTICE in notice.replace("\n", " "), notice.replace("\n", " ")[:80])
            check("카메라 즉시 호출 속성", page.get_attribute("#cap-file", "capture") == "environment"
                  and "image" in (page.get_attribute("#cap-file", "accept") or ""),
                  (page.get_attribute("#cap-file", "accept"), page.get_attribute("#cap-file", "capture")))
            check("앨범 선택 아님 안내", "앨범" in page.inner_text(".cap-file-note"), page.inner_text(".cap-file-note")[:50])

            keys_before = page.evaluate("() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).sort().join(',')")
            page.set_input_files("#cap-file", photo)
            page.wait_for_timeout(1400)
            check("촬영 후 결과 표시", page.is_visible("#cap-result"), page.is_visible("#cap-result"))
            badge = page.inner_text("#cap-badge").strip()
            check("메모리 파기 배지", badge == BADGE, badge)
            meta = page.inner_text("#cap-meta").replace("\n", " ")
            check("전처리 통계 표시", "원본" in meta and "전처리" in meta and "대비" in meta, meta[:70])
            beta = page.inner_text("#cap-beta")
            check("정적 베타 한계 안내", all(k in beta for k in BETA_NOTE_KEYS), beta[:70])
            keys_after = page.evaluate("() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).sort().join(',')")
            check("저장소 키 변화 0", keys_before == keys_after, (keys_before, keys_after))
            leaked = page.evaluate("""() => {
              const dump = [];
              const grab = (store) => {
                for (let i = 0; i < store.length; i++) dump.push(store.getItem(store.key(i)) || '');
              };
              grab(localStorage); grab(sessionStorage);
              const big = dump.filter((v) => v.length > 2000).length;
              const img = dump.filter((v) => v.indexOf('data:image') >= 0 || v.indexOf('base64') >= 0).length;
              return { big, img, n: dump.length };
            }""")
            check("저장소에 이미지·대용량 값 0", leaked["big"] == 0 and leaked["img"] == 0, leaked)
            dbs = page.evaluate("""async () => {
              if (!indexedDB.databases) return -1;
              try { return (await indexedDB.databases()).length; } catch (e) { return -1; }
            }""")
            check("IndexedDB 사용 0", dbs in (0, -1), dbs)
            page.evaluate("() => window.scrollTo(0, 260)")
            page.wait_for_timeout(200)
            page.screenshot(path=os.path.join(SHOTS, "v53-02-camera-volatile.png"))
            check("사진 1장 파기 카운트", page.inner_text("#cap-shot-count").strip() == "1", page.inner_text("#cap-shot-count"))

            # =========================================================
            # 3. PDF 로컬 추출 → 검수 → 반영
            # =========================================================
            page.click('#view-capture [data-inputhub]')
            page.wait_for_timeout(200)
            page.click('#input-hub [data-mode="pdf"]')
            page.wait_for_timeout(350)
            check("PDF 추출 화면 열림", page.is_visible("#view-import"), page.is_visible("#view-import"))
            check("PDF 파일 입력 accept", ".pdf" in (page.get_attribute("#imp-file", "accept") or ""), page.get_attribute("#imp-file", "accept"))
            check("샘플 불러오기 버튼", page.is_visible("#imp-sample"), True)

            page.set_input_files("#imp-file", utf16_pdf)
            page.wait_for_timeout(1500)
            pdf_status = page.inner_text("#imp-status")
            check("PDF 추출 성공 안내", "PDF" in pdf_status and "페이지" in pdf_status and "인식" in pdf_status, pdf_status[:90])
            check("검수 화면 표시", page.is_visible("#imp-review"), page.is_visible("#imp-review"))
            labels = page.eval_on_selector_all(".rv-main b", "els => els.map(e => e.innerText.trim())")
            check("추출 항목 4건", labels == ["월 보험료", "일반암 진단비", "유사암 진단비", "뇌혈관질환 진단비"], labels)
            values = page.eval_on_selector_all(".rv-num", "els => els.map(e => e.value)")
            check("인식 금액 (21 / 4000 / 800 / 2000)", values == ["21", "4000", "800", "2000"], values)
            snips = page.eval_on_selector_all(".rv-snip", "els => els.map(e => e.innerText.trim())")
            check("매칭 근거 원문 표시", len(snips) == 4 and "일반암 진단비 4,000만원" in snips[1], snips[:2])
            check("검수 요약 문구", "4건 인식" in page.inner_text("#imp-summary") and "21만원" in page.inner_text("#imp-summary"), page.inner_text("#imp-summary"))

            # ToUnicode CMap PDF 도 같은 결과
            page.set_input_files("#imp-file", cmap_pdf)
            page.wait_for_timeout(1500)
            labels2 = page.eval_on_selector_all(".rv-main b", "els => els.map(e => e.innerText.trim())")
            values2 = page.eval_on_selector_all(".rv-num", "els => els.map(e => e.value)")
            check("ToUnicode CMap PDF 동일 추출", labels2 == labels and values2 == values, (labels2, values2))

            # 이미지 스캔 PDF 안내
            page.set_input_files("#imp-file", scan_pdf)
            page.wait_for_timeout(1200)
            scan_msg = page.inner_text("#imp-status")
            check("이미지 스캔 PDF 정직 안내", "이미지" in scan_msg or "글자" in scan_msg, scan_msg[:90])

            # 한국어 텍스트 붙여넣기 경로
            page.fill("#imp-text", "암진단비 5,000만원, 유사암 1,000만원, 뇌혈관질환 2,000만원, 허혈성심장질환 2,000만원, 월 보험료 24만원")
            page.click("#imp-parse")
            page.wait_for_timeout(600)
            labels3 = page.eval_on_selector_all(".rv-main b", "els => els.map(e => e.innerText.trim())")
            pair3 = page.evaluate("""() => {
              const out = {};
              document.querySelectorAll('.rv-main b').forEach((b, i) => {
                const n = document.querySelector('[data-rvnum=\"' + b.closest('.rv-row').dataset.rv + '\"]');
                out[b.innerText.trim()] = n ? n.value : '';
              });
              return out;
            }""")
            check("붙여넣기 파싱 5건", len(labels3) == 5, labels3)
            check("붙여넣기 금액", pair3.get("일반암 진단비") == "5000" and pair3.get("유사암 진단비") == "1000"
                  and pair3.get("뇌혈관질환 진단비") == "2000" and pair3.get("허혈성심장질환 진단비") == "2000"
                  and pair3.get("월 보험료") == "24", pair3)
            page.screenshot(path=os.path.join(SHOTS, "v53-03-pdf-review.png"))

            # 검수 → 반영 (유사암 해제, 일반암 4,500으로 수정)
            idx = page.evaluate("""() => {
              const out = {};
              document.querySelectorAll('.rv-main b').forEach((b, i) => { out[b.innerText.trim()] = i; });
              return out;
            }""")
            page.uncheck(f'[data-rvcheck="{idx["유사암 진단비"]}"]')
            page.fill(f'[data-rvnum="{idx["일반암 진단비"]}"]', "4500")
            before_score = page.evaluate("() => (document.querySelector('.ring-text strong') || {}).textContent || ''")
            page.click("#imp-apply")
            page.wait_for_timeout(1200)
            state = page.evaluate("""() => ({
              view: document.querySelector('#view-analysis').classList.contains('is-active'),
              premium: window.__bojangState.premium,
              general: window.__bojangState.cov.cancer.general,
              similar: window.__bojangState.cov.cancer.similar,
              brain: window.__bojangState.cov.brain.dx.vascular,
              heart: window.__bojangState.cov.heart.dx.ischemic,
              analyzed: window.__bojangState.analyzed,
              resultVisible: !document.getElementById('result').hidden,
              score: (document.querySelector('.ring-text strong') || {}).textContent || '',
              strip: (document.getElementById('cs-meta') || {}).textContent || ''
            })""")
            check("반영 후 6단계 입력실로 이동", state["view"] is True, state["view"])
            check("반영: 일반암 수정값 4,500", state["general"] == 4500, state["general"])
            check("반영: 체크 해제한 유사암 미변경", state["similar"] == 1000, state["similar"])
            check("반영: 뇌·심장 진단비", state["brain"] == 2000 and state["heart"] == 2000, (state["brain"], state["heart"]))
            check("반영: 월 보험료 24만원", state["premium"] == 24 and "24만원" in state["strip"], (state["premium"], state["strip"]))
            check("반영 후 점수 재계산", state["analyzed"] is True and state["resultVisible"] is True
                  and state["score"].isdigit() and int(state["score"]) > 0, (state["score"], before_score))
            check("반영 후 클라이언트 상태 저장", page.evaluate("() => JSON.parse(localStorage.getItem('bojang.session.v4')).cov.cancer.general") == 4500, "session")

            # =========================================================
            # 4. 파서 단위 검증
            # =========================================================
            unit = page.evaluate("""() => {
              const P = BojangImport.parseCoverageText;
              const r = P('암진단비 5,000만원, 유사암 1,000만원, 뇌혈관질환 2,000만원, 허혈성심장질환 2,000만원, 월 보험료 24만원');
              const map = {};
              r.items.forEach((i) => { map[i.field] = i.value; });
              const amounts = ['3,000만원', '3천만원', '1억원', '500만', '270,000원', '1억 2,000만원', '질병 1~5종 수술비 300만원']
                .map((x) => BojangImport.parseAmounts(x).map((a) => a.value));
              const sec = P('[암]\\n일반암 진단비 3,000만원\\n[뇌]\\n중환자실 입원비 500만원');
              const secMap = {};
              sec.items.forEach((i) => { secMap[i.field] = i.value; });
              const care = P('일반병원 간병인 사용일당 10만원\\n요양병원 간병인 사용일당 5만원');
              const careMap = {};
              care.items.forEach((i) => { careMap[i.field] = i.value; });
              return { map, premium: r.premium, amounts, secMap, careMap, sample: P(BojangImport.SAMPLE_TEXT).items.length };
            }""")
            check("파서: 5대 담보 매핑", unit["map"].get("cancer.general") == 5000 and unit["map"].get("cancer.similar") == 1000
                  and unit["map"].get("brain.dx.vascular") == 2000 and unit["map"].get("heart.dx.ischemic") == 2000,
                  unit["map"])
            check("파서: 월 보험료 24만원", unit["premium"] == 24, unit["premium"])
            check("금액 단위 정규화", unit["amounts"] == [[3000], [3000], [10000], [500], [27], [12000], [300]], unit["amounts"])
            check("파서: 섹션 문맥 (뇌 중환자실)", unit["secMap"].get("brain.treat.icu") == 500
                  and unit["secMap"].get("cancer.treatment.icu") is None, unit["secMap"])
            check("파서: 일반/요양 간병 분리", unit["careMap"].get("care.daily") == 10
                  and unit["careMap"].get("care.nDaily") == 5, unit["careMap"])
            check("파서: 샘플 보장분석표 20건", unit["sample"] == 20, unit["sample"])
            check("비전 어댑터 인터페이스", page.evaluate("() => typeof BojangImport.parseWithVisionBackend === 'function'")
                  and page.evaluate("() => BojangImport.VISION_ENDPOINT === ''"), True)

            # =========================================================
            # 5. v5.2 회귀 — 30장 · PDF 3종 · 리모델링
            # =========================================================
            page.click('.viewswitch button[data-mode="client"]')
            page.wait_for_timeout(900)
            bad = []
            for no in range(1, 31):
                page.evaluate("n => window.BojangDeck.goTo(n)", no)
                page.wait_for_timeout(35)
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
                if m["xover"] or m["sw"] > m["cw"] + 2 or m["inner"] > m["stage"] * 1.12:
                    bad.append(m)
            check("30장 전수 넘침 0", len(bad) == 0, bad[:3])
            page.click("#deck-home")
            page.wait_for_timeout(500)

            for kind, pages in (("summary", 1), ("detail", 10), ("advisor", 30)):
                out = page.evaluate("""async (kind) => {
                  const r = await BojangApp.buildPdfBlob(kind);
                  return { pages: r.pages, overflow: r.overflow, watermark: r.watermark };
                }""", kind)
                check(f"PDF {kind} {pages}페이지 · 넘침 0", out["pages"] == pages and len(out["overflow"]) == 0,
                      f"pages={out['pages']} overflow={out['overflow']}")
            page.evaluate("() => { document.getElementById('pdf-overlay').hidden = true; }")

            remodel = page.evaluate("() => { return !!document.querySelector('[data-home-go=\"remodel\"]'); }")
            check("리모델링 비교기 진입점 유지", remodel is True, remodel)
            check("브랜드(화이트라벨) 진입점 유지", page.evaluate("() => !!document.querySelector('[data-home-go=\"brand\"]')") is True, True)
            check("베타 무료 배지 유지", page.inner_text("#plan-badge").strip() == "베타 무료", page.inner_text("#plan-badge"))

            # =========================================================
            # 6. 모바일 넘침 · 콘솔 · 네트워크
            # =========================================================
            for view, name in (("capture", "촬영"), ("import", "추출")):
                page.evaluate("(v) => BojangApp.switchView(v)", view)
                page.wait_for_timeout(350)
                over = page.evaluate("""() => {
                  const de = document.documentElement;
                  const wide = [];
                  document.querySelectorAll('#' + BojangApp.state.tab + ' *').forEach(() => {});
                  const v = document.querySelector('.view.is-active');
                  v.querySelectorAll('*').forEach((el) => {
                    const b = el.getBoundingClientRect();
                    if (b.width > 0 && b.right > de.clientWidth + 1.5) wide.push(el.className || el.tagName);
                  });
                  return { doc: de.scrollWidth, client: de.clientWidth, wide: wide.slice(0, 5) };
                }""")
                check(f"{name} 화면 가로 넘침 0", over["doc"] <= over["client"] + 1 and not over["wide"], over)

            page.set_viewport_size({"width": 360, "height": 780})
            page.evaluate("() => BojangApp.switchView('capture')")
            page.wait_for_timeout(350)
            narrow = page.evaluate("() => ({ d: document.documentElement.scrollWidth, c: document.documentElement.clientWidth })")
            check("360px 촬영 화면 넘침 0", narrow["d"] <= narrow["c"] + 1, narrow)
            page.evaluate("() => { BojangApp.switchView('import'); }")
            page.wait_for_timeout(300)
            page.click("#imp-sample")
            page.wait_for_timeout(400)
            narrow2 = page.evaluate("""() => {
              const de = document.documentElement;
              const wide = [];
              document.querySelectorAll('#view-import .rv-row *').forEach((el) => {
                const b = el.getBoundingClientRect();
                if (b.width > 0 && b.right > de.clientWidth + 1.5) wide.push(el.className);
              });
              return { d: de.scrollWidth, c: de.clientWidth, wide: wide.slice(0, 5) };
            }""")
            check("360px 검수 표 넘침 0", narrow2["d"] <= narrow2["c"] + 1 and not narrow2["wide"], narrow2)
            page.set_viewport_size({"width": 430, "height": 932})

            check("콘솔 오류 0", len(errors) == 0, errors[:3])
            check("외부 네트워크 요청 0", len(external) == 0, external[:3])

            # =========================================================
            # 7. 단일 HTML · file:// 오프라인
            # =========================================================
            single = os.path.join(ROOT, "dist", "bojang-guide.single.html")
            html = open(single, encoding="utf-8").read()
            check("단일 HTML: v5.3 이상 모듈 포함", "BojangInputHub" in html and "BojangImport" in html and ("v5.3" in html or "v5.4" in html), len(html) // 1024)
            check("단일 HTML: 외부 스크립트 참조 0", '<script src="./' not in html and '<script src="http' not in html, "src=./" in html)
            check("단일 HTML: 외부 스타일시트 참조 0", '<link rel="stylesheet" href="./' not in html, "stylesheet" in html)
            ctx2 = browser.new_context(viewport={"width": 430, "height": 932})
            p2 = ctx2.new_page()
            file_errors = []
            p2.on("pageerror", lambda e: file_errors.append(str(e)))
            p2.goto("file://" + single, wait_until="load")
            p2.wait_for_timeout(900)
            p2.click("#btn-start-consult")
            p2.wait_for_timeout(250)
            p2.click('#input-hub [data-mode="pdf"]')
            p2.wait_for_timeout(300)
            p2.click("#imp-sample")
            p2.wait_for_timeout(500)
            sample_rows = p2.eval_on_selector_all(".rv-row", "e => e.length")
            check("file:// 오프라인 허브·샘플 동작", sample_rows == 20 and not file_errors, (sample_rows, file_errors[:2]))
            ctx2.close()

            browser.close()
    finally:
        httpd.shutdown()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
