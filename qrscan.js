/* 보장분석 라이프 리포트 v6.0 — 순수 JS QR 디코더 (qrscan.js)

   왜 직접 만들었나
   · 아이폰 Safari 에는 BarcodeDetector 가 없습니다. 안드로이드 크롬 전용 API 에 기대면
     "아이폰에서만 안 되는" 앱이 되므로, iOS·Android 공통 웹 표준(getUserMedia + Canvas)만 씁니다.
   · 외부 CDN·라이브러리 0 (단일 HTML 오프라인 원칙). qr.js(인코더)와 짝을 이루는 디코더입니다.

   지원 범위 (정직한 표기)
   · QR 버전 1~10 (21×21 ~ 57×57) · 오류정정 L/M/Q/H · 바이트 모드(UTF-8) · 숫자/영문 모드
   · 정면 또는 가까운 각도(±25° 이내)의 화면·인쇄물 스캔을 전제로 합니다.
   · 심한 원근 왜곡·초점 흐림·저조도는 실패할 수 있습니다. 그래서 앱에는 항상
     "6자리 코드 직접 입력" 폴백이 함께 있습니다(실패해도 인증은 100% 가능).
   · 카메라 실기기(iPhone/Android) 스캔은 이 환경에서 자동 테스트할 수 없어
     실기기 미검증 항목으로 보고서에 명시했습니다. 렌더→역디코드 왕복과 회전·잡음은 자동 검증합니다.

   API
   · BojangQRScan.decodeImageData(imageData)  → 문자열 (실패 시 null)
   · BojangQRScan.decodeGray(width, height, grayUint8) → 문자열 (실패 시 null)
   · BojangQRScan.decodeCanvas(canvas) → 문자열
   · BojangQRScan.available() → true
*/
(function (root) {
  'use strict';

  /* ---------- GF(256) ---------- */
  const EXP = new Array(512);
  const LOG = new Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  const ginv = (a) => EXP[255 - LOG[a]];
  const gpow = (e) => EXP[((e % 255) + 255) % 255];

  function polyEvalAsc(p, x) {          // p[0] + p[1]x + ...
    let r = 0;
    for (let i = p.length - 1; i >= 0; i -= 1) r = gmul(r, x) ^ (p[i] || 0);
    return r;
  }

  /* ---------- Reed-Solomon 복호 (오류 정정) ---------- */
  function syndromes(cw, ecLen) {
    const s = new Array(ecLen);
    let any = false;
    for (let i = 0; i < ecLen; i += 1) {
      let v = 0;
      const a = gpow(i);
      for (let j = 0; j < cw.length; j += 1) v = gmul(v, a) ^ cw[j];
      s[i] = v;
      if (v) any = true;
    }
    return { s, any };
  }

  function berlekampMassey(synd) {
    let C = [1];
    let B = [1];
    let L = 0;
    let m = 1;
    let b = 1;
    const n = synd.length;
    for (let k = 0; k < n; k += 1) {
      let d = synd[k];
      for (let i = 1; i <= L; i += 1) d ^= gmul(C[i] || 0, synd[k - i]);
      if (d === 0) { m += 1; continue; }
      const coef = gmul(d, ginv(b));
      const T = C.slice();
      const need = B.length + m;
      while (C.length < need) C.push(0);
      for (let i = 0; i < B.length; i += 1) C[i + m] = (C[i + m] || 0) ^ gmul(coef, B[i]);
      if (2 * L <= k) { L = k + 1 - L; B = T; b = d; m = 1; } else { m += 1; }
    }
    C = C.slice(0, L + 1);
    while (C.length < L + 1) C.push(0);
    return C;
  }

  function chienSearch(locator, n) {     // 오류 위치(배열 인덱스) 목록
    const out = [];
    for (let j = 0; j < n; j += 1) {
      const p = n - 1 - j;               // 위치 지수
      const xinv = gpow(-p);             // X^-1
      if (polyEvalAsc(locator, xinv) === 0) out.push(j);
    }
    return out;
  }

  /* 오류 위치만 알면 크기는 GF(256) 연립방정식으로 정확히 풀 수 있습니다(가우스 소거). */
  function solveMagnitudes(positions, synd, n) {
    const nu = positions.length;
    const A = [];
    for (let i = 0; i < nu; i += 1) {
      const row = new Array(nu + 1);
      for (let k = 0; k < nu; k += 1) row[k] = gpow((n - 1 - positions[k]) * i);
      row[nu] = synd[i];
      A.push(row);
    }
    for (let c = 0; c < nu; c += 1) {
      let piv = -1;
      for (let r = c; r < nu; r += 1) if (A[r][c] !== 0) { piv = r; break; }
      if (piv < 0) return null;
      if (piv !== c) { const t = A[piv]; A[piv] = A[c]; A[c] = t; }
      const ip = ginv(A[c][c]);
      for (let k = c; k <= nu; k += 1) A[c][k] = gmul(A[c][k], ip);
      for (let r = 0; r < nu; r += 1) {
        if (r === c || A[r][c] === 0) continue;
        const f = A[r][c];
        for (let k = c; k <= nu; k += 1) A[r][k] ^= gmul(f, A[c][k]);
      }
    }
    return A.map((row) => row[nu]);
  }

  function rsDecode(cw, ecLen) {
    const n = cw.length;
    const { s, any } = syndromes(cw, ecLen);
    if (!any) return cw;
    const locator = berlekampMassey(s);
    const nu = locator.length - 1;
    if (nu <= 0 || nu * 2 > ecLen) throw new Error('rs-too-many-errors');
    const positions = chienSearch(locator, n);
    if (positions.length !== nu) throw new Error('rs-locator-fail');
    const mags = solveMagnitudes(positions, s, n);
    if (!mags) throw new Error('rs-magnitude-fail');
    const out = cw.slice();
    for (let i = 0; i < positions.length; i += 1) out[positions[i]] ^= mags[i];
    const check = syndromes(out, ecLen);
    if (check.any) throw new Error('rs-uncorrected');
    return out;
  }

  /* ---------- 포맷 정보 (BCH 15,5) ---------- */
  const FORMAT = (function () {
    const table = new Map();
    for (let d = 0; d < 32; d += 1) {
      let rem = d << 10;
      for (let i = 4; i >= 0; i -= 1) if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
      const bits = ((d << 10) | rem) ^ 0x5412;
      table.set(bits, d);
    }
    return table;
  })();
  const ECC_NAME = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };   // 포맷 2비트 → 오류정정 수준

  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };
  /* 오류정정 M · 버전별 [블록당 EC 코드워드, [[블록 수, 데이터 코드워드], ...]] — qr.js(인코더)와 동일 표 */
  const EC = {
    1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]],
    5: [24, [[2, 43]]], 6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]],
    9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]]
  };
  /* 오류정정 L/Q/H 는 스캔한 QR 이 M 이 아닐 때만 필요합니다(외부 QR 대비 보강) */
  const EC_ALL = {
    L: { 1: [7, [[1, 19]]], 2: [10, [[1, 34]]], 3: [15, [[1, 55]]], 4: [20, [[1, 80]]],
         5: [26, [[1, 108]]], 6: [18, [[2, 68]]], 7: [20, [[2, 78]]], 8: [24, [[2, 97]]],
         9: [30, [[2, 116]]], 10: [18, [[2, 68], [2, 69]]] },
    M: EC,
    Q: { 1: [13, [[1, 13]]], 2: [22, [[1, 22]]], 3: [18, [[2, 17]]], 4: [26, [[2, 24]]],
         5: [18, [[2, 15], [2, 16]]], 6: [24, [[4, 19]]], 7: [18, [[2, 14], [4, 15]]],
         8: [22, [[4, 18], [2, 19]]], 9: [20, [[4, 16], [4, 17]]], 10: [24, [[6, 19], [2, 20]]] },
    H: { 1: [17, [[1, 9]]], 2: [28, [[1, 16]]], 3: [22, [[2, 13]]], 4: [16, [[4, 9]]],
         5: [22, [[2, 11], [2, 12]]], 6: [28, [[4, 15]]], 7: [26, [[4, 13], [1, 14]]],
         8: [26, [[4, 14], [2, 15]]], 9: [24, [[4, 12], [4, 13]]], 10: [28, [[6, 15], [2, 16]]] }
  };

  /* ---------- 2차원 모듈 읽기 ---------- */
  function functionMap(version) {
    const size = 17 + 4 * version;
    const f = [];
    for (let y = 0; y < size; y += 1) f.push(new Array(size).fill(false));
    const mark = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) f[y][x] = true; };
    /* 파인더 7×7 + 분리형 = 8×8 셋 */
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) { mark(x, y); mark(size - 1 - x, y); mark(x, size - 1 - y); }
    }
    /* 포맷 정보 2사본 + 다크 모듈 */
    const copy1 = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    copy1.forEach(([x, y]) => mark(x, y));
    for (let i = 0; i < 8; i += 1) mark(size - 1 - i, 8);
    for (let i = 0; i < 7; i += 1) mark(8, size - 1 - i);
    mark(8, size - 8);                       /* 다크 모듈 */
    /* 타이밍 (6행·6열) */
    for (let i = 0; i < size; i += 1) { mark(6, i); mark(i, 6); }
    /* 정렬 패턴 */
    const al = ALIGN[version] || [];
    for (let a = 0; a < al.length; a += 1) {
      for (let b = 0; b < al.length; b += 1) {
        const cx = al[a], cy = al[b];
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
        for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(cx + dx, cy + dy);
      }
    }
    /* 버전 정보 (7 이상) */
    if (version >= 7) {
      for (let i = 0; i < 6; i += 1) for (let j = 0; j < 3; j += 1) { mark(i, size - 11 + j); mark(size - 11 + j, i); }
    }
    return f;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ];

  function readFormatBits(m) {
    const size = m.length;
    const pick = (x, y) => (m[y][x] ? 1 : 0);
    /* 비트0(LSB)부터의 위치 — 1사본(좌상단) */
    const copy1 = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    /* 2사본 — 가로 8비트(bit0~7, 오른→왼) + 세로 7비트(bit8~14, 아래→위) */
    const copy2 = [];
    for (let i = 0; i < 8; i += 1) copy2.push([size - 1 - i, 8]);
    for (let i = 0; i < 7; i += 1) copy2.push([8, size - 1 - i]);
    const value = (seq) => seq.reduce((acc, [x, y], i) => acc | (pick(x, y) << i), 0);
    const a = value(copy1);
    const b = value(copy2);
    for (const cand of [a, a ^ 0x7FFF]) if (FORMAT.has(cand)) return FORMAT.get(cand);
    for (const cand of [b, b ^ 0x7FFF]) if (FORMAT.has(cand)) return FORMAT.get(cand);
    return null;
  }

  function readCodewords(m, mask, version) {
    const size = m.length;
    const func = functionMap(version);
    const bits = [];
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert += 1) {
        const y = upward ? size - 1 - vert : vert;
        for (let c = 0; c < 2; c += 1) {
          const x = right - c;
          if (func[y][x]) continue;
          let v = m[y][x] ? 1 : 0;
          if (MASKS[mask](x, y)) v ^= 1;
          bits.push(v);
        }
      }
      upward = !upward;
    }
    const cw = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      let v = 0;
      for (let b = 0; b < 8; b += 1) v = (v << 1) | bits[i + b];
      cw.push(v);
    }
    return cw;
  }

  function deinterleaveAndCorrect(raw, version, eccName) {
    const table = (EC_ALL[eccName] || EC_ALL.M)[version];
    if (!table) throw new Error('unsupported-version');
    const ecLen = table[0];
    const spec = table[1];
    const dataLens = [];
    spec.forEach(([count, len]) => { for (let i = 0; i < count; i += 1) dataLens.push(len); });
    const totalData = dataLens.reduce((a, b) => a + b, 0);
    const total = totalData + ecLen * dataLens.length;
    if (raw.length < total) throw new Error('short-codewords');
    const dataBlocks = dataLens.map(() => []);
    let idx = 0;
    const maxData = Math.max.apply(null, dataLens);
    for (let i = 0; i < maxData; i += 1) {
      for (let b = 0; b < dataLens.length; b += 1) if (i < dataLens[b]) dataBlocks[b].push(raw[idx++]);
    }
    const ecBlocks = dataLens.map(() => []);
    for (let i = 0; i < ecLen; i += 1) {
      for (let b = 0; b < dataLens.length; b += 1) ecBlocks[b].push(raw[idx++]);
    }
    const out = [];
    for (let b = 0; b < dataLens.length; b += 1) {
      const fixed = rsDecode(dataBlocks[b].concat(ecBlocks[b]), ecLen);
      out.push.apply(out, fixed.slice(0, dataLens[b]));
    }
    return out;
  }

  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  function parseStream(bytes, version) {
    let bitPos = 0;
    const totalBits = bytes.length * 8;
    const readBits = (n) => {
      let v = 0;
      for (let i = 0; i < n; i += 1) {
        const p = bitPos + i;
        const byte = bytes[p >> 3] || 0;
        v = (v << 1) | ((byte >> (7 - (p & 7))) & 1);
      }
      bitPos += n;
      return v;
    };
    let out = '';
    while (bitPos + 4 <= totalBits) {
      const mode = readBits(4);
      if (mode === 0) break;
      if (mode === 4) {                                  // 바이트 모드
        const lenBits = version >= 10 ? 16 : 8;
        if (bitPos + lenBits > totalBits) break;
        const len = readBits(lenBits);
        if (bitPos + len * 8 > totalBits) break;
        const bin = [];
        for (let i = 0; i < len; i += 1) bin.push(readBits(8));
        out += utf8Decode(bin);
      } else if (mode === 1) {                           // 숫자
        const groups = version >= 10 ? [4, 3] : [3, 3];
        const cntBits = version <= 9 ? 10 : version <= 26 ? 12 : 14;
        const len = readBits(cntBits);
        let remain = len;
        while (remain > 0) {
          const n = remain >= 3 ? 3 : remain;
          const bits = n === 3 ? 10 : n === 2 ? 7 : 4;
          const v = readBits(bits);
          out += String(v).padStart(n, '0');
          remain -= n;
        }
        void groups;
      } else if (mode === 2) {                           // 영문·숫자
        const cntBits = version <= 9 ? 9 : version <= 26 ? 11 : 13;
        const len = readBits(cntBits);
        let remain = len;
        while (remain >= 2) { const v = readBits(11); out += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; remain -= 2; }
        if (remain === 1) out += ALNUM[readBits(6)];
      } else if (mode === 7) {                           // ECI — 표시만 건너뜀
        const first = readBits(8);
        if ((first & 0x80) === 0) { /* 1바이트 */ }
        else if ((first & 0xC0) === 0x80) readBits(8);
        else readBits(16);
      } else {
        break;                                           // 모르는 모드 — 폴백 유도
      }
    }
    return out;
  }

  function utf8Decode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i];
      if (b < 0x80) s += String.fromCharCode(b);
      else if (b >= 0xC0 && b < 0xE0 && i + 1 < bytes.length) {
        s += String.fromCharCode(((b & 0x1F) << 6) | (bytes[++i] & 0x3F));
      } else if (b >= 0xE0 && b < 0xF0 && i + 2 < bytes.length) {
        const c1 = bytes[++i], c2 = bytes[++i];
        s += String.fromCharCode(((b & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F));
      } else if (b >= 0xF0 && i + 3 < bytes.length) {
        const c1 = bytes[++i], c2 = bytes[++i], c3 = bytes[++i];
        const cp = ((b & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
        s += String.fromCodePoint(cp - 0x10000 > -1 ? cp : 0xFFFD);
      } else s += '\uFFFD';
    }
    return s;
  }

  /* ---------- 이미지 → 흑백 ---------- */
  function otsu(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i += 1) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t += 1) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  function binarize(gray, invert) {
    const thr = otsu(gray);
    const out = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i += 1) {
      const dark = gray[i] <= thr;
      out[i] = (invert ? !dark : dark) ? 1 : 0;
    }
    return out;
  }

  /* ---------- 파인더 패턴 찾기 ---------- */
  function finderCandidates(bin, w, h) {
    const cands = [];
    for (let y = 0; y < h; y += 1) {
      const runs = [];            // {len, color}
      let prev = bin[y * w];
      let len = 1;
      for (let x = 1; x <= w; x += 1) {
        const cur = x < w ? bin[y * w + x] : -1;
        if (cur === prev) len += 1;
        else {
          runs.push({ len, color: prev, end: x });
          prev = cur; len = 1;
        }
      }
      for (let i = 0; i + 5 <= runs.length; i += 1) {
        if (runs[i].color !== 1) continue;                 // 바깥 검정부터
        const r = runs.slice(i, i + 5);
        if (r[0].color !== 1 || r[1].color !== 0 || r[2].color !== 1 || r[3].color !== 0 || r[4].color !== 1) continue;
        const total = r.reduce((a, b) => a + b.len, 0);
        if (total < 7 || total > w / 3) continue;
        const unit = total / 7;
        const tol = unit * 0.62;
        if (Math.abs(r[0].len - unit) > tol || Math.abs(r[1].len - unit) > tol ||
            Math.abs(r[2].len - 3 * unit) > 3 * tol || Math.abs(r[3].len - unit) > tol ||
            Math.abs(r[4].len - unit) > tol) continue;
        const cx = r[2].end - r[2].len / 2;
        cands.push({ x: cx, y, unit });
      }
    }
    return cands;
  }

  function verticalCheck(bin, w, h, cx, cy, unit) {
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : bin[y * w + x]);
    const x = Math.round(cx);
    const y0 = Math.max(0, Math.round(cy - 3.5 * unit));
    const y1 = Math.min(h - 1, Math.round(cy + 3.5 * unit));
    if (y1 <= y0) return false;
    const runs = [];
    let prev = at(x, y0), len = 1;
    for (let y = y0 + 1; y <= y1; y += 1) {
      const c = at(x, y);
      if (c === prev) len += 1;
      else { runs.push({ len, color: prev }); prev = c; len = 1; }
    }
    runs.push({ len, color: prev });
    if (runs.length < 5) return false;
    /* 중심(검정)이 세 번째 검정 런에 오도록 5런 창을 고릅니다 */
    for (let i = 0; i + 5 <= runs.length; i += 1) {
      const s = runs.slice(i, i + 5);
      if (s[0].color !== 1 || s[2].color !== 1 || s[4].color !== 1) continue;
      if (s[1].color !== 0 || s[3].color !== 0) continue;
      const total = s.reduce((a, b) => a + b.len, 0);
      if (total < 7) continue;
      const u = total / 7;
      const tol = u * 0.75;
      if (Math.abs(s[0].len - u) < tol && Math.abs(s[1].len - u) < tol &&
          Math.abs(s[2].len - 3 * u) < 3 * tol && Math.abs(s[3].len - u) < tol &&
          Math.abs(s[4].len - u) < tol) return true;
    }
    return false;
  }

  function cluster(cands, w, h, bin) {
    const groups = [];
    cands.forEach((c) => {
      let hit = null;
      for (const g of groups) {
        if (Math.hypot(g.x - c.x, g.y - c.y) < Math.max(4, g.unit * 2.2)) { hit = g; break; }
      }
      if (hit) {
        hit.x = (hit.x * hit.n + c.x) / (hit.n + 1);
        hit.y = (hit.y * hit.n + c.y) / (hit.n + 1);
        hit.unit = (hit.unit * hit.n + c.unit) / (hit.n + 1);
        hit.n += 1;
      } else {
        groups.push({ x: c.x, y: c.y, unit: c.unit, n: 1 });
      }
    });
    return groups
      .filter((g) => g.n >= 2 && verticalCheck(bin, w, h, g.x, g.y, g.unit))
      .sort((a, b) => b.n - a.n);
  }

  function orderCorners(pts) {
    /* 가장 먼 두 점 = TR·BL, 남은 점 = TL */
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const d01 = d(pts[0], pts[1]), d02 = d(pts[0], pts[2]), d12 = d(pts[1], pts[2]);
    let tl, p, q;
    if (d01 >= d02 && d01 >= d12) { tl = pts[2]; p = pts[0]; q = pts[1]; }
    else if (d02 >= d01 && d02 >= d12) { tl = pts[1]; p = pts[0]; q = pts[2]; }
    else { tl = pts[0]; p = pts[1]; q = pts[2]; }
    const cross = (p.x - tl.x) * (q.y - tl.y) - (p.y - tl.y) * (q.x - tl.x);
    return cross > 0 ? { tl, tr: p, bl: q } : { tl, tr: q, bl: p };
  }

  function sampleGrid(bin, w, h, corners, dim) {
    const { tl, tr, bl } = corners;
    const span = dim - 7;
    const ex = { x: (tr.x - tl.x) / span, y: (tr.y - tl.y) / span };
    const ey = { x: (bl.x - tl.x) / span, y: (bl.y - tl.y) / span };
    const m = [];
    for (let row = 0; row < dim; row += 1) {
      const line = new Array(dim);
      for (let col = 0; col < dim; col += 1) {
        const px = tl.x + (col - 3) * ex.x + (row - 3) * ey.x;
        const py = tl.y + (col - 3) * ex.y + (row - 3) * ey.y;
        let dark = 0, seen = 0;
        for (let dy = -0.16; dy <= 0.161; dy += 0.16) {
          for (let dx = -0.16; dx <= 0.161; dx += 0.16) {
            const x = Math.round(px + dx * ex.x + dy * ey.x);
            const y = Math.round(py + dx * ex.y + dy * ey.y);
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            seen += 1;
            dark += bin[y * w + x];
          }
        }
        line[col] = seen && dark * 2 >= seen ? 1 : 0;
      }
      m.push(line);
    }
    return m;
  }

  function decodeModules(m) {
    const dim = m.length;
    if (dim < 21 || dim > 57 || (dim - 17) % 4 !== 0) return null;
    const version = (dim - 17) / 4;
    const fmt = readFormatBits(m);
    if (fmt === null) return null;
    const eccName = ECC_NAME[(fmt >> 3) & 3];
    const mask = fmt & 7;
    const raw = readCodewords(m, mask, version);
    const data = deinterleaveAndCorrect(raw, version, eccName);
    return parseStream(data, version);
  }

  function transpose(bin, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) out[x * h + y] = bin[y * w + x];
    return out;
  }

  function allCandidates(bin, w, h) {
    const rows = finderCandidates(bin, w, h);
    const tb = transpose(bin, w, h);
    const cols = finderCandidates(tb, h, w).map((c) => ({ x: c.y, y: c.x, unit: c.unit }));
    return rows.concat(cols);
  }

  /* 세 파인더의 기하 검증 — 직각이등변삼각형(다리 길이 같고 90°)이어야 합니다 */
  function geometryScore(c, unit) {
    const legA = Math.hypot(c.tr.x - c.tl.x, c.tr.y - c.tl.y);
    const legB = Math.hypot(c.bl.x - c.tl.x, c.bl.y - c.tl.y);
    if (legA < 10 || legB < 10) return 0;
    const ratio = Math.min(legA, legB) / Math.max(legA, legB);
    if (ratio < 0.72) return 0;
    const v1 = { x: (c.tr.x - c.tl.x) / legA, y: (c.tr.y - c.tl.y) / legA };
    const v2 = { x: (c.bl.x - c.tl.x) / legB, y: (c.bl.y - c.tl.y) / legB };
    const dot = Math.abs(v1.x * v2.x + v1.y * v2.y);
    if (dot > 0.42) return 0;                        // 약 65° 이하
    const span = (legA + legB) / 2 / unit;
    if (span < 12 || span > 60) return 0;
    return ratio * (1 - dot);
  }

  function tryDecode(bin, w, h) {
    const cands = allCandidates(bin, w, h);
    if (cands.length < 3) return null;
    const groups = cluster(cands, w, h, bin);
    if (groups.length < 3) return null;
    const top = groups.slice(0, Math.min(8, groups.length));
    const combos = [];
    for (let i = 0; i < top.length; i += 1) for (let j = i + 1; j < top.length; j += 1) for (let k = j + 1; k < top.length; k += 1) {
      const c = orderCorners([top[i], top[j], top[k]]);
      const unit = (top[i].unit + top[j].unit + top[k].unit) / 3;
      const score = geometryScore(c, unit);
      if (!score) continue;
      combos.push({ c, unit, score });
    }
    combos.sort((a, b) => b.score - a.score);
    for (const combo of combos.slice(0, 6)) {
      const { c, unit } = combo;
      const legA = Math.hypot(c.tr.x - c.tl.x, c.tr.y - c.tl.y);
      const legB = Math.hypot(c.bl.x - c.tl.x, c.bl.y - c.tl.y);
      const span = (legA + legB) / 2 / unit;
      const base = Math.round(span) + 7;
      const dims = [];
      for (const cand of [base, base - 4, base + 4, base - 2, base + 2, base - 6, base + 6]) {
        const d = Math.round((cand - 17) / 4) * 4 + 17;
        if (d >= 21 && d <= 57 && dims.indexOf(d) < 0) dims.push(d);
      }
      for (const dim of dims) {
        try {
          const m = sampleGrid(bin, w, h, c, dim);
          const text = decodeModules(m);
          if (text) return text;
        } catch (e) { /* 다음 후보 */ }
      }
    }
    return null;
  }

  function decodeGray(w, h, gray) {
    if (!w || !h || !gray || gray.length < w * h) return null;
    const attempts = [false, true];
    for (const inv of attempts) {
      const bin = binarize(gray, inv);
      const text = tryDecode(bin, w, h);
      if (text) return text;
    }
    return null;
  }

  function decodeImageData(img) {
    if (!img || !img.data) return null;
    const w = img.width, h = img.height;
    const gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      gray[i] = (img.data[p] * 77 + img.data[p + 1] * 150 + img.data[p + 2] * 29) >> 8;
    }
    return decodeGray(w, h, gray);
  }

  function decodeCanvas(canvas) {
    if (!canvas) return null;
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const { width, height } = canvas;
      if (!width || !height) return null;
      return decodeImageData(ctx.getImageData(0, 0, width, height));
    } catch (e) { return null; }
  }

  root.BojangQRScan = {
    decodeImageData, decodeGray, decodeCanvas,
    available: () => true,
    /* 테스트·검증용 내부 노출 (문서화된 공개 API 아님) */
    _internal: { rsDecode, sampleGrid, decodeModules, binarize, finderCandidates, cluster, orderCorners,
                 readFormatBits, readCodewords, deinterleaveAndCorrect, parseStream, functionMap }
  };
})(typeof window !== 'undefined' ? window : globalThis);
