#!/usr/bin/env python3
"""단일 파일 번들 생성기 — index.html/styles.css/JS 를 하나의 HTML 로 인라인.

사용: python3 build_single.py [--no-protect]
결과: dist/bojang-guide.single.html  (파일 탐색기/메일 첨부로 바로 열람 가능)

v6.0 보호 패스 (경량)
  · 주석(// · /* */)과 과잉 공백을 제거해 소스 힌트를 줄입니다.
  · 문자열·템플릿·정규식 리터럴 안의 //, /* 는 건드리지 않습니다(문법 보존).
  · 식별자 난독화(minify)는 하지 않습니다 — 동작 보존을 최우선으로 하고, 이 보호는
    "복제 방지 2차" 수준임을 정직하게 표기합니다(암호화가 아니며 원본 복원은 가능).
  · 보호 후에도 기능이 100% 같도록 테스트(test_v6_0.py)에서 보호본을 직접 실행해 검증합니다.
"""
import base64
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, "dist")

SCRIPTS = [
    "version.js", "security.js", "storage-idb.js", "content.js", "playbook.js",
    "model.js", "pdfkit.js", "qr.js", "qrscan.js", "report.js", "client.js",
    "live.js", "tools.js", "aftercare.js", "claimcheck.js", "publicdata.js", "memofill.js", "monetize.js", "backend.js", "smartkey.js",
    "import-parser.js", "inputhub.js", "app.js",
]

REGEX_PREV = set("(,=:[!&|?{};+-*%~^<>")
REGEX_WORDS = {"return", "typeof", "case", "in", "of", "new", "delete", "void", "instanceof", "do", "else", "yield"}


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()


def protect_js(src):
    """주석 제거 — 문자열/템플릿/정규식 리터럴은 그대로 둡니다."""
    out = []
    i, n = 0, len(src)
    state = None            # None | "'" | '"' | '`' | regex
    prev_char = ""
    prev_word = ""
    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""

        if state == "regex":
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(nxt)
                i += 2
                continue
            if ch == "/":
                state = None
                prev_char = "/"
                i += 1
                continue
            if ch == "[":
                # 문자 클래스 안에서는 / 도 그대로
                j = i + 1
                while j < n and src[j] != "]":
                    if src[j] == "\\" and j + 1 < n:
                        j += 2
                        continue
                    j += 1
                out.append(src[i + 1:j + 1])
                i = j + 1
                continue
            i += 1
            continue

        if state in ("'", '"', "`"):
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(nxt)
                i += 2
                continue
            if ch == state:
                state = None
            i += 1
            continue

        # 일반 코드
        if ch == "/" and nxt == "/":
            j = src.find("\n", i)
            if j < 0:
                break
            i = j
            continue
        if ch == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            if j < 0:
                break
            out.append(" ")
            i = j + 2
            continue
        if ch in ("'", '"', "`"):
            state = ch
            out.append(ch)
            i += 1
            continue
        if ch == "/":
            # 나눗셈인지 정규식 리터럴인지 판별
            if prev_char == "" or prev_char in REGEX_PREV or prev_word in REGEX_WORDS:
                state = "regex"
                out.append(ch)
                i += 1
                continue
        out.append(ch)
        if not ch.isspace():
            prev_char = ch
            if ch.isalnum() or ch in "_$":
                prev_word = (prev_word + ch) if (prev_word and (prev_word[-1].isalnum() or prev_word[-1] in "_$")) else ch
            else:
                prev_word = ""
        i += 1

    text = "".join(out)
    # 줄 끝 공백 · 3줄 이상 빈 줄 정리
    lines = [ln.rstrip() for ln in text.split("\n")]
    cleaned, blank = [], 0
    for ln in lines:
        if not ln.strip():
            blank += 1
            if blank > 1:
                continue
        else:
            blank = 0
        cleaned.append(ln)
    return "\n".join(cleaned).strip() + "\n"


def build(protect=True):
    html = read("index.html")
    css = read("styles.css")
    sources = {name: read(name) for name in SCRIPTS}
    if protect:
        sources = {name: protect_js(src) for name, src in sources.items()}

    def data_uri(path, mime):
        with open(os.path.join(ROOT, path), "rb") as f:
            return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))

    icon_192 = data_uri("icons/icon-192.png", "image/png")
    icon_180 = data_uri("icons/apple-touch-icon.png", "image/png")

    html = html.replace('<link rel="stylesheet" href="./styles.css">', "<style>\n" + css + "\n</style>")
    html = html.replace('<link rel="manifest" href="./manifest.json">', "")
    html = html.replace('<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">',
                        '<link rel="apple-touch-icon" href="%s">' % icon_180)
    html = html.replace('<link rel="icon" href="./icons/icon-192.png" sizes="192x192">',
                        '<link rel="icon" href="%s" sizes="192x192">' % icon_192)

    bundle = "\n".join("<script>\n%s\n</script>" % sources[name] for name in SCRIPTS)
    old = ('<script src="./version.js"></script>\n<script src="./security.js"></script>\n'
           '<script src="./storage-idb.js"></script>\n'
           '<script src="./content.js"></script>\n<script src="./playbook.js"></script>\n'
           '<script src="./model.js"></script>\n<script src="./pdfkit.js"></script>\n'
           '<script src="./qr.js"></script>\n<script src="./report.js"></script>\n<script src="./client.js"></script>\n<script src="./live.js"></script>\n<script src="./tools.js"></script>\n'
           '<script src="./aftercare.js"></script>\n<script src="./claimcheck.js"></script>\n<script src="./publicdata.js"></script>\n<script src="./memofill.js"></script>\n'
           '<script src="./monetize.js"></script>\n<script src="./backend.js"></script>\n'
           '<script src="./qrscan.js"></script>\n<script src="./smartkey.js"></script>\n'
           '<script src="./import-parser.js"></script>\n<script src="./inputhub.js"></script>\n<script src="./app.js"></script>')
    assert old in html, "script tag block not found"
    html = html.replace(old, bundle)

    digest = hashlib.sha256(html.encode("utf-8")).hexdigest()[:12]
    html = html.replace("</head>", "<!-- build %s · protected=%s -->\n</head>" % (digest, str(protect).lower()), 1)

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "bojang-guide.single.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    size = os.path.getsize(out) / 1024
    left = re.findall(r'(?:src|href)="\./', html)
    print("built %s (%.0f KB), 외부 참조 %d개, protect=%s, build=%s" % (out, size, len(left), protect, digest))
    return out


if __name__ == "__main__":
    build(protect="--no-protect" not in sys.argv)
