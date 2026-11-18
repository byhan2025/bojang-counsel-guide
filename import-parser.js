/* 보장분석 라이프 리포트 v7.3 — 입력 파서 (import-parser.js)

   v5.3의 자동입력 허브가 쓰는 세 가지 엔진을 이 파일 하나에 모았습니다.
   v5.4: 사진 인식이 실서버 모드에서 backend.js(parse-coverage-vision)로 연결됩니다.
   v7.3: 보장분석표 파서를 **범용 표 파서**로 개편 — 보험사·양식과 무관하게
         한 줄형 / 구분자형(|·탭) / 세로 줄바꿈형(담보명·금액·보험료·납입기간이 다른 줄)을 모두 읽고,
         표 머리글의 열 구조와 기본 단위(만원·천원·원)를 먼저 파악한 뒤 숫자 셀을 닻으로 담보명을 찾습니다.
         약관 본문([보험금을 지급하지 않는 사유])은 이름 후보에서 걸러내고,
         1~5종 수술비는 1종 기준액으로 대표값을 잡습니다. 검증은 tests/test_v7_3.py.
   1) PDF 로컬 텍스트 추출 — 외부 라이브러리·CDN 없이 file:// 에서도 동작하는 경량 추출기
      · FlateDecode(zlib) 스트림은 DecompressionStream('deflate')로 해독
      · 괄호 리터럴 문자열 / 16진(hex) 문자열, UTF-16BE · PDFDocEncoding · UTF-8 해독
      · Type0(CID) 폰트의 ToUnicode CMap(bfchar·bfrange) 이 있으면 코드→유니코드 매핑
      · 이미지 스캔 PDF(텍스트 스트림 없음)는 "텍스트 없음"으로 정직하게 알립니다
   2) 한국 보험 보장분석표 텍스트 파서 — 정규식 + 동의어 사전으로 v5.2 모델 필드에 매핑
      · 금액 단위 정규화: 3,000만원 · 3천만원 · 1억원 · 500만 · 270,000원 → 만원
   3) 휘발성 사진 처리 — 촬영 이미지는 저장소에 절대 쓰지 않고, 전처리 직후 메모리에서 파기
      · 3단계 백엔드 연결용 비전 어댑터(parseWithVisionBackend) 인터페이스만 준비

   저장소(localStorage/sessionStorage/IndexedDB)·서버 업로드를 쓰지 않습니다. */
(function (root) {
  'use strict';

  /* 3단계 백엔드(AI 비전 프록시) 주소 — 정적 베타에서는 비어 있습니다.
     배포 시 이 값 또는 parseWithVisionBackend(blob, endpoint)의 endpoint 로 연결합니다. */
  const VISION_ENDPOINT = '';

  const MAX_TEXT = 200000;

  /* =========================================================
     1. 바이트 · 문자열 해독
     ========================================================= */
  function bytesToLatin1(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return s;
  }

  function latin1ToBytes(s) {
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
    return u8;
  }

  /* PDFDocEncoding — 0x80~0xA0 구간만 특수 문자, 나머지는 코드포인트 그대로 */
  const PDFDOC = {
    0x80: '\u2022', 0x81: '\u2020', 0x82: '\u2021', 0x83: '\u2026', 0x84: '\u2014', 0x85: '\u2013',
    0x86: '\u0192', 0x87: '\u2044', 0x88: '\u2039', 0x89: '\u203A', 0x8A: '\u2212', 0x8B: '\u2030',
    0x8C: '\u201E', 0x8D: '\u201C', 0x8E: '\u201D', 0x8F: '\u2018', 0x90: '\u2019', 0x91: '\u201A',
    0x92: '\u2122', 0x93: '\uFB01', 0x94: '\uFB02', 0x95: '\u0141', 0x96: '\u0152', 0x97: '\u0160',
    0x98: '\u0178', 0x99: '\u017D', 0x9A: '\u0131', 0x9B: '\u0142', 0x9C: '\u0153', 0x9D: '\u0161',
    0x9E: '\u017E', 0xA0: '\u20AC'
  };

  function pdfDocDecode(u8, start) {
    let s = '';
    for (let i = start || 0; i < u8.length; i++) {
      const b = u8[i];
      s += PDFDOC[b] || String.fromCharCode(b);
    }
    return s;
  }

  function utf16beDecode(u8, start) {
    let s = '';
    for (let i = start || 0; i + 1 < u8.length; i += 2) {
      s += String.fromCharCode((u8[i] << 8) | u8[i + 1]);
    }
    return s;
  }

  function tryUtf8(u8) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) { return null; }
  }

  function mapCodes(u8, cmap, width) {
    let s = '';
    for (let i = 0; i + width - 1 < u8.length; i += width) {
      const code = width === 2 ? (u8[i] << 8) | u8[i + 1] : u8[i];
      const v = cmap.get(code);
      if (v != null) s += v;
      else if (width === 2) s += '';
      else s += String.fromCharCode(code);
    }
    return s;
  }

  /* PDF 문자열(bytes) → 유니코드. 폰트 정보(ToUnicode·2바이트 여부)를 우선 사용합니다. */
  function decodePdfString(u8, font) {
    if (!u8 || !u8.length) return '';
    const twoByte = font && font.twoByte;
    if (font && font.cmap) return mapCodes(u8, font.cmap, font.cmapBytes || (twoByte ? 2 : 1));
    if (u8.length > 1 && u8[0] === 0xFE && u8[1] === 0xFF) return utf16beDecode(u8, 2);
    if (twoByte) return utf16beDecode(u8);
    const utf8 = tryUtf8(u8);
    if (utf8 != null) return utf8;
    return pdfDocDecode(u8);
  }

  /* =========================================================
     2. 스트림 해독 (FlateDecode)
     ========================================================= */
  async function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') return null;
    const one = async (format) => {
      try {
        const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream(format));
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) { return null; }
    };
    return (await one('deflate')) || (await one('deflate-raw')) || null;
  }

  /* =========================================================
     3. PDF 오브젝트 스캔
     ========================================================= */
  function scanObjects(raw) {
    const objs = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(raw))) {
      const num = parseInt(m[1], 10);
      const bodyStart = m.index + m[0].length;
      let si = raw.indexOf('stream', bodyStart);
      let eo = raw.indexOf('endobj', bodyStart);
      if (eo < 0) eo = raw.length;
      let dict, data = null, next;
      if (si >= 0 && si < eo) {
        dict = raw.slice(bodyStart, si);
        let ds = si + 6;
        if (raw[ds] === '\r') ds++;
        if (raw[ds] === '\n') ds++;
        let len = null;
        const lm = /\/Length\s+(\d+)\s*(?!\d+\s+R)/.exec(dict);
        if (lm && !/\/Length\s+\d+\s+\d+\s+R/.test(dict.slice(Math.max(0, lm.index - 2), lm.index + lm[0].length + 6))) {
          len = parseInt(lm[1], 10);
        }
        let de;
        if (len != null && ds + len <= raw.length) de = ds + len;
        else { de = raw.indexOf('endstream', ds); if (de < 0) de = raw.length; }
        data = raw.slice(ds, de);
        const after = raw.indexOf('endobj', de);
        next = after < 0 ? raw.length : after + 6;
      } else {
        dict = raw.slice(bodyStart, eo);
        next = eo + 6;
      }
      objs.set(num, { num, dict, data, offset: m.index });
      re.lastIndex = next;
    }
    return objs;
  }

  async function streamBytes(obj) {
    if (!obj || obj.data == null) return null;
    const d = obj.dict || '';
    if (/DCTDecode|JPXDecode|CCITTFaxDecode|LZWDecode|RunLengthDecode/.test(d) && !/FlateDecode/.test(d)) return null;
    const u8 = latin1ToBytes(obj.data);
    if (/FlateDecode/.test(d)) {
      const out = await inflate(u8);
      if (!out) return null;
      /* Predictor(예측 부호화)는 지원하지 않습니다 — 텍스트 스트림에는 거의 쓰이지 않습니다 */
      return out;
    }
    return u8;
  }

  async function streamText(obj) {
    const u8 = await streamBytes(obj);
    return u8 ? bytesToLatin1(u8) : null;
  }

  /* PDF 1.5+ 오브젝트 스트림(/Type /ObjStm) 안의 오브젝트를 펼칩니다 */
  async function expandObjectStreams(objs) {
    const list = Array.from(objs.values());
    for (const o of list) {
      if (!/\/Type\s*\/ObjStm/.test(o.dict) || o.data == null) continue;
      const n = parseInt((/\/N\s+(\d+)/.exec(o.dict) || [])[1] || '0', 10);
      const first = parseInt((/\/First\s+(\d+)/.exec(o.dict) || [])[1] || '0', 10);
      const text = await streamText(o);
      if (!text || !n) continue;
      const header = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n; i++) {
        const num = header[i * 2];
        const off = header[i * 2 + 1];
        if (num == null || off == null || isNaN(num) || isNaN(off)) continue;
        if (objs.has(num)) continue;
        const s = first + off;
        const e = i + 1 < n ? first + header[(i + 1) * 2 + 1] : text.length;
        objs.set(num, { num, dict: text.slice(s, e), data: null, offset: 0 });
      }
    }
  }

  /* =========================================================
     4. ToUnicode CMap · 폰트
     ========================================================= */
  function hexToUnicode(h) {
    const u8 = new Uint8Array(Math.floor(h.length / 2));
    for (let i = 0; i < u8.length; i++) u8[i] = parseInt(h.substr(i * 2, 2), 16) || 0;
    return utf16beDecode(u8);
  }

  /* CMap → { map, bytes }. bytes 는 codespacerange 로 판단한 코드 길이(1·2)입니다. */
  function parseCMap(text) {
    const map = new Map();
    let bytes = 0;
    const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
    if (cs) {
      const first = /<([0-9A-Fa-f]+)>/.exec(cs[1]);
      if (first) bytes = Math.max(1, Math.round(first[1].length / 2));
    }
    let m;
    const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = bfchar.exec(text))) {
      const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      let p;
      while ((p = re.exec(m[1]))) map.set(parseInt(p[1], 16), hexToUnicode(p[2]));
    }
    const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = bfrange.exec(text))) {
      const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
      let r;
      while ((r = re.exec(m[1]))) {
        const lo = parseInt(r[1], 16);
        const hi = parseInt(r[2], 16);
        if (isNaN(lo) || isNaN(hi) || hi < lo) continue;
        if (r[3]) {
          const base = hexToUnicode(r[3]);
          const head = base.slice(0, -1);
          const cp = base.charCodeAt(base.length - 1);
          for (let c = lo; c <= hi && c - lo < 65535; c++) map.set(c, head + String.fromCharCode(cp + (c - lo)));
        } else if (r[4]) {
          const items = (r[4].match(/<([0-9A-Fa-f]+)>/g) || []).map((x) => x.slice(1, -1));
          items.forEach((h, i) => { if (lo + i <= hi) map.set(lo + i, hexToUnicode(h)); });
        }
      }
    }
    return { map, bytes };
  }

  async function buildFonts(objs) {
    const fonts = new Map();
    for (const o of objs.values()) {
      if (!/\/Type\s*\/Font/.test(o.dict)) continue;
      const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.dict);
      let cmap = null;
      if (tu) {
        const cm = objs.get(parseInt(tu[1], 10));
        if (cm && cm.data != null) {
          const t = await streamText(cm);
          if (t && /beginbf/.test(t)) cmap = parseCMap(t);
        }
      }
      const twoByte = /\/Subtype\s*\/Type0/.test(o.dict) || /Identity-[HV]/.test(o.dict);
      fonts.set(o.num, { cmap: cmap ? cmap.map : null, cmapBytes: cmap ? cmap.bytes : 0, twoByte });
    }
    return fonts;
  }

  /* =========================================================
     5. 콘텐츠 스트림 → 텍스트
     ========================================================= */
  function readLiteral(s, i) {
    const out = [];
    let depth = 1;
    let j = i + 1;
    while (j < s.length) {
      const c = s.charAt(j);
      if (c === '\\') {
        const n = s.charAt(j + 1);
        if (n === 'n') { out.push(10); j += 2; }
        else if (n === 'r') { out.push(13); j += 2; }
        else if (n === 't') { out.push(9); j += 2; }
        else if (n === 'b') { out.push(8); j += 2; }
        else if (n === 'f') { out.push(12); j += 2; }
        else if (n === '(' || n === ')' || n === '\\') { out.push(n.charCodeAt(0)); j += 2; }
        else if (n >= '0' && n <= '7') {
          let oct = '';
          let k = j + 1;
          while (k < s.length && oct.length < 3 && s.charAt(k) >= '0' && s.charAt(k) <= '7') { oct += s.charAt(k); k++; }
          out.push(parseInt(oct, 8) & 0xff);
          j = k;
        } else if (n === '\n') { j += 2; }
        else if (n === '\r') { j += 2; if (s.charAt(j) === '\n') j++; }
        else { out.push(n ? n.charCodeAt(0) : 92); j += 2; }
      } else if (c === '(') { depth++; out.push(40); j++; }
      else if (c === ')') {
        depth--;
        j++;
        if (depth === 0) break;
        out.push(41);
      } else { out.push(s.charCodeAt(j) & 0xff); j++; }
    }
    return { bytes: new Uint8Array(out), end: j };
  }

  function readHex(s, i) {
    const close = s.indexOf('>', i + 1);
    const end = close < 0 ? s.length : close + 1;
    let h = s.slice(i + 1, close < 0 ? s.length : close).replace(/[^0-9A-Fa-f]/g, '');
    if (h.length % 2) h += '0';
    const u8 = new Uint8Array(h.length / 2);
    for (let k = 0; k < u8.length; k++) u8[k] = parseInt(h.substr(k * 2, 2), 16) || 0;
    return { bytes: u8, end };
  }

  function scanContent(s, resolveFont) {
    const out = [];
    let curFont = null;
    let pendingName = null;
    let i = 0;
    while (i < s.length) {
      const c = s.charAt(i);
      if (c === '%') {
        const e = s.indexOf('\n', i);
        i = e < 0 ? s.length : e + 1;
        continue;
      }
      if (c === '(') {
        const r = readLiteral(s, i);
        out.push(decodePdfString(r.bytes, resolveFont(curFont)));
        i = r.end;
        continue;
      }
      if (c === '<') {
        if (s.charAt(i + 1) === '<') { i += 2; continue; }
        const r = readHex(s, i);
        out.push(decodePdfString(r.bytes, resolveFont(curFont)));
        i = r.end;
        continue;
      }
      if (c === '/') {
        let j = i + 1;
        let name = '';
        while (j < s.length && /[A-Za-z0-9#+.\-_]/.test(s.charAt(j))) { name += s.charAt(j); j++; }
        pendingName = name;
        i = j;
        continue;
      }
      if (c === 'T' && s.charAt(i + 1) === 'f') { curFont = pendingName; i += 2; continue; }
      if (c === 'T' && (s.charAt(i + 1) === 'd' || s.charAt(i + 1) === 'D' || s.charAt(i + 1) === '*')) { out.push('\n'); i += 2; continue; }
      if (c === 'E' && s.charAt(i + 1) === 'T') { out.push('\n'); i += 2; continue; }
      if (c === 'B' && s.charAt(i + 1) === 'T') { i += 2; continue; }
      if (c === "'" || c === '"') { out.push('\n'); i++; continue; }
      i++;
    }
    return out.join('');
  }

  function resourceFonts(dict, objs) {
    const map = {};
    let base = dict;
    const ref = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(dict);
    if (ref) {
      const ro = objs.get(parseInt(ref[1], 10));
      if (ro) base = ro.dict;
    }
    const fontBlock = /\/Font\s*<<([\s\S]*?)>>/.exec(base);
    if (!fontBlock) return map;
    const re = /\/([A-Za-z0-9#+.\-_]+)\s+(\d+)\s+\d+\s+R/g;
    let m;
    while ((m = re.exec(fontBlock[1]))) map[m[1]] = parseInt(m[2], 10);
    return map;
  }

  function normalizeText(t) {
    return String(t || '')
      .replace(/\u0000/g, '')
      .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* 글자가 깨졌는지 판단 — 한글·영숫자·기호 비중이 낮으면 깨진 것으로 봅니다 */
  function looksGarbled(text) {
    if (!text) return false;
    const total = text.length;
    if (total < 20) return false;
    let good = 0;
    for (let i = 0; i < total; i++) {
      const c = text.charCodeAt(i);
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3131 && c <= 0x318e)) good++;
    }
    return good / total < 0.45;
  }

  /* PDF → 텍스트 (100% 로컬) */
  async function extractPdfText(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (!u8.length) return { ok: false, text: '', pages: 0, reason: 'empty', message: 'PDF 내용이 비어 있습니다.' };
    const raw = bytesToLatin1(u8);
    const header = raw.slice(0, 8);
    if (header.indexOf('%PDF') < 0) {
      return { ok: false, text: '', pages: 0, reason: 'not-pdf', message: 'PDF 파일이 아닌 것 같습니다. 확장자와 내용을 확인해 주세요.' };
    }
    const noInflate = typeof DecompressionStream === 'undefined';
    const iosNote = noInflate
      ? ' 이 브라우저(iOS 16.4 미만 등)는 압축된 PDF 스트림 해독을 지원하지 않습니다 — PDF 뷰어에서 텍스트를 복사해 붙여넣어 주세요.'
      : '';
    const objs = scanObjects(raw);
    await expandObjectStreams(objs);
    const fonts = await buildFonts(objs);

    const pageObjs = Array.from(objs.values())
      .filter((o) => /\/Type\s*\/Page\b(?!s)/.test(o.dict))
      .sort((a, b) => a.num - b.num);

    const parts = [];
    if (pageObjs.length) {
      for (const pg of pageObjs) {
        const res = resourceFonts(pg.dict, objs);
        const resolveFont = (name) => {
          if (!name) return null;
          const num = res[name];
          if (num != null && fonts.has(num)) return fonts.get(num);
          return null;
        };
        const cRef = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(pg.dict);
        if (!cRef) continue;
        const nums = [];
        const re = /(\d+)\s+\d+\s+R/g;
        let m;
        while ((m = re.exec(cRef[1]))) nums.push(parseInt(m[1], 10));
        for (const n of nums) {
          const co = objs.get(n);
          const txt = co ? await streamText(co) : null;
          if (txt && /BT/.test(txt)) parts.push(scanContent(txt, resolveFont));
        }
      }
    }
    if (!parts.length) {
      /* 페이지 구조를 못 찾은 PDF — BT/ET 텍스트가 있는 스트림을 직접 훑습니다 */
      for (const o of objs.values()) {
        if (o.data == null) continue;
        if (/\/Type\s*\/(Font|ObjStm|Metadata|XObject)/.test(o.dict)) continue;
        const txt = await streamText(o);
        if (txt && /\bBT\b/.test(txt) && /\bET\b/.test(txt)) parts.push(scanContent(txt, () => null));
      }
    }

    let text = normalizeText(parts.join('\n'));
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

    const images = Array.from(objs.values()).filter((o) => /\/Subtype\s*\/Image/.test(o.dict)).length;
    const textLen = text.replace(/\s/g, '').length;

    if (textLen < 20) {
      return {
        ok: false, text: '', pages: pageObjs.length, images, reason: 'image-only',
        message: images
          ? `이 PDF는 이미지로 스캔된 문서입니다(이미지 ${images}개, 추출된 글자 ${textLen}자). 글자가 없어 담보표를 읽지 못했습니다 — 화면을 사진으로 찍는 대신, 보장분석표 텍스트를 복사해 붙여넣어 주세요.${iosNote}`
          : `이 PDF에서 글자를 찾지 못했습니다(추출된 글자 ${textLen}자). 보장분석표 텍스트를 붙여넣는 방식으로 입력해 주세요.${iosNote}`
      };
    }
    const garbled = looksGarbled(text);
    return {
      ok: true, text, pages: pageObjs.length, images, garbled,
      message: garbled
        ? '글자는 찾았지만 폰트 매핑이 없어 일부가 깨져 보입니다. 깨진 항목은 쓰지 말고, PDF 뷰어에서 텍스트를 복사해 붙여넣는 편이 정확합니다.'
        : null
    };
  }

  /* =========================================================
     6. 금액 정규화 (만원 단위)
     ========================================================= */
  const AMT_RE = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(억|천만|백만|만|천|원)?/g;
  const SKIP_AFTER = /[종대세년월일회%명건개층차]/;
  const SKIP_BEFORE = /[~\-ー/]/;

  function roundAmount(v) {
    if (!isFinite(v)) return null;
    if (v >= 10) return Math.round(v);
    return Math.round(v * 10) / 10;
  }

  /* 표 헤더 단위 → 만원 배수 (가입금액(만원) · 보장금액(천원) · 지급금액(원)) */
  const UNIT_TO_MAN = { '만원': 1, '만': 1, '천원': 0.1, '천': 0.1, '원': 0.0001, '억원': 10000, '억': 10000 };

  /* opts.unit — 표 헤더에서 읽은 기본 단위(만원·천원·원). 있으면 단위 없이 적힌 셀 숫자도 그 단위로 해석합니다.
       예) 가입금액(만원) 아래 셀 '20' → 20만원 / 가입금액(천원) 아래 '300' → 30만원
     opts.small — 단위 표기가 없어도 100 미만 숫자를 금액으로 인정합니다(표 셀 전용, 기본 꺼짐).
     단위 없이 100 미만인 숫자를 금액으로 보지 않는 기본 규칙(1~5종·횟수)은 그대로 둡니다. */
  function parseAmounts(str, opts) {
    const o = opts || {};
    const baseUnit = o.unit && UNIT_TO_MAN[o.unit] != null ? o.unit : null;
    const out = [];
    const s = String(str || '');
    let m;
    AMT_RE.lastIndex = 0;
    while ((m = AMT_RE.exec(s))) {
      const raw = m[0];
      const numText = m[1];
      const unit = m[2] || '';
      const start = m.index;
      const end = m.index + raw.length;
      const after = s.charAt(end);
      const before = s.charAt(start - 1);
      if (after && SKIP_AFTER.test(after)) continue;
      if (before && SKIP_BEFORE.test(before)) continue;
      const n = parseFloat(numText.replace(/,/g, ''));
      if (!isFinite(n)) continue;
      let v;
      if (unit === '억') v = n * 10000;
      else if (unit === '천만') v = n * 1000;
      else if (unit === '백만') v = n * 100;
      else if (unit === '만') v = n;
      else if (unit === '천') v = n / 10;
      else if (unit === '원') v = n / 10000;
      else {
        if (baseUnit) v = n * UNIT_TO_MAN[baseUnit];
        else if (o.small && n > 0) v = n >= 100000 ? n / 10000 : n;
        else {
          if (n < 100) continue;            /* 단위 없는 작은 숫자는 금액으로 보지 않습니다 (1~5종 등) */
          v = n >= 100000 ? n / 10000 : n;  /* 270,000 → 27만원 */
        }
      }
      v = roundAmount(v);
      if (v == null || v <= 0) continue;
      const prev = out[out.length - 1];
      if (prev && prev.unit === '억' && (unit === '만' || unit === '천만' || unit === '백만') && start - prev.end <= 4) {
        prev.value = roundAmount(prev.value + v);
        prev.end = end;
        prev.raw += ' ' + raw;
        continue;
      }
      out.push({ value: v, unit, start, end, raw: raw.trim() });
    }
    return out;
  }

  /* =========================================================
     7. 보장분석표 파서 (v7.3 범용 표 파서)
        보험사 PDF·복사 텍스트는 같은 표라도 회사마다 줄이 다르게 끊깁니다.
        · 한 줄형        일반암 진단비 5,000만원
        · 구분자형       일반암 진단비 | 5,000 | 12,000
        · 세로 줄바꿈형  담보명 / 가입금액 / 보장보험료 / 납입기간이 각각 다른 줄
        세 형태를 모두 받도록, (1) 표 머리글에서 열 구조와 기본 단위를 먼저 읽고
        (2) 숫자 셀(가입금액·보험료)과 납입기간 줄을 닻으로 삼아 위로 거슬러 올라가
            담보명을 찾은 뒤 (3) 같은 규칙 사전으로 담보를 맞춥니다.
        약관 본문(보장상세·[보험금을 지급하지 않는 사유])은 이름 후보에서 걸러냅니다.
     ========================================================= */

  /* --- 셀·줄 분류 ------------------------------------------------ */
  const NUM_CELL = /^\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:만원|천원|원|억원|만|천)?$/;
  function isAmountCell(t) { return NUM_CELL.test(String(t == null ? '' : t).trim()); }

  /* 납입기간·만기 줄: '20년납 90세만기' · '종신납' · '100세만기' · '갱신형 20년만기' */
  function periodLike(t) {
    const s = String(t == null ? '' : t).trim();
    if (!s || s.length > 40) return false;
    if (/보험료|가입금액|보장금액|진단|수술|치료|급부|담보/.test(s)) return false;
    return /(\d+\s*(?:년|세)\s*납)|(\d+\s*(?:세|년)\s*만기)|(종신\s*(?:납|만기)?)|(만기\s*\d+\s*(?:세|년))|(^\d+\s*(?:년|세)$)|(갱신\s*형)/.test(s);
  }

  /* 표 머리글 — 담보명 열과 열 라벨 */
  const HDR_NAME = /^(보장명|담보명|보장항목|담보항목|보장내용|급부명|특약명|보장종류|지급항목|보장세부내용|담보구분|보장구분)$/;
  const COL_LABEL = /^(보장상세|보장내용|지급사유|보장사유|가입금액.*|보장금액.*|지급금액.*|보장보험료.*|납입보험료(\s*\(.*\))?|보험료(\s*\(.*\))?$|보험료\s*합계$|납입기간.*|보장기간.*|지급기간.*|만기(\s*.*)?|비고|지급조건)$/;
  function isHeaderLine(t) {
    const s = String(t == null ? '' : t).trim();
    if (!s) return false;
    return HDR_NAME.test(s) || COL_LABEL.test(s);
  }
  /* 머리글에서 기본 단위만 뽑습니다 — '가입금액(만원)' → 만원 */
  function headerUnit(label) {
    const m = /(?:가입|보장|지급)금액\s*\(?\s*(만원|천원|원|억원)/.exec(String(label || ''));
    return m ? m[1] : null;
  }

  /* 담보명처럼 보이는 줄 — 반복돼도 지우지 않습니다 */
  const COVERAGE_KEEP = /(진단비|진단금|수술비|치료비|입원비|입원일당|일당|장해|골절|화상|간병|실손|배상|벌금|수술|진단|보장금액|보험금|특약|연금|저축|환급금|지원금|보장비|보장금)/;
  /* 약관 본문·안내문 — 담보명 후보에서 제외 */
  const NOISE_NAME = /(지급하지\s*않는|보통약관|약관|청약|상기|유의사항|안내|참조|바랍니다|합니다|습니다|입니다|됩니다|경우|따라|의하여|인하여|발생한|제\s*\d+\s*항|다음|아래|보험기간\s*중|납입면제\s*사유|해약환급금|적립|만기환급)/;
  /* 문서 머리말의 라벨(계약자·피보험자 정보) — 담보명이 아닙니다 */
  const META_LABEL = /^(계약자|피보험자|설계번호|설계일자|주민|주민등록번호|주민\/사업자번호|주소|직업|급수|운전형태|이륜차|상령일|모집점|모집자|연락처|전화번호|휴대폰|휴\s*대\s*폰|e-mail|발행일|발행일시|가입유형|납입주기|납입보험료|보장보험료|적립보험료|총납입보험료|예상만기환급금|실납입보험료|납입\s*및\s*보험기간|가입제안.*|상품명|보험기간|점\s*포\s*명|담\s*당\s*자)$/i;
  const SECTION_MARK = /^[■□◆◇○●◈▣▶※•]/;

  function isNameLike(t) {
    const s = String(t == null ? '' : t).trim();
    if (s.length < 2 || s.length > 60) return false;
    if (!/[가-힣]/.test(s)) return false;
    if (SECTION_MARK.test(s)) return false;
    if (/^\d/.test(s) && !/^\d{1,2}\s*(?:대|종)/.test(s)) return false;   /* 5대골절진단비는 살립니다 */
    if (/[.。]$/.test(s)) return false;
    if (NOISE_NAME.test(s)) return false;
    if (META_LABEL.test(s)) return false;
    if (/^[()\[\]{},.%·]+$/.test(s)) return false;
    return true;
  }

  /* 여러 쪽에 되풀이되는 머리말·꼬리말·약관 문구 — 담보명 후보에서 뺍니다 */
  const BOILER_STRONG = /(진단비|진단금|수술비|치료비|일당|간병|보장금액|특약|보장비|지원금)/;
  function fuzzyKey(t) {
    return String(t == null ? '' : t).replace(/[\s\d,.()\[\]·:%~\-]/g, '').slice(0, 16);
  }
  function buildBoilerplate(lines) {
    const cnt = Object.create(null);
    const byKey = Object.create(null);
    for (const raw of lines) {
      const t = String(raw == null ? '' : raw).trim();
      if (!t) continue;
      cnt[t] = (cnt[t] || 0) + 1;
      const k = fuzzyKey(t);
      if (k) (byKey[k] || (byKey[k] = [])).push(t);
    }
    const out = new Set();
    Object.keys(cnt).forEach((t) => {
      if (cnt[t] < 4) return;
      if (t.length < 2) { out.add(t); return; }
      if (isAmountCell(t) || periodLike(t) || isHeaderLine(t)) return;
      if (COVERAGE_KEEP.test(t) && cnt[t] < 8) return;
      out.add(t);
    });
    /* 줄바꿈 위치가 달라 글자가 조금씩 다른 약관 문구 — 앞 16자(숫자·기호 제외)가 같은 줄이 5번 넘게
       나오면 설명문으로 봅니다. 담보명다운 접미사가 있는 줄은 반복돼도 남깁니다. */
    Object.keys(byKey).forEach((k) => {
      if (byKey[k].length < 5) return;
      byKey[k].forEach((t) => { if (!BOILER_STRONG.test(t)) out.add(t); });
    });
    return out;
  }

  /* --- 표 행 뽑기 -------------------------------------------------
     숫자 닻: [가입금액] [보장보험료] [납입기간] 세 줄이 이어지거나,
     [가입금액] [납입기간] 두 줄이 이어지면 한 행으로 봅니다. */
  function scanTableRows(lines, boiler, usedLines) {
    const headers = [];
    for (let i = 0; i < lines.length; i++) {
      if (!isHeaderLine(lines[i])) continue;
      let j = i;
      while (j + 1 < lines.length && isHeaderLine(lines[j + 1]) && j - i < 8) j++;
      let unit = null;
      for (let k = i; k <= j; k++) {
        const u = headerUnit(lines[k]);
        if (u) { unit = u; break; }
      }
      headers.push({ start: i, end: j, unit });
      i = j;
    }
    const rows = [];
    let lastEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!isAmountCell(lines[i])) continue;
      if (boiler && boiler.has(String(lines[i]).trim())) continue;
      let premIdx = null;
      let perIdx = null;
      if (isAmountCell(lines[i + 1]) && periodLike(lines[i + 2])) { premIdx = i + 1; perIdx = i + 2; }
      else if (periodLike(lines[i + 1])) { perIdx = i + 1; }
      else continue;
      let hd = null;
      for (const h of headers) { if (h.end < i) hd = h; else break; }
      const lower = Math.max(hd ? hd.end + 1 : 0, lastEnd + 1, i - 40);
      let nameIdx = -1;
      let topIsRider = false;
      for (let j = i - 1; j >= lower; j--) {
        const t = String(lines[j] == null ? '' : lines[j]).trim();
        if (!t || (boiler && boiler.has(t))) continue;
        if (isAmountCell(t) || periodLike(t) || isHeaderLine(t) || SECTION_MARK.test(t)) continue;
        if (isNameLike(t)) { nameIdx = j; topIsRider = NON_COVERAGE.test(t) && !/후유\s*장해/.test(t); }   /* 위로 올라가며 갱신 → 가장 위 줄이 담보명 */
      }
      if (nameIdx < 0) { lastEnd = perIdx; i = perIdx; continue; }
      /* 납입면제·납입지원·환급금 특약 행 — 담보가 아니지만 행 구간은 건너뜁니다 */
      if (topIsRider) { lastEnd = perIdx; i = perIdx; continue; }
      let name = String(lines[nameIdx]).trim();
      let k = nameIdx;
      let guard = 0;
      while (k + 1 < i && guard < 12) {
        const nxtRaw = String(lines[k + 1] == null ? '' : lines[k + 1]).trim();
        if (!nxtRaw || isAmountCell(nxtRaw) || periodLike(nxtRaw)) break;
        if (nxtRaw.length > 30 || /[.。]$/.test(nxtRaw) || NOISE_NAME.test(nxtRaw) || SECTION_MARK.test(nxtRaw)) break;
        const open = (name.match(/[([]/g) || []).length;
        const close = (name.match(/[)\]]/g) || []).length;
        const parenOnly = /^\([^()]{1,24}\)$/.test(nxtRaw) && !/[(\[]$/.test(name);
        const opensNext = /[(\[]$/.test(nxtRaw);   /* 'Ⅱ(' 처럼 다음 줄이 괄호를 여는 조각 */
        if (!(open > close) && !parenOnly && !opensNext) break;
        name = name + (/[(\[]$/.test(name) || /^[)\]]/.test(nxtRaw) ? '' : ' ') + nxtRaw;
        k++;
        guard++;
      }
      const amtRaw = String(lines[i]).trim();
      const premRaw = premIdx != null ? String(lines[premIdx]).trim() : null;
      rows.push({
        name,
        amtRaw, premRaw,
        period: perIdx != null ? String(lines[perIdx]).trim() : null,
        unit: hd ? hd.unit : null,
        amtIdx: i,
        nameIdx,
        endIdx: perIdx
      });
      if (usedLines) for (let q = nameIdx; q <= perIdx; q++) usedLines.add(q);
      lastEnd = perIdx;
      i = perIdx;
    }
    return rows;
  }

  /* --- 세로줄(구분자)형 — 한 줄에 담보명 | 가입금액 | 보장보험료 가 나란히 적힌 표 ---
     복사한 표를 그대로 붙여넣을 때 흔한 형태입니다. */
  function scanSeparatorRows(lines) {
    const out = [];
    let unit = null;
    for (const raw of lines) {
      const line = String(raw == null ? '' : raw);
      if (line.indexOf('|') < 0 && line.indexOf('\t') < 0) continue;
      const cells = line.split(/[|\t]/).map((c) => c.trim()).filter((c) => c);
      if (cells.length < 2) continue;
      if (cells.some((c) => isHeaderLine(c))) {
        /* 머리글 줄 — 열 단위를 읽어 아래 행에 적응 */
        for (const c of cells) { const u = headerUnit(c); if (u) { unit = u; break; } }
        continue;
      }
      const nameIdx = cells.findIndex((c) => isNameLike(c));
      if (nameIdx < 0) continue;
      let amtRaw = null;
      let premRaw = null;
      for (let i = nameIdx + 1; i < cells.length; i++) {
        if (!isAmountCell(cells[i])) continue;
        if (amtRaw == null) amtRaw = cells[i];
        else if (premRaw == null) premRaw = cells[i];
        else break;
      }
      if (amtRaw == null) continue;
      out.push({
        name: cells[nameIdx], amtRaw, premRaw, period: null, unit,
        amtIdx: -1, nameIdx: -1, endIdx: -1
      });
    }
    return out;
  }

  /* --- 담보명 → 규격 칸 ------------------------------------------- */
  const TREAT_WORD = /(주요\s*치료비|수술비|치료비|입원|일당|수술을|수술비용)/;   /* 진단비 규칙이 치료 담보를 먹지 않게 */

  const RULES = [
    /* --- 암 --- */
    { field: 'cancer.similar', label: '유사암 진단비', group: '암', p: 96,
      exclude: /(유사암\s*제외|중증\s*갑상선|주요\s*치료비|수술비|치료비|입원|일당)/,
      kw: /(유사암|소액암|갑상선암|기타피부암|제자리암|경계성\s*종양)/ },
    { field: 'cancer.recur', label: '재진단·전이암 보장', group: '암', p: 95, type: 'bool',
      kw: /(재진단\s*암|전이\s*암|재발\s*암|재진단형)/ },
    { field: 'cancer.high', label: '고액암 진단비 (참고)', group: '암', p: 94, apply: false,
      note: 'v5.2 계산식은 일반암 진단비 한 축으로 판정합니다 — 고액암은 참고값으로만 보여드립니다.',
      kw: /(고액암|특정\s*암|1\s*억\s*암)/ },
    { field: 'cancer.general', label: '일반암 진단비', group: '암', p: 90,
      exclude: /(재진단|전이|재발|주요\s*치료비|수술비|치료비|입원|일당)/,
      kw: /(일반암\s*진단|암\s*(?:진단비|진단금|진단보험금)|암\s*진단)/ },
    { field: 'cancer.treatment.surgery', label: '암수술비', group: '암', p: 88,
      kw: /(암\s*수술|암수술)/ },
    { field: 'cancer.treatment.drug', label: '항암약물치료비', group: '암', p: 88,
      exclude: /항암\s*호르몬\s*약물/,
      kw: /(항암\s*(?:약물|화학|주사)|표적\s*항암|면역\s*항암|약물\s*치료)/ },
    { field: 'cancer.treatment.radio', label: '항암방사선치료비', group: '암', p: 87,
      exclude: /약물|호르몬/,
      kw: /(항암\s*방사선|방사선\s*(?:치료|수술)|중입자\s*치료)/ },
    { field: 'cancer.treatment.icu', label: '암 중환자실 입원', group: '암', p: 80, section: 'cancer',
      kw: /(중환자실|집중치료실)/ },
    { field: 'cancer.treatment.extra', label: '비급여 추가 치료비', group: '암', p: 78, section: 'cancer',
      kw: /(비급여|추가\s*치료비|표적\s*치료)/ },

    /* --- 뇌 --- */
    { field: 'brain.dx.stroke', label: '뇌졸중 진단비', group: '뇌', p: 92,
      exclude: TREAT_WORD, kw: /(뇌졸중|뇌경색)/ },
    { field: 'brain.dx.bleed', label: '뇌출혈 진단비', group: '뇌', p: 92,
      exclude: TREAT_WORD, kw: /(뇌출혈|뇌내출혈|지주막하출혈)/ },
    { field: 'brain.dx.vascular', label: '뇌혈관질환 진단비', group: '뇌', p: 91,
      exclude: TREAT_WORD, kw: /(뇌혈관\s*질환|뇌혈관)/ },
    { field: 'brain.treat.surgery', label: '뇌 수술비(관혈·비관혈)', group: '뇌', p: 86,
      kw: /(뇌\s*수술|개두술|색전술|뇌혈관\s*수술|스텐트)/ },
    { field: 'brain.treat.lysis', label: '뇌 혈전용해제 치료비', group: '뇌', p: 85, section: 'brain',
      kw: /(혈전\s*용해|tPA|트롬빈)/ },
    { field: 'brain.treat.icu', label: '뇌 중환자실 입원비', group: '뇌', p: 80, section: 'brain',
      kw: /(중환자실|집중치료실)/ },

    /* --- 심장 --- */
    { field: 'heart.dx.ami', label: '급성심근경색 진단비', group: '심장', p: 92,
      exclude: TREAT_WORD, kw: /(급성\s*심근경색|심근경색)/ },
    { field: 'heart.dx.ischemic', label: '허혈성심장질환 진단비', group: '심장', p: 91,
      exclude: TREAT_WORD, kw: /(허혈성\s*심장|협심증|관상동맥\s*질환)/ },
    { field: 'heart.treat.surgery', label: '심장 수술비(관혈·비관혈)', group: '심장', p: 86,
      kw: /(심장\s*수술|관상동맥\s*우회|개흉|관상동맥\s*스텐트|심장\s*스텐트)/ },
    { field: 'heart.treat.lysis', label: '심장 혈전용해제 치료비', group: '심장', p: 85, section: 'heart',
      kw: /(혈전\s*용해|tPA|트롬빈)/ },
    { field: 'heart.treat.icu', label: '심장 중환자실 입원비', group: '심장', p: 80, section: 'heart',
      kw: /(중환자실|집중치료실)/ },

    /* --- 수술 --- */
    { field: 'surgery.diseaseNonPay', label: '비급여 질병 수술비', group: '수술', p: 88,
      kw: /비급여[^\n]{0,8}수술/ },
    { field: 'surgery.disease15', label: '질병 1~5종 수술비', group: '수술', p: 90,
      kw: /질병\s*1\s*[~\-]\s*5\s*종/ },
    { field: 'surgery.diseaseNdae', label: '질병 N대 수술비', group: '수술', p: 89,
      kw: /(질병\s*\d+\s*대|질병\s*N\s*대|N\s*대\s*수술)/ },
    { field: 'surgery.disease', label: '질병수술비', group: '수술', p: 84,
      exclude: /1\s*[~\-]\s*5\s*종|\(\s*[1-5]\s*종|N\s*대|\d+\s*대|비급여|상급\s*종합\s*병원|종합\s*병원|병원|의원/,
      kw: /(질병\s*수술|질병수술)/ },
    { field: 'surgery.injury15', label: '상해 1~5종 수술비', group: '수술', p: 90,
      kw: /상해\s*1\s*[~\-]\s*5\s*종/ },
    { field: 'surgery.injury', label: '일반 상해수술비', group: '수술', p: 84,
      exclude: /1\s*[~\-]\s*5\s*종|\(\s*[1-5]\s*종|후유\s*장해|장해|사망|골절|상급\s*종합\s*병원|종합\s*병원/,
      kw: /(상해\s*수술|상해수술|일반\s*상해)/ },

    /* --- 간병 --- */
    { field: 'care.nDaily', label: '요양병원 간병인 사용일당', group: '간병', p: 93,
      exclude: /치매|상해/,
      kw: /(요양\s*병원[^\n]{0,10}간병|요양\s*간병)/ },
    { field: 'care.daily', label: '일반병원 간병인 사용일당', group: '간병', p: 86,
      /* v5.8 — 중증치매간병비·상해간병일당·장기요양간병비는 '직접 기재' 담보로 보냅니다 */
      exclude: /요양|치매|상해|장기\s*요양|중증/,
      kw: /(간병\s*인?[^\n]{0,10}(?:일당|사용|비)|간병일당|간병비)/ },

    /* --- 생활·실손(참고 축) --- */
    { field: 'living.disabilityInjury', label: '상해 후유장해', group: '생활', p: 88,
      kw: /(상해\s*후유\s*장해|일반상해후유장해|상해후유장해)/ },
    { field: 'living.disabilityDisease', label: '질병 후유장해', group: '생활', p: 88,
      kw: /(질병\s*후유\s*장해|질병후유장해)/ },
    { field: 'living.deathInjury', label: '일반상해 사망', group: '생활', p: 86,
      exclude: /후유\s*장해/,
      kw: /(일반\s*상해\s*사망|상해\s*사망)/ },
    { field: 'living.deathDisease', label: '질병 사망', group: '생활', p: 86,
      kw: /(질병\s*사망)/ },
    { field: 'living.fracture', label: '골절 진단비', group: '생활', p: 84,
      kw: /(골절\s*진단|골절진단)/ },
    { field: 'living.burn', label: '화상 진단비', group: '생활', p: 84,
      kw: /(화상\s*진단|화상진단)/ },

    /* --- 기본 정보 --- */
    { field: 'monthlyPremium', label: '월 보험료', group: '기본', p: 99, type: 'premium',
      exclude: /총\s*납입|적립\s*보험료|예상\s*만기|해약\s*환급/,
      kw: /(월\s*보험료|보험료\s*합계|월\s*납입|합계\s*보험료|월보험료|납입\s*보험료)/ },
    { field: 'silsonGen', label: '실손 세대', group: '기본', p: 99, type: 'silson',
      kw: /실손[^\n]{0,12}?(\d)\s*세대|(\d)\s*세대\s*(?:실손|의료비)/ }
  ].sort((a, b) => b.p - a.p);

  /* 담보가 아닌 줄 — 납입면제·납입지원·환급금 특약 */
  const NON_COVERAGE = /(납입\s*면제|납입\s*지원|보험료\s*납입|납입\s*보험료|해약\s*환급|만기\s*환급|적립\s*보험료)/;

  function detectSection(line) {
    const s = line.replace(/[\[\](){}<>]/g, '').replace(/\s+/g, '');
    if (!s) return null;
    if (/간병|요양/.test(s)) return 'care';
    if (/뇌|뇌혈관|뇌졸중|뇌출혈/.test(s)) return 'brain';
    if (/심장|심근|협심|허혈|관상동맥/.test(s)) return 'heart';
    if (/암|항암|유사암/.test(s)) return 'cancer';
    if (/수술/.test(s)) return 'surgery';
    return null;
  }

  function splitSegments(text) {
    return String(text || '')
      .split(/[\n\r|·ㆍ:：;；\t]+/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 0);
  }

  /* 매칭 근거 원문 — 키워드 주변만 잘라 보여줍니다 */
  function snip(seg, start, end) {
    const s = Math.max(0, (start || 0) - 14);
    const e = Math.min(seg.length, (end || start || 0) + 26);
    return (s > 0 ? '…' : '') + seg.slice(s, e).trim() + (e < seg.length ? '…' : '');
  }

  function chooseAmount(amounts, kwStart, kwEnd) {
    if (!amounts.length) return null;
    let best = null;
    for (const a of amounts) {
      if (a.start >= kwEnd && a.start - kwEnd <= 40) { best = a; break; }
    }
    if (best) return best;
    for (const a of amounts) {
      if (a.end <= kwStart && kwStart - a.end <= 12) best = a;
    }
    if (best) return best;
    return amounts[0];
  }

  function setByPath(target, field, value) {
    const parts = field.split('.');
    if (parts.length === 1) { target[parts[0]] = value; return true; }
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
    return true;
  }

  /* =========================================================
     v7.3 — 1~5종 수술비 계열
     같은 담보가 1종~5종으로 나뉘어 여러 줄로 적힙니다.
     model.js 의 surgery.disease15 · injury15 는 '1종 기준액' 한 칸이므로
     1종(없으면 가장 낮은 종) 금액을 대표값으로 넣고, 나머지 종은 note 에 남깁니다.
     ========================================================= */
  const TIER_SERIES = [
    { field: 'surgery.disease15', label: '질병 1~5종 수술비', group: '수술', re: /질병\s*수술비?\s*\(?\s*([1-5])\s*종/ },
    { field: 'surgery.injury15', label: '상해 1~5종 수술비', group: '수술', re: /(?:일반\s*)?상해\s*수술비?\s*\(?\s*([1-5])\s*종/ }
  ];
  function tierSeriesOf(name) {
    const s = String(name || '');
    for (const t of TIER_SERIES) {
      const m = t.re.exec(s);
      if (m) return { field: t.field, label: t.label, group: t.group, tier: Number(m[1]), key: t.field };
    }
    return null;
  }

  /* 직접 기재(custom) — 고정 칸에 없는 특약을 증권 담보명 그대로 담습니다 */
  const CUSTOM_GROUP = { cancer: '암', brain: '뇌', heart: '심장', surgery: '수술', care: '간병' };
  const CUSTOM_KEEP = /(진단비|진단금|수술비|치료비|입원|일당|장해|골절|화상|간병|배상|벌금|실손|수술|치료|보장금|연금|저축|지원금|로봇|다빈치)/;
  const CUSTOM_SKIP = /(보험료|납입|환급|해약|적립|면제|지원\s*\(|기본계약\s*\(|자동\s*이체|지정대리|청구서비스|갱신형\s*$)/;
  const MAX_CUSTOM = 40;

  function customAreaOf(name) {
    const s = String(name || '').replace(/\s+/g, '');
    if (/(간병|요양|치매|장기요양)/.test(s)) return 'care';
    if (/(특정순환계|순환계)/.test(s)) return 'brain';   /* 뇌·심장 공유 담보 — 기존 규격(뇌)으로 */
    if (/(뇌|중추신경|뇌혈관|뇌졸중|뇌출혈|뇌종양)/.test(s)) return 'brain';
    if (/(심장|심근|협심|허혈|관상동맥|판막|부정맥|심혈관)/.test(s)) return 'heart';
    if (/(암|항암|종양|백혈병|갑상선)/.test(s)) return 'cancer';
    if (/(수술|절제|인공|관절|척추|골절|깁스|화상)/.test(s)) return 'surgery';
    return null;
  }

  function cleanCustomName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  /* 표기가 다른 같은 담보를 한 번만 담기 위한 열쇠 — 꼬리 선택조건(상급종합병원Ⅲ, 연간1회한)을 빼고 비교합니다 */
  function customKeyOf(name) {
    let s = String(name || '').replace(/\s+/g, '');
    let prev;
    do {
      prev = s;
      s = s.replace(/\([^()]*\)$/, (m) => (/(상급종합병원|종합병원|연간|최초|치료별|체증형|갱신|회한|종별|Ⅲ)/.test(m) ? '' : m)).trim();
    } while (s !== prev);
    return s;
  }

  /* =========================================================
     v5.8 — 증권 담보 '직접 기재(custom)' 인식 (한 줄형 텍스트용 규칙)
     ========================================================= */
  const CUSTOM_RULES = [
    { name: '특정순환계질환(3~5종) 주요치료비', area: 'auto', mode: 'bundle',
      kw: /(특정\s*순환계|순환계\s*질환[^\n]{0,14}주요\s*치료비|3\s*[~\-–]\s*5\s*종[^\n]{0,12}주요\s*치료비)/ },
    { name: '표적항암약물허가치료비', area: 'cancer', mode: 'individual',
      kw: /(표적\s*항암\s*약물|표적항암\s*허가|표적\s*항암\s*치료비)/ },
    { name: '다빈치로봇수술비', area: 'cancer', mode: 'individual',
      kw: /(다빈치|로봇\s*수술|로봇\s*보조)/ },
    { name: '중증치매간병비', area: 'care', mode: 'individual',
      kw: /(중증\s*치매[^\n]{0,8}간병|치매\s*간병)/ },
    { name: '관절/척추 수술비', area: 'surgery', mode: 'individual',
      kw: /(관절|척추|디스크)[^\n]{0,10}수술/ },
    { name: '상해간병일당', area: 'care', mode: 'individual',
      kw: /상해[^\n]{0,8}간병/ },
    { name: '장기요양간병비', area: 'care', mode: 'individual',
      kw: /(장기\s*요양[^\n]{0,8}간병|요양\s*등급[^\n]{0,8}간병)/ },
    { name: '뇌 중환자실입원일당', area: 'brain', mode: 'individual',
      kw: /뇌[^\n]{0,8}중환자실/ },
    { name: '심장 중환자실입원일당', area: 'heart', mode: 'individual',
      kw: /심장[^\n]{0,8}중환자실/ }
  ];

  /* 표준 규칙이 이미 먹은 줄은 건드리지 않습니다(이중 반영 방지) */
  function parseCustomItems(src, usedSegs, skipLines, takenNames) {
    const out = [];
    const segments = splitSegments(src);
    let section = null;
    usedSegs = usedSegs || { has: () => false, add: () => {} };
    for (const seg of segments) {
      if (skipLines && skipLines.has(seg)) continue;
      const amounts = parseAmounts(seg);
      const sec = detectSection(seg);
      const isHeading = amounts.length === 0 && seg.replace(/[\[\](){}<>]/g, '').trim().length <= 24 && !!sec;
      if (isHeading) { section = sec; continue; }
      if (!amounts.length || usedSegs.has(seg)) continue;
      if (takenNames && takenNames.has(cleanCustomName(seg).replace(/\s/g, ''))) continue;
      const areaHint = sec || section;
      for (const rule of CUSTOM_RULES) {
        const m = rule.kw.exec(seg);
        if (!m) continue;
        const a = chooseAmount(amounts, m.index, m.index + m[0].length);
        if (!a) continue;
        /* 뇌·심장 공통 담보명은 표 머리글에서 영역을 읽고, 모르면 뇌로 둡니다 */
        const area = rule.area === 'auto' ? (areaHint === 'heart' ? 'heart' : 'brain') : rule.area;
        if (out.some((x) => x.name === rule.name && x.area === area)) continue;
        out.push({
          field: 'custom.' + area, label: rule.name, group: CUSTOM_GROUP[area],
          value: a.value, unit: '만원',
          snippet: snip(seg, m.index, m.index + m[0].length),
          apply: true, kind: 'custom', area, name: rule.name, mode: rule.mode,
          note: rule.area === 'auto' && areaHint !== 'heart'
            ? '뇌·심장 공통 담보명 — 심장 쪽에도 같은 담보가 있으면 5대 담보 입력에서 직접 추가하세요.' : null
        });
        usedSegs.add(seg);
        break;
      }
    }
    return out;
  }

  /* =========================================================
     월 보험료 — 라벨과 값이 다른 줄에 있는 표를 위한 짝짓기
     납입보험료/실납입보험료/월보험료 = 월 보험료(177,611원)
     총납입보험료(42,626,640원)·적립보험료·예상만기환급금은 제외합니다.
     ========================================================= */
  const PREMIUM_LABELS = [
    { p: 3, re: /^(?:월\s*)?(?:실\s*)?납입\s*보험료$|^월\s*보험료$|^보험료\s*합계$|^월\s*납입액$|^월\s*보험료\s*합계$/ },
    { p: 2, re: /^보장\s*보험료$/ },
    { p: 1, re: /^보험료$/ }
  ];
  const PREMIUM_BAN = /(총\s*납입|적립|예상\s*만기|해약\s*환급|환급금)/;

  function detectPremium(lines) {
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      const t = String(lines[i] == null ? '' : lines[i]).trim();
      if (!t || PREMIUM_BAN.test(t)) continue;
      for (const c of PREMIUM_LABELS) {
        if (!c.re.test(t)) continue;
        let val = null;
        let proof = t;
        const nxt = String(lines[i + 1] == null ? '' : lines[i + 1]).trim();
        if (isAmountCell(nxt)) {
          const a = parseAmounts(nxt);
          if (a.length) { val = a[0].value; proof = t + ' ' + nxt; }
        }
        if (val == null || val <= 0 || val > 300) break;   /* 월 보험료 상한 300만원 */
        if (!best || c.p > best.p) best = { p: c.p, value: roundAmount(val), proof };
        break;
      }
    }
    return best;
  }

  /* =========================================================
     텍스트 → { items, premium, silson, count }
     items[] = { field, label, group, value, snippet, apply, note, kind }
     ========================================================= */
  function parseCoverageText(text) {
    const src = String(text || '');
    const lines = src.split(/\r?\n/);
    const boiler = buildBoilerplate(lines);
    const found = new Map();
    const items = [];
    const tierMap = new Map();
    const usedLines = new Set();
    const usedNames = new Set();
    let section = null;
    let premium = null;
    let silson = null;

    /* 0) 월 보험료 — 라벨·값이 다른 줄에 있는 표 */
    const pv = detectPremium(lines);
    if (pv) {
      premium = Math.round(pv.value);
      items.push({
        field: 'monthlyPremium', label: '월 보험료', group: '기본', value: premium, unit: '만원',
        snippet: pv.proof, apply: true, kind: 'premium',
        note: pv.value !== premium ? `원문 월 보험료 약 ${pv.value}만원 — 1만원 단위로 반영합니다.` : null
      });
      found.set('monthlyPremium', true);
    }

    function noteAlternate(field, text) {
      const it = items.find((x) => x.field === field);
      if (!it) return;
      const note = it.note || '';
      if (note.indexOf(text) >= 0) return;   /* 같은 안내를 두 번 붙이지 않습니다 */
      it.note = note ? (note + ' · ' + text) : text;
    }

    /* 1) 표 행 — 담보명이 여러 줄로 끊긴 표 + 세로줄(구분자)형 한 줄 표 */
    const rows = scanTableRows(lines, boiler, usedLines).concat(scanSeparatorRows(lines));
    const allNames = rows.map((r) => String(r.name || '').replace(/\s/g, ''));
    const customNames = Object.create(null);
    const handleRow = (row) => {
      const name = row.name;
      usedNames.add(name.replace(/\s/g, ''));
      const unit = row.unit || '만원';
      let amt = parseAmounts(row.amtRaw, { unit });
      if (!amt.length && isAmountCell(row.amtRaw)) {
        /* 단위 열을 못 읽은 표 — 셀 숫자를 만원으로 해석 */
        const n = parseFloat(row.amtRaw.replace(/[^0-9.]/g, ''));
        if (isFinite(n) && n > 0) amt = [{ value: roundAmount(n), unit: '', start: 0, end: 0, raw: row.amtRaw }];
      }
      if (!amt.length) return;
      let value = amt[0].value;
      /* 단위 머리글을 못 읽은 표 — 숫자가 너무 크면 '원' 단위로 적힌 것으로 되돌립니다 */
      if (!row.unit && value > 100000) value = roundAmount(value / 10000);
      const unitTag = row.unit && !/(만원|천원|원)/.test(row.amtRaw) ? `(${row.unit})` : '';
      const snippet = `${name} · ${row.amtRaw}${unitTag}${row.period ? ' · ' + row.period : ''}`;

      if (NON_COVERAGE.test(name) && !/후유\s*장해/.test(name)) return;

      const tier = tierSeriesOf(name);
      if (tier) {
        const cur = tierMap.get(tier.field);
        if (!cur) tierMap.set(tier.field, { label: tier.label, group: tier.group, tiers: { [tier.tier]: value }, names: [name] });
        else {
          if (cur.tiers[tier.tier] == null) cur.tiers[tier.tier] = value;
          cur.names.push(name);
        }
        return;
      }

      const hit = bestRule(name, detectSection(name));
      if (hit) {
        if (found.has(hit.rule.field)) {
          const prev = items.find((x) => x.field === hit.rule.field);
          if (prev && Number(prev.value) !== Number(value)) noteAlternate(hit.rule.field, `같은 담보 ${prev.value}/${value}만원 중 ${prev.value}만원 반영`);
          return;
        }
        found.set(hit.rule.field, true);
        items.push({
          field: hit.rule.field, label: hit.rule.label, group: hit.rule.group, value,
          unit: '만원', snippet, apply: hit.rule.apply !== false,
          note: hit.rule.note || null, kind: 'cov'
        });
        return;
      }

      /* 2) 고정 칸에 없는 담보 — 원문 이름 그대로 직접 기재 */
      const cArea = customAreaOf(name);
      if (!cArea) return;
      if (!CUSTOM_KEEP.test(name) || CUSTOM_SKIP.test(name)) return;
      const cName = cleanCustomName(name);
      /* 같은 담보가 더 긴 이름(선택조건 붙은 줄)으로도 잡혔으면 짧은 쪽은 버립니다 */
      const nk = cName.replace(/\s/g, '');
      if (allNames.some((n2) => n2.length > nk.length && n2.indexOf(nk) === 0)) return;
      const key = customKeyOf(cName) + '|' + cArea;
      if (customNames[key]) return;
      if (Object.keys(customNames).length >= MAX_CUSTOM) return;
      customNames[key] = true;
      items.push({
        field: 'custom.' + cArea, label: cName, group: CUSTOM_GROUP[cArea],
        value, unit: '만원', snippet, apply: true, kind: 'custom',
        area: cArea, name: cName,
        mode: /주요\s*치료비|통합/.test(name) ? 'bundle' : 'individual',
        note: '고정 칸에 없는 담보 — 증권 담보명 그대로 담았습니다.'
      });
    };
    rows.forEach(handleRow);

    /* 3) 1~5종 수술비 — 1종(없으면 가장 낮은 종) 금액을 대표값으로 */
    tierMap.forEach((t, field) => {
      if (found.has(field)) return;
      const tiers = Object.keys(t.tiers).map(Number).sort((a, b) => a - b);
      if (!tiers.length) return;
      const rep = tiers[0];
      const parts = tiers.map((k) => `${k}종 ${t.tiers[k]}만원`).join(' · ');
      found.set(field, true);
      items.push({
        field, label: t.label, group: t.group, value: t.tiers[rep], unit: '만원',
        snippet: t.names.join(' / ') + ` · ${parts}`,
        apply: true, kind: 'cov',
        note: `${tiers.length}개 종이 있습니다(${parts}). 이 칸은 1종 기준액으로 보고 ${rep}종 ${t.tiers[rep]}만원을 넣었습니다.`
      });
    });

    /* 4) 한 줄형·구분자형 — 표에 쓰인 줄은 건너뜁니다 */
    for (let li = 0; li < lines.length; li++) {
      if (usedLines.has(li)) continue;
      const line = String(lines[li] == null ? '' : lines[li]).trim();
      if (!line || boiler.has(line)) continue;
      const segments = splitSegments(line);
      for (const seg of segments) {
        const amounts = parseAmounts(seg);
        const sec = detectSection(seg);
        const isHeading = amounts.length === 0 && seg.replace(/[\[\](){}<>]/g, '').trim().length <= 24 && !!sec;
        if (isHeading) { section = sec; continue; }
        const effective = sec && amounts.length === 0 ? sec : (sec || section);

        const candidates = [];
        for (const rule of RULES) {
          if (rule.section && rule.section !== (sec || section)) continue;
          if (rule.exclude && rule.exclude.test(seg)) continue;
          const m = rule.kw.exec(seg);
          if (!m) continue;
          candidates.push({ rule, start: m.index, end: m.index + m[0].length, match: m });
        }
        if (!candidates.length) continue;
        candidates.sort((a, b) => b.rule.p - a.rule.p);

        const accepted = [];
        for (const cand of candidates) {
          const rule = cand.rule;
          if (found.has(rule.field)) continue;
          const overlap = accepted.some((a) => cand.start < a.end && cand.end > a.start);
          if (overlap) continue;

          if (rule.type === 'premium') {
            const a = chooseAmount(amounts, cand.start, cand.end);
            if (a) {
              premium = Math.round(a.value);
              accepted.push(cand);
              found.set(rule.field, true);
              items.push({ field: rule.field, label: rule.label, group: rule.group, value: premium, unit: '만원', snippet: snip(seg, cand.start, cand.end), apply: true, kind: 'premium', note: null });
            }
            continue;
          }
          if (rule.type === 'silson') {
            const g = /(\d)\s*세대/.exec(cand.match[0]) || /(\d)\s*세대/.exec(seg);
            if (g) {
              const gen = g[1];
              if (gen >= '1' && gen <= '5') {
                silson = gen;
                accepted.push(cand);
                found.set(rule.field, true);
                items.push({ field: rule.field, label: rule.label, group: rule.group, value: gen, unit: '세대', snippet: snip(seg, cand.start, cand.end), apply: true, kind: 'silson' });
              }
            }
            continue;
          }
          if (rule.type === 'bool') {
            accepted.push(cand);
            found.set(rule.field, true);
            items.push({ field: rule.field, label: rule.label, group: rule.group, value: true, unit: '', snippet: snip(seg, cand.start, cand.end), apply: true, kind: 'bool' });
            continue;
          }
          const a = chooseAmount(amounts, cand.start, cand.end);
          if (!a) continue;
          accepted.push(cand);
          found.set(rule.field, true);
          items.push({
            field: rule.field, label: rule.label, group: rule.group, value: a.value, unit: '만원',
            snippet: snip(seg, cand.start, cand.end), apply: rule.apply !== false, note: rule.note || null, kind: 'cov'
          });
        }
        void effective;
      }
    }

    /* 5) 예전 한 줄형 보완 스캔 — 그래도 비어 있으면 원문 줄 단위로 한 번 더 */
    if (!items.filter((x) => x.kind === 'cov' || x.kind === 'custom').length) {
      for (let li = 0; li < lines.length; li++) {
        if (usedLines.has(li)) continue;
        const line = String(lines[li] == null ? '' : lines[li]).trim();
        if (!line || boiler.has(line)) continue;
        const amounts = parseAmounts(line);
        if (!amounts.length) continue;
        for (const rule of RULES) {
          if (found.has(rule.field) || rule.type) continue;
          if (rule.exclude && rule.exclude.test(line)) continue;
          const m = rule.kw.exec(line);
          if (!m) continue;
          found.set(rule.field, true);
          items.push({
            field: rule.field, label: rule.label, group: rule.group, value: amounts[0].value, unit: '만원',
            snippet: snip(line, m.index, m.index + m[0].length), apply: rule.apply !== false, note: rule.note || null, kind: 'cov'
          });
          break;
        }
      }
    }

    /* 6) 한 줄형 텍스트용 직접 기재 규칙 — 이미 담은 이름은 다시 담지 않습니다 */
    const usedSegs = { set: Object.create(null), has(seg) { return !!this.set[seg]; }, add(seg) { this.set[seg] = true; } };
    const skipLines = new Set();
    usedLines.forEach((i) => { const t = String(lines[i] == null ? '' : lines[i]).trim(); if (t) skipLines.add(t); });
    parseCustomItems(src, usedSegs, skipLines, usedNames).forEach((x) => items.push(x));

    const order = ['기본', '암', '뇌', '심장', '수술', '간병', '생활'];
    items.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    return { items, premium, silson, count: items.length };
  }

  /* 이름 하나 → 규칙 하나 (표 행 전용) */
  function bestRule(name, sec) {
    const s = String(name || '');
    let best = null;
    for (const rule of RULES) {
      if (rule.type === 'premium' || rule.type === 'silson') continue;
      if (rule.section && rule.section !== sec) continue;
      if (rule.exclude && rule.exclude.test(s)) continue;
      const m = rule.kw.exec(s);
      if (!m) continue;
      if (!best || rule.p > best.rule.p) best = { rule, match: m };
    }
    return best;
  }

  /* 파서 단위 시험·샘플 불러오기에 쓰는 표준 보장분석표 */
  const SAMPLE_TEXT = [
    '보장분석표 (샘플 · 40대 남) · 월 보험료 27만원 · 실손 4세대',
    '[기본]',
    '월 보험료 27만원',
    '실손의료보험 4세대',
    '[암]',
    '일반암 진단비 5,000만원',
    '유사암 진단비 1,000만원',
    '암수술비 1,000만원',
    '항암약물치료비 1,500만원',
    '항암방사선치료비 600만원',
    '[뇌]',
    '뇌혈관질환 진단비 2,000만원',
    '뇌졸중 진단비 2,000만원',
    '뇌출혈 진단비 1,000만원',
    '혈전용해제 치료비 1,000만원',
    '[심장]',
    '허혈성심장질환 진단비 2,000만원',
    '급성심근경색 진단비 1,000만원',
    '[수술]',
    '질병수술비 50만원',
    '질병 1~5종 수술비 300만원',
    '질병 N대 수술비 500만원',
    '상해수술비 50만원',
    '상해 1~5종 수술비 300만원',
    '[간병]',
    '일반병원 간병인 사용일당 10만원',
    '요양병원 간병인 사용일당 5만원'
  ].join('\n');

  /* v7.3 — 세로 줄바꿈형 표 샘플 (완전 합성·비식별).
     담보명·가입금액·보장보험료·납입기간이 각각 다른 줄로 끊긴 실제 보험사 제안서 양식입니다. */
  const SAMPLE_TEXT_TABLE = [
    '가상 보장분석표 · 월 보험료 12만원',
    '피보험자 홍길동(남자,45세)',
    '납입보험료',
    '120,000원',
    '총납입보험료',
    '28,800,000원',
    '■ 보장내역(선택계약)',
    '보장명',
    '보장상세',
    '가입금액(만원)',
    '보장보험료(원)',
    '납입기간 및 만기',
    '암진단비(유사암제외)',
    '암보장개시일 이후 암으로 진단확정시 지급',
    '3,000',
    '12,500',
    '20년납 100세만기',
    '[',
    '보험금을 지급하지 않는 사유',
    ']',
    '보통약관의 (보험금을 지급하지 않는 사유)',
    '유사암진단비(연간1회한)',
    '기타피부암·갑상선암 등 진단확정시 지급',
    '600',
    '1,200',
    '20년납 100세만기',
    '뇌혈관질환진단비',
    '뇌혈관질환으로 진단확정 되었을 때 지급',
    '1,000',
    '4,300',
    '20년납 90세만기',
    '허혈성심장질환진단비',
    '허혈성심장질환으로 진단확정 되었을 때 지급',
    '800',
    '3,100',
    '20년납 90세만기',
    '질병수술비(1종)',
    '1~5종 수술분류표 1종 수술 1회당',
    '10',
    '620',
    '20년납 90세만기',
    '질병수술비(3종)',
    '1~5종 수술분류표 3종 수술 1회당',
    '200',
    '2,050',
    '20년납 90세만기',
    '질병수술비(5종)',
    '1~5종 수술분류표 5종 수술 1회당',
    '1,000',
    '5,400',
    '20년납 90세만기',
    '일반상해수술비(1종)',
    '상해 1종 수술 1회당',
    '10',
    '140',
    '20년납 100세만기',
    '일반상해수술비',
    '상해 수술 1회당',
    '50',
    '900',
    '20년납 100세만기',
    '골절진단비(치아파절제외)',
    '상해로 골절 진단확정시',
    '10',
    '780',
    '20년납 100세만기',
    '특정순환계질환(3~5종)주요치료비(연간1회한)',
    '특정순환계질환 3~5종 치료 1회당',
    '2,000',
    '9,800',
    '20년납 90세만기',
    '보험료납입면제대상',
    '납입면제 사유 발생시 보장보험료 납입면제',
    '100',
    '3,750',
    '20년납 20년만기'
  ].join('\n');

  /* =========================================================
     8. 사진 전처리 (휘발)
     ========================================================= */
  async function decodeBitmap(blob) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch (e) { /* 폴백 */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없습니다 — 다른 사진으로 다시 시도해 주세요.')); };
      img.src = url;
    });
  }

  /* 촬영본을 메모리에서만 축소·대비 측정합니다. 저장소에 쓰지 않습니다. */
  async function preprocessImage(blob, opts) {
    opts = opts || {};
    const maxEdge = opts.maxEdge || 1600;
    const bmp = await decodeBitmap(blob);
    const w = bmp.width || bmp.naturalWidth;
    const h = bmp.height || bmp.naturalHeight;
    if (!w || !h) throw new Error('사진 크기를 읽지 못했습니다.');
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, cw, ch);

    let mean = null;
    let contrast = null;
    let darkRatio = null;
    try {
      const data = ctx.getImageData(0, 0, cw, ch).data;
      const step = 4 * Math.max(1, Math.floor((cw * ch) / 40000));
      let n = 0, sum = 0, sum2 = 0, dark = 0;
      for (let i = 0; i < data.length; i += step) {
        const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += l;
        sum2 += l * l;
        n++;
        if (l < 110) dark++;
      }
      if (n) {
        mean = sum / n;
        contrast = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
        darkRatio = dark / n;
      }
    } catch (e) { /* 캔버스 픽셀 접근 제한 — 통계 없이 진행 */ }

    const outBlob = await new Promise((res) => {
      try { canvas.toBlob((b) => res(b), 'image/jpeg', 0.85); }
      catch (e) { res(null); }
    });

    /* ---- 즉시 파기 ---- */
    try { ctx.clearRect(0, 0, cw, ch); } catch (e) {}
    canvas.width = 0;
    canvas.height = 0;
    if (typeof bmp.close === 'function') { try { bmp.close(); } catch (e) {} }

    const enough = contrast == null ? null : contrast >= 22;
    return {
      width: w, height: h, scaledWidth: cw, scaledHeight: ch,
      mean: mean == null ? null : Math.round(mean),
      contrast: contrast == null ? null : Math.round(contrast),
      darkRatio: darkRatio == null ? null : Math.round(darkRatio * 100),
      sharpEnough: enough,
      bigEnough: Math.min(w, h) >= 640,
      blob: outBlob
    };
  }

  /* =========================================================
     9. 3단계 백엔드 비전 어댑터 (인터페이스만 준비)
     ========================================================= */
  async function parseWithVisionBackend(blob, endpoint, opts) {
    opts = opts || {};
    /* v5.4 — 서버 연결 + 로그인 상태면 backend.js 가 JWT·CORS·표준 스키마를 맡고,
       그 응답을 여기서 parseCoverageText() 로 다시 파싱해 검수 화면에 그대로 넣습니다. */
    if (root.BojangBackend && root.BojangBackend.canUseVision && root.BojangBackend.canUseVision()) {
      return root.BojangBackend.parseCoverageVision(blob, opts);
    }
    const url = endpoint || VISION_ENDPOINT;
    if (!url) {
      return {
        ok: false, reason: 'no-endpoint', items: [], premium: null, silson: null,
        message: '비전 서버 주소가 설정되지 않았습니다. 3단계 백엔드 연동 후 사용할 수 있습니다.'
      };
    }
    /* v7.1 — fail-closed: 가드가 없거나 허용 판정이 아니면 사진을 외부로 보내지 않습니다 */
    const g = root.bojangDomainGuard;
    if (!g || typeof g.allowed !== 'function' || !g.allowed()) {
      return {
        ok: false, reason: 'domain-lock', items: [], premium: null, silson: null,
        message: '지금 실행 환경에서는 사진 AI 인식을 쓸 수 없습니다. 공식 배포처(HTTPS)에서 열어 주세요.'
      };
    }
    const form = new FormData();
    form.append('image', blob, opts.filename || 'capture.jpg');
    if (opts.hint) form.append('hint', String(opts.hint));
    let res;
    try {
      res = await fetch(url, { method: 'POST', body: form, headers: opts.headers || {} });
    } catch (e) {
      return { ok: false, reason: 'network', items: [], premium: null, silson: null, message: '비전 서버에 연결하지 못했습니다.' };
    }
    if (!res.ok) {
      return { ok: false, reason: 'http-' + res.status, items: [], premium: null, silson: null, message: `비전 서버 응답 오류 (${res.status})` };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!data) return { ok: false, reason: 'bad-json', items: [], premium: null, silson: null, message: '비전 서버 응답을 읽지 못했습니다.' };
    if (data.text) {
      const parsed = parseCoverageText(data.text);
      return Object.assign({ ok: true, text: data.text }, parsed);
    }
    if (Array.isArray(data.items)) {
      return { ok: true, items: data.items, premium: data.premium != null ? data.premium : null, silson: data.silson != null ? data.silson : null, text: data.text || '' };
    }
    return { ok: false, reason: 'empty', items: [], premium: null, silson: null, message: '비전 서버가 담보 항목을 돌려주지 않았습니다.' };
  }

  root.BojangImport = {
    VISION_ENDPOINT,
    extractPdfText,
    parseCoverageText,
    parseCustomItems,
    CUSTOM_RULES,
    parseAmounts,
    setByPath,
    SAMPLE_TEXT,
    SAMPLE_TEXT_TABLE,
    scanTableRows,
    scanSeparatorRows,
    periodLike,
    isAmountCell,
    buildBoilerplate,
    tierSeriesOf,
    preprocessImage,
    parseWithVisionBackend,
    decodePdfString,
    parseCMap,
    looksGarbled
  };
})(typeof window !== 'undefined' ? window : globalThis);
