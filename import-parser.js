/* 보장분석 라이프 리포트 v5.4 — 입력 파서 (import-parser.js)

   v5.3의 자동입력 허브가 쓰는 세 가지 엔진을 이 파일 하나에 모았습니다.
   v5.4: 사진 인식이 실서버 모드에서 backend.js(parse-coverage-vision)로 연결됩니다.
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
  const SKIP_BEFORE = /[~\-\uFF5E/]/;

  function roundAmount(v) {
    if (!isFinite(v)) return null;
    if (v >= 10) return Math.round(v);
    return Math.round(v * 10) / 10;
  }

  function parseAmounts(str) {
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
        if (n < 100) continue;            /* 단위 없는 작은 숫자는 금액으로 보지 않습니다 (1~5종 등) */
        v = n >= 100000 ? n / 10000 : n;  /* 270,000 → 27만원 */
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
     7. 한국 보장분석표 파서
     ========================================================= */
  const RULES = [
    /* --- 암 --- */
    { field: 'cancer.similar', label: '유사암 진단비', group: '암', p: 96,
      kw: /(유사암|소액암|갑상선암|기타피부암|제자리암|경계성\s*종양)/ },
    { field: 'cancer.recur', label: '재진단·전이암 보장', group: '암', p: 95, type: 'bool',
      kw: /(재진단\s*암|전이\s*암|재발\s*암|재진단형)/ },
    { field: 'cancer.high', label: '고액암 진단비 (참고)', group: '암', p: 94, apply: false,
      note: 'v5.2 계산식은 일반암 진단비 한 축으로 판정합니다 — 고액암은 참고값으로만 보여드립니다.',
      kw: /(고액암|특정\s*암|1\s*억\s*암)/ },
    { field: 'cancer.general', label: '일반암 진단비', group: '암', p: 90,
      exclude: /재진단|전이|재발/,
      kw: /(일반암\s*진단|암\s*(?:진단비|진단금|진단보험금))/ },
    { field: 'cancer.treatment.surgery', label: '암수술비', group: '암', p: 88,
      kw: /(암\s*수술|암수술)/ },
    { field: 'cancer.treatment.drug', label: '항암약물치료비', group: '암', p: 88,
      kw: /(항암\s*(?:약물|화학|치료|주사)|표적\s*항암|면역\s*항암)/ },
    { field: 'cancer.treatment.radio', label: '항암방사선치료비', group: '암', p: 87,
      kw: /(항암\s*방사선|방사선\s*(?:치료|수술))/ },
    { field: 'cancer.treatment.icu', label: '암 중환자실 입원', group: '암', p: 80, section: 'cancer',
      kw: /(중환자실|집중치료실)/ },
    { field: 'cancer.treatment.extra', label: '비급여 추가 치료비', group: '암', p: 78, section: 'cancer',
      kw: /(비급여|추가\s*치료비|표적\s*치료)/ },

    /* --- 뇌 --- */
    { field: 'brain.dx.stroke', label: '뇌졸중 진단비', group: '뇌', p: 92,
      kw: /(뇌졸중|뇌경색)/ },
    { field: 'brain.dx.bleed', label: '뇌출혈 진단비', group: '뇌', p: 92,
      kw: /(뇌출혈|뇌내출혈|지주막하출혈)/ },
    { field: 'brain.dx.vascular', label: '뇌혈관질환 진단비', group: '뇌', p: 91,
      kw: /(뇌혈관\s*질환|뇌혈관)/ },
    { field: 'brain.treat.surgery', label: '뇌 수술비(관혈·비관혈)', group: '뇌', p: 86,
      kw: /(뇌\s*수술|개두술|색전술|뇌혈관\s*수술|스텐트)/ },
    { field: 'brain.treat.lysis', label: '뇌 혈전용해제 치료비', group: '뇌', p: 85, section: 'brain',
      kw: /(혈전\s*용해|tPA|트롬빈)/ },
    { field: 'brain.treat.icu', label: '뇌 중환자실 입원비', group: '뇌', p: 80, section: 'brain',
      kw: /(중환자실|집중치료실)/ },

    /* --- 심장 --- */
    { field: 'heart.dx.ami', label: '급성심근경색 진단비', group: '심장', p: 92,
      kw: /(급성\s*심근경색|심근경색)/ },
    { field: 'heart.dx.ischemic', label: '허혈성심장질환 진단비', group: '심장', p: 91,
      kw: /(허혈성\s*심장|협심증|관상동맥\s*질환)/ },
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
      exclude: /1\s*[~\-]\s*5\s*종|N\s*대|\d+\s*대|비급여/,
      kw: /(질병\s*수술|질병수술)/ },
    { field: 'surgery.injury15', label: '상해 1~5종 수술비', group: '수술', p: 90,
      kw: /상해\s*1\s*[~\-]\s*5\s*종/ },
    { field: 'surgery.injury', label: '일반 상해수술비', group: '수술', p: 84,
      exclude: /1\s*[~\-]\s*5\s*종/,
      kw: /(상해\s*수술|상해수술|일반\s*상해)/ },

    /* --- 간병 --- */
    { field: 'care.nDaily', label: '요양병원 간병인 사용일당', group: '간병', p: 93,
      kw: /(요양\s*병원[^\n]{0,10}간병|요양\s*간병)/ },
    { field: 'care.daily', label: '일반병원 간병인 사용일당', group: '간병', p: 86,
      exclude: /요양/,
      kw: /(간병\s*인?[^\n]{0,10}(?:일당|사용|비)|간병일당|간병비)/ },

    /* --- 기본 정보 --- */
    { field: 'monthlyPremium', label: '월 보험료', group: '기본', p: 99, type: 'premium',
      kw: /(월\s*보험료|보험료\s*합계|월\s*납입|합계\s*보험료|월보험료|납입\s*보험료)/ },
    { field: 'silsonGen', label: '실손 세대', group: '기본', p: 99, type: 'silson',
      kw: /실손[^\n]{0,12}?(\d)\s*세대|(\d)\s*세대\s*(?:실손|의료비)/ }
  ].sort((a, b) => b.p - a.p);

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

  /* 텍스트 → { items, premium, silson }
     items[] = { field, label, group, value, snippet, apply, note } */
  function parseCoverageText(text) {
    const src = String(text || '');
    const segments = splitSegments(src);
    const found = new Map();
    const items = [];
    let section = null;
    let premium = null;
    let silson = null;

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
            premium = a.value;
            accepted.push(cand);
            found.set(rule.field, true);
            items.push({ field: rule.field, label: rule.label, group: rule.group, value: a.value, unit: '만원', snippet: snip(seg, cand.start, cand.end), apply: true, kind: 'premium' });
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

    /* 섹션 머리글만 있고 값이 없는 표는 항목이 비므로, 원문 줄 단위 2차 스캔으로 보완합니다 */
    if (!items.length) {
      const lines = String(src).split(/\n+/);
      for (const line of lines) {
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

    const order = ['기본', '암', '뇌', '심장', '수술', '간병'];
    items.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    return { items, premium, silson, count: items.length };
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
    parseAmounts,
    setByPath,
    SAMPLE_TEXT,
    preprocessImage,
    parseWithVisionBackend,
    decodePdfString,
    parseCMap,
    looksGarbled
  };
})(typeof window !== 'undefined' ? window : globalThis);
