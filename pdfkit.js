/* 보장분석 상담 가이드 — PDF 엔진 (v3)
   브라우저 Canvas에 A4(595×842pt) 레이아웃을 시스템 한글 폰트로 직접 그린 뒤,
   각 페이지를 JPEG로 만들어 순수 JS로 PDF 바이너리를 조립합니다.
   · 외부 라이브러리 0개 → 단일 HTML·PWA·오프라인에서 100% 동작
   · 한글은 브라우저가 그리므로 폰트 임베딩 없이도 깨지지 않습니다 */
(function (root) {
  'use strict';

  const W = 595.28, H = 841.89;          // A4 pt
  const DENS = 2.0833;                    // 150dpi
  const PXW = Math.round(W * DENS);       // 1240
  const PXH = Math.round(H * DENS);       // 1754
  const FONT = '"Apple SD Gothic Neo","Pretendard","Noto Sans KR","Noto Sans CJK KR","Malgun Gothic","Segoe UI",sans-serif';

  /* v5.0 「보험에 반하다」 — 크림·로즈 아이보리 바탕, 로즈 코랄 포인트, 깊은 와인 텍스트 */
  const C = {
    navy: '#3A2628', navy2: '#4A2E30', blue: '#C85A60', blue2: '#D96B70', sky: '#FDF0F0', sky2: '#FDF9F8',
    ink: '#231F20', ink2: '#4C3B3C', muted: '#8B7A7B', line: '#EED9D8', line2: '#F6EAE9',
    red: '#B3261E', redSoft: '#FDECEA', mint: '#0E9C86', mintSoft: '#E6F6F2',
    orange: '#C07A2C', orangeSoft: '#FDF2E3', gray: '#9B9091', graySoft: '#F4EBEB',
    gold: '#B8912F', white: '#FFFFFF', rose: '#D96B70', roseDeep: '#C85A60', wine: '#3A2628', blush: '#FDF0F0', cream: '#FDF9F8'
  };

  const TONE = {
    enough: { fg: '#0E7C69', bg: '#E6F6F2', label: '충분', solid: C.mint },
    check: { fg: '#B0690F', bg: '#FDF2E3', label: '점검', solid: C.orange },
    short: { fg: '#B3261E', bg: '#FDECEA', label: '부족', solid: '#E05B52' },
    none: { fg: '#5B6B7E', bg: '#EFF2F6', label: '없음', solid: C.gray },
    ok: { fg: '#0E7C69', bg: '#E6F6F2', label: '적정', solid: C.mint },
    need: { fg: '#B0690F', bg: '#FDF2E3', label: '보강 필요', solid: C.orange },
    gap: { fg: '#B3261E', bg: '#FDECEA', label: '공백 위험', solid: C.red },
    info: { fg: '#A8494F', bg: '#FDF0F0', label: '안내', solid: C.blue },
    warn: { fg: '#B0690F', bg: '#FDF2E3', label: '주의', solid: C.orange },
    danger: { fg: '#B3261E', bg: '#FDECEA', label: '위험', solid: C.red }
  };

  const won = (n) => Number(n || 0).toLocaleString('ko-KR');

  /* =========================================================
     Sheet — 한 페이지를 그리는 캔버스 래퍼
     ========================================================= */
  class Sheet {
    constructor() {
      const cv = document.createElement('canvas');
      cv.width = PXW; cv.height = PXH;
      const ctx = cv.getContext('2d', { alpha: false });
      ctx.setTransform(DENS, 0, 0, DENS, 0, 0);
      ctx.textBaseline = 'top';
      this.cv = cv; this.ctx = ctx;
      this.W = W; this.H = H;
      this.ML = 40; this.MR = 40; this.MT = 34; this.MB = 40;
      this.CW = W - this.ML - this.MR;
      this.limit = H - this.MB;
      this.overflow = 0;
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.fillRect(0, 0, W, H);
    }

    /* ---------- 기본 ---------- */
    font(size, weight) {
      this.ctx.font = `${weight || 400} ${size}px ${FONT}`;
      return this.ctx;
    }
    measure(str, size, weight) {
      this.font(size, weight);
      return this.ctx.measureText(String(str)).width;
    }
    guard(y) { if (y > this.limit + 0.5) this.overflow = Math.max(this.overflow, y); return y; }

    rect(x, y, w, h, o) {
      const c = this.ctx; o = o || {};
      this.maxY = Math.max(this.maxY || 0, y + h);
      c.save();
      if (o.r) { this.rrect(x, y, w, h, o.r); } else { c.beginPath(); c.rect(x, y, w, h); }
      if (o.fill) { c.fillStyle = o.fill; c.fill(); }
      if (o.stroke) { c.strokeStyle = o.stroke; c.lineWidth = o.lw || 1; c.stroke(); }
      c.restore();
      return y + h;
    }
    rrect(x, y, w, h, r) {
      const c = this.ctx, rr = Math.min(r, w / 2, h / 2);
      c.beginPath();
      c.moveTo(x + rr, y);
      c.arcTo(x + w, y, x + w, y + h, rr);
      c.arcTo(x + w, y + h, x, y + h, rr);
      c.arcTo(x, y + h, x, y, rr);
      c.arcTo(x, y, x + w, y, rr);
      c.closePath();
    }
    line(x1, y1, x2, y2, o) {
      const c = this.ctx; o = o || {};
      c.save();
      c.strokeStyle = o.color || C.line; c.lineWidth = o.w || 1;
      if (o.dash) c.setLineDash(o.dash);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.restore();
    }

    /* ---------- 텍스트 ---------- */
    text(str, x, y, o) {
      o = o || {};
      this.maxY = Math.max(this.maxY || 0, y + (o.size || 9) * 1.15);
      const c = this.font(o.size || 9, o.weight);
      c.fillStyle = o.color || C.ink;
      c.textAlign = o.align || 'left';
      c.fillText(String(str), x, y);
      c.textAlign = 'left';
      return y + (o.size || 9) * (o.lh || 1.3);
    }
    wrap(str, maxW, size, weight) {
      const c = this.font(size, weight);
      const out = [];
      String(str == null ? '' : str).split('\n').forEach((para) => {
        if (!para.trim()) { out.push(''); return; }
        let cur = '';
        para.split(/\s+/).forEach((word) => {
          const cand = cur ? cur + ' ' + word : word;
          if (c.measureText(cand).width <= maxW) { cur = cand; return; }
          if (cur) { out.push(cur); cur = ''; }
          if (c.measureText(word).width <= maxW) { cur = word; return; }
          let chunk = '';
          for (const ch of word) {
            if (c.measureText(chunk + ch).width > maxW && chunk) { out.push(chunk); chunk = ch; }
            else chunk += ch;
          }
          cur = chunk;
        });
        out.push(cur);
      });
      return out;
    }
    height(str, maxW, size, lh) {
      return this.wrap(str, maxW, size).length * size * (lh || 1.45);
    }
    para(str, x, y, maxW, o) {
      o = o || {};
      const size = o.size || 8.6, lh = o.lh || 1.45;
      const lines = this.wrap(str, maxW, size, o.weight);
      const c = this.font(size, o.weight);
      c.fillStyle = o.color || C.ink2;
      c.textAlign = o.align || 'left';
      const ax = o.align === 'center' ? x + maxW / 2 : o.align === 'right' ? x + maxW : x;
      lines.forEach((ln, i) => c.fillText(ln, ax, y + i * size * lh));
      c.textAlign = 'left';
      this.guard(y + lines.length * size * lh);
      return y + lines.length * size * lh + (o.after || 0);
    }

    /* ---------- 공용 조각 ---------- */
    badge(x, y, text, tone, o) {
      o = o || {};
      const t = TONE[tone] || TONE.info;
      const size = o.size || 6.6;
      const padX = o.padX || 5;
      const w = this.measure(text, size, 700) + padX * 2;
      const h = o.h || 12;
      this.rect(x, y, w, h, { fill: o.solid ? t.solid : t.bg, r: h / 2 });
      this.text(text, x + padX, y + (h - size * 1.18) / 2, { size, weight: 700, color: o.solid ? '#fff' : t.fg });
      return w;
    }
    pill(x, y, text, o) {
      o = o || {};
      const size = o.size || 6.8;
      const w = this.measure(text, size, 600) + 12;
      const h = o.h || 14;
      this.rect(x, y, w, h, { fill: o.fill || C.sky, r: h / 2, stroke: o.stroke || null });
      this.text(text, x + 6, y + (h - size * 1.2) / 2, { size, weight: 600, color: o.color || C.navy2 });
      return w;
    }
    chipRow(items, x, y, maxW, o) {
      o = o || {};
      let cx = x, cy = y;
      items.forEach((it) => {
        const size = o.size || 6.8;
        const w = this.measure(it, size, 600) + 14;
        if (cx + w > x + maxW) { cx = x; cy += (o.h || 15) + 4; }
        this.rect(cx, cy, w, o.h || 15, { fill: o.fill || C.sky2, r: 7.5, stroke: C.line });
        this.text(it, cx + 7, cy + ((o.h || 15) - size * 1.2) / 2, { size, weight: 600, color: o.color || C.ink2 });
        cx += w + 5;
      });
      return cy + (o.h || 15);
    }
    sectionHead(x, y, w, num, title, desc) {
      const c = this.ctx;
      c.fillStyle = C.blue; c.fillRect(x, y + 2, 3.4, 15);
      let tx = x + 10;
      if (num) {
        this.rect(tx, y, 15, 15, { fill: C.navy, r: 3 });
        this.text(num, tx + 7.5, y + 3, { size: 7.4, weight: 800, color: '#fff', align: 'center' });
        tx += 20;
      }
      this.text(title, tx, y + 1, { size: 11.4, weight: 800, color: C.navy });
      if (desc) this.text(desc, x + w, y + 4, { size: 7, weight: 500, color: C.muted, align: 'right' });
      return y + 26;
    }
    card(x, y, w, h, o) {
      o = o || {};
      this.rect(x, y, w, h, { fill: o.fill || '#FFFFFF', r: o.r || 6, stroke: o.stroke || C.line, lw: o.lw || 0.8 });
      return y;
    }

    /* ---------- 페이지 머리·꼬리 ---------- */
    brandMark(x, y, size, o) {
      o = o || {};
      const c = this.ctx;
      const sc = (size || 10) / 100;
      c.save();
      c.translate(x, y);
      c.scale(sc, sc);
      c.strokeStyle = o.color || C.rose;
      c.lineWidth = (o.lw || 1) / sc;
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(60, 36);
      c.bezierCurveTo(60, 26, 68, 18, 79, 18);
      c.bezierCurveTo(90, 18, 98, 27, 98, 39);
      c.bezierCurveTo(98, 56, 79, 69, 60, 81);
      c.bezierCurveTo(41, 69, 22, 56, 22, 39);
      c.bezierCurveTo(22, 27, 31, 18, 42, 18);
      c.bezierCurveTo(53, 18, 60, 26, 60, 36);
      c.stroke();
      c.globalAlpha = o.ribbon === false ? 0 : 0.65;
      c.beginPath();
      c.moveTo(18, 78);
      c.bezierCurveTo(38, 90, 70, 90, 88, 76);
      c.bezierCurveTo(94, 71, 100, 69, 106, 69);
      c.stroke();
      c.restore();
      return x + size * 1.2;
    }
    /* 표지용 워드마크: 하트 + 보험에(먹색) 반하다(로즈) + 선택 슬로건 */
    brandWordmark(x, y, o) {
      o = o || {};
      const size = o.size || 20;
      const mx = this.brandMark(x, y - size * 0.12, size * 1.15, { lw: 1.05, color: o.markColor || C.rose });
      const tx = mx + 6;
      this.text('보험에 ', tx, y, { size, weight: 800, color: o.ink || C.ink });
      const w1 = this.measure('보험에 ', size, 800);
      this.text('반하다', tx + w1, y, { size, weight: 800, color: o.accent || C.rose });
      if (o.slogan) this.text(o.slogan, tx, y + size * 1.35, { size: Math.max(5.4, size * 0.32), weight: 500, color: C.ink2 });
      return y + size * (o.slogan ? 1.75 : 1.2);
    }
    header(o) {
      const y = this.MT;
      this.brandMark(this.ML, y - 2.5, 11, { lw: 0.95 });
      this.text(o.kicker || 'LIFE REPORT', this.ML + 14, y, { size: 8, weight: 800, color: C.navy });
      if (o.no) {
        const label = o.total ? `${o.no} / ${o.total}` : String(o.no);
        this.text(label, this.W - this.MR, y - 0.5, { size: 8, weight: 700, color: C.blue, align: 'right' });
      }
      this.line(this.ML, y + 14, this.W - this.MR, y + 14, { color: C.line });
      this.line(this.ML, y + 14, this.ML + 46, y + 14, { color: C.blue, w: 2 });
      return y + 22;
    }
    footer(o) {
      o = o || {};
      this.contentBottom = this.maxY || 0;
      const y = this.H - 26;
      this.line(this.ML, y, this.W - this.MR, y, { color: C.line });
      this.text(o.left || '상담 보조용 자료 · 실제 지급 여부와 금액은 가입 상품의 약관·증권이 기준입니다', this.ML, y + 5, { size: 6.2, weight: 500, color: C.muted });
      this.text(o.right || '보험에 반하다', this.W - this.MR, y + 5, { size: 6.2, weight: 700, color: C.blue, align: 'right' });
    }
    memoBand(labels, maxH) {
      const top = (this.contentBottom || 0) + 16;
      const bottom = this.H - 36;
      let avail = bottom - top;
      if (maxH && maxH !== Infinity) avail = Math.min(avail, maxH);
      if (avail < 70) return top;
      const rows = labels && labels.length ? labels : ['고객이 한 말', '내가 약속한 것', '다음 할 일'];
      const h = avail;
      this.rect(this.ML, top, this.CW, h, { fill: '#FBFCFE', r: 5, stroke: '#E3EAF4' });
      this.text('MEMO', this.ML + 10, top + 8, { size: 6, weight: 800, color: '#9AAABD' });
      this.text('상담 메모', this.ML + 36, top + 8, { size: 6.2, weight: 700, color: '#8B9CB0' });
      const groupH = (h - 26) / rows.length;
      rows.forEach((r, i) => {
        const gy = top + 24 + i * groupH;
        this.text(r, this.ML + 10, gy, { size: 6, weight: 700, color: '#B0BFD0' });
        const lx = this.ML + 10 + Math.max(66, this.measure(r, 6, 700) + 8);
        for (let ly = gy + 11; ly < gy + groupH - 2; ly += 17) {
          this.line(lx, ly, this.ML + this.CW - 10, ly, { color: '#E9EFF7', dash: [1.5, 2.5] });
        }
        if (i) this.line(this.ML + 10, gy - 5, this.ML + this.CW - 10, gy - 5, { color: '#EEF3FA' });
      });
      return top + h;
    }
    pageTitle(kicker, title, sub, y) {
      y = y == null ? 66 : y;
      this.text(kicker, this.ML, y, { size: 7, weight: 800, color: C.blue });
      this.text(title, this.ML, y + 11, { size: 19, weight: 800, color: C.navy });
      if (sub) this.para(sub, this.ML, y + 36, this.CW, { size: 8.4, color: C.ink2, lh: 1.4 });
      return y + (sub ? 36 + this.height(sub, this.CW, 8.4, 1.4) + 8 : 36);
    }

    /* ---------- 차트 ---------- */
    donut(cx, cy, r, segs, o) {
      o = o || {};
      const c = this.ctx;
      const total = segs.reduce((a, s) => a + s.value, 0) || 1;
      let start = -Math.PI / 2;
      c.save();
      segs.forEach((s) => {
        if (s.value <= 0) return;
        const ang = (s.value / total) * Math.PI * 2;
        c.beginPath();
        c.moveTo(cx, cy);
        c.arc(cx, cy, r, start, start + ang);
        c.closePath();
        c.fillStyle = s.color;
        c.fill();
        start += ang;
      });
      const inner = o.inner || r * 0.62;
      c.beginPath(); c.arc(cx, cy, inner, 0, Math.PI * 2); c.fillStyle = o.innerFill || '#fff'; c.fill();
      if (o.centerValue != null) {
        this.text(String(o.centerValue), cx, cy - (o.centerSize || 17) * 0.62, { size: o.centerSize || 17, weight: 800, color: o.centerColor || C.navy, align: 'center' });
        if (o.centerLabel) this.text(o.centerLabel, cx, cy + (o.centerSize || 17) * 0.5, { size: 6.4, weight: 600, color: C.muted, align: 'center' });
      }
      c.restore();
    }
    ring(cx, cy, r, pct, o) {
      o = o || {};
      const c = this.ctx;
      c.save();
      c.lineWidth = o.w || 8;
      c.strokeStyle = o.track || C.line2;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = o.color || C.mint;
      c.lineCap = 'round';
      c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, pct)); c.stroke();
      c.restore();
    }
    radar(cx, cy, r, axes, o) {
      o = o || {};
      const c = this.ctx, n = axes.length;
      const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const pt = (i, k) => [cx + Math.cos(ang(i)) * r * k, cy + Math.sin(ang(i)) * r * k];
      c.save();
      [0.25, 0.5, 0.75, 1].forEach((k) => {
        c.beginPath();
        axes.forEach((_, i) => { const p = pt(i, k); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
        c.closePath(); c.strokeStyle = k === 1 ? '#CFDBEA' : C.line2; c.lineWidth = 0.8; c.stroke();
      });
      axes.forEach((_, i) => {
        const p = pt(i, 1);
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(p[0], p[1]); c.strokeStyle = C.line2; c.lineWidth = 0.7; c.stroke();
      });
      c.beginPath();
      axes.forEach((a, i) => { const p = pt(i, Math.max(0.03, Math.min(1, a.value))); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
      c.closePath();
      c.fillStyle = o.fill || 'rgba(200,90,96,0.16)'; c.fill();
      c.strokeStyle = o.color || C.blue; c.lineWidth = 1.6; c.stroke();
      axes.forEach((a, i) => {
        const p = pt(i, Math.max(0.03, Math.min(1, a.value)));
        c.beginPath(); c.arc(p[0], p[1], 2.2, 0, Math.PI * 2); c.fillStyle = o.color || C.blue; c.fill();
        const lp = pt(i, 1.16);
        const anchor = lp[0] < cx - 3 ? 'right' : lp[0] > cx + 3 ? 'left' : 'center';
        this.text(a.label, lp[0], lp[1] - 5.4, { size: o.labelSize || 6.4, weight: 700, color: C.ink2, align: anchor });
        if (o.showValue) this.text(`${Math.round(a.value * 100)}%`, lp[0], lp[1] + 1.6, { size: 6, weight: 600, color: C.muted, align: anchor });
      });
      c.restore();
      return cy + r * 1.16;
    }
    bars(x, y, w, rows, o) {
      o = o || {};
      const rowH = o.rowH || 16, labelW = o.labelW || 62, valW = o.valW || 52;
      let cy = y;
      rows.forEach((r) => {
        this.text(r.label, x, cy + 3, { size: o.size || 7, weight: 600, color: C.ink });
        const bx = x + labelW, bw = w - labelW - valW;
        this.rect(bx, cy + 4, bw, 6, { fill: o.track || C.line2, r: 3 });
        const pct = Math.max(0.015, Math.min(1, r.value));
        this.rect(bx, cy + 4, bw * pct, 6, { fill: r.color || C.blue, r: 3 });
        if (r.ref != null) {
          const rx = bx + bw * Math.min(1, r.ref);
          this.line(rx, cy + 1.5, rx, cy + 12.5, { color: o.refColor || C.navy, w: 1, dash: [2, 2] });
        }
        this.text(r.text || '', x + w, cy + 3, { size: o.size || 7, weight: 700, color: r.textColor || C.navy, align: 'right' });
        cy += rowH;
      });
      return cy;
    }
    stacked(x, y, w, h, segs, o) {
      o = o || {};
      const total = segs.reduce((a, s) => a + s.value, 0) || 1;
      let cx = x;
      this.ctx.save();
      segs.forEach((s, i) => {
        const sw = (s.value / total) * w;
        this.ctx.fillStyle = s.color;
        const r = o.r || 0;
        if (r) { this.ctx.beginPath(); this.ctx.rect(cx, y, sw + 0.3, h); this.ctx.fill(); }
        else { this.ctx.fillRect(cx, y, sw + 0.3, h); }
        if (o.showLabel && sw > 26) {
          const dark = i >= (o.lightFrom || 99);
          this.text(`${Math.round((s.value / total) * 100)}%`, cx + sw / 2, y + (h - 7.4) / 2, { size: 6.4, weight: 700, color: dark ? C.navy : '#fff', align: 'center' });
        }
        cx += sw;
      });
      this.ctx.restore();
      return y + h;
    }
    gauge(x, y, w, pct, o) {
      o = o || {};
      const h = o.h || 7;
      this.rect(x, y, w, h, { fill: o.track || C.line2, r: h / 2 });
      this.rect(x, y, Math.max(3, w * Math.min(1, pct)), h, { fill: o.color || C.blue, r: h / 2 });
      return y + h;
    }
    table(x, y, w, cols, rows, o) {
      o = o || {};
      const size = o.size || 6.9;
      const padX = o.padX || 5;
      const widths = o.widths || cols.map(() => w / cols.length);
      const headH = o.headH || 17;
      const rowH = o.rowH || 15;
      // 헤더
      this.rect(x, y, w, headH, { fill: o.headFill || C.navy, r: 0 });
      let cx = x;
      cols.forEach((c, i) => {
        this.text(c, cx + padX, y + (headH - size * 1.2) / 2, { size, weight: 700, color: '#fff', align: i === 0 ? 'left' : (o.align ? o.align[i] : 'center') });
        if (o.colors && o.colors[i]) { /* 헤더 글자색 */ }
        cx += widths[i];
      });
      let cy = y + headH;
      rows.forEach((row, ri) => {
        const rh = o.rowHeight ? o.rowHeight(row) : rowH;
        if (o.zebra !== false) this.rect(x, cy, w, rh, { fill: ri % 2 ? (o.zebraFill || C.sky2) : '#fff' });
        else this.rect(x, cy, w, rh, { fill: '#fff' });
        this.line(x, cy + rh, x + w, cy + rh, { color: C.line2 });
        let rx = x;
        row.forEach((cell, ci) => {
          const cw = widths[ci];
          const cellObj = (cell && typeof cell === 'object') ? cell : { text: cell };
          const align = cellObj.align || (o.align ? o.align[ci] : (ci === 0 ? 'left' : 'center'));
          if (cellObj.badge) {
            const bw = this.measure(cellObj.text, size, 700) + 9;
            const bxx = align === 'left' ? rx + padX : rx + (cw - bw) / 2;
            this.badge(bxx, cy + (rh - 11) / 2, cellObj.text, cellObj.badge, { size: 6, h: 11, padX: 4.5 });
          } else if (cellObj.fill) {
            this.rect(rx, cy, cw, rh, { fill: cellObj.fill });
            this.text(cellObj.text, align === 'left' ? rx + padX : rx + cw / 2, cy + (rh - size * 1.2) / 2, { size, weight: cellObj.weight || 600, color: cellObj.color || C.ink, align });
          } else {
            const lines = cellObj.text != null && String(cellObj.text).length > 0 ? this.wrap(cellObj.text, cw - padX * 2 - 2, size, cellObj.weight) : [''];
            lines.slice(0, Math.floor((rh - 3) / (size * 1.3))).forEach((ln, li) => {
              this.text(ln, align === 'left' ? rx + padX : rx + cw / 2, cy + 3 + li * size * 1.3, { size, weight: cellObj.weight || 500, color: cellObj.color || C.ink, align });
            });
          }
          rx += cw;
        });
        cy += rh;
      });
      this.guard(cy);
      return cy;
    }
    bullets(x, y, w, items, o) {
      o = o || {};
      const size = o.size || 8;
      const gap = o.gap || 3.5;
      let cy = y;
      items.forEach((it) => {
        const isObj = it && typeof it === 'object';
        const text = isObj ? it.text : it;
        const dotColor = isObj && it.tone ? (TONE[it.tone] || TONE.info).solid : (o.dot || C.blue);
        const lines = this.wrap(text, w - 10, size, o.weight);
        if (o.box) {
          const bh = lines.length * size * 1.42 + 6;
          this.rect(x, cy - 2, w, bh, { fill: o.boxFill || C.sky2, r: 3 });
        }
        this.ctx.save();
        this.ctx.fillStyle = dotColor;
        this.ctx.beginPath(); this.ctx.arc(x + 3, cy + size * 0.62, isObj && it.square ? 1.7 : 1.6, 0, Math.PI * 2); this.ctx.fill();
        this.ctx.restore();
        let ty = cy;
        lines.forEach((ln, i) => {
          this.text(ln, x + 10, ty, { size, weight: o.weight || 500, color: o.color || C.ink2 });
          ty += size * 1.42;
        });
        cy = ty + gap;
      });
      this.guard(cy);
      return cy;
    }
    checks(x, y, w, items, o) {
      o = o || {};
      const size = o.size || 7.6, rowH = o.rowH || 14.5;
      let cy = y;
      items.forEach((it) => {
        const r = 3.1;
        this.rect(x, cy + 2.2, r * 2, r * 2, { fill: '#fff', stroke: C.blue, r: 1.2, lw: 0.9 });
        this.line(x + r * 0.55, cy + 2.2 + r, x + r * 0.95, cy + 2.2 + r * 1.55, { color: C.blue, w: 0.9 });
        this.line(x + r * 0.95, cy + 2.2 + r * 1.55, x + r * 1.5, cy + 2.2 + r * 0.55, { color: C.blue, w: 0.9 });
        this.text(it, x + 13, cy, { size, weight: 500, color: C.ink2 });
        cy += rowH;
      });
      return cy;
    }
    /* 스크립트 박스: 실제 상담 대사. 높이 자동 계산 */
    script(x, y, w, o) {
      o = o || {};
      const size = o.size || 8.6, lh = 1.52, padX = 10, padY = 8;
      const quoteW = w - padX * 2 - (o.tagW || 0);
      const lines = this.wrap(o.text, quoteW, size);
      const h = padY * 2 + (o.title ? 13 : 0) + lines.length * size * lh + (o.note ? this.height(o.note, quoteW, 6.8, 1.4) + 5 : 0);
      this.rect(x, y, w, h, { fill: o.fill || '#F7FAFE', r: 5, stroke: o.stroke || C.line });
      this.rect(x, y, 2.6, h, { fill: o.accent || C.blue, r: 1.3 });
      let cy = y + padY;
      if (o.title) {
        this.text(o.title, x + padX, cy, { size: 6.6, weight: 800, color: o.accent || C.blue });
        cy += 13;
      }
      const c = this.font(size, o.weight || 500);
      c.fillStyle = o.color || C.ink;
      lines.forEach((ln) => { c.fillText(ln, x + padX, cy); cy += size * lh; });
      if (o.note) {
        cy += 2;
        this.para(o.note, x + padX, cy, quoteW, { size: 6.8, color: C.muted, lh: 1.4 });
      }
      this.guard(y + h);
      return y + h;
    }
    kv(x, y, w, rows, o) {
      o = o || {};
      const rowH = o.rowH || 15;
      let cy = y;
      rows.forEach((r) => {
        this.text(r[0], x, cy + 2, { size: o.size || 7.2, weight: 500, color: C.muted });
        this.text(r[1], x + w, cy + 2, { size: o.size || 7.2, weight: 700, color: r[2] || C.navy, align: 'right' });
        cy += rowH;
        this.line(x, cy - 4, x + w, cy - 4, { color: C.line2 });
      });
      return cy;
    }
    iconCircle(cx, cy, r, o) {
      o = o || {};
      this.ctx.save();
      this.ctx.beginPath(); this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
      this.ctx.fillStyle = o.fill || C.sky; this.ctx.fill();
      this.ctx.restore();
      if (o.num) this.text(String(o.num), cx, cy - (o.size || 9) * 0.6, { size: o.size || 9, weight: 800, color: o.color || C.blue, align: 'center' });
    }
    photoBand(y, h, o) {
      o = o || {};
      const c = this.ctx;
      c.save();
      c.beginPath(); c.rect(0, y, W, h); c.clip();
      const g = c.createLinearGradient(0, y, W, y + h);
      g.addColorStop(0, o.from || '#FDF3F2'); g.addColorStop(0.55, o.mid || '#FFFBFA'); g.addColorStop(1, o.to || '#F7E6E5');
      c.fillStyle = g; c.fillRect(0, y, W, h);
      // 장식 도형
      c.globalAlpha = 0.5;
      c.fillStyle = '#F3D7D5';
      c.beginPath(); c.moveTo(W * 0.62, y); c.lineTo(W, y); c.lineTo(W, y + h); c.lineTo(W * 0.78, y + h); c.closePath(); c.fill();
      c.globalAlpha = 0.3; c.fillStyle = '#EBC4C1';
      c.beginPath(); c.moveTo(W * 0.74, y); c.lineTo(W * 0.9, y); c.lineTo(W * 0.72, y + h); c.lineTo(W * 0.6, y + h); c.closePath(); c.fill();
      c.globalAlpha = 1;
      // 미니 차트 모티프
      const bx = W * 0.66, by = y + h * 0.52, bw = W * 0.24, bh = h * 0.3;
      c.fillStyle = 'rgba(255,255,255,0.72)';
      c.fillRect(bx, by, bw, bh);
      const vals = [0.42, 0.66, 0.52, 0.78, 0.6];
      vals.forEach((v, i) => {
        c.fillStyle = i === 3 ? '#C85A60' : '#E3A9A6';
        c.fillRect(bx + 8 + i * (bw - 16) / 5, by + bh - 6 - (bh - 14) * v, (bw - 16) / 5 - 4, (bh - 14) * v);
      });
      c.restore();
      return y + h;
    }
  }

  /* =========================================================
     PDF 조립 (JPEG 페이지 → PDF 1.4)
     ========================================================= */
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function assemble(pages, meta) {
    meta = meta || {};
    const enc = new TextEncoder();
    const chunks = [];
    let len = 0;
    const offsets = {};
    const push = (u8) => { chunks.push(u8); len += u8.length; };
    const put = (s) => push(enc.encode(s));

    const n = pages.length;
    const pageObj = (i) => 4 + i * 3;
    const total = 3 + n * 3;

    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const obj = (num, dict, stream) => {
      offsets[num] = len;
      put(`${num} 0 obj\n${dict}\n`);
      if (stream) {
        put('stream\n');
        push(stream);
        put('\nendstream\n');
      }
      put('endobj\n');
    };

    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const kids = [];
    for (let i = 0; i < n; i++) kids.push(`${pageObj(i)} 0 R`);
    obj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`);
    const title = (meta.title || '보장분석 리포트').replace(/[()\\]/g, ' ');
    obj(3, `<< /Title (${title.replace(/[^\x20-\x7E]/g, '')}) /Producer (Bojang Guide v3) /Creator (Bojang Guide) >>`);

    pages.forEach((pg, i) => {
      const pn = pageObj(i);
      const cn = pn + 1, imn = pn + 2;
      obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /XObject << /Im0 ${imn} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${cn} 0 R >>`);
      const content = `q ${W.toFixed(2)} 0 0 ${H.toFixed(2)} 0 0 cm /Im0 Do Q`;
      obj(cn, `<< /Length ${enc.encode(content).length} >>`, enc.encode(content));
      const bytes = pg.bytes;
      offsets[imn] = len;
      put(`${imn} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      put('\nendstream\nendobj\n');
    });

    const xrefOff = len;
    put(`xref\n0 ${total + 1}\n`);
    put('0000000000 65535 f \n');
    for (let i = 1; i <= total; i++) {
      const off = offsets[i] || 0;
      put(String(off).padStart(10, '0') + ' 00000 n \n');
    }
    put(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`);

    const all = new Uint8Array(len);
    let p = 0;
    chunks.forEach((c) => { all.set(c, p); p += c.length; });
    return new Blob([all], { type: 'application/pdf' });
  }

  /* =========================================================
     페이지 렌더러
     ========================================================= */
  async function renderPages(drawers, opts) {
    opts = opts || {};
    const quality = opts.quality || 0.9;
    const sheet = new Sheet();
    const pages = [];
    for (let i = 0; i < drawers.length; i++) {
      const s = new Sheet();
      s.overflow = 0;
      try { drawers[i](s, i); } catch (e) { console.error('page ' + (i + 1) + ' draw error', e); throw e; }
      if (opts.collect) opts.collect.push({ page: i + 1, contentBottom: Math.round(s.contentBottom || 0), limit: Math.round(s.limit) });
      if (opts.memo !== false && s.contentBottom && s.contentBottom < s.H - 130) {
        try { s.memoBand(opts.memoLabels, opts.memoMax); } catch (e) { console.warn('memo', e); }
      }
      if (s.overflow) {
        const msg = `[PDF] 레이아웃 넘침 page ${i + 1} (y=${s.overflow.toFixed(1)} > ${s.limit})`;
        console.warn(msg);
        (opts.overflow || []).push({ page: i + 1, y: s.overflow });
      }
      const url = s.cv.toDataURL('image/jpeg', quality);
      const b64 = url.slice(url.indexOf(',') + 1);
      pages.push({ bytes: b64ToBytes(b64), w: PXW, h: PXH });
      s.cv.width = 1; s.cv.height = 1; // 메모리 해제
      if (opts.onProgress) opts.onProgress(i + 1, drawers.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    return assemble(pages, opts.meta);
  }

  /* 파일 저장·공유 */
  function fileName(kind, name, dateLabel) {
    const d = (dateLabel || '').replace(/[^\d]/g, '').slice(0, 8) || (() => {
      const t = new Date();
      return `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
    })();
    const who = (name || '고객').replace(/[\\/:*?"<>|\s]/g, '');
    const label = kind === 'summary' ? '보장분석_1장요약' : kind === 'detail' ? '보장분석_10장상세' : '상담플랜_30장가이드';
    return `${who}_${label}_${d}.pdf`;
  }

  async function saveBlob(blob, filename, o) {
    o = o || {};
    const nav = navigator;
    // 1) 모바일 공유 시트 (아이폰: 파일 앱 저장 / 문자·카톡 전송)
    try {
      if (nav.canShare && o.share !== false) {
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: o.title || filename, text: o.text || '' });
          return 'share';
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
      /* 공유 실패 → 다운로드로 폴백 */
    }
    // 2) PC 저장 위치 선택 (지원 브라우저)
    try {
      if (window.showSaveFilePicker && o.picker && !/Mobi|Android|iPhone|iPad/i.test(nav.userAgent)) {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
        });
        const w = await handle.createWritable();
        await w.write(blob); await w.close();
        return 'saved';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
    }
    // 3) 일반 다운로드 (PC 바탕화면/다운로드 폴더, 모바일 파일 앱)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
    return 'download';
  }

  root.PDFKit = { Sheet, renderPages, saveBlob, fileName, C, TONE, W, H, PXW, PXH, FONT, won };
})(typeof window !== 'undefined' ? window : globalThis);
