#!/usr/bin/env python3
"""단일 파일 번들 생성기 — index.html/styles.css/content.js/app.js를 하나의 HTML로 인라인.

사용: python3 build_single.py
결과: dist/bojang-guide.single.html  (파일 탐색기/메일 첨부로 바로 열람 가능)
"""
import base64
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, "dist")


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()


def build():
    html = read("index.html")
    css = read("styles.css")
    version = read("version.js")
    security = read("security.js")
    storage = read("storage-idb.js")
    content = read("content.js")
    playbook = read("playbook.js")
    model = read("model.js")
    pdfkit = read("pdfkit.js")
    qr = read("qr.js")
    report = read("report.js")
    client = read("client.js")
    live = read("live.js")
    tools = read("tools.js")
    monetize = read("monetize.js")
    backend = read("backend.js")
    parser = read("import-parser.js")
    inputhub = read("inputhub.js")
    app = read("app.js")

    # 파비콘/터치 아이콘을 data URI로 (단일 파일에서도 아이콘 표시)
    def data_uri(path, mime):
        with open(os.path.join(ROOT, path), "rb") as f:
            b = base64.b64encode(f.read()).decode("ascii")
        return f"data:{mime};base64,{b}"

    icon_192 = data_uri("icons/icon-192.png", "image/png")
    icon_180 = data_uri("icons/apple-touch-icon.png", "image/png")

    html = html.replace('<link rel="stylesheet" href="./styles.css">',
                        "<style>\n" + css + "\n</style>")
    html = html.replace('<link rel="manifest" href="./manifest.json">', "")
    html = html.replace('<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">',
                        f'<link rel="apple-touch-icon" href="{icon_180}">')
    html = html.replace('<link rel="icon" href="./icons/icon-192.png" sizes="192x192">',
                        f'<link rel="icon" href="{icon_192}" sizes="192x192">')
    bundle = "\n".join([
        "<script>\n" + version + "\n</script>",
        "<script>\n" + security + "\n</script>",
        "<script>\n" + storage + "\n</script>",
        "<script>\n" + content + "\n</script>",
        "<script>\n" + playbook + "\n</script>",
        "<script>\n" + model + "\n</script>",
        "<script>\n" + pdfkit + "\n</script>",
        "<script>\n" + qr + "\n</script>",
        "<script>\n" + report + "\n</script>",
        "<script>\n" + client + "\n</script>",
        "<script>\n" + live + "\n</script>",
        "<script>\n" + tools + "\n</script>",
        "<script>\n" + monetize + "\n</script>",
        "<script>\n" + backend + "\n</script>",
        "<script>\n" + parser + "\n</script>",
        "<script>\n" + inputhub + "\n</script>",
        "<script>\n" + app + "\n</script>",
    ])
    old = ('<script src="./version.js"></script>\n<script src="./security.js"></script>\n'
           '<script src="./storage-idb.js"></script>\n'
           '<script src="./content.js"></script>\n<script src="./playbook.js"></script>\n'
           '<script src="./model.js"></script>\n<script src="./pdfkit.js"></script>\n'
           '<script src="./qr.js"></script>\n<script src="./report.js"></script>\n<script src="./client.js"></script>\n<script src="./live.js"></script>\n<script src="./tools.js"></script>\n'
           '<script src="./monetize.js"></script>\n<script src="./backend.js"></script>\n<script src="./import-parser.js"></script>\n<script src="./inputhub.js"></script>\n<script src="./app.js"></script>')
    assert old in html, "script tag block not found"
    html = html.replace(old, bundle)

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "bojang-guide.single.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    size = os.path.getsize(out) / 1024
    left = re.findall(r'(?:src|href)="\./', html)
    print(f"built {out} ({size:.0f} KB), 외부 참조 {len(left)}개")
    return out


if __name__ == "__main__":
    build()
