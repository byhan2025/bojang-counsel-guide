/* 보장분석 라이프 리포트 v5.7 — QR 코드 생성기 (외부 라이브러리·네트워크 0)
   명함의 카카오톡 상담 링크 · 전화번호(tel:)를 PDF에 스캔 가능한 QR로 인쇄합니다.
   · 바이트 모드(UTF-8) · 오류정정 M · 버전 1~10 자동 선택 · 마스크 8종 자동 평가
   · 반환값: { size, modules[y][x] (1=검정), version, mask, text }
   · 그리기 도우미: svg(text, {px, quiet}) — HTML, matrix(text) — PDF/Canvas */
(function (root) {
  'use strict';

  /* 오류정정 M — 버전별 [블록당 EC 코드워드, [[블록 수, 데이터 코드워드], ...]] */
  const EC_M = {
    1: [10, [[1, 16]]],
    2: [16, [[1, 28]]],
    3: [26, [[1, 44]]],
    4: [18, [[2, 32]]],
    5: [24, [[2, 43]]],
    6: [16, [[4, 27]]],
    7: [18, [[4, 31]]],
    8: [22, [[2, 38], [2, 39]]],
    9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]]
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };
  const MAX_VERSION = 10;

  /* ---------- UTF-8 바이트 ---------- */
  function utf8(str) {
    const s = String(str == null ? '' : str);
    const out = [];
    for (let i = 0; i < s.length; i += 1) {
      let c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        const c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          c = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          i += 1;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return out;
  }

  /* ---------- GF(256) · Reed-Solomon ---------- */
  const EXP = new Array(512);
  const LOG = new Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
  })();
  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function rsGen(deg) {
    let poly = [1];
    for (let i = 0; i < deg; i += 1) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGen(ecLen);
    const out = new Array(ecLen).fill(0);
    for (let i = 0; i < data.length; i += 1) {
      const factor = data[i] ^ out[0];
      out.shift();
      out.push(0);
      if (factor) {
        for (let j = 0; j < ecLen; j += 1) out[j] ^= gfMul(gen[j + 1], factor);
      }
    }
    return out;
  }

  /* ---------- 비트 버퍼 ---------- */
  function BitBuf() { this.bits = []; }
  BitBuf.prototype.put = function (val, len) {
    for (let i = len - 1; i >= 0; i -= 1) this.bits.push((val >>> i) & 1);
  };
  BitBuf.prototype.len = function () { return this.bits.length; };
  BitBuf.prototype.bytes = function () {
    const out = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j += 1) b = (b << 1) | (this.bits[i + j] || 0);
      out.push(b);
    }
    return out;
  };

  function capacityBits(version) {
    const spec = EC_M[version];
    return spec[1].reduce((a, g) => a + g[0] * g[1], 0) * 8;
  }

  function fitVersion(byteLen) {
    for (let v = 1; v <= MAX_VERSION; v += 1) {
      const countBits = v < 10 ? 8 : 16;
      const need = 4 + countBits + byteLen * 8;
      if (need <= capacityBits(v)) return v;
    }
    return null;
  }

  /* ---------- 매트릭스 ---------- */
  function blank(size) {
    const m = [];
    for (let y = 0; y < size; y += 1) m.push(new Array(size).fill(null));
    return m;
  }

  function bch15(data) {
    let d = data << 10;
    for (let i = 4; i >= 0; i -= 1) {
      if (d & (1 << (i + 10))) d ^= 0x537 << i;
    }
    return ((data << 10) | (d & 0x3FF)) ^ 0x5412;
  }
  function bch18(version) {
    let d = version << 12;
    for (let i = 5; i >= 0; i -= 1) {
      if (d & (1 << (i + 12))) d ^= 0x1F25 << i;
    }
    return (version << 12) | (d & 0xFFF);
  }

  function finder(m, x, y) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || Y >= m.length || X >= m.length) continue;
        const edge = (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) || (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        m[Y][X] = edge || core ? 1 : 0;
      }
    }
  }

  function align(m, cx, cy) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const edge = Math.max(Math.abs(dx), Math.abs(dy));
        m[cy + dy][cx + dx] = edge === 2 || edge === 0 ? 1 : 0;
      }
    }
  }

  const MASKS = [
    (y, x) => (y + x) % 2 === 0,
    (y) => y % 2 === 0,
    (y, x) => x % 3 === 0,
    (y, x) => (y + x) % 3 === 0,
    (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
    (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
    (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0
  ];

  function penalty(m) {
    const n = m.length;
    let score = 0;
    /* 규칙 1 — 같은 색 5개 이상 연속 */
    for (let y = 0; y < n; y += 1) {
      let run = 1;
      for (let x = 1; x < n; x += 1) {
        if (m[y][x] === m[y][x - 1]) run += 1;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let x = 0; x < n; x += 1) {
      let run = 1;
      for (let y = 1; y < n; y += 1) {
        if (m[y][x] === m[y - 1][x]) run += 1;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    /* 규칙 2 — 2×2 같은 색 블록 */
    for (let y = 0; y < n - 1; y += 1) {
      for (let x = 0; x < n - 1; x += 1) {
        const v = m[y][x];
        if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
      }
    }
    /* 규칙 3 — 1:1:3:1:1 유사 패턴 */
    const pat = [1, 0, 1, 1, 1, 0, 1];
    const scan = (get) => {
      for (let i = 0; i + 6 < n; i += 1) {
        let hit = true;
        for (let k = 0; k < 7; k += 1) if (get(i + k) !== pat[k]) { hit = false; break; }
        if (!hit) continue;
        const before = i >= 4 ? [0, 0, 0, 0].every((_, k) => get(i - 4 + k) === 0) : false;
        const after = i + 10 < n ? [0, 0, 0, 0].every((_, k) => get(i + 7 + k) === 0) : false;
        if (before || after) score += 40;
      }
    };
    for (let y = 0; y < n; y += 1) scan((i) => m[y][i]);
    for (let x = 0; x < n; x += 1) scan((i) => m[i][x]);
    /* 규칙 4 — 검정 비율 편차 */
    let dark = 0;
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (m[y][x]) dark += 1;
    const pct = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function build(text) {
    const bytes = utf8(text);
    const version = fitVersion(bytes.length);
    if (!version) return null;
    const size = 17 + version * 4;
    const spec = EC_M[version];

    /* 1) 데이터 코드워드 */
    const bb = new BitBuf();
    bb.put(4, 4);                                   /* 바이트 모드 */
    bb.put(bytes.length, version < 10 ? 8 : 16);    /* 문자 수 */
    bytes.forEach((b) => bb.put(b, 8));
    const cap = capacityBits(version);
    if (bb.len() > cap) return null;
    const term = Math.min(4, cap - bb.len());
    bb.put(0, term);
    while (bb.len() % 8 !== 0) bb.bits.push(0);
    const data = bb.bytes();
    const totalData = cap / 8;
    let pad = 0;
    while (data.length < totalData) { data.push(pad % 2 === 0 ? 0xEC : 0x11); pad += 1; }

    /* 2) 블록 분할 · RS */
    const blocks = [];
    let off = 0;
    spec[1].forEach(([count, len]) => {
      for (let i = 0; i < count; i += 1) {
        const chunk = data.slice(off, off + len);
        off += len;
        blocks.push({ data: chunk, ec: rsEncode(chunk, spec[0]) });
      }
    });

    /* 3) 인터리브 */
    const maxData = Math.max.apply(null, blocks.map((b) => b.data.length));
    const words = [];
    for (let i = 0; i < maxData; i += 1) {
      blocks.forEach((b) => { if (i < b.data.length) words.push(b.data[i]); });
    }
    for (let i = 0; i < spec[0]; i += 1) {
      blocks.forEach((b) => words.push(b.ec[i]));
    }

    /* 4) 기능 패턴 */
    const base = blank(size);
    finder(base, 0, 0);
    finder(base, size - 7, 0);
    finder(base, 0, size - 7);
    for (let i = 8; i < size - 8; i += 1) {
      if (base[6][i] == null) base[6][i] = i % 2 === 0 ? 1 : 0;
      if (base[i][6] == null) base[i][6] = i % 2 === 0 ? 1 : 0;
    }
    const ap = ALIGN[version];
    ap.forEach((cy) => {
      ap.forEach((cx) => {
        const nearFinder = (cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) || (cx <= 8 && cy >= size - 9);
        if (!nearFinder) align(base, cx, cy);
      });
    });
    base[size - 8][8] = 1;                                     /* 다크 모듈 */
    /* 포맷 정보 자리 예약 */
    for (let i = 0; i <= 8; i += 1) {
      if (base[8][i] == null) base[8][i] = 0;
      if (base[i][8] == null) base[i][8] = 0;
    }
    for (let i = 0; i < 8; i += 1) {
      if (base[8][size - 1 - i] == null) base[8][size - 1 - i] = 0;
      if (base[size - 1 - i][8] == null) base[size - 1 - i][8] = 0;
    }
    /* 버전 정보(v7+) */
    if (version >= 7) {
      const vbits = bch18(version);
      for (let i = 0; i < 18; i += 1) {
        const bit = (vbits >> i) & 1;
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        base[b][a] = bit;
        base[a][b] = bit;
      }
    }

    /* 5) 데이터 배치 */
    const cells = [];
    let bitIdx = 0;
    const bits = [];
    words.forEach((w) => { for (let i = 7; i >= 0; i -= 1) bits.push((w >> i) & 1); });
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert += 1) {
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          if (base[y][x] !== null) continue;
          base[y][x] = bits[bitIdx] == null ? 0 : bits[bitIdx];
          cells.push([y, x]);
          bitIdx += 1;
        }
      }
    }

    /* 6) 마스크 평가 → 최적 선택 */
    let best = null;
    for (let mk = 0; mk < 8; mk += 1) {
      const m = base.map((row) => row.slice());
      cells.forEach(([y, x]) => { if (MASKS[mk](y, x)) m[y][x] ^= 1; });
      const fmt = bch15(mk);                                   /* EC M = 00 + 마스크 */
      const putBit = (v, y, x) => { m[y][x] = v; };
      /* 포맷 정보 1벌 — 좌상단 파인더 둘레 (열 8 세로 / 행 8 가로) */
      for (let i = 0; i <= 5; i += 1) putBit((fmt >> i) & 1, i, 8);
      putBit((fmt >> 6) & 1, 7, 8);
      putBit((fmt >> 7) & 1, 8, 8);
      putBit((fmt >> 8) & 1, 8, 7);
      for (let i = 9; i <= 14; i += 1) putBit((fmt >> i) & 1, 8, 14 - i);
      /* 포맷 정보 2벌 — 우상단·좌하단 */
      for (let i = 0; i <= 7; i += 1) putBit((fmt >> i) & 1, 8, size - 1 - i);
      for (let i = 8; i <= 14; i += 1) putBit((fmt >> i) & 1, size - 15 + i, 8);
      m[size - 8][8] = 1;
      const p = penalty(m);
      if (!best || p < best.penalty) best = { penalty: p, matrix: m, mask: mk };
    }
    return { size, modules: best.matrix, version, mask: best.mask, text: String(text) };
  }

  /* ---------- 그리기 ---------- */
  function matrix(text) {
    try { return build(text); } catch (e) { return null; }
  }

  function svg(text, o) {
    o = o || {};
    const q = matrix(text);
    if (!q) return '';
    const quiet = o.quiet == null ? 4 : o.quiet;
    const px = o.px || 6;
    const dim = (q.size + quiet * 2) * px;
    let rects = '';
    for (let y = 0; y < q.size; y += 1) {
      for (let x = 0; x < q.size; x += 1) {
        if (!q.modules[y][x]) continue;
        rects += `<rect x="${(x + quiet) * px}" y="${(y + quiet) * px}" width="${px}" height="${px}"/>`;
      }
    }
    return `<svg class="qr-svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" role="img" aria-label="QR 코드 — ${String(text).replace(/[<>&"]/g, '')}" fill="#0a2540"><rect width="100%" height="100%" fill="#fff"/><g shape-rendering="crispEdges">${rects}</g></svg>`;
  }

  /* PDF(Canvas)용 — quiet zone 포함해 size(pt) 정사각형 안에 그립니다 */
  function draw(sheet, x, y, size, text, o) {
    o = o || {};
    const q = matrix(text);
    if (!q) return false;
    const quiet = o.quiet == null ? 2 : o.quiet;
    const unit = size / (q.size + quiet * 2);
    sheet.rect(x, y, size, size, { fill: o.bg || '#ffffff', r: o.r || 2, stroke: o.stroke || null });
    const fill = o.fill || '#0a2540';
    for (let ry = 0; ry < q.size; ry += 1) {
      let runStart = -1;
      for (let rx = 0; rx <= q.size; rx += 1) {
        const on = rx < q.size && q.modules[ry][rx] === 1;
        if (on && runStart < 0) runStart = rx;
        if (!on && runStart >= 0) {
          sheet.rect(x + (runStart + quiet) * unit, y + (ry + quiet) * unit,
            (rx - runStart) * unit, unit, { fill });
          runStart = -1;
        }
      }
    }
    return true;
  }

  root.BojangQR = { matrix, svg, draw, utf8, MAX_VERSION, EC_M, fitVersion };
})(typeof window !== 'undefined' ? window : globalThis);
