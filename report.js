/* 보장분석 상담 가이드 — 3종 리포트 레이아웃 (v3)
   1장 요약 · 10장 상세 · 30장 설계사 플랜북.
   모두 PDFKit.Sheet 프리미티브로 그려 캔버스 → PDF로 저장됩니다. */
(function (root) {
  'use strict';

  const BK = root.BojangModel, K = root.PDFKit;
  const won = K.won;
  const C = K.C;

  const TONE_COLOR = { ok: C.mint, need: C.orange, gap: C.red, warn: C.orange, danger: C.red, info: C.blue, enough: C.mint, check: C.orange, short: '#E05B52', none: C.gray };
  const LEVEL_LABEL = { enough: '충분', check: '점검', short: '부족', none: '없음' };
  /* 리포트 표에서 쓰는 5종 짧은 이름 (칸 넘잘 방지) */
  const TREAT_SHORT = { surgery: '암수술', drug: '항암약물', radio: '항암방사선', icu: '중환자실', extra: '비급여' };

  const statById = (id) => STATS.find((s) => s.id === id);

  /* v4.2: 세부 항목을 위치가 아니라 키로 찾습니다 (수술 6축·간병 6칸으로 늘어남) */
  const PK = (row, key) => (row && row.r.parts.find((p) => p.key === key)) || { val: 0, rec: 0, fill: 0, subs: [], pct: 0, option: null };
  const subHave = (p) => (p.subs || []).filter((s) => s.val > 0).length;

  /* 1장 요약·표처럼 좁은 칸에 들어가는 짧은 현재 보장 문장 (v4.2) */
  const REC_SCOPE = { brain: '뇌혈관질환 I60~I69', heart: '허혈성심장 I20~I25' };
  const BASIS_SHORT = { time: '시간 기준', money: '금액 기준', unknown: '기준 미확인' };
  function shortSummary(row) {
    const k = row.item.key;
    if (k === 'cancer') {
      return `일반암 ${won(PK(row, 'general').val)} · 치료비 ${subHave(PK(row, 'treatment'))}/5`;
    }
    if (k === 'brain' || k === 'heart') {
      const dxp = PK(row, 'dx');
      const core = dxp.dx && dxp.dx.core;
      const sc = core && core.val > 0 ? `${BK.dxShort(core.label)} ${won(core.val)}` : (dxp.dx && dxp.dx.gapWarn ? '범위 공백' : '미보유');
      return `${sc} · 치료비 ${subHave(PK(row, 'treat'))}/3`;
    }
    if (k === 'surgery') {
      const dz = ['disease', 'disease15', 'diseaseNdae', 'diseaseNonPay'].filter((x) => PK(row, x).val > 0).length;
      const ij = ['injury', 'injury15'].filter((x) => PK(row, x).val > 0).length;
      return `질병 ${dz}/4 · 상해 ${ij}/2`;
    }
    const daily = PK(row, 'daily').val, nd = PK(row, 'nDaily').val;
    const basis = (PK(row, 'basis').option || {}).label || '';
    return `일반 ${won(daily)} · 요양 ${nd ? won(nd) : '없음'} · ${basis}`;
  }

  /* =========================================================
     공용 블록
     ========================================================= */
  function clientBar(s, m, y) {
    const cells = [
      ['고객명', m.client.name],
      ['생년월일', m.client.birth ? `${m.client.birth} (보험나이 ${m.client.insuranceAge}세)` : `연령대 ${m.state.age}대`],
      ['상담일', m.dateLabel || '-'],
      ['담당자', m.client.consultant]
    ];
    const w = s.CW, cw = w / 4;
    s.rect(s.ML, y, w, 34, { fill: C.sky2, r: 5, stroke: C.line });
    cells.forEach((c, i) => {
      const x = s.ML + i * cw;
      if (i) s.line(x, y + 7, x, y + 27, { color: C.line });
      s.text(c[0], x + 10, y + 6, { size: 5.9, weight: 600, color: C.muted });
      s.text(c[1], x + 10, y + 16, { size: 7.6, weight: 700, color: C.navy });
    });
    return y + 34;
  }

  function gradeHero(s, m, y, h) {
    const w = s.CW;
    s.rect(s.ML, y, w, h, { fill: '#3A2628', r: 7 });
    // 왼쪽 등급
    s.text('종합 보장등급', s.ML + 16, y + 13, { size: 6.4, weight: 700, color: '#E7CDC9' });
    s.text(m.letter, s.ML + 16, y + 22, { size: 34, weight: 800, color: '#FFFFFF' });
    s.text(`${m.score}점 / 100`, s.ML + 16, y + h - 22, { size: 7.4, weight: 600, color: '#F0DEDB' });
    s.text(m.grade.label, s.ML + 16, y + h - 12, { size: 6.6, weight: 700, color: '#8FF0DC' });

    // 가운데 레이더
    const cx = s.ML + 168, cy = y + h / 2 + 2;
    const axes = m.rows.map((r) => ({ label: '', value: r.r.fill }));
    s.radar(cx, cy, 34, axes, { color: '#8FF0DC', fill: 'rgba(143,240,220,0.18)', labelSize: 0, showValue: false });

    // 오른쪽 도넛
    const dn = m.counts;
    const dcx = s.ML + 306, dcy = y + h / 2;
    const segs = [
      { value: dn.enough, color: '#12A594' },
      { value: dn.check, color: '#E8952E' },
      { value: dn.short, color: '#E05B52' },
      { value: dn.none, color: '#94A6BA' }
    ];
    s.donut(dcx, dcy, 30, segs, { inner: 19, innerFill: '#3A2628', centerValue: dn.total, centerLabel: '항목', centerSize: 14, centerColor: '#fff' });
    const legend = [['충분', C.mint, dn.enough], ['점검', C.orange, dn.check], ['부족', '#E05B52', dn.short], ['없음', '#94A6BA', dn.none]];
    legend.forEach((l, i) => {
      const ly = y + h / 2 - 22 + i * 12;
      s.rect(dcx + 36, ly + 1, 5, 5, { fill: l[1], r: 2.5 });
      s.text(`${l[0]} ${l[2]}`, dcx + 45, ly - 0.5, { size: 6.2, weight: 600, color: '#F2E4E2' });
    });

    // 우측 끝 보완 우선
    const fx = s.W - s.MR - 92;
    s.text('먼저 채울 곳', fx, y + 13, { size: 6.2, weight: 700, color: '#E7CDC9' });
    if (m.first) {
      s.text(`${m.first.item.rank}순위 ${m.first.item.name}`, fx, y + 24, { size: 11, weight: 800, color: '#FFD47A' });
      s.text(`${m.first.pct}% · ${m.first.label}`, fx, y + 40, { size: 6.8, weight: 600, color: '#fff' });
      if (m.first.gaps.length) s.text(`부족 ${won(m.first.gaps[0].need)}만원`, fx, y + 50, { size: 6.8, weight: 700, color: '#FFB4AC' });
    } else {
      s.text('구조 유지', fx, y + 24, { size: 11, weight: 800, color: '#8FF0DC' });
      s.text('금액·갱신 점검', fx, y + 40, { size: 6.8, weight: 600, color: '#fff' });
    }
    return y + h;
  }

  function priorityTable(s, m, y, o) {
    o = o || {};
    const w = s.CW;
    const rowH = o.rowH || 26;
    const headH = 16;
    const rankW = 86, curW = 148, gauW = 96, verdictW = 56;
    s.rect(s.ML, y, w, headH, { fill: C.navy });
    const heads = [
      ['우선순위', s.ML + 7, 'left'],
      ['현재 보장', s.ML + rankW + 6, 'left'],
      ['충족도', s.ML + rankW + curW + 4, 'left'],
      ['판정', s.ML + rankW + curW + gauW + verdictW / 2, 'center'],
      ['부족분', s.ML + w - 7, 'right']
    ];
    heads.forEach((h) => s.text(h[0], h[1], y + 5, { size: 6.2, weight: 700, color: '#fff', align: h[2] }));
    let cy = y + headH;
    m.rows.forEach((row, i) => {
      s.rect(s.ML, cy, w, rowH, { fill: i % 2 ? C.sky2 : '#fff' });
      s.line(s.ML, cy + rowH, s.ML + w, cy + rowH, { color: C.line2 });
      // 순위
      s.iconCircle(s.ML + 13, cy + rowH / 2, 7.2, { fill: C.navy, num: row.item.rank, size: 6.8, color: '#fff' });
      s.text(row.item.name, s.ML + 24, cy + rowH / 2 - 4, { size: 8.4, weight: 800, color: C.navy });
      // 현재
      s.text(shortSummary(row), s.ML + rankW + 6, cy + rowH / 2 - 3.6, { size: 6.4, weight: 500, color: C.ink2 });
      // 충족도
      const bx = s.ML + rankW + curW + 2, bw = 66;
      s.gauge(bx, cy + rowH / 2 - 3, bw, row.pct / 100, { color: TONE_COLOR[row.level], h: 5 });
      s.text(`${row.pct}%`, bx + bw + 4, cy + rowH / 2 - 3.6, { size: 6.2, weight: 700, color: C.ink });
      // 판정
      const badgeW = s.measure(row.label, 6.2, 700) + 9;
      s.badge(s.ML + rankW + curW + gauW + verdictW / 2 - badgeW / 2, cy + (rowH - 11) / 2, row.label, row.level, { size: 6.2, h: 11, padX: 4.5 });
      // 부족분
      const gapText = row.gaps.length ? `${won(row.gaps.reduce((a, g) => a + g.need, 0))}만원` : (row.level === 'ok' ? '—' : '범위 점검');
      s.text(gapText, s.ML + w - 7, cy + rowH / 2 - 3.6, { size: 6.6, weight: 700, color: row.gaps.length ? C.red : C.muted, align: 'right' });
      cy += rowH;
    });
    s.rect(s.ML, y, w, cy - y, { stroke: C.line, r: 0 });
    return cy;
  }

  function roadmapCards(s, m, y, h) {
    const w = s.CW, gap = 8, cw = (w - gap * 2) / 3;
    m.steps.forEach((st, i) => {
      const x = s.ML + i * (cw + gap);
      s.rect(x, y, cw, h, { fill: i === 0 ? '#FDF5F4' : i === 1 ? '#FDF7EC' : '#F1FAF7', r: 6, stroke: C.line });
      s.rect(x, y, cw, 3.2, { fill: [C.blue, C.orange, C.mint][i], r: 1.6 });
      s.text(`STEP ${i + 1}`, x + 10, y + 10, { size: 6, weight: 800, color: [C.blue, C.orange, C.mint][i] });
      s.text(st.title.replace(/^[^ ]+ — /, ''), x + 10, y + 19, { size: 9.4, weight: 800, color: C.navy });
      s.para(st.body, x + 10, y + 34, cw - 20, { size: 6.9, color: C.ink2, lh: 1.45 });
    });
    return y + h;
  }

  function statTiles(s, x, y, w, items, o) {
    o = o || {};
    const cols = o.cols || 3, gap = 6;
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = o.h || 44;
    let cy = y;
    items.forEach((it, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const bx = x + c * (cw + gap), by = cy + r * (ch + gap);
      s.rect(bx, by, cw, ch, { fill: o.fill || '#fff', r: 5, stroke: C.line });
      s.text(it.label, bx + 8, by + 7, { size: 6, weight: 600, color: C.muted });
      s.text(it.value, bx + 8, by + 16, { size: it.size || 14, weight: 800, color: it.color || C.navy });
      if (it.sub) s.text(it.sub, bx + 8, by + ch - 12, { size: 5.8, weight: 500, color: C.muted });
    });
    return cy + Math.ceil(items.length / cols) * (ch + gap) - gap;
  }

  function noteStrip(s, y, text, o) {
    o = o || {};
    const w = s.CW;
    const h = s.height(text, w - 24, o.size || 7, 1.45) + 14;
    s.rect(s.ML, y, w, h, { fill: o.fill || '#FDF7F6', r: 4, stroke: o.stroke || '#F3DCDB' });
    s.rect(s.ML, y, 2.4, h, { fill: o.accent || C.blue, r: 1.2 });
    s.para(text, s.ML + 12, y + 7, w - 24, { size: o.size || 7, color: o.color || C.ink2, lh: 1.45 });
    return y + h;
  }

  function todoStrip(s, y, text) {
    return noteStrip(s, y, text, { fill: '#EEF7F4', stroke: '#D5ECE5', accent: C.mint, size: 7.2, color: '#215A4E' });
  }

  function statCard(s, x, y, w, h, st, o) {
    o = o || {};
    s.rect(x, y, w, h, { fill: '#fff', r: 6, stroke: C.line });
    s.text(st.title, x + 10, y + 8, { size: 7.4, weight: 800, color: C.navy });
    s.text(st.headlineValue, x + w - 10, y + 6, { size: 12, weight: 800, color: C.blue, align: 'right' });
    s.text(st.headline, x + 10, y + 19, { size: 5.9, weight: 500, color: C.muted });
    let cy = y + 30;
    if (st.stacked) {
      const total = st.stacked.reduce((a, b) => a + b.value, 0);
      const tones = ['#3A2628', '#1B4A78', '#2F6FA3', '#4E90C0', '#8FBADA', '#C9DDEC'];
      s.stacked(x + 10, cy, w - 20, 10, st.stacked.map((sg, i) => ({ value: sg.value, color: tones[i] })), { showLabel: true, lightFrom: 4 });
      cy += 14;
      st.stacked.forEach((sg, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        s.rect(x + 10 + col * ((w - 20) / 3), cy + row * 9, 4, 4, { fill: tones[i], r: 2 });
        s.text(`${sg.label} ${sg.value}%`, x + 16 + col * ((w - 20) / 3), cy + row * 9 - 1.5, { size: 5.4, weight: 500, color: C.ink2 });
      });
      cy += 20;
    } else {
      const max = st.max || Math.max.apply(null, st.rows.map((r) => r.value));
      st.rows.forEach((r) => {
        s.text(r.label, x + 10, cy, { size: 5.9, weight: 500, color: C.ink2 });
        s.text(r.unit === '명' ? won(r.value) : r.value + '%', x + w - 10, cy, { size: 6, weight: 700, color: C.navy, align: 'right' });
        const bx = x + 10, bw = w - 20, valW = 34;
        s.rect(bx, cy + 7.6, bw - valW, 4.4, { fill: C.line2, r: 2.2 });
        s.rect(bx, cy + 7.6, (bw - valW) * Math.min(1, r.value / max), 4.4, { fill: C.blue, r: 2.2 });
        cy += 16;
      });
      cy += 2;
    }
    if (st.notes) {
      st.notes.forEach((n) => { s.text(`· ${n}`, x + 10, cy - 2, { size: 5.6, weight: 500, color: C.ink2 }); cy += 8; });
    }
    s.text(`출처: ${st.source}`, x + 10, y + h - 11, { size: 5, weight: 500, color: C.muted });
    return y + h;
  }

  function donutWithLegend(s, x, y, w, h, segs, center, o) {
    o = o || {};
    const cx = x + 46, cy = y + h / 2;
    s.donut(cx, cy, Math.min(36, h / 2 - 6), segs.map((sg) => ({ value: sg.value, color: sg.color })), {
      inner: Math.min(24, h / 2 - 16), centerValue: center.value, centerLabel: center.label, centerSize: 15
    });
    let ly = cy - segs.length * 6.6;
    segs.forEach((sg) => {
      s.rect(x + 92, ly + 1, 6, 6, { fill: sg.color, r: 3 });
      s.text(sg.label, x + 103, ly - 0.6, { size: 6.6, weight: 600, color: C.ink2 });
      s.text(String(sg.value), x + w - 8, ly - 0.6, { size: 6.8, weight: 800, color: C.navy, align: 'right' });
      ly += 13.2;
    });
    return y + h;
  }

  function concentric(s, cx, cy, tiers, o) {
    o = o || {};
    tiers.forEach((t, i) => {
      s.ctx.save();
      s.ctx.beginPath(); s.ctx.arc(cx, cy, t.r, 0, Math.PI * 2);
      s.ctx.fillStyle = t.fill; s.ctx.fill();
      s.ctx.strokeStyle = '#fff'; s.ctx.lineWidth = 1.4; s.ctx.stroke();
      s.ctx.restore();
      s.text(t.pct, cx, cy - t.r + t.r * 0.22, { size: t.pctSize || 10, weight: 800, color: t.color || '#fff', align: 'center' });
      s.text(t.label, cx, cy - t.r + t.r * 0.22 + (t.pctSize || 10) + 1, { size: 5.8, weight: 700, color: t.color || '#fff', align: 'center' });
    });
    return cy;
  }

  function codeTable(s, x, y, w, rows, o) {
    o = o || {};
    const rowH = 15;
    s.rect(x, y, w, 15, { fill: o.headFill || C.navy });
    s.text(o.head || '구분', x + 7, y + 5, { size: 6, weight: 700, color: '#fff' });
    s.text('질병코드', x + w * 0.34, y + 5, { size: 6, weight: 700, color: '#fff' });
    s.text('의미', x + w * 0.62, y + 5, { size: 6, weight: 700, color: '#fff' });
    let cy = y + 15;
    rows.forEach((r, i) => {
      s.rect(x, cy, w, rowH, { fill: i % 2 ? C.sky2 : '#fff' });
      s.text(r.label, x + 7, cy + 3.6, { size: 6.3, weight: 700, color: C.navy });
      s.text(r.code, x + w * 0.34, cy + 3.6, { size: 6.1, weight: 600, color: C.blue });
      s.text(r.note, x + w * 0.62, cy + 3.6, { size: 5.8, weight: 500, color: C.ink2 });
      s.line(x, cy + rowH, x + w, cy + rowH, { color: C.line2 });
      cy += rowH;
    });
    s.rect(x, y, w, cy - y, { stroke: C.line });
    return cy;
  }

  function contractTable(s, m, y, o) {
    o = o || {};
    const w = s.CW;
    const rows = m.contracts.length ? m.contracts : [];
    const headH = 16, rowH = 22;
    s.rect(s.ML, y, w, headH, { fill: C.navy });
    const cols = [['보험사 · 상품명', 0.46, 'left'], ['월 보험료', 0.16, 'right'], ['납입', 0.15, 'center'], ['만기 · 구조', 0.23, 'center']];
    let cx = s.ML;
    cols.forEach((c) => {
      const cw = w * c[1];
      const tx = c[2] === 'left' ? cx + 7 : c[2] === 'right' ? cx + cw - 7 : cx + cw / 2;
      s.text(c[0], tx, y + 5, { size: 6.2, weight: 700, color: '#fff', align: c[2] });
      cx += cw;
    });
    let cy = y + headH;
    if (!rows.length) {
      s.rect(s.ML, cy, w, 26, { fill: C.sky2 });
      s.text('입력된 계약이 없습니다 — 앱에서 계약을 추가하면 이 표가 채워집니다.', s.ML + 10, cy + 9, { size: 6.4, weight: 500, color: C.muted });
      cy += 26;
    }
    rows.slice(0, o.max || 8).forEach((c, i) => {
      s.rect(s.ML, cy, w, rowH, { fill: i % 2 ? C.sky2 : '#fff' });
      s.text(c.insurer || '—', s.ML + 7, cy + 3.5, { size: 6.4, weight: 700, color: C.navy });
      s.text(c.product || '—', s.ML + 7, cy + 12, { size: 5.8, weight: 500, color: C.ink2 });
      s.text(`${won(c.premium)}만원`, s.ML + w * 0.62 - 7, cy + 7, { size: 6.4, weight: 700, color: C.navy, align: 'right' });
      const paid = (c.pay || '납입중') === '납입완료';
      s.text(paid ? '납입완료' : '납입중', s.ML + w * 0.62 + (w * 0.15) / 2, cy + 7, { size: 5.9, weight: 700, color: paid ? C.muted : C.mint, align: 'center' });
      s.text(`${c.maturity && c.maturity !== '미입력' ? c.maturity : '만기 미입력'} · ${c.renew ? '갱신형' : '비갱신'}`, s.ML + w * 0.77 + (w * 0.23) / 2, cy + 7, { size: 5.8, weight: 600, color: c.renew ? C.orange : C.mint, align: 'center' });
      s.line(s.ML, cy + rowH, s.ML + w, cy + rowH, { color: C.line2 });
      cy += rowH;
    });
    if (rows.length) {
      const cs = m.contractStats || BK.contractStats(m.contracts);
      s.rect(s.ML, cy, w, 16, { fill: '#F0F6FD' });
      s.text(`합계 ${cs.count}건 · 납입중 ${cs.activeCount}건 / 납입완료 ${cs.paidUpCount}건`, s.ML + 7, cy + 4, { size: 6.2, weight: 700, color: C.navy });
      s.text(`${won(cs.total)}만원`, s.ML + w * 0.62 - 7, cy + 4, { size: 6.6, weight: 800, color: C.navy, align: 'right' });
      s.text(`${cs.shortMaturityCount ? `만기 80·90세 ${cs.shortMaturityCount}건` : '만기 점검'}`, s.ML + w * 0.77 + (w * 0.23) / 2, cy + 4, { size: 5.8, weight: 600, color: cs.shortMaturityCount ? C.orange : C.muted, align: 'center' });
      cy += 16;
    }
    s.rect(s.ML, y, w, cy - y, { stroke: C.line });
    return cy;
  }

  /* =========================================================
     ① 고객용 1장 요약
     ========================================================= */
  function summaryPage(m) {
    return function (s) {
      s.header({ kicker: 'LIFE REPORT', no: '1', total: '1' });
      s.brandWordmark(s.ML, 58, { size: 8.2 });
      s.text('COVERAGE SUMMARY', s.ML, 73, { size: 6.6, weight: 800, color: C.blue });
      s.text('보장분석 요약 리포트', s.ML, 82, { size: 20, weight: 800, color: C.navy });
      s.text(`${m.client.name}님의 보장을 한 장으로 정리했습니다`, s.ML, 106, { size: 8, weight: 500, color: C.ink2 });
      s.rect(s.W - s.MR - 96, 79, 96, 30, { fill: C.sky, r: 4 });
      s.text('보완 우선', s.W - s.MR - 88, 85, { size: 5.8, weight: 700, color: C.blue });
      s.text(m.first ? `${m.first.item.rank}순위 ${m.first.item.name}` : '구조 유지', s.W - s.MR - 88, 94, { size: 10, weight: 800, color: C.navy });

      let y = clientBar(s, m, 120);
      y = gradeHero(s, m, y + 8, 88);
      y = s.sectionHead(s.ML, y + 14, s.CW, null, '5대 우선순위 진단', '현재 보장 → 권장 기준');
      y = priorityTable(s, m, y + 2);
      y = s.sectionHead(s.ML, y + 12, s.CW, null, '핵심 보장 요약', '가장 먼저 확인할 다섯 줄');

      // 5줄 요약표
      const rows = m.rows.map((r) => {
        const p = PK(r, r.item.parts[0].key);
        const dxCore = p.type === 'dxset' && p.dx ? p.dx.core : null;
        const cur = p.type === 'amount' ? `${won(p.val)}만원`
          : p.type === 'dxset' ? (dxCore ? `${won(dxCore.val)}만원` : '—')
            : (p.option ? p.option.label : '—');
        const tgt = p.type === 'amount' ? `권장 ${won(p.rec)}만원`
          : p.type === 'dxset' ? `권장 ${won(p.rec)}만원`
            : (p.type === 'scale' ? (REC_SCOPE[r.item.key] || (p.option ? p.option.label : '—')) : (p.part && p.part.options ? (p.part.options[p.part.options.length - 1].label) : '—'));
        return [`${r.item.rank}. ${r.item.name}`, { text: cur, weight: 600 }, { text: tgt, color: C.muted }, { text: r.label, badge: r.level, align: 'center' }, { text: r.gaps.length ? `+${won(r.gaps.reduce((a, g) => a + g.need, 0))}만원` : '—', color: r.gaps.length ? C.red : C.muted, weight: 700 }];
      });
      y = s.table(s.ML, y, s.CW, ['우선순위', '현재 보장', '권장 기준', '상태', '부족분'], rows, {
        widths: [86, 128, 128, 96, 77], size: 6.8, rowH: 16.5, align: ['left', 'left', 'left', 'center', 'right']
      });
      const sT = PK(m.rows[0], 'treatment');
      const tLine = `암 주요치료비 5종 — ${(sT.subs || []).map((x) => `${TREAT_SHORT[x.key] || x.label} ${x.val ? won(x.val) : '없음'}`).join(' · ')} (합계 ${won(sT.val)} / 권장 ${won(sT.rec)}만원)`;
      s.rect(s.ML, y + 4, s.CW, 12, { fill: '#FDF9F8', r: 3, stroke: '#DCE8F4' });
      s.rect(s.ML, y + 4, 2, 12, { fill: C.blue, r: 1 });
      s.text(tLine, s.ML + 8, y + 8, { size: 5.7, weight: 600, color: C.ink2 });
      y += 17;
      const bdxS = PK(m.rows[1], 'dx').dx || {};
      const hdxS = PK(m.rows[2], 'dx').dx || {};
      const bSub = bdxS.subs || [], hSub = hdxS.subs || [];
      const dxLine = `뇌 진단비 — 뇌혈관 ${won((bSub[0] || {}).val || 0)} · 뇌졸중 ${won((bSub[1] || {}).val || 0)} · 뇌출혈 ${won((bSub[2] || {}).val || 0)} / 심장 — 허혈성 ${won((hSub[0] || {}).val || 0)} · 급성심근경색 ${won((hSub[1] || {}).val || 0)} (만원)`;
      s.rect(s.ML, y + 3, s.CW, 11, { fill: '#FDF2F1', r: 3, stroke: '#F3DCDB' });
      s.rect(s.ML, y + 3, 2, 11, { fill: C.rose, r: 1 });
      s.text(dxLine, s.ML + 8, y + 5.4, { size: 5.5, weight: 600, color: '#8C3A40' });
      y += 16;

      y = s.sectionHead(s.ML, y + 8, s.CW, null, '실행 로드맵 3단계', '유지 → 조정 → 보완');
      y = roadmapCards(s, m, y + 1, 72);
      y += 10;
      const useW = (s.CW - 16) / 3;
      const cs1 = m.contractStats;
      [
        ['가족력', m.family.length ? m.familyLabels.join('·') : '미입력', C.navy],
        ['고지 판정', m.disclosure.label, m.disclosure.tone === 'ok' ? C.mint : m.disclosure.tone === 'gap' ? C.red : C.orange],
        ['보유 계약', cs1.count ? `${cs1.count}건 · 납입완료 ${cs1.paidUpCount}건` : '미입력', C.navy]
      ].forEach((u, i) => {
        const x = s.ML + i * (useW + 8);
        s.rect(x, y, useW, 36, { fill: '#fff', r: 4, stroke: C.line });
        s.text(u[0], x + 9, y + 7, { size: 5.8, weight: 700, color: C.muted });
        s.para(u[1], x + 9, y + 16, useW - 18, { size: 6.6, weight: 800, color: u[2], lh: 1.2 });
      });
      y += 42;
      y = noteStrip(s, y + 4, `※ 이 리포트의 점수·권장선은 상담 보조용 자체 산식입니다. 통계는 통계청 2024 · 중앙암등록본부 2023 · 중앙심뇌혈관질환센터 2023 · 건보공단 2025 공표 수치이며, 실제 지급 여부와 금액은 가입하신 상품의 약관과 증권이 기준입니다.`, { size: 6.2 });
      s.footer({ left: `${m.client.name}님 보장분석 요약 · ${m.dateLabel} · ${m.client.consultant}`, right: 'LIFE REPORT', brandSlogan: true });
    };
  }

  /* =========================================================
     ② 고객용 10장 상세
     ========================================================= */
  function detailPages(m) {
    const P = [];
    const H = (s, no, title, sub) => {
      s.header({ kicker: 'LIFE REPORT', no: String(no).padStart(2, '0'), total: '10' });
      return s.pageTitle('INSURANCE ANALYSIS REPORT', title, sub, 64);
    };

    /* 01 표지 & 목차 */
    P.push(function (s) {
      s.photoBand(0, 306, {});
      s.header({ kicker: 'LIFE REPORT', no: '01', total: '10' });
      s.brandWordmark(s.ML, 54, { size: 8.6 });
      s.text('보장분석 리포트', s.ML, 96, { size: 32, weight: 800, color: C.navy });
      s.text('과도한 보장은 줄이고, 부족한 보장은 채우는', s.ML, 66, { size: 10, weight: 700, color: C.blue });
      s.para(`${m.client.name}님의 보장자산 현황을 한눈에 진단하고, 보완 우선순위를 숫자와 근거로 설명하는 금융시스템형 분석 리포트입니다.`, s.ML, 140, 300, { size: 8.4, color: C.ink2, lh: 1.5 });
      s.text(`${m.client.name} 고객님`, s.ML, 196, { size: 9.6, weight: 800, color: C.navy });
      s.text(`상담일 ${m.dateLabel} · ${m.client.consultant}`, s.ML, 210, { size: 7.2, weight: 500, color: C.ink2 });
      s.rect(s.ML, 232, 150, 42, { fill: '#3A2628', r: 5 });
      s.text('종합 보장등급', s.ML + 12, 240, { size: 5.8, weight: 700, color: '#E7CDC9' });
      s.text(m.letter, s.ML + 12, 248, { size: 18, weight: 800, color: '#fff' });
      s.text(`${m.score}점`, s.ML + 62, 252, { size: 9, weight: 700, color: '#8FF0DC' });

      let y = 356;
      s.text('이 리포트에서 확인하실 수 있습니다', s.ML, y, { size: 11.6, weight: 800, color: C.navy });
      s.line(s.ML + s.measure('이 리포트에서 확인하실 수 있습니다', 11.6, 800) + 8, y + 8, s.W - s.MR, y + 8, { color: C.line });

      const cards = [
        { n: '01', t: '보장 진단 결과 요약', d: '전체 보장 현황을 한눈에 분석하고, 과도·부족 항목을 진단합니다.', kind: 'donut' },
        { n: '02', t: '5대 질병 보장 분석', d: '암·뇌·심장·수술·간병 보장의 두께를 비교해 보여드립니다.', kind: 'radar' },
        { n: '03', t: '보장 포트폴리오 점검', d: '보유 계약과 세부 담보의 충분/점검/부족/없음을 확인합니다.', kind: 'bars' },
        { n: '04', t: '실행 로드맵 및 제안', d: '우선순위에 따른 보완 전략과 실행 가능한 맞춤 설계를 제안합니다.', kind: 'road' }
      ];
      const cw = (s.CW - 8 * 3) / 4, ch = 214;
      cards.forEach((c, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y + 16, cw, ch, { fill: '#fff', r: 6, stroke: C.line });
        s.iconCircle(x + 14, y + 32, 7.6, { fill: C.blue, num: c.n, size: 6.4, color: '#fff' });
        s.para(c.t, x + 8, y + 44, cw - 16, { size: 8.4, weight: 800, color: C.navy, lh: 1.3 });
        s.para(c.d, x + 8, y + 70, cw - 16, { size: 6.4, color: C.ink2, lh: 1.45 });
        const cy = y + 108;
        if (c.kind === 'donut') {
          s.donut(x + cw / 2, cy + 38, 30, [
            { value: m.counts.enough, color: C.mint }, { value: m.counts.check, color: C.orange },
            { value: m.counts.short, color: '#E05B52' }, { value: m.counts.none, color: C.gray }
          ], { inner: 18, centerValue: m.counts.total, centerLabel: '항목', centerSize: 13 });
        } else if (c.kind === 'radar') {
          s.radar(x + cw / 2, cy + 32, 30, m.rows.map((r) => ({ label: '', value: r.r.fill })), { color: C.blue, fill: 'rgba(18,100,176,0.14)', labelSize: 0 });
          s.text('5대 보장 밸런스', x + cw / 2, cy + 68, { size: 5.6, weight: 600, color: C.muted, align: 'center' });
        } else if (c.kind === 'bars') {
          m.rows.forEach((r, k) => {
            s.rect(x + 10, cy + 12 + k * 15, cw - 20, 7, { fill: C.line2, r: 3.5 });
            s.rect(x + 10, cy + 12 + k * 15, (cw - 20) * Math.max(0.02, r.r.fill), 7, { fill: TONE_COLOR[r.level], r: 3.5 });
          });
        } else {
          m.steps.forEach((st, k) => {
            s.rect(x + 10, cy + 10 + k * 22, cw - 20, 16, { fill: '#F3F8FE', r: 3 });
            s.text(`${k + 1}`, x + 15, cy + 13.5 + k * 22, { size: 7, weight: 800, color: C.blue });
            s.text(st.short, x + 25, cy + 14 + k * 22, { size: 6.4, weight: 700, color: C.navy });
          });
        }
      });
      y += 16 + ch;
      y = noteStrip(s, y + 12, `이 리포트는 ${m.client.consultant}가 ${m.dateLabel} 상담을 기준으로 작성했습니다. 수치는 상담 보조용 자체 산식이며, 통계는 공표 자료(통계청 2024 · 중앙암등록본부 2023 · 중앙심뇌혈관질환센터 2023 · 건보공단 2025)를 인용했습니다.`, { size: 6.4 });

      // 오늘의 결론 3줄
      y += 16;
      s.text('오늘의 결론', s.ML, y, { size: 9.4, weight: 800, color: C.navy });
      y += 14;
      const kpis = [
        { k: '먼저 채울 곳', v: m.first ? `${m.first.item.rank}순위 ${m.first.item.name}` : '구조 유지', s: m.first ? `${m.first.pct}% · ${m.first.label}` : '금액 조정 단계' },
        { k: '보완이 필요한 항목', v: `${m.needList.length}개`, s: m.needList.length ? m.needList.map((x) => x.item.name).join(' · ') : '없음' },
        { k: '하면 좋은 다음 단계', v: '10장 상세', s: '세부 담보·갱신 구조까지 확인' }
      ];
      const kw = (s.CW - 16) / 3;
      kpis.forEach((k, i) => {
        const x = s.ML + i * (kw + 8);
        s.rect(x, y, kw, 62, { fill: i === 0 ? '#FDF5F4' : '#fff', r: 5, stroke: C.line });
        s.text(k.k, x + 10, y + 8, { size: 6, weight: 600, color: C.muted });
        s.text(k.v, x + 10, y + 18, { size: 11, weight: 800, color: C.navy });
        s.para(k.s, x + 10, y + 34, kw - 20, { size: 6.2, color: C.ink2, lh: 1.35 });
      });
      y += 74;
      y = noteStrip(s, y, `문의 · ${m.client.consultant} · 상담일 ${m.dateLabel}. 이 리포트는 ${m.client.name}님 1인 기준으로 작성되었습니다.`, { size: 6.2, fill: '#F7FAFE', accent: C.navy2 });
      y += 12;
      const parts = [
        ['이 리포트', '10장 상세', '지금 보고 계신 문서'],
        ['함께 받는 자료', '1장 요약', '핵심만 압축한 한 장'],
        ['설계사용', '30장 플랜북', '상담 진행용 (고객 배포용 아님)']
      ];
      const pw = (s.CW - 16) / 3;
      parts.forEach((pt, i) => {
        const x = s.ML + i * (pw + 8);
        s.rect(x, y, pw, 40, { fill: '#fff', r: 4, stroke: C.line });
        s.text(pt[0], x + 9, y + 7, { size: 5.8, weight: 600, color: C.muted });
        s.text(pt[1], x + 9, y + 16, { size: 8.6, weight: 800, color: C.navy });
        s.text(pt[2], x + 9, y + 29, { size: 5.6, weight: 500, color: C.ink2 });
      });
      s.footer({ left: 'LIFE REPORT · 보장분석 리포트', right: `${m.client.name}님` });
    });

    /* 02 보장 진단 결과 */
    P.push(function (s) {
      let y = H(s, 2, '보장 진단 결과', '전체 보장을 한 장으로 요약했습니다. 충분·점검·부족·없음의 개수로 먼저 보세요.');
      const dn = m.counts;
      s.rect(s.ML, y, 250, 132, { fill: '#fff', r: 6, stroke: C.line });
      s.text('전체 보장 현황', s.ML + 12, y + 10, { size: 7.4, weight: 800, color: C.navy });
      s.donut(s.ML + 74, y + 78, 46, [
        { value: dn.enough, color: C.mint }, { value: dn.check, color: C.orange },
        { value: dn.short, color: '#E05B52' }, { value: dn.none, color: C.gray }
      ], { inner: 29, centerValue: m.score, centerLabel: '종합 점수', centerSize: 18 });
      const lg = [['충분', C.mint, dn.enough], ['점검', C.orange, dn.check], ['부족', '#E05B52', dn.short], ['없음', C.gray, dn.none]];
      lg.forEach((l, i) => {
        const ly = y + 44 + i * 17;
        s.rect(s.ML + 140, ly + 1, 7, 7, { fill: l[1], r: 3.5 });
        s.text(l[0], s.ML + 152, ly - 1, { size: 7, weight: 600, color: C.ink2 });
        s.text(`${l[2]}개`, s.ML + 224, ly - 1, { size: 7, weight: 800, color: C.navy, align: 'right' });
      });

      const kx = s.ML + 262, kw = s.CW - 262;
      const kpis = [
        { label: '종합 보장등급', value: m.letter, sub: `${m.score}점 · ${m.grade.label}`, color: C.blue },
        { label: '주요 진단비 합계', value: `${won(m.totalSum)}만원`, sub: '암 진단비 + 수술비 기준', color: C.navy },
        { label: '월 보험료', value: `${won(m.premium)}만원`, sub: `연 ${won(m.annual)}만원`, color: C.navy },
        { label: '연 보험료 대비 진단비', value: m.ratio ? `${m.ratio.toFixed(1)}배` : '—', sub: '12배 이상이면 균형', color: m.ratio && m.ratio < 12 ? C.orange : C.mint }
      ];
      statTiles(s, kx, y, kw, kpis, { cols: 2, h: 62 });

      y += 146;
      y = s.sectionHead(s.ML, y, s.CW, '01', '핵심 진단 3가지', '이 세 문장이 상담의 뼈대입니다');
      const diag = [];
      if (m.first) diag.push({ t: `${m.first.item.rank}순위 ${m.first.item.name}이 가장 비어 있습니다`, d: `${m.first.label} · ${m.first.summary}${m.first.gaps.length ? ` — ${m.first.gaps[0].label} 기준 ${won(m.first.gaps[0].need)}만원 부족` : ''}`, tone: 'gap' });
      diag.push({ t: `보완이 필요한 항목 ${m.needList.length}개`, d: m.needList.length ? m.needList.map((x) => `${x.item.name}(${x.pct}%)`).join(' · ') : '없음 — 금액 조정 단계로 넘어갑니다', tone: 'need' });
      diag.push({ t: m.state.silson === 'none' ? '실손 공백 — 의료비 기본축이 비어 있습니다' : `실손 ${m.state.silson === '5' ? '5' : m.state.silson}세대 · 갱신형 ${m.state.flags.renew ? '중심' : '없음'}`, d: m.state.silson === 'none' ? '진단비보다 실손을 먼저 세워야 합니다.' : (m.state.silson === '1' || m.state.silson === '2' ? '2026년 11월 선택형 할인 특약·5세대 전환 두 갈래를 같은 표에 놓고 비교합니다.' : '구조와 한도를 확인하고 유지 여부를 판단합니다.'), tone: m.state.silson === 'none' ? 'gap' : 'info' });
      const dw = (s.CW - 16) / 3;
      diag.forEach((d, i) => {
        const x = s.ML + i * (dw + 8);
        s.rect(x, y, dw, 66, { fill: '#fff', r: 5, stroke: C.line });
        s.rect(x, y, dw, 2.6, { fill: TONE_COLOR[d.tone] || C.blue, r: 1.3 });
        s.para(d.t, x + 9, y + 9, dw - 18, { size: 7.4, weight: 800, color: C.navy, lh: 1.3 });
        s.para(d.d, x + 9, y + 30, dw - 18, { size: 6.2, color: C.ink2, lh: 1.4 });
      });
      y += 78;

      y = s.sectionHead(s.ML, y, s.CW, '02', '월 보험료 배분 점검', '권장 배분 예시와 현재 상태를 비교합니다');
      s.rect(s.ML, y, s.CW, 54, { fill: '#fff', r: 5, stroke: C.line });
      s.text('권장 배분 예시 (상담 보조)', s.ML + 10, y + 8, { size: 6.2, weight: 700, color: C.muted });
      const alloc = [
        { label: '진단비', v: 45, color: C.navy },
        { label: '치료·수술', v: 20, color: C.blue },
        { label: '실손', v: 25, color: C.blue2 },
        { label: '간병·기타', v: 10, color: C.mint }
      ];
      s.stacked(s.ML + 10, y + 20, s.CW - 20, 14, alloc.map((a) => ({ value: a.v, color: a.color })), { showLabel: true });
      let ax = s.ML + 10;
      alloc.forEach((a) => {
        s.rect(ax, y + 40, 5, 5, { fill: a.color, r: 2.5 });
        s.text(`${a.label} ${a.v}%`, ax + 8, y + 38, { size: 5.8, weight: 600, color: C.ink2 });
        ax += (s.CW - 20) / 4;
      });
      y += 62;
      y = noteStrip(s, y + 6, `현재 월 보험료는 ${won(m.premium)}만원입니다. 위 배분은 상품·연령에 따라 달라지는 권장 예시이며, 배분을 바꾸는 방법은 해지가 아니라 특약 정리(배서)입니다.`, { size: 6.6 });

      y = s.sectionHead(s.ML, y + 12, s.CW, '03', '5대 판정 요약', '이 표만 보셔도 순서가 보입니다');
      const rows5 = m.rows.map((r) => [
        { text: `${r.item.rank}. ${r.item.name}`, weight: 700, color: C.navy },
        r.summary,
        { text: `${r.pct}%`, weight: 700, color: TONE_COLOR[r.level] },
        { text: r.label, badge: r.level, align: 'center' },
        { text: r.gaps.length ? `${won(r.gaps.reduce((a, g) => a + g.need, 0))}만원` : (r.level === 'ok' ? '—' : '범위 점검'), weight: 700, color: r.gaps.length ? C.red : C.muted, align: 'right' }
      ]);
      y = s.table(s.ML, y + 2, s.CW, ['우선순위', '현재 보장', '충족도', '판정', '부족분'], rows5, {
        widths: [86, 214, 56, 88, 71], size: 6.8, rowH: 22, align: ['left', 'left', 'center', 'center', 'right']
      });
      s.footer({ left: `${m.client.name}님 · 보장 진단 결과`, right: '02 / 10' });
    });

    /* 03 포트폴리오 */
    P.push(function (s) {
      let y = H(s, 3, '보장 포트폴리오 현황', '보유 계약과 세부 담보를 항목별로 점검합니다. 표의 상태 배지가 다음 상담의 순서를 정합니다.');
      y = s.sectionHead(s.ML, y, s.CW, '01', '보유 계약 목록', m.contracts.length ? `${m.contracts.length}건 · 월 ${won(m.contractTotal)}만원` : '앱에서 계약을 추가할 수 있습니다');
      y = contractTable(s, m, y + 2, { max: 5 });

      /* v4: 가족력 · 고지 판정 */
      y = s.sectionHead(s.ML, y + 10, s.CW, '02', '가족력 · 간편고지 판정', '청약 전에 확인하는 두 가지');
      const half = (s.CW - 8) / 2;
      s.rect(s.ML, y, half, 62, { fill: '#fff', r: 5, stroke: C.line });
      s.text('가족력', s.ML + 10, y + 7, { size: 6.2, weight: 700, color: C.muted });
      const famText = m.family.length ? m.familyLabels.join(' · ') : '미입력';
      s.text(famText, s.ML + 10, y + 17, { size: 9.6, weight: 800, color: m.family.length ? C.navy : C.muted });
      s.para(m.familyNotes.length ? m.familyNotes[0].body : '가족력을 입력하면 같은 위험을 우선 점검합니다.', s.ML + 10, y + 31, half - 20, { size: 5.9, color: C.ink2, lh: 1.35 });
      const dx = s.ML + half + 8;
      const djFill = m.disclosure.tone === 'ok' ? '#F1FAF7' : m.disclosure.tone === 'gap' ? '#FDF2F1' : '#FDF7EC';
      s.rect(dx, y, half, 62, { fill: djFill, r: 5, stroke: C.line });
      s.text('고지 판정 (3개월 · 1년 · 5년)', dx + 10, y + 7, { size: 6.2, weight: 700, color: C.muted });
      s.text(m.disclosure.label, dx + 10, y + 17, { size: 9.6, weight: 800, color: m.disclosure.tone === 'ok' ? C.mint : m.disclosure.tone === 'gap' ? C.red : C.orange });
      s.para(m.disclosure.headline, dx + 10, y + 31, half - 20, { size: 5.9, color: C.ink2, lh: 1.35 });
      if (m.disclosure.reasons.length) s.text(m.disclosure.reasons.join(' · '), dx + 10, y + 52, { size: 5.4, weight: 600, color: C.orange });
      y += 72;

      y = s.sectionHead(s.ML, y, s.CW, '03', '세부 담보 점검 매트릭스', '충분 / 점검 / 부족 / 없음');
      const rows = m.parts.map((p) => [
        { text: `${p.rank}. ${p.itemName}`, weight: 700, color: C.navy },
        { text: p.label, weight: 500 },
        { text: p.text, color: C.ink2 },
        { text: LEVEL_LABEL[p.level], badge: p.level === 'enough' ? 'ok' : p.level === 'check' ? 'need' : p.level === 'short' ? 'gap' : 'info', align: 'center' }
      ]);
      y = s.table(s.ML, y + 2, s.CW, ['우선순위', '세부 담보', '현재 / 권장', '상태'], rows, {
        widths: [92, 168, 190, 65], size: 6.5, rowH: 14.2, align: ['left', 'left', 'left', 'center']
      });
      y = noteStrip(s, y + 8, '「없음」은 담보 자체가 없는 상태, 「부족」은 금액이 권장 기준에 못 미치는 상태, 「점검」은 코드 범위·지급 횟수 확인이 필요한 상태입니다. 권장 기준은 상담 보조용 예시이며 실제 판단은 증권의 담보명·코드·지급 조건으로 확인합니다.', { size: 6.4 });
      s.footer({ left: `${m.client.name}님 · 포트폴리오`, right: '03 / 10' });
    });

    /* 04 밸런스 */
    P.push(function (s) {
      let y = H(s, 4, '보장 밸런스 그래프', '네 개의 축으로 나누어 보면 어디가 얇은지 바로 보입니다. 축은 상담 보조용 자체 산식입니다.');
      const axesSets = [
        { t: '① 5대 핵심 우선순위', a: m.rows.map((r) => ({ label: r.item.name, value: r.r.fill })) },
        { t: '② 진단비 축', note: '진단비가 얇으면 치료 중 소득 공백을 메우지 못합니다.', a: [PK(m.rows[0], 'general'), PK(m.rows[0], 'similar'), PK(m.rows[0], 'treatment'), PK(m.rows[1], 'dx'), PK(m.rows[2], 'dx')].map((p, i) => ({ label: ['일반암', '유사암', '치료비', '뇌', '심장'][i], value: p.fill })) },
        { t: '③ 의료비·수술·입원', note: '수술·치료비는 진단비와 별도 계약입니다.', a: [PK(m.rows[3], 'disease15'), PK(m.rows[3], 'diseaseNdae'), PK(m.rows[3], 'diseaseNonPay'), PK(m.rows[1], 'treat'), PK(m.rows[2], 'treat')].map((p, i) => ({ label: ['질병1~5종', 'N대', '비급여', '뇌치료3종', '심장치료3종'][i], value: p.fill })) },
        { t: '④ 간병·노후·기타', note: '노후에 가장 오래 나가는 돈이 이 축입니다.', a: [PK(m.rows[4], 'daily').fill, PK(m.rows[4], 'family').fill, PK(m.rows[4], 'ltc').fill, m.state.silson === 'none' ? 0 : 1, m.state.cov.cancer.recur ? 1 : 0].map((v, i) => ({ label: ['간병일당', '가족간병', '장기요양', '실손', '재진단'][i], value: v })) }
      ];
      const cw = (s.CW - 8) / 2, ch = 158;
      axesSets.forEach((set, i) => {
        const x = s.ML + (i % 2) * (cw + 8), cy = y + Math.floor(i / 2) * (ch + 8);
        s.rect(x, cy, cw, ch, { fill: '#fff', r: 6, stroke: C.line });
        s.text(set.t, x + 10, cy + 9, { size: 7.4, weight: 800, color: C.navy });
        s.radar(x + cw / 2, cy + 62, 40, set.a, { color: C.blue, fill: 'rgba(18,100,176,0.15)', labelSize: 5.6, showValue: false });
        const avg = set.a.reduce((acc, a) => acc + a.value, 0) / set.a.length;
        const weak = set.a.slice().sort((p, q) => p.value - q.value)[0];
        s.text(`평균 충족도 ${Math.round(avg * 100)}%`, x + 10, cy + ch - 30, { size: 6.4, weight: 800, color: avg >= 0.9 ? C.mint : avg >= 0.5 ? C.orange : C.red });
        s.text(`${weak.label} ${Math.round(weak.value * 100)}% — ${set.note}`, x + 10, cy + ch - 19, { size: 5.8, weight: 500, color: C.ink2 });
      });
      y += ch * 2 + 16;
      y = s.sectionHead(s.ML, y, s.CW, '01', '우선 점검 5개 항목', '이 중 세 개만 채워도 체감이 달라집니다');
      const lowest = m.parts.slice().sort((a, b) => a.fill - b.fill).slice(0, 5);
      y = s.bars(s.ML, y + 2, s.CW, lowest.map((p) => ({
        label: `${p.itemName} · ${p.label}`.slice(0, 18), value: p.fill, text: `${p.pct}%`,
        color: TONE_COLOR[p.level === 'enough' ? 'ok' : p.level === 'check' ? 'need' : p.level === 'none' ? 'none' : 'gap']
      })), { rowH: 18, labelW: 140, size: 7 });
      y = noteStrip(s, y + 8, '0%는 담보 없음, 100%는 권장 기준 충족입니다. 기준선(100%)은 연령대와 상담 목적에 따라 달라지므로 절대 기준이 아닙니다.', { size: 6.4 });
      s.footer({ left: `${m.client.name}님 · 보장 밸런스`, right: '04 / 10' });
    });

    /* 05 암 */
    P.push(function (s) {
      let y = H(s, 5, '1순위 · 암 정밀 분석', '암은 진단비(목돈)와 치료비(장기)를 나눠 봅니다. 이 페이지에서 두 축을 모두 확인합니다.');
      const cr = m.rows[0];
      const tparts = PK(cr, 'treatment');
      const tsubs = tparts.subs || [];
      const tHave = tsubs.filter((s) => s.val > 0).length;
      const cards = [
        { label: '일반암 진단비', p: PK(cr, 'general'), rec: PK(cr, 'general').rec },
        { label: '유사암 진단비', p: PK(cr, 'similar'), rec: PK(cr, 'similar').rec },
        { label: '암 주요치료비 5종', p: tparts, rec: tparts.rec, note: `5종 중 ${tHave}종` },
        { label: '재진단·전이', p: PK(cr, 'recur'), rec: null }
      ];
      const cw = (s.CW - 8 * 3) / 4;
      cards.forEach((c, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 78, { fill: '#fff', r: 5, stroke: C.line });
        s.text(c.label, x + 8, y + 8, { size: 6.4, weight: 700, color: C.ink2 });
        if (c.rec != null) {
          s.text(`${won(c.p.val)}만원`, x + 8, y + 19, { size: 13, weight: 800, color: C.navy });
          s.text(`권장 ${won(c.rec)}만원`, x + 8, y + 35, { size: 6, weight: 500, color: C.muted });
          if (c.note) s.text(c.note, x + 8, y + 48, { size: 5.6, weight: 700, color: tHave >= 5 ? C.mint : C.orange });
          s.gauge(x + 8, y + 60, cw - 16, c.p.fill, { color: c.p.fill >= 0.99 ? C.mint : c.p.fill > 0 ? C.orange : C.red, h: 6 });
          s.text(`${Math.round(c.p.fill * 100)}%`, x + cw - 8, y + 47, { size: 6.4, weight: 700, color: C.ink2, align: 'right' });
        } else {
          s.text(c.p.val ? '보유' : '없음', x + 8, y + 19, { size: 13, weight: 800, color: c.p.val ? C.mint : C.red });
          s.text('재발·전이 대비', x + 8, y + 35, { size: 6, weight: 500, color: C.muted });
          s.gauge(x + 8, y + 60, cw - 16, c.p.val ? 1 : 0, { color: c.p.val ? C.mint : C.gray, h: 6 });
        }
      });
      y += 90;
      y = s.sectionHead(s.ML, y, s.CW, '01', '왜 이 순서인가 — 공식 통계', '출처를 함께 제시하면 설득이 아니라 확인이 됩니다');
      statCard(s, s.ML, y, (s.CW - 8) / 2, 108, statById('death'));
      statCard(s, s.ML + (s.CW - 8) / 2 + 8, y, (s.CW - 8) / 2, 108, statById('cancer'));
      y += 118;
      y = s.sectionHead(s.ML, y, s.CW, '02', '암 담보 코드 · 지급 구조', null);
      y = codeTable(s, s.ML, y + 2, s.CW, PLAYBOOK_CODES('cancer'));
      y = s.sectionHead(s.ML, y + 12, s.CW, '03', '지금 채울 것', m.first && m.first.item.key === 'cancer' ? '가장 먼저 손댈 곳입니다' : '해당 없음 — 유지');
      const gaps = cr.gaps;
      y = s.bullets(s.ML, y, s.CW, gaps.length ? gaps.map((g) => `${g.label}: 현재 ${won(g.val)}만원 → 권장 ${won(g.rec)}만원 (${won(g.need)}만원 부족)`) : ['주요 금액은 기준선을 넘었습니다. 재진단·전이 담보와 1회한 조건을 확인합니다.'], { size: 7.2 });
      y = s.script(s.ML, y + 4, s.CW, {
        title: '고객에게 이렇게 말합니다',
        text: PLAYBOOK.cancer.talk[1],
        note: '※ 이 문장은 외우지 말고, 고객 증권의 담보명을 보면서 자기 말로 바꿔 말합니다.'
      });
      y = s.sectionHead(s.ML, y + 10, s.CW, '04', '설계 권장안 — 암 주요치료비 5종 세부', '권장 기준 — 예산에 맞춰 조정합니다');
      const recs = [
        ['일반암 진단비', `${won(m.state.cov.cancer.general)}만원`, `${won(PK(cr, 'general').rec)}만원`, PK(cr, 'general').fill],
        ['유사암 진단비', m.state.cov.cancer.similar ? `${won(m.state.cov.cancer.similar)}만원` : '없음', `${won(PK(cr, 'similar').rec)}만원`, PK(cr, 'similar').fill],
        ['암 주요치료비 5종 합계', `${won(tparts.val)}만원`, `${won(tparts.rec)}만원`, tparts.fill]
      ].concat(tsubs.map((sp) => [`　· ${sp.label}`, sp.val ? `${won(sp.val)}만원` : '없음', `${won(sp.rec)}만원`, sp.fill]))
        .concat([['재진단·전이', m.state.cov.cancer.recur ? '보유' : '없음', '보유 권장', m.state.cov.cancer.recur ? 1 : 0]]);
      y = s.table(s.ML, y + 2, s.CW, ['항목', '현재', '권장 기준', '충족도'], recs.map((r) => [
        { text: r[0], weight: 700, color: C.navy }, r[1], { text: r[2], color: C.ink2 },
        { text: `${Math.round(r[3] * 100)}%`, weight: 700, color: r[3] >= 0.99 ? C.mint : r[3] > 0.4 ? C.orange : C.red, align: 'center' }
      ]), { widths: [140, 130, 150, 95], size: 6.4, rowH: 14, align: ['left', 'center', 'center', 'center'] });
      y = noteStrip(s, y + 8, '유사암에 묶는 범위와 지급 비율은 상품마다 다릅니다. 원발부위 기준 조항의 설명 여부가 다퉈진 판례(대법원 2025.3.13. 선고 2023다250746)도 함께 확인하세요.', { size: 6.4 });
      s.footer({ left: `${m.client.name}님 · 1순위 암`, right: '05 / 10' });
    });

    /* 06 뇌·심장 */
    P.push(function (s) {
      let y = H(s, 6, '뇌 · 심장 보장범위 분석', '같은 질병이라도 보장 범위에 따라 보장되는 범위가 크게 달라집니다. 담보명이 아니라 코드로 확인합니다.');
      const brain = m.rows[1], heart = m.rows[2];
      const half = (s.CW - 8) / 2;
      const bdx = PK(brain, 'dx').dx || {};
      const hdx = PK(heart, 'dx').dx || {};

      [[brain, '뇌혈관질환', ['뇌혈관질환 I60~I69', '뇌졸중 I60~I63·I65~I66', '뇌출혈 I60~I62'], ['#3A2628', '#7A3F45', '#D96B70'], C.blue],
      [heart, '허혈성심장질환', ['허혈성심장 I20~I25', '급성심근경색 I21~I23'], ['#8C3A40', '#E8A39B'], C.red]].forEach((grp, gi) => {
        const [row, title, labels, colors, accent] = grp;
        const x = s.ML + gi * (half + 8);
        s.rect(x, y, half, 150, { fill: gi ? '#FDF2F1' : '#FDF9F8', r: 6, stroke: C.line });
        s.text(title, x + 12, y + 10, { size: 10, weight: 800, color: accent });
        s.text(`${row.item.rank}순위`, x + half - 12, y + 12, { size: 6, weight: 700, color: C.muted, align: 'right' });
        const cy = y + 78;
        const rr = [40, 29, 17];
        labels.forEach((lb, i) => {
          s.ctx.save();
          s.ctx.beginPath(); s.ctx.arc(x + 74, cy, rr[i], 0, Math.PI * 2);
          s.ctx.fillStyle = colors[i]; s.ctx.fill();
          s.ctx.strokeStyle = 'rgba(255,255,255,.85)'; s.ctx.lineWidth = 1.2; s.ctx.stroke();
          s.ctx.restore();
        });
        labels.forEach((lb, i) => {
          const bits = lb.split(' ');
          const ly = y + 124 + i * 9;
          s.rect(x + 12, ly + 1, 5, 5, { fill: colors[i], r: 2.5 });
          s.text(`${bits[0]} ${bits[1] || ''}`, x + 21, ly - 1.2, { size: 5.7, weight: 600, color: C.ink2 });
        });

        // 현재 vs 권장 — 범위별 진단비 금액
        const dxp = PK(row, 'dx');
        const dx = gi ? hdx : bdx;
        const core = dx.core;
        const tx = x + 132, tw = half - 144;
        s.text('핵심 범위 금액', tx, y + 32, { size: 6, weight: 600, color: C.muted });
        s.text(`${core ? won(core.val) : '0'}만원`, tx, y + 40, { size: 10, weight: 800, color: core && core.val >= 2000 ? C.mint : C.red });
        s.text('권장 범위', tx, y + 56, { size: 6, weight: 600, color: C.muted });
        s.text(gi ? '허혈성심장질환 I20~I25' : '뇌혈관질환 I60~I69', tx, y + 65, { size: 6.8, weight: 700, color: C.navy });
        s.gauge(tx, y + 80, tw, dxp.fill, { color: dxp.fill >= 0.99 ? C.mint : C.orange, h: 6 });
        s.text(`충족 ${Math.round(dxp.fill * 100)}%`, tx, y + 89, { size: 6.2, weight: 600, color: C.ink2 });
        s.text(`주요치료비 3종 ${subHave(PK(row, 'treat'))}/3 · ${won(PK(row, 'treat').val)}만원`, tx, y + 100, { size: 6.2, weight: 600, color: PK(row, 'treat').val > 0 ? C.mint : C.red });
        s.text((dx.scenarios || []).map((sc) => `${BK.dxShort(sc.label.replace(/\(.*/, ''))} ${won(sc.sum)}`).join(' · '), tx, y + 112, { size: 5.9, weight: 600, color: C.navy });
        s.para(gi ? '협심증(I20)은 허혈성심장 담보에서만, 급성심근경색(I21)은 두 담보가 합산됩니다.' : '뇌경색(I63)은 뇌혈관+뇌졸중, 뇌출혈(I61)은 세 담보가 합산됩니다.', tx, y + 122, tw, { size: 5.7, color: C.ink2, lh: 1.32 });
      });
      y += 160;

      y = s.sectionHead(s.ML, y, s.CW, '01', '진단비 3단계·2단계 금액', '핵심 범위 / 현재 / 권장 / 해석');
      const rowOfDx = (dxp, i) => {
        const sp = (dxp.subs || [])[i];
        if (!sp) return ['—', '—', '—', '—'];
        return [sp.label, sp.val ? `${won(sp.val)}만원` : '0원', `${won(sp.rec)}만원`, sp.codes];
      };
      const rows = [
        rowOfDx(PK(brain, 'dx'), 0), rowOfDx(PK(brain, 'dx'), 1), rowOfDx(PK(brain, 'dx'), 2),
        rowOfDx(PK(heart, 'dx'), 0), rowOfDx(PK(heart, 'dx'), 1),
        ['주요치료비 3종', `뇌 ${subHave(PK(brain, 'treat'))}/3 · 심장 ${subHave(PK(heart, 'treat'))}/3`, '혈전용해제·수술·중환자실', '혈전용해제와 기계적 혈전제거술은 별도']
      ];
      y = s.table(s.ML, y + 2, s.CW, ['담보 (범위)', '현재', '권장', '코드'], rows, {
        widths: [150, 90, 90, 185], size: 6.6, rowH: 20, align: ['left', 'center', 'center', 'center']
      });
      y = noteStrip(s, y + 6, (bdx.gapWarn ? '⚠ 뇌혈관질환 진단비가 0원입니다 — 뇌경색(I63)은 뇌졸중 금액만, 뇌혈관 후유증(I69)은 지급되지 않습니다. ' : '')
        + (hdx.gapWarn ? '⚠ 허혈성심장질환 진단비가 0원입니다 — 협심증(I20)·스텐트 시술이 지급되지 않습니다. ' : '')
        + '안쪽 담보는 바깥 담보에 포함되고, 진단 시 금액이 합산됩니다. 실제 지급은 담보명·코드·지급 조건으로 확인합니다.', { size: 6.4 });
      y = s.sectionHead(s.ML, y + 10, s.CW, '02', '공식 통계로 확인', '출처: 중앙심뇌혈관질환센터·건강보험통계 2023');
      statCard(s, s.ML, y, s.CW, 100, statById('stroke'));
      y += 108;
      y = s.sectionHead(s.ML, y, s.CW, '03', '뇌·심장에서 함께 확인할 것', '진단비 밖의 빈틈');
      y = s.bullets(s.ML, y, s.CW, [
        '주요치료비 3종: 혈전용해제(tPA)·수술(관혈/비관혈)·중환자실을 각각 봅니다. 기계적 혈전제거술(카테터법)은 혈전용해치료에서 제외되어 별도 담보입니다. 대부분 1년 미만은 50% 감액입니다.',
        '후유장해: 살아남아도 장해가 남으면 지급률로 평가합니다. 진단비와 별개 담보입니다.',
        '재활·간병: 회복 기간이 길어 간병비·장기요양과 연결됩니다. 5순위에서 이어서 봅니다.'
      ], { size: 6.9, gap: 2.5 });
      s.footer({ left: `${m.client.name}님 · 뇌·심장`, right: '06 / 10' });
    });

    /* 07 수술·간병·실손 */
    P.push(function (s) {
      let y = H(s, 7, '수술 · 입원 · 간병 · 실손', '매일 나가는 돈과 한 번 나가는 돈을 함께 봅니다. 의료비 방어력은 이 네 축의 합입니다.');
      const surgery = m.rows[3], care = m.rows[4];
      const defence = Math.round(((surgery.r.fill + care.r.fill + (m.state.silson === 'none' ? 0 : 1) + (BK.treatSum(m.state) > 0 ? 1 : 0)) / 4) * 100);
      s.rect(s.ML, y, s.CW, 54, { fill: '#3A2628', r: 6 });
      s.text('의료비 방어력', s.ML + 14, y + 10, { size: 6.4, weight: 700, color: '#E7CDC9' });
      s.text(`${defence}%`, s.ML + 14, y + 19, { size: 22, weight: 800, color: '#fff' });
      s.gauge(s.ML + 92, y + 30, s.CW - 116, defence / 100, { color: '#8FF0DC', h: 8, track: '#5A3C3E' });
      s.text(defence >= 80 ? '기본 방어선이 서 있습니다' : defence >= 50 ? '한두 축이 비어 있습니다' : '의료비 기본축부터 세워야 합니다', s.ML + 92, y + 12, { size: 6.8, weight: 600, color: '#F2E4E2' });
      s.text('수술 · 간병 · 실손 · 치료비 4축 평균', s.W - s.MR - 14, y + 12, { size: 5.8, weight: 500, color: '#E7CDC9', align: 'right' });
      y += 64;

      y = s.sectionHead(s.ML, y, s.CW, '01', '수술비 6축 · 간병 6칸', null);
      const sgr = m.rows[3], carR = m.rows[4];
      const rows = [
        ['수술비', '질병수술비(일반·매회)', `${won(m.state.cov.surgery.disease)}만원`, '수술 1회당 정액'],
        ['수술비', '질병 1~5종', `${won(m.state.cov.surgery.disease15)}만원`, '침습도 분류 · 1종 고액'],
        ['수술비', '질병 N대', m.state.cov.surgery.diseaseNdae ? `${won(m.state.cov.surgery.diseaseNdae)}만원` : '없음', '질환 묶음별 한도'],
        ['수술비', '비급여 질병 수술', m.state.cov.surgery.diseaseNonPay ? `${won(m.state.cov.surgery.diseaseNonPay)}만원` : '없음', '5세대 실손 보완'],
        ['수술비', '일반 상해수술', `${won(m.state.cov.surgery.injury)}만원`, '사고 수술 정액'],
        ['수술비', '상해 1~5종', `${won(m.state.cov.surgery.injury15)}만원`, '사고 수술 침습도'],
        ['간병', '일반병원 간병일당', `${won(m.state.cov.care.daily)}만원`, '요양병원 제외 · 5~20만원'],
        ['간병', '요양병원 간병일당', m.state.cov.care.nDaily ? `${won(m.state.cov.care.nDaily)}만원` : '없음', '통상 5~6만원대'],
        ['간병', '지급 기준', { time: '시간 기준', money: '금액 기준', unknown: '미확인' }[m.state.cov.care.basis], '일 8시간 / 7~8만원'],
        ['간병', '가족 간병', { yes: '인정', conditional: '업체등록·결제 필요', no: '불인정' }[m.state.cov.care.family], '청구 가능성'],
        ['간병', '간호간병통합', m.state.cov.care.nursing ? '보유' : '없음', '보호자 없는 병동'],
        ['간병', '장기요양등급', m.state.cov.care.ltc ? '보유' : '없음', '1~5등급 · 인지지원'],
        ['실손', '세대', m.state.silson === 'none' ? '없음' : `${m.state.silson}세대`, '급여·비급여 구조 확인']
      ];
      y = s.table(s.ML, y + 2, s.CW, ['영역', '항목', '현재', '메모'], rows.map((r) => [
        { text: r[0], weight: 700, color: C.navy }, r[1], { text: r[2], weight: 700, color: r[2] === '없음' || r[2] === '미확인' ? C.red : C.navy }, { text: r[3], color: C.muted }
      ]), { widths: [48, 170, 92, 205], size: 6.3, rowH: 13.2, align: ['left', 'left', 'center', 'left'] });
      y = s.sectionHead(s.ML, y + 8, s.CW, '02', '의료비 방어력 4축', '지금 어느 축이 비어 있는지');
      const axes4 = [
        ['수술비', m.rows[3].r.fill], ['간병', m.rows[4].r.fill],
        ['실손', m.state.silson === 'none' ? 0 : 1], ['치료비 5종', BK.treatCount(m.state) / 5]
      ];
      const aw = (s.CW - 6 * 3) / 4;
      axes4.forEach((a, i) => {
        const x = s.ML + i * (aw + 6);
        s.rect(x, y, aw, 46, { fill: '#fff', r: 5, stroke: C.line });
        s.text(a[0], x + 9, y + 8, { size: 6.2, weight: 600, color: C.muted });
        s.text(`${Math.round(a[1] * 100)}%`, x + 9, y + 17, { size: 13, weight: 800, color: a[1] >= 0.9 ? C.mint : a[1] > 0.3 ? C.orange : C.red });
        s.gauge(x + 9, y + 36, aw - 18, a[1], { color: a[1] >= 0.9 ? C.mint : a[1] > 0.3 ? C.orange : C.gray, h: 4.5 });
      });
      y += 58;
      y = s.sectionHead(s.ML, y + 2, s.CW, '03', '장기요양 등급 분포 — 왜 1~2등급만 준비하면 안 되는가', '출처: 건보공단 2025 노인장기요양보험 통계연보');
      statCard(s, s.ML, y, s.CW, 118, statById('ltc'));
      y += 126;
      y = noteStrip(s, y, '2026년 7월부터 주요 손보사가 간병인 사용일당 지급 기준을 금액(하루 8만원)→시간(하루 8시간)으로 전환했습니다. 가족 간병은 업체 등록·결제·간병일지가 맞아야 인정되며, 요양병원은 별도 담보입니다. 장기요양은 등급 판정이 전제이고 65세 미만도 노인성 질병이면 신청할 수 있습니다.', { size: 6.2 });
      s.footer({ left: `${m.client.name}님 · 수술·간병`, right: '07 / 10' });
    });

    /* 08 갱신형·노후 */
    P.push(function (s) {
      let y = H(s, 8, '갱신형 보험 & 노후 보장 전망', '지금의 보험료가 앞으로도 같지는 않습니다. 갱신 구조를 확인하면 노후 준비가 보입니다.');
      y = s.sectionHead(s.ML, y, s.CW, '01', '갱신형 vs 비갱신형', '같은 보장도 계약 구조에 따라 60대 이후 보험료가 달라집니다');
      const rows = [
        ['보험료 변화', '가입 시 저렴, 갱신 때 인상', '가입 시 비싸지만 일정'],
        ['재가입 심사', '갱신 시 건강 상태 재심사', '없음 (만기까지 유지)'],
        ['만기 구조', '주기별 갱신 (5·10·15·20년 등)', '80세·100세 만기 등'],
        ['노후 리스크', '갱신 거절·보험료 급증', '만기 후 보장 공백'],
        ['상담 포인트', '갱신 연령·예상 보험료 표를 확인', '만기 이후 대안을 함께 설계']
      ];
      y = s.table(s.ML, y + 2, s.CW, ['구분', '갱신형', '비갱신형'], rows, { widths: [90, 215, 210], size: 6.8, rowH: 20, align: ['left', 'left', 'left'] });
      y = noteStrip(s, y + 6, `현재 입력 기준: 갱신형 담보 ${m.state.flags.renew ? '중심' : '없음'} · 적립성 특약 ${m.state.flags.savings ? '있음' : '없음'} · 특약 ${m.state.flags.manyRiders ? '6개 이상' : '6개 미만'}. 갱신 시점의 실제 보험료는 상품·나이에 따라 다르므로 증권의 갱신 보험료 표로 확인해야 합니다.`, { size: 6.4 });
      y += 12;
      y = s.sectionHead(s.ML, y, s.CW, '02', '노후 보장 공백 전망', '구조 예시 — 실제 만기·갱신 시점은 증권에서 확인');
      const bands = [
        { t: '현재', d: `보험나이 ${m.client.insuranceAge != null ? m.client.insuranceAge + '세' : m.state.age + '대'}`, c: C.blue },
        { t: '상령일', d: m.client.ageDay ? `${m.client.ageDay.label} (D-${m.client.ageDay.days})` : '생년월일 입력 시 계산', c: C.navy },
        { t: '갱신 시점', d: '보험료 재산정 · 인수 심사', c: C.orange },
        { t: '65세', d: '장기요양 신청 가능 구간', c: C.mint },
        { t: '만기', d: '보장 공백 · 재가입 불가 가능', c: C.red }
      ];
      const bw = (s.CW - 8 * 4) / 5;
      bands.forEach((b, i) => {
        const x = s.ML + i * (bw + 8);
        s.rect(x, y, bw, 52, { fill: '#fff', r: 5, stroke: C.line });
        s.rect(x, y, bw, 2.6, { fill: b.c, r: 1.3 });
        s.text(b.t, x + 8, y + 9, { size: 7, weight: 800, color: C.navy });
        s.para(b.d, x + 8, y + 20, bw - 16, { size: 5.9, color: C.ink2, lh: 1.35 });
      });
      y += 64;
      y = s.sectionHead(s.ML, y, s.CW, '03', '노후 체크포인트', null);
      y = s.bullets(s.ML, y, s.CW, [
        '갱신형 담보의 다음 갱신 연령과 그때의 예상 보험료를 증권에서 확인합니다.',
        '만기 80세·100세 여부와 만기 후 대안(간병·요양)을 함께 설계합니다.',
        '적립성 특약은 해지환급금보다 보장 효율을 먼저 따집니다.',
        '노후에는 진단비보다 간병·요양·실손이 실제 지출의 중심이 됩니다.'
      ], { size: 7.1 });
      y = s.script(s.ML, y + 4, s.CW, { title: '이렇게 말합니다', text: '"지금 보험료가 앞으로도 계속 같지는 않습니다. 갱신 때 얼마가 되는지 표로 한 번 보시고, 그때를 대비해 지금 구조를 잡아두자는 겁니다."' });
      y += 10;
      y = s.sectionHead(s.ML, y + 2, s.CW, '04', '계약 납입 · 만기 현황', m.state.contracts.length ? `입력 계약 ${m.contractStats.count}건` : '앱에서 계약을 입력하면 채워집니다');
      const cw8 = (s.CW - 16) / 3;
      const csn = m.contractStats;
      [
        ['납입완료', csn.paidUpCount ? `${csn.paidUpCount}건 · ${won(csn.paidUpPremium)}만원` : '없음', csn.paidUpCount ? '보험료 부담 없이 보장만 유지 — 해지하지 않습니다' : '입력된 납입완료 계약이 없습니다', csn.paidUpPremium > 0 ? C.mint : C.gray],
        ['만기 80·90세', csn.shortMaturityCount ? `${csn.shortMaturityCount}건` : '없음', csn.shortMaturityCount ? '노후에 보장이 먼저 끊겼니다 — 만기 후 대안 설계' : '만기 100세·종신이면 노후 유지에 유리합니다', csn.shortMaturityCount ? C.red : C.mint],
        ['갱신형 비중', csn.count ? `${csn.renewShare}%` : '—', csn.renewShare >= 60 ? '보험료의 절반 이상이 갱신형 — 갱신 시점 인상 확인' : '갱신형 비중이 크지 않습니다 — 현 구조 유지', csn.renewShare >= 60 ? C.orange : C.mint]
      ].forEach((c, i) => {
        const x = s.ML + i * (cw8 + 8);
        s.rect(x, y, cw8, 50, { fill: '#fff', r: 4, stroke: C.line });
        s.rect(x, y, cw8, 2.4, { fill: c[3], r: 1.2 });
        s.text(c[0], x + 9, y + 9, { size: 6.6, weight: 700, color: C.muted });
        s.text(c[1], x + 9, y + 18, { size: 10.4, weight: 800, color: c[3] === C.gray ? C.muted : C.navy });
        s.para(c[2], x + 9, y + 32, cw8 - 18, { size: 5.6, color: C.ink2, lh: 1.25 });
      });
      y += 60;
      if (m.client.ageDay) y = noteStrip(s, y, `상령일 ${m.client.ageDay.label}까지 D-${m.client.ageDay.days}. 이 날이 지나면 보험나이가 ${m.client.ageDay.insuranceAgeAfter}세가 되어 같은 보장도 보험료가 달라질 수 있습니다.`, { size: 6.4, fill: '#FFF9EE', stroke: '#F3E4C6', accent: C.orange });
      s.footer({ left: `${m.client.name}님 · 갱신·노후`, right: '08 / 10' });
    });

    /* 09 summary */
    P.push(function (s) {
      let y = H(s, 9, '한 장으로 보는 보장자산 Summary', '점수·등급·세부 점수를 한 화면에 모았습니다. 이 페이지만 보관하셔도 됩니다.');
      s.rect(s.ML, y, s.CW, 76, { fill: '#3A2628', r: 6 });
      s.text('종합 보장등급', s.ML + 16, y + 12, { size: 6.4, weight: 700, color: '#E7CDC9' });
      s.text(m.letter, s.ML + 16, y + 22, { size: 30, weight: 800, color: '#fff' });
      s.text(`${m.score} / 100점`, s.ML + 76, y + 34, { size: 9, weight: 700, color: '#8FF0DC' });
      s.text(m.grade.line, s.ML + 76, y + 48, { size: 7.4, weight: 500, color: '#F2E4E2' });
      s.text(`보완 필요 ${m.needList.length}개 항목`, s.W - s.MR - 16, y + 14, { size: 7.4, weight: 700, color: '#fff', align: 'right' });
      s.text(`충분 ${m.counts.enough} · 점검 ${m.counts.check} · 부족 ${m.counts.short} · 없음 ${m.counts.none}`, s.W - s.MR - 16, y + 28, { size: 6.4, weight: 500, color: '#E7CDC9', align: 'right' });
      y += 86;
      y = s.sectionHead(s.ML, y, s.CW, '01', '세부 점수 분포', '14개 세부 담보 + 실손');
      const cols = 2, cw = (s.CW - 10) / cols;
      const perCol = Math.ceil(m.parts.length / cols);
      m.parts.forEach((p, i) => {
        const c = Math.floor(i / perCol), r = i % perCol;
        const x = s.ML + c * (cw + 10), cy = y + r * 15;
        s.text(`${p.itemName} · ${p.label}`, x, cy, { size: 6.3, weight: 500, color: C.ink2 });
        s.gauge(x + 118, cy + 1.5, cw - 160, p.fill, { color: TONE_COLOR[p.level === 'enough' ? 'ok' : p.level === 'check' ? 'need' : p.level === 'none' ? 'none' : 'gap'], h: 4.6 });
        s.text(`${p.pct}%`, x + cw, cy, { size: 6.2, weight: 700, color: C.navy, align: 'right' });
      });
      y += perCol * 15 + 12;
      y = s.sectionHead(s.ML, y, s.CW, '02', '우선순위 요약표', null);
      const rows = m.rows.map((r) => [
        { text: `${r.item.rank}. ${r.item.name}`, weight: 700, color: C.navy },
        r.summary,
        { text: `${r.pct}%`, weight: 700, color: TONE_COLOR[r.level] },
        { text: r.label, badge: r.level, align: 'center' },
        { text: r.gaps.length ? `${won(r.gaps.reduce((a, g) => a + g.need, 0))}만원` : '—', weight: 700, color: r.gaps.length ? C.red : C.muted, align: 'right' }
      ]);
      y = s.table(s.ML, y + 2, s.CW, ['우선순위', '현재 보장', '충족도', '판정', '부족분'], rows, {
        widths: [86, 214, 56, 88, 71], size: 6.6, rowH: 22, align: ['left', 'left', 'center', 'center', 'right']
      });
      y = s.sectionHead(s.ML, y + 10, s.CW, '03', '보험료 지표', null);
      y = statTiles(s, s.ML, y + 2, s.CW - 4, [
        { label: '월 보험료', value: `${won(m.premium)}만원`, sub: '실손 포함 전체', size: 12.5 },
        { label: '연 보험료', value: `${won(m.annual)}만원`, sub: '월 × 12', size: 12.5 },
        { label: '연 대비 진단비', value: m.ratio ? `${m.ratio.toFixed(1)}배` : '—', sub: '12배 이상이면 균형', color: m.ratio && m.ratio < 12 ? C.orange : C.mint, size: 12.5 },
        { label: '계약 건수', value: m.contracts.length ? `${m.contracts.length}건` : '—', sub: m.contracts.length ? `합계 ${won(m.contractTotal)}만원` : '앱에서 입력', size: 12.5 }
      ], { cols: 4, h: 52 });
      y = noteStrip(s, y + 6, '이 점수는 상담 보조용 자체 산식이며 보험사 기준이 아닙니다. 같은 입력이라도 연령대·직업급수·실손 세대에 따라 가중치가 달라집니다.', { size: 6.4 });
      s.footer({ left: `${m.client.name}님 · 보장자산 Summary`, right: '09 / 10' });
    });

    /* 10 보조보장 & 로드맵 */
    P.push(function (s) {
      let y = H(s, 10, '핵심 보조보장 & 실행 로드맵', '큰 담보를 채운 뒤에 남는 빈틈과, 오늘부터의 실행 순서입니다.');
      y = s.sectionHead(s.ML, y, s.CW, '01', '놓치기 쉬운 보조보장', '진단비 다음에 확인할 항목');
      const rows = [
        ['후유장해', '뇌졸중·사고 후 장해 지급률 평가', '진단비와 별도 담보'],
        ['배상책임', '가족·반려동물 사고 배상', '생활배상책임 특약'],
        ['골절·화상', '상해 계열 소액 보장', '상해수술비와 별개'],
        ['치아', '보철·임플란트', '실손과 별도 담보'],
        ['수술·입원 일당', '입원 기간 매일 지급', '간병비와 구분']
      ];
      y = s.table(s.ML, y + 2, s.CW, ['항목', '무엇을 보장하나', '확인 포인트'], rows, { widths: [82, 235, 198], size: 6.7, rowH: 18, align: ['left', 'left', 'left'] });
      y = s.sectionHead(s.ML, y + 12, s.CW, '02', '실행 로드맵', '한 번에 다 하지 않습니다');
      const cw = s.CW;
      m.steps.forEach((st, i) => {
        s.rect(s.ML, y, cw, 44, { fill: i === 0 ? '#FDF5F4' : i === 1 ? '#FDF7EC' : '#F1FAF7', r: 5, stroke: C.line });
        s.iconCircle(s.ML + 18, y + 22, 9, { fill: [C.blue, C.orange, C.mint][i], num: i + 1, size: 8, color: '#fff' });
        s.text(st.title.replace(/^[^ ]+ — /, ''), s.ML + 34, y + 8, { size: 8.6, weight: 800, color: C.navy });
        s.para(st.body, s.ML + 34, y + 22, cw - 46, { size: 6.3, color: C.ink2, lh: 1.35 });
        y += 48;
      });
      y = s.sectionHead(s.ML, y + 8, s.CW, '03', '다음 단계 체크리스트', '고객과 함께 확인합니다');
      y = s.checks(s.ML, y, s.CW, [
        '증권 원본(또는 앱 캡처)으로 담보명·코드·지급 조건 확인',
        '가장 비어 있는 1순위 한 칸의 금액 결정',
        '실손 세대 확인 후 유지 / 선택형 할인 / 5세대 전환 비교',
        '갱신 시점과 예상 보험료 확인',
        '고지의무 3·1·5(간편 3·2·5) 질문지 함께 작성',
        '다음 상담 날짜와 전달 방법(PDF·문자) 확정'
      ], { size: 7.4, rowH: 15.5 });
      y = noteStrip(s, y + 6, `상담일 ${m.dateLabel} · 담당 ${m.client.consultant} · 이 리포트는 고객 1인 기준으로 생성되었습니다.`, { size: 6.4 });
      s.footer({ left: `${m.client.name}님 · 보조보장·로드맵`, right: '10 / 10' });
    });

    return P;
  }

  function PLAYBOOK_CODES(key) {
    const pb = PLAYBOOK[key];
    return pb.codes.map((c) => ({ label: c.label, code: c.code, note: c.note }));
  }

  /* =========================================================
     ③ 설계사용 30장 플랜북
     ========================================================= */
  function advisorPages(m) {
    const P = [];
    const TOTAL = 30;
    const head = (s, no, kicker, title, lead) => {
      s.header({ kicker: 'BOJANG PLAN BOOK', no: String(no).padStart(2, '0'), total: '30' });
      const y = s.pageTitle(kicker, title, lead, 62);
      s.line(s.ML, y - 4, s.W - s.MR, y - 4, { color: C.line });
      return y + 2;
    };
    const foot = (s, no, label, extra) => s.footer(Object.assign({ left: `${m.client.name}님 상담 플랜 · ${label} · 설계사용`, right: `${String(no).padStart(2, '0')} / 30` }, extra || {}));
    const secLabel = (s, y, t) => {
      s.text(t, s.ML, y, { size: 6.4, weight: 800, color: C.blue });
      return y + 12;
    };
    const scriptBlock = (s, y, title, text, note) => s.script(s.ML, y, s.CW, { title, text, note, accent: C.blue });
    const gapLine = (m2) => m2.needList.map((x) => `${x.item.name} ${x.pct}%`).join(' · ') || '전 항목 기준선 이상';


    /* ---- 보강 블록 (플랜북) ---- */
    const questionCard = (s, y, q, label) => {
      y = blockTitle(s, y + 2, label || '이 페이지에서 쓸 질문 하나', '하나만 골라 쓰면 됩니다');
      s.rect(s.ML, y, s.CW, 46, { fill: '#F3FBF8', r: 4, stroke: '#CDECE3' });
      s.text('Q', s.ML + 10, y + 8, { size: 9, weight: 800, color: C.mint });
      s.text(q.q, s.ML + 24, y + 8, { size: 8.4, weight: 700, color: C.navy });
      s.text('의도 — ' + q.why, s.ML + 24, y + 22, { size: 6, weight: 500, color: C.ink2 });
      s.text('기대 — ' + q.expect, s.ML + 24, y + 32, { size: 6, weight: 500, color: C.muted });
      return y + 54;
    };
    const blockTitle = (s, y, t, sub) => {
      s.text(t, s.ML, y, { size: 8.4, weight: 800, color: C.navy });
      if (sub) s.text(sub, s.W - s.MR, y + 1.5, { size: 6, weight: 500, color: C.muted, align: 'right' });
      return y + 13;
    };
    const typeCards = (s, y, items, title) => {
      y = blockTitle(s, y, title || '고객 유형별 첫 문장', '같은 담보, 다른 시작');
      const cw = (s.CW - 16) / 3;
      items.forEach((it, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 78, { fill: '#fff', r: 5, stroke: C.line });
        s.rect(x, y, cw, 2.6, { fill: [C.blue, C.navy2, C.mint][i], r: 1.3 });
        s.text(it.t, x + 9, y + 9, { size: 7.2, weight: 800, color: C.navy });
        s.para('"' + it.s + '"', x + 9, y + 22, cw - 18, { size: 6.1, color: C.ink2, lh: 1.4 });
      });
      return y + 86;
    };
    const noSay = (s, y, items) => {
      y = blockTitle(s, y, '말하면 안 되는 것 · 이렇게 바꿔 말합니다', '한 문장만 바꿔도 반응이 달라집니다');
      items.forEach((it) => {
        s.rect(s.ML, y, s.CW, 34, { fill: '#fff', r: 4, stroke: C.line });
        s.text('✕', s.ML + 8, y + 6, { size: 7.4, weight: 800, color: C.red });
        s.text(it.bad, s.ML + 20, y + 6, { size: 6.8, weight: 700, color: '#8C3A33' });
        s.text(it.why, s.W - s.MR - 8, y + 7.5, { size: 5.9, weight: 500, color: C.muted, align: 'right' });
        s.text('○', s.ML + 10, y + 19, { size: 7, weight: 800, color: C.mint });
        s.text(it.instead, s.ML + 20, y + 19, { size: 6.6, weight: 600, color: C.navy2 });
        y += 37;
      });
      return y + 2;
    };
    const docOrder = (s, y, items, title) => {
      y = blockTitle(s, y, title || '증권 확인 4단계', '고객 증권을 펼치면 이 순서로');
      const cw = (s.CW - 8 * 3) / 4;
      items.forEach((t, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 52, { fill: '#F7FAFE', r: 4, stroke: C.line });
        s.iconCircle(x + 13, y + 12, 7, { fill: C.navy, num: i + 1, size: 6.4, color: '#fff' });
        s.para(t, x + 8, y + 23, cw - 16, { size: 5.9, color: C.ink2, lh: 1.35 });
      });
      return y + 60;
    };
    const afterBlock = (s, y, items, title) => {
      y = blockTitle(s, y, title || '동의한 직후에 할 말', '여기서 끊기면 결정이 흐려집니다');
      items.forEach((it) => {
        s.rect(s.ML, y, s.CW, 30, { fill: '#fff', r: 4, stroke: C.line });
        s.text(it.t, s.ML + 8, y + 9, { size: 6.4, weight: 800, color: C.blue });
        s.para(it.s, s.ML + 66, y + 7, s.CW - 74, { size: 6.3, color: C.ink2, lh: 1.35 });
        y += 33;
      });
      return y + 2;
    };
    /* 01 표지 */
    P.push(function (s) {
      s.photoBand(0, 296, {});
      s.header({ kicker: 'BOJANG PLAN BOOK', no: '01', total: '30' });
      s.brandWordmark(s.ML, 52, { size: 8.4 });
      s.text('상담 마스터 플랜북', s.ML, 76, { size: 28, weight: 800, color: C.navy });
      s.text('이 책만 보고 따라가면 상담이 끊기지 않습니다', s.ML, 112, { size: 9.6, weight: 700, color: C.blue });
      s.para(`${m.client.name}님 · ${m.dateLabel} · 담당 ${m.client.consultant}`, s.ML, 132, 280, { size: 7.6, color: C.ink2 });
      s.rect(s.ML, 150, 190, 44, { fill: '#3A2628', r: 5 });
      s.text('오늘의 목표', s.ML + 12, 157, { size: 5.8, weight: 700, color: '#E7CDC9' });
      s.text(`1순위 ${m.first ? m.first.item.name : '유지'} · ${m.score}점 ${m.letter}`, s.ML + 12, 167, { size: 10.4, weight: 800, color: '#fff' });
      let y = 300;
      s.text('오늘 상담 60분 설계', s.ML, y, { size: 11, weight: 800, color: C.navy });
      y += 16;
      PLAN_OPEN.flow.forEach((f, i) => {
        const x = s.ML + i * ((s.CW - 8 * 4) / 5 + 8);
        const w = (s.CW - 8 * 4) / 5;
        s.rect(x, y, w, 66, { fill: i === 0 ? '#FDF5F4' : '#fff', r: 5, stroke: C.line });
        s.text(f.m, x + 9, y + 8, { size: 6, weight: 800, color: C.blue });
        s.text(f.t, x + 9, y + 20, { size: 9.4, weight: 800, color: C.navy });
        s.para(f.d, x + 9, y + 36, w - 18, { size: 6, color: C.ink2, lh: 1.35 });
      });
      y += 80;
      s.text('이 책을 쓰는 법', s.ML, y, { size: 9.4, weight: 800, color: C.navy });
      y += 13;
      y = s.bullets(s.ML, y, s.CW, [
        '페이지 순서를 바꾸지 않습니다. 순서 자체가 설득 구조입니다.',
        '파란 박스는 고객에게 실제로 읽는 문장입니다. 그대로 읽어도 되고 자기 말로 바꿔도 됩니다.',
        '회색 표는 확인용입니다. 고객에게 다 보여주지 않고, 설계사가 판단 근거로만 씁니다.',
        '각 페이지 끝의 "다음 페이지로 넘어가기 전" 한 줄을 확인하고 넘어갑니다.'
      ], { size: 7.4, gap: 3 });
      y = noteStrip(s, y + 8, `이 플랜북은 ${m.client.name}님의 입력값으로 계산된 맞춤 자료입니다. 권장 금액은 상담 보조용 예시이며, 상품 인수 조건과 실제 보험료는 다를 수 있습니다.`, { size: 6.6 });
      y += 12;
      y = blockTitle(s, y, '오늘 상담의 성공 기준 3가지', '계약이 아니라 이 세 가지로 판단합니다');
      const sw = (s.CW - 16) / 3;
      PLAN_FRONT.success.forEach((sc, i) => {
        const x = s.ML + i * (sw + 8);
        s.rect(x, y, sw, 44, { fill: '#F7FAFE', r: 4, stroke: C.line });
        s.text(`${i + 1}. ${sc.t}`, x + 9, y + 8, { size: 7, weight: 800, color: C.navy });
        s.para(sc.d, x + 9, y + 21, sw - 18, { size: 5.9, color: C.ink2, lh: 1.3 });
      });
      y += 54;
      y = blockTitle(s, y, '페이지 지도', '필요한 페이지만 펼쳐도 됩니다');
      y = s.table(s.ML, y, s.CW, ['페이지', '내용', '소요'], PLAN_FRONT.pageMap.map((r) => [
        { text: r[0], weight: 800, color: C.blue }, r[1], { text: r[2], color: C.muted }
      ]), { widths: [62, 360, 93], size: 6.2, rowH: 13.5, align: ['left', 'left', 'center'] });
      foot(s, 1, '표지');
    });

    /* 02 프로파일 */
    P.push(function (s) {
      let y = head(s, 2, 'CUSTOMER PROFILE', '고객 프로파일', '상담 전에 이 페이지만 다시 읽으면 고객의 현재 위치가 잡힙니다.');
      const left = (s.CW - 12) / 2;
      s.rect(s.ML, y, left, 150, { fill: '#fff', r: 6, stroke: C.line });
      s.text('기본 정보', s.ML + 12, y + 9, { size: 7.6, weight: 800, color: C.navy });
      const kv = [
        ['고객명', m.client.name],
        ['생년월일', m.client.birth || '미입력'],
        ['보험나이', m.client.insuranceAge != null ? `${m.client.insuranceAge}세` : `${m.state.age}대 (입력값)`],
        ['상령일', m.client.ageDay ? `${m.client.ageDay.label} · D-${m.client.ageDay.days}` : '생년월일 입력 시 계산'],
        ['성별 · 직업', `${m.state.gender} · ${m.state.job}급`],
        ['실손', m.state.silson === 'none' ? '없음' : `${m.state.silson}세대`],
        ['월 보험료', `${won(m.premium)}만원 (연 ${won(m.annual)}만원)`],
        ['계약 건수', m.contracts.length ? `${m.contracts.length}건 / ${won(m.contractTotal)}만원` : '미입력']
      ];
      let cy = y + 22;
      kv.forEach((r) => {
        s.text(r[0], s.ML + 12, cy, { size: 6.4, weight: 500, color: C.muted });
        s.text(r[1], s.ML + left - 12, cy, { size: 6.8, weight: 700, color: C.navy, align: 'right' });
        s.line(s.ML + 12, cy + 10, s.ML + left - 12, cy + 10, { color: C.line2 });
        cy += 15;
      });

      const rx = s.ML + left + 12;
      s.rect(rx, y, left, 150, { fill: '#3A2628', r: 6 });
      s.text('진단 요약', rx + 12, y + 9, { size: 7.6, weight: 800, color: '#E7CDC9' });
      s.text(`${m.letter}`, rx + 12, y + 22, { size: 30, weight: 800, color: '#fff' });
      s.text(`${m.score}점 · ${m.grade.label}`, rx + 58, y + 36, { size: 8.4, weight: 700, color: '#8FF0DC' });
      s.text('보완 필요', rx + 12, y + 62, { size: 6.2, weight: 700, color: '#E7CDC9' });
      s.para(gapLine(m), rx + 12, y + 71, left - 24, { size: 6.8, color: '#fff', lh: 1.4 });
      s.text('오늘의 목표', rx + 12, y + 106, { size: 6.2, weight: 700, color: '#E7CDC9' });
      s.para(m.first ? `${m.first.item.name} 한 칸을 결정하고, 다음 약속 날짜를 받는다.` : '금액 조정과 갱신 대비를 정리한다.', rx + 12, y + 115, left - 24, { size: 7, weight: 600, color: '#fff', lh: 1.4 });
      y += 162;

      /* v4: 가족력 · 고지 판정 */
      const halfW = (s.CW - 8) / 2;
      s.rect(s.ML, y, halfW, 54, { fill: '#fff', r: 5, stroke: C.line });
      s.text('가족력', s.ML + 10, y + 7, { size: 6.2, weight: 700, color: C.muted });
      s.text(m.family.length ? m.familyLabels.join(' · ') : '미입력', s.ML + 10, y + 16, { size: 9.4, weight: 800, color: m.family.length ? C.navy : C.muted });
      s.para(m.familyNotes.length ? m.familyNotes.map((f) => f.title).join(' · ') + ' — 해당 담보를 우선 점검합니다.' : '가족력을 입력하면 같은 위험의 담보를 먼저 확인합니다.', s.ML + 10, y + 30, halfW - 20, { size: 5.7, color: C.ink2, lh: 1.3 });
      const ddx = s.ML + halfW + 8;
      s.rect(ddx, y, halfW, 54, { fill: m.disclosure.tone === 'ok' ? '#F1FAF7' : m.disclosure.tone === 'gap' ? '#FDF2F1' : '#FDF7EC', r: 5, stroke: C.line });
      s.text('고지 판정 (3개월·1년·5년)', ddx + 10, y + 7, { size: 6.2, weight: 700, color: C.muted });
      s.text(m.disclosure.label, ddx + 10, y + 16, { size: 9.4, weight: 800, color: m.disclosure.tone === 'ok' ? C.mint : m.disclosure.tone === 'gap' ? C.red : C.orange });
      s.para(m.disclosure.reasons.length ? m.disclosure.reasons.join(' · ') : '체크된 항목 없음 — 표준체 우선', ddx + 10, y + 30, halfW - 20, { size: 5.7, color: C.ink2, lh: 1.3 });
      y += 64;

      y = secLabel(s, y, '보유 계약');
      y = contractTable(s, m, y, { max: 7 });
      y += 10;
      y = s.sectionHead(s.ML, y, s.CW, null, '상담 전 3분 준비', null);
      y = s.checks(s.ML, y, s.CW, [
        '증권에서 담보명·코드·가입일·갱신일을 확인했다',
        '고객이 최근 5년 안에 입원·수술·진단 이력이 있는지 물어볼 준비가 됐다',
        '가족(배우자·자녀) 동석 여부를 확인했다',
        '오늘 결정할 수 있는 범위와 아닌 범위를 구분해 두었다'
      ], { size: 7.2, rowH: 14.5 });
      y = blockTitle(s, y + 6, '상담 전에 예상해 둘 쟁점', '첫 반론을 미리 준비합니다');
      PLAN_FRONT.issues.forEach((it) => {
        s.rect(s.ML, y, s.CW, 26, { fill: '#fff', r: 4, stroke: C.line });
        s.text(it.t, s.ML + 9, y + 6, { size: 6.8, weight: 800, color: C.navy });
        s.para(it.d, s.ML + 120, y + 5.5, s.CW - 128, { size: 6, color: C.ink2, lh: 1.3 });
        y += 29;
      });
      y += 2;
      y = noteStrip(s, y, m.client.ageDay ? `상령일이 ${m.client.ageDay.label} (D-${m.client.ageDay.days})입니다. 이 날이 지나면 보험나이가 한 살 올라가 같은 보장도 보험료가 달라질 수 있습니다.` : '생년월일을 입력하면 상령일 D-day가 자동 계산되어 이 자리에 표시됩니다.', { size: 6.6 });
      foot(s, 2, '프로파일');
    });

    /* 03 오프닝 */
    P.push(function (s) {
      let y = head(s, 3, 'OPENING · 3분', '오프닝 — 첫 3분이 상담의 절반', '팔지 않는다는 신호를 먼저 줘야 고객이 방어를 내려놓습니다. 순서대로 읽으세요.');
      y = todoStrip(s, y, '첫 3분의 목표: ① 팔려는 사람이 아니라는 신뢰 ② 시간 약속 ③ 화면을 봐도 된다는 허락. 이 세 가지가 없으면 뒤에서 무슨 말을 해도 들리지 않습니다.');
      y += 10;
      PLAN_OPEN.greeting.forEach((g, i) => {
        y = s.script(s.ML, y, s.CW, { title: g.title, text: g.text.replace(/\{name\}/g, m.client.name), accent: C.blue });
        y += 7;
      });
      y += 2;
      y = s.sectionHead(s.ML, y, s.CW, null, '아이스브레이킹 3종 — 하나만 고르세요', '고객 성향에 따라 선택');
      const cw = (s.CW - 16) / 3;
      PLAN_OPEN.icebreakers.forEach((ic, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 74, { fill: '#fff', r: 5, stroke: C.line });
        s.text(ic.title, x + 9, y + 8, { size: 7.4, weight: 800, color: C.navy });
        s.para(ic.text, x + 9, y + 21, cw - 18, { size: 6.2, color: C.ink2, lh: 1.4 });
      });
      y += 84;
      y = s.sectionHead(s.ML, y, s.CW, null, '첫 3분 체크', null);
      y = s.checks(s.ML, y, s.CW, [
        '고객 이름을 두 번 이상 불렀다',
        '"오늘 결정 안 하셔도 된다"는 말을 내가 먼저 했다',
        '개인정보가 기기 안에서만 계산된다는 것을 설명했다',
        '고객이 오늘 상담 목적을 자기 말로 한 번 말했다'
      ], { size: 7.2, rowH: 14.5 });
      y = noteStrip(s, y + 4, '고객이 "그냥 괜찮아요"라고 하면 상담을 밀지 않습니다. "그럼 오늘은 지금 보장이 어디까지 되어 있는지만 확인하고 끝내겠습니다"로 낮춰 잡으면 대화가 이어집니다.', { size: 6.6 });
      foot(s, 3, '오프닝');
    });

    /* 04 전체 판독 */
    P.push(function (s) {
      let y = head(s, 4, 'READING · 8분', '전체 보장 판독', '숫자 하나 → 도넛 → 5대 카드 순서로 보여줍니다. 세부 표부터 펼치지 않습니다.');
      const dn = m.counts;
      s.rect(s.ML, y, 176, 118, { fill: '#fff', r: 6, stroke: C.line });
      s.donut(s.ML + 56, y + 62, 38, [
        { value: dn.enough, color: C.mint }, { value: dn.check, color: C.orange },
        { value: dn.short, color: '#E05B52' }, { value: dn.none, color: C.gray }
      ], { inner: 24, centerValue: m.score, centerLabel: '점수', centerSize: 16 });
      [['충분', C.mint, dn.enough], ['점검', C.orange, dn.check], ['부족', '#E05B52', dn.short], ['없음', C.gray, dn.none]].forEach((l, i) => {
        const ly = y + 34 + i * 14;
        s.rect(s.ML + 104, ly + 1, 6, 6, { fill: l[1], r: 3 });
        s.text(l[0], s.ML + 115, ly - 1, { size: 6.4, weight: 600, color: C.ink2 });
        s.text(`${l[2]}`, s.ML + 164, ly - 1, { size: 6.6, weight: 800, color: C.navy, align: 'right' });
      });
      const rx = s.ML + 188, rw = s.CW - 188;
      s.rect(rx, y, rw, 118, { fill: '#3A2628', r: 6 });
      s.text('한 문장으로 말하면', rx + 12, y + 10, { size: 6.2, weight: 700, color: '#E7CDC9' });
      s.para(`${m.client.name}님은 지금 ${m.letter} 등급이고, ${m.first ? `${m.first.item.rank}순위 ${m.first.item.name}이 ${m.first.pct}%로 가장 비어 있습니다.` : '5대 담보가 모두 기준선을 넘었습니다.'} 나머지는 유지하면서 이 한 칸부터 채우면 됩니다.`, rx + 12, y + 22, rw - 24, { size: 9, weight: 600, color: '#fff', lh: 1.5 });
      s.text(`${m.needList.length}개 항목 보완 필요 · 월 ${won(m.premium)}만원`, rx + 12, y + 96, { size: 6.6, weight: 600, color: '#8FF0DC' });
      y += 130;

      y = s.sectionHead(s.ML, y, s.CW, '01', '5대 판정 — 고객에게 이 순서로', null);
      y = priorityTable(s, m, y + 2, { rowH: 25 });
      y = s.sectionHead(s.ML, y + 12, s.CW, '02', '보여주는 순서 4단계', null);
      const cw = (s.CW - 8 * 3) / 4;
      PLAN_OPEN.presentOrder.forEach((p, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 74, { fill: '#F7FAFE', r: 5, stroke: C.line });
        s.iconCircle(x + 14, y + 14, 7, { fill: C.blue, num: p.n, size: 5.8, color: '#fff' });
        s.text(p.t, x + 25, y + 9, { size: 7.4, weight: 800, color: C.navy });
        s.para(p.d, x + 8, y + 28, cw - 16, { size: 6.1, color: C.ink2, lh: 1.4 });
      });
      y += 82;
      y = noteStrip(s, y, '고객이 중간에 끼어들면 그 자리에서 멈춥니다. 끼어든 지점이 고객이 가장 신경 쓰는 지점이고, 그 이야기를 다 들은 뒤 다음 카드로 넘어가면 이탈하지 않습니다.', { size: 6.6 });
      foot(s, 4, '전체 판독');
    });

    /* 05 왜 이 순서 */
    P.push(function (s) {
      let y = head(s, 5, 'WHY THIS ORDER', '왜 암 · 뇌 · 심장 · 수술 · 간병 순서인가', '"왜 이 순서냐"는 질문에는 통계가 아니라 구조로 답합니다. 통계는 확인용으로만 씁니다.');
      const rows = [
        ['1 암', '사망원인 1위 24.8%, 5년 생존율 73.7%', '오래 사는 병이 되었고, 그래서 목돈과 치료비를 나눠야 합니다.', '통계청 2024 · 중앙암등록본부 2023'],
        ['2 뇌', '사망원인 4위 6.9%, 뇌경색이 뇌내출혈의 약 5.1배', '살아남아도 후유증이 길고, 가장 흔한 형태가 담보에서 빠지기 쉽습니다.', '통계청 2024 · 심뇌센터 2023'],
        ['3 심장', '사망원인 2위 9.4%', '협심증과 급성심근경색이 다른 담보라 범위를 확인해야 합니다.', '통계청 2024'],
        ['4 수술', '수술은 진단과 별개 사유', '진단 없이 수술하는 경우의 빈틈을 막는 보조 장치입니다.', '약관 분류표'],
        ['5 간병', '장기요양 인정자 123만 5,045명, 3~5등급·인지지원 87.4%', '매일 나가는 돈이고, 노후에 가장 오래 갑니다.', '건보공단 2025']
      ];
      y = s.table(s.ML, y + 2, s.CW, ['순위', '근거', '왜 이 순서인가', '출처'], rows.map((r) => [
        { text: r[0], weight: 800, color: C.navy }, { text: r[1], weight: 600 }, { text: r[2] }, { text: r[3], color: C.muted }
      ]), {
        widths: [42, 152, 214, 107], size: 6.3, rowHeight: () => 40, align: ['left', 'left', 'left', 'left']
      });
      y += 8;
      y = s.sectionHead(s.ML, y, s.CW, '01', '공감 멘트 — 통계를 말로 바꾸기', null);
      y = s.script(s.ML, y, s.CW, {
        title: '고객에게', text: '"왜 암부터 보나 하면, 암은 죽는 병이 아니라 오래 관리하는 병이 됐기 때문입니다. 치료가 끝난 뒤에도 5년 넘게 검진과 관리가 이어지고, 그동안 일을 못 하는 기간이 생깁니다. 그래서 진단비로 생활을 버티고, 치료비로 병원비를 버티는 두 칸이 필요합니다."'
      });
      y += 7;
      y = s.script(s.ML, y, s.CW, {
        title: '이어서', text: '"뇌는 살아남아도 후유증이 오래 갑니다. 그런데 가장 흔한 게 혈관이 막히는 뇌경색이고, 이건 뇌출혈 담보로는 안 나옵니다. 그래서 순서가 뇌가 두 번째입니다."', accent: C.navy2
      });
      y = blockTitle(s, y + 4, '순위별로 실제로 보는 것', '기억할 것은 통계가 아니라 구조입니다');
      y = s.table(s.ML, y, s.CW, ['순위', '핵심 구조', '실제로 확인하는 담보'], PLAN_FRONT.threeVs.map((r) => [
        { text: r[0], weight: 800, color: C.navy }, r[1], { text: r[2], color: C.blue, weight: 600 }
      ]), { widths: [46, 300, 169], size: 6.3, rowH: 15, align: ['left', 'left', 'left'] });
      y = noteStrip(s, y + 6, '통계를 먼저 내밀면 설득이 아니라 압박이 됩니다. 고객의 경험을 먼저 듣고, 그 경험을 통계로 확인해 주는 순서가 맞습니다.', { size: 6.6 });
      foot(s, 5, '우선순위 근거');
    });

    /* 06 보험료 다이어트 */
    P.push((s) => {
      let y = head(s, 6, 'PREMIUM DIET', '보험료 다이어트 점검표', '해지가 아니라 재배치입니다. 이 페이지에서 "추가 부담 없는 보완"의 근거를 만듭니다.');
      y = todoStrip(s, y, '목표: 고객이 지금 내는 보험료 안에서 비어 있는 칸을 채울 여지를 찾는 것. 찾지 못하면 그렇다고 말하고, 새 지출은 고객이 선택하게 합니다.');
      y += 10;
      PLAN_OPEN.premiumDiet.forEach((p, i) => {
        s.rect(s.ML, y, s.CW, 58, { fill: '#fff', r: 5, stroke: C.line });
        s.iconCircle(s.ML + 16, y + 16, 8, { fill: C.orangeSoft, num: i + 1, size: 7, color: C.orange });
        s.text(p.t, s.ML + 30, y + 9, { size: 8.2, weight: 800, color: C.navy });
        s.text(p.q, s.ML + 30, y + 22, { size: 6.4, weight: 600, color: C.blue });
        s.para(p.d, s.ML + 30, y + 32, s.CW - 40, { size: 6.2, color: C.ink2, lh: 1.35 });
        y += 62;
      });
      y = s.sectionHead(s.ML, y + 2, s.CW, '01', '이 고객의 점검 포인트', '입력값에서 자동 추출');
      const cps = m.checkpoints.slice(0, 4);
      const cw = (s.CW - 8) / 2;
      cps.forEach((c, i) => {
        const x = s.ML + (i % 2) * (cw + 8), cy = y + Math.floor(i / 2) * 52;
        s.rect(x, cy, cw, 46, { fill: '#fff', r: 4, stroke: C.line });
        s.rect(x, cy, 2.4, 46, { fill: TONE_COLOR[c.level] || C.blue, r: 1.2 });
        s.text(c.title, x + 9, cy + 6, { size: 7, weight: 800, color: C.navy });
        s.para(c.body, x + 9, cy + 18, cw - 18, { size: 5.8, color: C.ink2, lh: 1.3 });
      });
      y += 52 * Math.ceil(cps.length / 2) + 6;
      y = blockTitle(s, y + 2, '배서 전에 확인할 4가지', '정리해서 확보한 돈의 용도를 먼저 정합니다');
      y = s.checks(s.ML, y, s.CW, PLAN_FRONT.endorsement, { size: 7, rowH: 14.5 });
      y = noteStrip(s, y + 4, '해지는 마지막 수단입니다. 지금 가진 핵심 담보는 나이와 병력 때문에 같은 조건으로 다시 들 수 없습니다. "해지"라는 단어는 고객이 먼저 꺼낼 때만 사용합니다.', { size: 6.6, fill: '#FFF7F3', stroke: '#F7DDD2', accent: C.orange });
      foot(s, 6, '보험료 점검');
    });

    /* 07~11 암 */
    const pb = PLAYBOOK.cancer;
    P.push((s) => {
      let y = head(s, 7, 'PLAN 1 · CANCER', '1순위 · 암 상담 플랜', `${pb.minutes} 배분. 판독 결과를 먼저 말하고, 고객의 경험을 들은 뒤 치료비 이야기로 넘어갑니다.`);
      y = todoStrip(s, y, `이 페이지에서 할 일 — ${m.client.name}님의 암 보장을 1분 안에 판독해 전달하고, "왜 진단비와 치료비를 나눠야 하는지"까지 도달합니다.`);
      y += 10;
      const cr = m.rows[0];
      const cw = (s.CW - 8 * 3) / 4;
      const tP = PK(cr, 'treatment');
      const tS = tP.subs || [];
      const tN = tS.filter((x) => x.val > 0).length;
      [
        ['일반암', `${won(m.state.cov.cancer.general)}만원`, `권장 ${won(PK(cr, 'general').rec)}만원`, PK(cr, 'general').fill],
        ['유사암', m.state.cov.cancer.similar ? `${won(m.state.cov.cancer.similar)}만원` : '없음', `권장 ${won(PK(cr, 'similar').rec)}만원`, PK(cr, 'similar').fill],
        ['치료비 5종', `${won(tP.val)}만원 (${tN}/5)`, `권장 ${won(tP.rec)}만원`, tP.fill],
        ['재진단', m.state.cov.cancer.recur ? '보유' : '없음', '권장 보유', m.state.cov.cancer.recur ? 1 : 0]
      ].forEach((c, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 56, { fill: '#fff', r: 5, stroke: C.line });
        s.text(c[0], x + 9, y + 8, { size: 6.2, weight: 600, color: C.muted });
        s.text(c[1], x + 9, y + 18, { size: 12, weight: 800, color: c[3] >= 0.99 ? C.mint : c[3] > 0 ? C.orange : C.red });
        s.text(c[2], x + 9, y + 34, { size: 5.8, weight: 500, color: C.muted });
        s.gauge(x + 9, y + 46, cw - 18, c[3], { color: c[3] >= 0.99 ? C.mint : c[3] > 0 ? C.orange : C.gray, h: 4.5 });
      });
      y += 66;
      y = secLabel(s, y, '60초 판독 멘트 (그대로 읽어도 됩니다)');
      y = s.script(s.ML, y, s.CW, { title: '판독', text: `"${m.client.name}님은 일반암 진단비가 ${won(m.state.cov.cancer.general)}만원입니다. 기준으로 보면 ${Math.round(PK(cr, 'general').fill * 100)}% 수준이고, ${m.state.cov.cancer.similar ? `유사암은 ${won(m.state.cov.cancer.similar)}만원으로` : '유사암 담보는 없어서 갑상선암 같은 경우 0원이 될 수 있고,'} ${tN >= 5 ? `치료비는 5종이 모두 채워져 합계 ${won(tP.val)}만원입니다` : `치료비는 5종 중 ${tN}종만 채워져 합계 ${won(tP.val)}만원입니다`}. 제가 보기엔 ${cr.gaps.length ? `${cr.gaps[0].label}가 가장 먼저 손댈 곳입니다` : '금액은 충분하니 재진단 조건을 확인할 차례입니다'}."` });
      y += 6;
      y = s.bullets(s.ML, y, s.CW, [`치료비 5종 세부 — ${tS.map((x) => `${x.label} ${x.val ? won(x.val) + '만원' : '없음'}`).join(' · ')} (권장 ${won(tP.rec)}만원)`], { size: 6.6 });
      y += 8;
      y = secLabel(s, y, '왜 이렇게 말하는가');
      y = s.bullets(s.ML, y, s.CW, [
        pb.why,
        '숫자를 먼저 말하면 고객은 방어적으로 듣습니다. "지금 얼마인지"를 먼저 말하고 "권장 기준"을 뒤에 두면 같은 숫자도 판단으로 들립니다.',
        '부족분을 말할 때는 총액이 아니라 한 항목만 짚습니다. 한 번에 세 개를 고치라고 하면 아무것도 결정되지 않습니다.'
      ], { size: 7, gap: 3 });
      y = noteStrip(s, y + 6, `오늘의 결정 목표: ${cr.gaps.length ? `${cr.gaps[0].label} ${won(cr.gaps[0].need)}만원 부족분을 채울지 결정` : '재진단·유사암 조건 확인 후 유지 결정'}`, { size: 6.8, fill: '#FFF9EE', stroke: '#F3E4C6', accent: C.orange });
      y = typeCards(s, y + 10, PLAN_EXTRA.cancer.types);
      y = questionCard(s, y, PLAYBOOK.cancer.questions[0], '이 페이지에서 쓸 질문 하나');
      foot(s, 7, '1순위 암 · 판독');
    });

    P.push((s) => {
      let y = head(s, 8, 'PLAN 1 · CANCER', '암 — 질문 설계와 설명 화법', '질문 5개 중 3개만 써도 충분합니다. 고객이 많이 말할수록 결정은 빨라집니다.');
      let n = 0;
      pb.questions.forEach((q) => {
        n += 1;
        s.rect(s.ML, y, s.CW, 44, { fill: '#fff', r: 5, stroke: C.line });
        s.iconCircle(s.ML + 15, y + 14, 7, { fill: C.sky, num: n, size: 6.6, color: C.blue });
        s.text(q.q, s.ML + 28, y + 8, { size: 8, weight: 700, color: C.navy });
        s.text(`의도 — ${q.why}`, s.ML + 28, y + 21, { size: 6, weight: 500, color: C.ink2 });
        s.text(`기대 반응 — ${q.expect}`, s.ML + 28, y + 31, { size: 6, weight: 500, color: C.muted });
        y += 48;
      });
      y += 4;
      y = s.sectionHead(s.ML, y, s.CW, null, '설명 화법 3종 — 비유로 바꾸기', null);
      pb.talk.forEach((t, i) => {
        y = s.script(s.ML, y, s.CW, { title: i === 0 ? '소득 보전' : i === 1 ? '유사암' : '치료비', text: `"${t}"`, accent: [C.blue, C.navy2, C.mint][i] });
        y += 6;
      });
      y = noteStrip(s, y + 2, '화법은 외우는 문장이 아니라 확인하는 문장입니다. 고객이 고개를 끄덕이지 않으면 같은 말을 반복하지 말고, 다른 비유로 바꿉니다.', { size: 6.6 });
      y = noSay(s, y + 8, PLAN_EXTRA.cancer.noSay);
      foot(s, 8, '1순위 암 · 질문·화법');
    });

    P.push((s) => {
      let y = head(s, 9, 'PLAN 1 · CANCER', '암 — 증권 함정 6가지', '증권을 펼쳐놓고 이 여섯 줄만 확인하면 대부분의 구멍이 보입니다.');
      y = todoStrip(s, y, '이 페이지는 고객에게 다 보여주지 않습니다. 설계사가 확인하고, 해당되는 항목만 골라一句话로 설명합니다.');
      y += 10;
      pb.traps.forEach((t, i) => {
        s.rect(s.ML, y, s.CW, 62, { fill: i % 2 ? C.sky2 : '#fff', r: 4, stroke: C.line });
        s.iconCircle(s.ML + 15, y + 15, 7, { fill: i < 2 ? C.redSoft : C.orangeSoft, num: i + 1, size: 6.6, color: i < 2 ? C.red : C.orange });
        s.text(t.title, s.ML + 28, y + 8, { size: 8, weight: 800, color: C.navy });
        s.text(`확인 — ${t.watch}`, s.ML + 28, y + 21, { size: 6.1, weight: 500, color: C.ink2 });
        s.text(`말 — ${t.script.replace(/^"|"$/g, '')}`, s.ML + 28, y + 33, s.CW - 40, { size: 6.1, weight: 500, color: C.blue });
        y += 64;
      });
      y = noteStrip(s, y, '함정을 "문제"라고 부르면 고객은 자기 잘못으로 느낍니다. "지금 상품이 그렇게 설계된 것"이라고 말하면 방어하지 않습니다.', { size: 6.6 });
      y = docOrder(s, y + 6, PLAN_EXTRA.cancer.docOrder);
      foot(s, 9, '1순위 암 · 함정');
    });

    P.push((s) => {
      let y = head(s, 10, 'PLAN 1 · CANCER', '암 — 설계 권장안 3단계', '예산에 따라 세 단계로 나눠 제시합니다. 고객이 고르게 하는 것이 핵심입니다.');
      const rec = m.rows[0].baseRec;
      const treatTotal = BK.treatRecs(rec).reduce((a, x) => a + x, 0);
      const round = (v, u) => Math.max(u, Math.round(v / u) * u);
      const mk = (f) => ({
        g: round(rec * f, 100), s: round(rec * f * 0.2, 100), t: round(treatTotal * f, 500)
      });
      const tiers = [
        { name: '최소 (지금 예산)', f: 0.6, note: '1순위 한 칸만 채우는 안. 유사암·치료비는 최소선.' },
        { name: '표준 (권장 기준)', f: 1, note: '일반암·유사암·치료비 5종·재진단을 모두 기준선에 맞추는 안.' },
        { name: '확대 (여유 있을 때)', f: 1.5, note: '가족력·직업 위험이 큰 경우. 일반암을 두껍게.' }
      ];
      tiers.forEach((t, i) => {
        const d = mk(t.f);
        const x = s.ML + i * ((s.CW - 16) / 3 + 8);
        const w = (s.CW - 16) / 3;
        s.rect(x, y, w, 128, { fill: i === 1 ? '#FDF5F4' : '#fff', r: 6, stroke: i === 1 ? C.blue : C.line });
        if (i === 1) s.rect(x, y, w, 3, { fill: C.blue, r: 1.5 });
        s.text(t.name, x + 10, y + 10, { size: 8, weight: 800, color: C.navy });
        s.text(`일반암 ${won(d.g)}만원`, x + 10, y + 24, { size: 10, weight: 800, color: C.blue });
        s.text(`유사암 ${won(d.s)}만원`, x + 10, y + 40, { size: 6.6, weight: 600, color: C.ink2 });
        s.text(`치료비 5종 합계 ${won(d.t)}만원`, x + 10, y + 50, { size: 6.6, weight: 600, color: C.ink2 });
        s.text(`재진단 ${i === 0 ? '선택' : '포함'}`, x + 10, y + 60, { size: 6.6, weight: 600, color: C.ink2 });
        s.para(t.note, x + 10, y + 74, w - 20, { size: 5.9, color: C.muted, lh: 1.35 });
        y = y;
      });
      y += 138;
      y = s.script(s.ML, y, s.CW, { title: '제안 멘트', text: `"세 가지로 계산해 봤습니다. 예산을 지키면서 가장 비어 있는 한 칸만 채우는 안, 기준선까지 맞추는 안, 가족력까지 생각해 두껍게 가는 안입니다. 오늘은 첫 번째부터 시작하셔도 되고, 두 번째를 한 번에 가셔도 됩니다. 어느 쪽이 편하세요?"` });
      y += 8;
      y = s.sectionHead(s.ML, y, s.CW, null, '설계 시 확인', null);
      y = s.checks(s.ML, y, s.CW, [
        '같은 보장을 중복으로 두 번 넣지 않았는가 (기존 증권과 겹치는 특약)',
        '갱신형으로 넣으면 갱신 보험료를 표로 보여줬는가',
        '1회한·감액·면책 조건을 말로 설명했는가',
        '가입 나이·상령일 기준으로 보험료가 달라지는 시점을 확인했는가'
      ], { size: 7, rowH: 14 });
      y = afterBlock(s, y + 6, PLAN_EXTRA.cancer.after);
      y = blockTitle(s, y + 4, '예산 조정 3원칙', '금액은 고객이 고릅니다');
      y = s.bullets(s.ML, y, s.CW, [
        '한 번에 두 칸을 올리지 않습니다. 1순위 한 칸, 그다음 상담에서 한 칸.',
        '금액을 낮추는 대신 지급 조건(1회한·재진단·치료비)을 확인해 실질 보장을 지킵니다.',
        '보험료 총액이 아니라 "지금 쓰는 돈 안에서의 재배치"로 말합니다.'
      ], { size: 6.9, gap: 2.5 });
      foot(s, 10, '1순위 암 · 설계');
    });

    P.push((s) => {
      let y = head(s, 11, 'PLAN 1 · CANCER', '암 — 예상 반론 3종', '반론은 막는 것이 아니라 꺼내게 하는 것입니다. 먼저 꺼내면 대화가 됩니다.');
      pb.objections.forEach((o, i) => {
        s.rect(s.ML, y, s.CW, 22, { fill: '#3A2628', r: 4 });
        s.text(o.trigger, s.ML + 12, y + 5, { size: 8.4, weight: 800, color: '#fff' });
        y += 26;
        [['공감', o.empathy, C.mint], ['환기', o.awaken, C.orange], ['대안', o.alternative, C.blue]].forEach((st) => {
          s.rect(s.ML, y, s.CW, 34, { fill: '#fff', r: 3, stroke: C.line });
          s.rect(s.ML, y, 34, 34, { fill: st[2], r: 3 });
          s.text(st[0], s.ML + 17, y + 12, { size: 6.4, weight: 800, color: '#fff', align: 'center' });
          s.para(st[1], s.ML + 42, y + 6, s.CW - 50, { size: 6.6, color: C.ink2, lh: 1.35 });
          y += 37;
        });
        y += 5;
      });
      y = noteStrip(s, y + 2, '반론이 세 번 반복되면 오늘은 여기서 멈춥니다. "오늘은 여기까지 정리해서 보내드리겠습니다"가 다음 통화를 만듭니다.', { size: 6.6 });
      y = afterBlock(s, y + 4, PLAN_EXTRA.cancer.after, '반론을 넘긴 직후 3분');
      foot(s, 11, '1순위 암 · 반론');
    });

    /* 12~15 뇌 */
    const bn = PLAYBOOK.brain;
    P.push((s) => {
      let y = head(s, 12, 'PLAN 2 · BRAIN', '2순위 · 뇌 상담 플랜', `${bn.minutes} 배분. "무엇으로 담았는가"만 확인하면 상담이 바로 설득으로 바뀝니다.`);
      y = todoStrip(s, y, `이 페이지에서 할 일 — ${m.client.name}님의 뇌 담보가 어느 범위인지 확인하고, 뇌경색 공백 여부를 판정합니다.`);
      y += 10;
      const br = m.rows[1];
      const bdxA = PK(br, 'dx').dx || {};
      const bCore = bdxA.core || { val: 0, label: '뇌혈관질환 진단비' };
      s.rect(s.ML, y, s.CW, 70, { fill: '#FDF9F8', r: 6, stroke: C.line });
      s.text('핵심 범위 · 뇌혈관질환', s.ML + 12, y + 9, { size: 6.2, weight: 600, color: C.muted });
      s.text(`${won(bCore.val)}만원`, s.ML + 12, y + 18, { size: 15, weight: 800, color: bCore.val >= 2000 ? C.mint : C.red });
      s.text(`뇌졸중 ${won((bdxA.subs[1] || {}).val || 0)} · 뇌출혈 ${won((bdxA.subs[2] || {}).val || 0)}만원`, s.ML + 12, y + 38, { size: 6.4, weight: 600, color: C.ink2 });
      s.text('주요치료비 3종', s.ML + 150, y + 9, { size: 6.2, weight: 600, color: C.muted });
      s.text(`${subHave(PK(br, 'treat'))}/3종`, s.ML + 150, y + 18, { size: 13, weight: 800, color: PK(br, 'treat').val > 0 ? C.mint : C.red });
      s.text(`혈전용해제·수술·중환자실 ${won(PK(br, 'treat').val)}만원`, s.ML + 150, y + 38, { size: 6.2, weight: 600, color: C.ink2 });
      s.text('진단 시 합산', s.W - s.MR - 150, y + 9, { size: 6.2, weight: 600, color: C.muted });
      s.text('뇌경색(I63) ' + won((bdxA.scenarios && bdxA.scenarios[0] ? bdxA.scenarios[0].sum : 0)) + '만원', s.W - s.MR - 150, y + 19, { size: 7.4, weight: 800, color: C.navy });
      s.text('뇌출혈(I61) ' + won((bdxA.scenarios && bdxA.scenarios[1] ? bdxA.scenarios[1].sum : 0)) + '만원', s.W - s.MR - 150, y + 30, { size: 7.4, weight: 800, color: C.navy });
      s.para('뇌경색은 뇌출혈 담보에서 0원입니다.', s.W - s.MR - 150, y + 46, 140, { size: 5.8, color: C.red, lh: 1.3 });
      y += 80;
      y = secLabel(s, y, '판독 멘트');
      y = s.script(s.ML, y, s.CW, { title: '판독', text: `"${m.client.name}님 뇌 담보는 뇌혈관질환 ${won(bCore.val)}만원, 뇌졸중 ${won((bdxA.subs[1] || {}).val || 0)}만원, 뇌출혈 ${won((bdxA.subs[2] || {}).val || 0)}만원입니다. ${bCore.val > 0 ? '가장 넓은 범위가 살아 있어서 뇌경색은 뇌혈관과 뇌졸중이 합산됩니다.' : '넓은 범위가 비어 있어서, 가장 흔한 뇌경색은 뇌졸중 금액만 받고 후유증은 지급되지 않습니다.'} 주요치료비는 3종 중 ${subHave(PK(br, 'treat'))}종이 채워져 있습니다."` });
      y += 8;
      y = s.sectionHead(s.ML, y, s.CW, '01', '근거 통계 — 이 세 줄이면 충분합니다', '출처: 중앙심뇌혈관질환센터·건강보험통계 2023 · 통계청 2024');
      bn.facts.forEach((f) => { y = s.bullets(s.ML, y, s.CW, [f], { size: 7, gap: 2 }); });
      y += 6;
      y = s.sectionHead(s.ML, y, s.CW, '02', '오늘의 목표', null);
      y = s.checks(s.ML, y, s.CW, [
        bCore.val >= 2000 ? '보유 범위 유지 + 수술·치료비 보완 여부 결정' : '뇌혈관질환 2,000만원 보완 여부 결정',
        '뇌경색(I63)이 현재 담보에 포함되는지 고객에게 확인시켜 주기',
        '후유장해 담보 유무 확인 (다음 상담 과제로 넘겨도 됨)'
      ], { size: 7, rowH: 14.5 });
      y = typeCards(s, y + 10, PLAN_EXTRA.brain.types);
      y = questionCard(s, y, PLAYBOOK.brain.questions[1], '이 페이지에서 쓸 질문 하나');
      foot(s, 12, '2순위 뇌 · 판독');
    });

    P.push((s) => {
      let y = head(s, 13, 'PLAN 2 · BRAIN', '뇌 — 질문과 설득 대본', '뇌는 겁을 주면 방어가 생기고, 구조를 보여주면 이해가 생깁니다.');
      let n = 0;
      bn.questions.forEach((q) => {
        n += 1;
        s.rect(s.ML, y, s.CW, 42, { fill: '#fff', r: 5, stroke: C.line });
        s.iconCircle(s.ML + 15, y + 13, 7, { fill: C.sky, num: n, size: 6.6, color: C.blue });
        s.text(q.q, s.ML + 28, y + 7, { size: 8, weight: 700, color: C.navy });
        s.text(`의도 — ${q.why}`, s.ML + 28, y + 20, { size: 6, color: C.ink2 });
        s.text(`기대 — ${q.expect}`, s.ML + 28, y + 30, { size: 6, color: C.muted });
        y += 46;
      });
      y += 2;
      y = s.sectionHead(s.ML, y, s.CW, null, '배관 비유 설득 대본', null);
      y = s.script(s.ML, y, s.CW, { title: '1단계 — 구조', text: '"뇌는 배관이라고 생각하시면 됩니다. 하나는 파이프가 터지는 것, 하나는 파이프가 막히는 것입니다. 둘 다 뇌졸중인데 보험에서는 담보 이름이 다릅니다."' });
      y += 6;
      y = s.script(s.ML, y, s.CW, { title: '2단계 — 통계', text: '"막히는 쪽이 터지는 쪽보다 약 5.1배 많습니다. 그런데 지금 담보는 터지는 쪽만 담고 있습니다. 순서가 거꾸로 되어 있는 셈입니다."', accent: C.navy2 });
      y += 6;
      y = s.script(s.ML, y, s.CW, { title: '3단계 — 비용', text: '"뇌경색으로 입원하면 평균 62.7일, 1인당 진료비가 2,562만 원 수준입니다. 회복 기간까지 생각하면 진단비 하나로는 부족합니다."', accent: C.mint });
      y += 6;
      y = s.script(s.ML, y, s.CW, { title: '4단계 — 제안', text: '"기존 뇌출혈 담보는 그대로 두고, 뇌혈관질환 범위로 한 칸만 보완하시죠. 금액은 지금 내는 보험료 안에서 조정할 수 있는지 제가 확인해 보겠습니다."', accent: C.orange });
      y = noteStrip(s, y + 8, '"중풍"이라는 표현이 나오면 뇌경색일 가능성이 큽니다. 고객 가족의 진단명을 함부로 단정하지 말고, "어떤 이름으로 진단받으셨는지"만 확인합니다.', { size: 6.6 });
      y = noSay(s, y + 8, PLAN_EXTRA.brain.noSay);
      foot(s, 13, '2순위 뇌 · 화법');
    });

    P.push((s) => {
      let y = head(s, 14, 'PLAN 2 · BRAIN', '뇌 — 코드 판독과 함정', '증권의 담보명 뒤에 붙은 코드를 보는 습관이 상담의 신뢰를 만듭니다.');
      y = codeTable(s, s.ML, y, s.CW, PLAYBOOK_CODES('brain'));
      y += 10;
      bn.traps.forEach((t, i) => {
        s.rect(s.ML, y, s.CW, 40, { fill: i % 2 ? C.sky2 : '#fff', r: 4, stroke: C.line });
        s.text(`${i + 1}. ${t.title}`, s.ML + 10, y + 5, { size: 7.4, weight: 800, color: C.navy });
        s.text(`확인 — ${t.watch}`, s.ML + 10, y + 17, { size: 6, color: C.ink2 });
        s.text(`말 — ${t.script.replace(/^"|"$/g, '')}`, s.ML + 10, y + 27, { size: 6, color: C.blue });
        y += 42;
      });
      y = docOrder(s, y + 6, PLAN_EXTRA.brain.docOrder);
      foot(s, 14, '2순위 뇌 · 코드');
    });

    P.push((s) => {
      let y = head(s, 15, 'PLAN 2 · BRAIN', '뇌 — 설계 권장안과 반론', '범위를 먼저 맞추고, 금액은 예산 안에서 조정합니다.');
      const bd15 = PK(m.rows[1], 'dx').dx || {};
      const rows = [
        ['뇌혈관질환 진단비', `${won((bd15.core || {}).val || 0)}만원`, '권장 2,000만원 (I60~I69)', '가장 넓은 핵심 범위'],
        ['뇌졸중 진단비', `${won((bd15.subs && bd15.subs[1] ? bd15.subs[1].val : 0))}만원`, '권장 2,000만원 (I60~I63·I65~I66)', '뇌경색(I63) 포함'],
        ['뇌출혈 진단비', `${won((bd15.subs && bd15.subs[2] ? bd15.subs[2].val : 0))}만원`, '권장 1,000만원 (I60~I62)', '가장 좁은 범위 · 뇌경색 제외'],
        ['주요치료비 3종', `${subHave(PK(m.rows[1], 'treat'))}/3종`, '혈전용해제·수술·중환자실', '기계적 혈전제거술은 별도']
      ];
      y = s.table(s.ML, y, s.CW, ['항목', '현재', '권장 기준', '이유'], rows, { widths: [86, 108, 152, 169], size: 6.7, rowH: 20, align: ['left', 'center', 'left', 'left'] });
      y += 12;
      bn.objections.forEach((o, i) => {
        s.rect(s.ML, y, s.CW, 20, { fill: '#3A2628', r: 3 });
        s.text(o.trigger, s.ML + 10, y + 4, { size: 8, weight: 800, color: '#fff' });
        y += 23;
        s.para(`공감 — ${o.empathy}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.ink2, lh: 1.35 });
        y += 13;
        s.para(`환기 — ${o.awaken}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.ink2, lh: 1.35 });
        y += 17;
        s.para(`대안 — ${o.alternative}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.blue, lh: 1.35 });
        y += 19;
      });
      y = afterBlock(s, y + 8, PLAN_EXTRA.brain.after);
      foot(s, 15, '2순위 뇌 · 설계·반론');
    });

    /* 16~19 심장 */
    const ht = PLAYBOOK.heart;
    P.push((s) => {
      let y = head(s, 16, 'PLAN 3 · HEART', '3순위 · 심장 상담 플랜', `${ht.minutes} 배분. "협심증과 급성심근경색은 다른 담보"라는 한 문장이 핵심입니다.`);
      y = todoStrip(s, y, `이 페이지에서 할 일 — ${m.client.name}님 심장 담보의 코드 범위를 확인하고, 스텐트 시술이 보장되는지 판정합니다.`);
      y += 10;
      const hr = m.rows[2];
      s.rect(s.ML, y, s.CW, 68, { fill: '#FDF2F1', r: 6, stroke: '#F3DDD9' });
      const hdxA = PK(hr, 'dx').dx || {};
      const hCore = hdxA.core || { val: 0 };
      s.text('핵심 범위 · 허혈성심장', s.ML + 12, y + 9, { size: 6.2, weight: 600, color: C.muted });
      s.text(`${won(hCore.val)}만원`, s.ML + 12, y + 18, { size: 15, weight: 800, color: hCore.val >= 2000 ? C.mint : C.red });
      s.text(`급성심근경색 ${won((hdxA.subs && hdxA.subs[1] ? hdxA.subs[1].val : 0))}만원`, s.ML + 12, y + 38, { size: 6.4, weight: 600, color: C.ink2 });
      s.text('주요치료비 3종', s.ML + 150, y + 9, { size: 6.2, weight: 600, color: C.muted });
      s.text(`${subHave(PK(hr, 'treat'))}/3종`, s.ML + 150, y + 18, { size: 13, weight: 800, color: PK(hr, 'treat').val > 0 ? C.mint : C.red });
      s.text(`혈전용해제·수술·중환자실 ${won(PK(hr, 'treat').val)}만원`, s.ML + 150, y + 38, { size: 6.2, color: C.ink2 });
      s.text('권장', s.W - s.MR - 160, y + 9, { size: 6.2, weight: 600, color: C.muted });
      s.text('허혈성심장질환 I20~I25', s.W - s.MR - 160, y + 20, { size: 9, weight: 800, color: C.navy });
      s.text('급성심근경색 I21~I22 → 협심증 I20 포함', s.W - s.MR - 160, y + 34, { size: 5.8, color: C.muted });
      s.para('스텐트 시술은 협심증 단계에서 가장 많이 이뤄집니다.', s.W - s.MR - 160, y + 46, 150, { size: 5.8, color: C.red, lh: 1.3 });
      y += 78;
      y = s.script(s.ML, y, s.CW, { title: '판독', text: `"${m.client.name}님 심장 담보는 허혈성심장질환 ${won(hCore.val)}만원, 급성심근경색 ${won((hdxA.subs && hdxA.subs[1] ? hdxA.subs[1].val : 0))}만원입니다. 협심증은 혈관이 좁아진 단계, 급성심근경색은 막힌 단계입니다. ${hCore.val > 0 ? '허혈성 범위가 있어서 협심증과 급성심근경색이 합산됩니다.' : '급성심근경색만 담겨 있어서, 협심증에서 하는 스텐트 시술은 보장 밖입니다.'}"` });
      y += 8;
      y = s.sectionHead(s.ML, y, s.CW, '01', '근거', '출처: 통계청 2024 사망원인통계');
      ht.facts.forEach((f) => { y = s.bullets(s.ML, y, s.CW, [f], { size: 7, gap: 2 }); });
      y += 4;
      y = noteStrip(s, y, '심장질환은 사망원인 2위입니다. 하지만 고객이 실제로 겪는 건 "수술과 약값"입니다. 그래서 진단비만이 아니라 수술비·치료비를 함께 봅니다.', { size: 6.6 });
      y = typeCards(s, y + 10, PLAN_EXTRA.heart.types);
      y = questionCard(s, y, PLAYBOOK.heart.questions[2], '이 페이지에서 쓸 질문 하나');
      foot(s, 16, '3순위 심장 · 판독');
    });

    P.push((s) => {
      let y = head(s, 17, 'PLAN 3 · HEART', '심장 — 질문과 설득 대본', '가슴 답답함·스텐트 경험을 먼저 묻습니다. 대부분 주변에 사례가 있습니다.');
      let n = 0;
      ht.questions.forEach((q) => {
        n += 1;
        s.rect(s.ML, y, s.CW, 42, { fill: '#fff', r: 5, stroke: C.line });
        s.iconCircle(s.ML + 15, y + 13, 7, { fill: '#FDECEA', num: n, size: 6.6, color: C.red });
        s.text(q.q, s.ML + 28, y + 7, { size: 8, weight: 700, color: C.navy });
        s.text(`의도 — ${q.why}`, s.ML + 28, y + 20, { size: 6, color: C.ink2 });
        s.text(`기대 — ${q.expect}`, s.ML + 28, y + 30, { size: 6, color: C.muted });
        y += 46;
      });
      y += 2;
      y = s.sectionHead(s.ML, y, s.CW, null, '설득 대본 3단계', null);
      y = s.script(s.ML, y, s.CW, { title: '1단계 — 같은 심장, 다른 담보', text: '"협심증과 급성심근경색은 같은 심장 질환이지만 보험에서는 다른 담보입니다. 협심증은 혈관이 좁아진 단계, 급성심근경색은 막힌 단계입니다."' });
      y += 6;
      y = s.script(s.ML, y, s.CW, { title: '2단계 — 실제 시술', text: '"스텐트는 대부분 협심증 단계에서 넣습니다. 급성심근경색 담보만 있으면 그 시술은 보장 밖입니다. 그래서 범위를 허혈성심장질환으로 넓히는 겁니다."', accent: C.navy2 });
      y += 6;
      y = s.script(s.ML, y, s.CW, { title: '3단계 — 약값과 수술비', text: '"심장은 한 번 막히면 항혈전제를 오래 먹습니다. 진단비 하나만 있고 수술비가 없으면, 그 구간이 비어 있게 됩니다."', accent: C.mint });
      y += 6;
      y = noteStrip(s, y, '고객이 "우리 아버지가 스텐트 하셨다"고 하면 그 자리에서 코드를 확인합니다. 가족의 실제 진단명이 가장 강한 근거입니다.', { size: 6.6 });
      y = noSay(s, y + 8, PLAN_EXTRA.heart.noSay);
      foot(s, 17, '3순위 심장 · 화법');
    });

    P.push((s) => {
      let y = head(s, 18, 'PLAN 3 · HEART', '심장 — 코드 판독과 함정', '심장은 코드가 좁을수록 지급이 적습니다. 담보명보다 코드를 먼저 봅니다.');
      y = codeTable(s, s.ML, y, s.CW, PLAYBOOK_CODES('heart'));
      y += 10;
      ht.traps.forEach((t, i) => {
        s.rect(s.ML, y, s.CW, 46, { fill: i % 2 ? '#FDF2F1' : '#fff', r: 4, stroke: C.line });
        s.text(`${i + 1}. ${t.title}`, s.ML + 10, y + 5, { size: 7.4, weight: 800, color: C.navy });
        s.text(`확인 — ${t.watch}`, s.ML + 10, y + 17, { size: 6, color: C.ink2 });
        s.text(`말 — ${t.script.replace(/^"|"$/g, '')}`, s.ML + 10, y + 28, s.CW - 20, { size: 6, color: C.blue });
        y += 48;
      });
      y = s.table(s.ML, y + 4, s.CW, ['담보', '코드', '실제 지급 대상'], [
        ['급성심근경색', 'I21~I22', '급성·재발성 심근경색증만'],
        ['허혈성심장질환', 'I20~I25', '협심증·스텐트 시술까지 포함'],
        ['심장질환(상품별)', '부정맥·판막·심부전', '별도 담보가 있어야 지급']
      ], { widths: [120, 116, 279], size: 6.6, rowH: 17, align: ['left', 'center', 'left'] });
      y = docOrder(s, y + 6, PLAN_EXTRA.heart.docOrder);
      foot(s, 18, '3순위 심장 · 코드');
    });

    P.push((s) => {
      let y = head(s, 19, 'PLAN 3 · HEART', '심장 — 설계 권장안과 반론', '범위를 넓히는 것이 먼저, 금액은 그다음입니다.');
      const hd19 = PK(m.rows[2], 'dx').dx || {};
      const rows = [
        ['허혈성심장질환 진단비', `${won((hd19.core || {}).val || 0)}만원`, '권장 2,000만원 (I20~I25)', '협심증·스텐트 포함'],
        ['급성심근경색 진단비', `${won((hd19.subs && hd19.subs[1] ? hd19.subs[1].val : 0))}만원`, '권장 2,000만원 (I21~I23)', '협심증(I20) 제외'],
        ['심혈관 수술비', PK(m.rows[3], 'diseaseNdae').val > 0 ? '수술비 축 확인' : '없음', '보유 권장', '스텐트·우회로 수술'],
        ['부정맥·심부전', '—', '확인 필요', '별도 담보 영역']
      ];
      y = s.table(s.ML, y, s.CW, ['항목', '현재', '권장 기준', '이유'], rows, { widths: [86, 108, 152, 169], size: 6.7, rowH: 20, align: ['left', 'center', 'left', 'left'] });
      y += 12;
      ht.objections.forEach((o) => {
        s.rect(s.ML, y, s.CW, 20, { fill: '#7A1F1A', r: 3 });
        s.text(o.trigger, s.ML + 10, y + 4, { size: 8, weight: 800, color: '#fff' });
        y += 23;
        s.para(`공감 — ${o.empathy}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.ink2, lh: 1.35 }); y += 13;
        s.para(`환기 — ${o.awaken}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.ink2, lh: 1.35 }); y += 17;
        s.para(`대안 — ${o.alternative}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.blue, lh: 1.35 }); y += 19;
      });
      y = noteStrip(s, y + 2, '심장은 "지금은 괜찮다"는 말이 가장 많이 나오는 영역입니다. 괜찮다는 말을 부정하지 말고, 괜찮을 때 넣어야 한다는 쪽으로 돌립니다.', { size: 6.6 });
      y = afterBlock(s, y + 8, PLAN_EXTRA.heart.after);
      foot(s, 19, '3순위 심장 · 설계·반론');
    });

    /* 20~22 수술 */
    const sg = PLAYBOOK.surgery;
    P.push((s) => {
      let y = head(s, 20, 'PLAN 4 · SURGERY', '4순위 · 수술비 상담 플랜', `${sg.minutes} 배분. 질병 4축과 상해 2축을 그림으로 설명합니다.`);
      y = todoStrip(s, y, `이 페이지에서 할 일 — ${m.client.name}님 수술비가 질병 4축·상해 2축을 갖췄는지 확인하고, 빈 축을 채웁니다.`);
      y += 10;
      const sur = m.rows[3];
      const cw = (s.CW - 16) / 3;
      [
        ['질병수술비(일반)', `${won(m.state.cov.surgery.disease)}만원`, '수술 1회당 정액', PK(sur, 'disease').fill],
        ['질병 1~5종', `${won(m.state.cov.surgery.disease15)}만원`, '1종 기준액', PK(sur, 'disease15').fill],
        ['질병 N대', m.state.cov.surgery.diseaseNdae ? `${won(m.state.cov.surgery.diseaseNdae)}만원` : '없음', '질환 묶음별 한도', PK(sur, 'diseaseNdae').fill],
        ['비급여 질병 수술', m.state.cov.surgery.diseaseNonPay ? `${won(m.state.cov.surgery.diseaseNonPay)}만원` : '없음', '5세대 실손 보완', PK(sur, 'diseaseNonPay').fill],
        ['일반 상해수술', `${won(m.state.cov.surgery.injury)}만원`, '사고 수술 정액', PK(sur, 'injury').fill],
        ['상해 1~5종', `${won(m.state.cov.surgery.injury15)}만원`, '1종 기준액', PK(sur, 'injury15').fill]
      ].forEach((c, i) => {
        const x = s.ML + (i % 3) * (cw + 8);
        const yy = y + Math.floor(i / 3) * 64;
        s.rect(x, yy, cw, 58, { fill: '#fff', r: 5, stroke: C.line });
        s.text(c[0], x + 9, yy + 8, { size: 6.4, weight: 600, color: C.muted });
        s.text(c[1], x + 9, yy + 18, { size: 13, weight: 800, color: c[3] >= 0.99 ? C.mint : c[3] > 0 ? C.orange : C.red });
        s.text(c[2], x + 9, yy + 36, { size: 5.8, color: C.muted });
        s.gauge(x + 9, yy + 47, cw - 18, c[3], { color: c[3] >= 0.99 ? C.mint : c[3] > 0 ? C.orange : C.gray, h: 4.5 });
      });
      y += 136;
      s.rect(s.ML, y, s.CW, 96, { fill: '#F7FAFE', r: 6, stroke: C.line });
      s.text('두 축은 경쟁이 아니라 중복 청구 구조입니다', s.ML + 12, y + 9, { size: 8, weight: 800, color: C.navy });
      s.ctx.save();
      s.ctx.beginPath(); s.ctx.arc(s.ML + 82, y + 58, 30, 0, Math.PI * 2); s.ctx.fillStyle = '#DCE9F8'; s.ctx.fill();
      s.ctx.beginPath(); s.ctx.arc(s.ML + 126, y + 58, 30, 0, Math.PI * 2); s.ctx.fillStyle = '#FDECEA'; s.ctx.fill();
      s.ctx.restore();
      s.text('1~5종', s.ML + 64, y + 52, { size: 7.2, weight: 800, color: C.navy });
      s.text('수술비', s.ML + 64, y + 62, { size: 5.8, color: C.ink2 });
      s.text('N대', s.ML + 112, y + 52, { size: 7.2, weight: 800, color: C.red });
      s.text('수술비', s.ML + 112, y + 62, { size: 5.8, color: C.ink2 });
      s.text('중복', s.ML + 96, y + 54, { size: 6, weight: 800, color: C.blue });
      s.para('같은 수술에 두 담보가 각각 반응합니다. 어느 한쪽만 있으면 큰 수술에서 금액이 얇아집니다. 지급 여부와 중복 가능 범위는 상품 약관의 수술 분류표로 확인합니다.', s.ML + 176, y + 24, s.CW - 196, { size: 6.4, color: C.ink2, lh: 1.45 });
      y += 106;
      y = s.script(s.ML, y, s.CW, { title: '구조 설명', text: '"수술비는 두 축입니다. 1~5종은 수술의 침습도로 금액이 정해지고, N대는 질환별로 한도가 따로 있습니다. 그래서 같은 수술이라도 어느 담보에서 나오는지에 따라 받는 금액이 달라집니다."' });
      y = noteStrip(s, y + 8, '수술비는 "보조"입니다. 큰 그림은 진단비·치료비로 잡고, 수술비는 빈틈을 막는 용도로만 제안합니다. 이 순서를 지키면 고객이 "수술비를 또 들라고 한다"고 느끼지 않습니다.', { size: 6.6 });
      y = typeCards(s, y + 10, PLAN_EXTRA.surgery.types);
      y = questionCard(s, y, PLAYBOOK.surgery.questions[1], '이 페이지에서 쓸 질문 하나');
      foot(s, 20, '4순위 수술 · 구조');
    });

    P.push((s) => {
      let y = head(s, 21, 'PLAN 4 · SURGERY', '수술 — 현장에서 자주 보는 청구 유형', '구체적인 사례가 설명보다 빠릅니다. 수치는 상품별로 다르므로 유형만 말합니다.');
      y = s.table(s.ML, y, s.CW, ['수술 유형', '현장에서 보는 특징'], CLAIM_TYPES.map((c) => [
        { text: c.t, weight: 700, color: C.navy }, c.d
      ]), { widths: [112, 403], size: 6.8, rowHeight: () => 26, align: ['left', 'left'] });
      y += 12;
      y = s.sectionHead(s.ML, y, s.CW, null, '청구 서류 — 미리 알려주면 신뢰가 됩니다', null);
      y = s.bullets(s.ML, y, s.CW, [
        '수술확인서(수술명·수술일·수술방법) + 진단서가 기본입니다.',
        '수술명이 약관 분류표 문구와 일치해야 인정됩니다. 병원에 수술명을 정확히 적어달라고 요청하세요.',
        '당일 시술·외래 시술은 수술비 대상이 아닌 경우가 많습니다.',
        '청구 소멸시효는 3년입니다. 수술일 기준으로 관리합니다.'
      ], { size: 7, gap: 3 });
      y = s.sectionHead(s.ML, y + 4, s.CW, null, '고객에게 이렇게 말합니다', null);
      y = s.script(s.ML, y, s.CW, { title: '청구 안내', text: '"수술하시면 수술확인서와 진단서를 챙기시고 저에게 사진으로 보내주세요. 제가 분류표에 맞는지 먼저 확인하고 청구하겠습니다. 이게 안 맞으면 금액이 달라지니까요."' });
      y = noteStrip(s, y + 8, '청구를 도와주는 사람은 보험을 파는 사람과 다르게 기억됩니다. 수술비 상담의 진짜 목적은 청구 동행입니다.', { size: 6.6 });
      y = docOrder(s, y + 6, PLAN_EXTRA.surgery.docOrder);
      y = blockTitle(s, y + 2, '청구가 거절되는 흔한 이유', '미리 알려주면 고객이 대비합니다');
      y = s.bullets(s.ML, y, s.CW, [
        '수술명이 약관 분류표와 다르게 적힘 — 병원에 분류표상 명칭으로 요청',
        '시술·처치로 분류되어 수술비 지급 대상이 아님',
        '고지의무 위반으로 계약이 해지된 경우',
        '청구 소멸시효(3년) 경과'
      ], { size: 6.8, gap: 2.5 });
      foot(s, 21, '4순위 수술 · 청구');
    });

    P.push((s) => {
      let y = head(s, 22, 'PLAN 4 · SURGERY', '수술 — 설계 권장안과 반론', '금액은 크게 잡지 않습니다. 빈 축을 채우는 것이 목적입니다.');
      const rows = [
        ['질병수술비(일반)', `${won(m.state.cov.surgery.disease)}만원`, `권장 ${won(PK(m.rows[3], 'disease').rec)}만원`, '수술 1회당 정액'],
        ['질병 1~5종', `${won(m.state.cov.surgery.disease15)}만원`, `권장 ${won(PK(m.rows[3], 'disease15').rec)}만원 (1종 기준)`, '침습도 축'],
        ['질병 N대', m.state.cov.surgery.diseaseNdae ? `${won(m.state.cov.surgery.diseaseNdae)}만원` : '없음', '보유 권장', '질환별 한도'],
        ['비급여 질병 수술', m.state.cov.surgery.diseaseNonPay ? `${won(m.state.cov.surgery.diseaseNonPay)}만원` : '없음', '보유 권장', '5세대 실손 보완'],
        ['일반 상해수술', `${won(m.state.cov.surgery.injury)}만원`, `권장 ${won(PK(m.rows[3], 'injury').rec)}만원`, '사고 수술 정액'],
        ['상해 1~5종', `${won(m.state.cov.surgery.injury15)}만원`, `권장 ${won(PK(m.rows[3], 'injury15').rec)}만원`, '사고 수술 침습도'],
        ['수술비 비중', '—', '전체 보험료의 20% 이내 (권장 예시)', '진단비가 우선']
      ];
      y = s.table(s.ML, y, s.CW, ['항목', '현재', '권장 기준', '이유'], rows, { widths: [78, 100, 182, 155], size: 6.7, rowH: 20, align: ['left', 'center', 'left', 'left'] });
      y += 14;
      sg.objections.forEach((o) => {
        s.rect(s.ML, y, s.CW, 20, { fill: '#3A2628', r: 3 });
        s.text(o.trigger, s.ML + 10, y + 4, { size: 8, weight: 800, color: '#fff' });
        y += 23;
        s.para(`공감 — ${o.empathy}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.ink2, lh: 1.35 }); y += 13;
        s.para(`환기 — ${o.awaken}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.ink2, lh: 1.35 }); y += 17;
        s.para(`대안 — ${o.alternative}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.blue, lh: 1.35 }); y += 19;
      });
      y = noSay(s, y + 12, PLAN_EXTRA.surgery.noSay);
      y = afterBlock(s, y + 6, PLAN_EXTRA.surgery.after);
      foot(s, 22, '4순위 수술 · 설계·반론');
    });

    /* 23~25 간병 */
    const cr2 = PLAYBOOK.care;
    P.push((s) => {
      let y = head(s, 23, 'PLAN 5 · CARE', '5순위 · 간병·장기요양 상담 플랜', `${cr2.minutes} 배분. 매일 나가는 돈이라는 점을 숫자로 체감시키는 페이지입니다.`);
      y = todoStrip(s, y, `이 페이지에서 할 일 — ${m.client.name}님 간병 보장이 세 갈래 중 어디까지 되어 있는지 확인하고, 노후 대비로 연결합니다.`);
      y += 10;
      const car = m.rows[4];
      const cw = (s.CW - 16) / 3;
      [
        ['일반병원 간병일당', `${won(m.state.cov.care.daily)}만원`, m.state.cov.care.mode === 'step' ? '체증형' : '일반형', PK(car, 'daily').fill],
        ['요양병원 간병일당', m.state.cov.care.nDaily ? `${won(m.state.cov.care.nDaily)}만원` : '없음', '통상 5~6만원대', PK(car, 'nDaily').fill],
        ['지급 기준', { time: '시간 기준', money: '금액 기준', unknown: '미확인' }[m.state.cov.care.basis], '일 8시간 / 7~8만원', PK(car, 'basis').fill],
        ['가족 간병', { yes: '인정', conditional: '업체등록·결제 필요', no: '불인정' }[m.state.cov.care.family], '청구 가능성', PK(car, 'family').fill],
        ['간호간병통합', m.state.cov.care.nursing ? '보유' : '없음', '보호자 없는 병동', PK(car, 'nursing').fill],
        ['장기요양등급', m.state.cov.care.ltc ? '보유' : '없음', '1~5등급·인지지원', PK(car, 'ltc').fill]
      ].forEach((c, i) => {
        const x = s.ML + (i % 3) * (cw + 8);
        const yy = y + Math.floor(i / 3) * 64;
        s.rect(x, yy, cw, 58, { fill: '#fff', r: 5, stroke: C.line });
        s.text(c[0], x + 9, yy + 8, { size: 6.4, weight: 600, color: C.muted });
        s.text(c[1], x + 9, yy + 18, { size: 13, weight: 800, color: c[3] >= 0.99 ? C.mint : c[3] > 0 ? C.orange : C.red });
        s.text(c[2], x + 9, yy + 36, { size: 5.8, color: C.muted });
        s.gauge(x + 9, yy + 47, cw - 18, c[3], { color: c[3] >= 0.99 ? C.mint : c[3] > 0 ? C.orange : C.gray, h: 4.5 });
      });
      y += 136;
      y = s.script(s.ML, y, s.CW, { title: '판독', text: `"${m.client.name}님은 일반병원 간병 일당이 ${won(m.state.cov.care.daily)}만원, 요양병원은 ${m.state.cov.care.nDaily ? won(m.state.cov.care.nDaily) + '만원' : '없음'}입니다. 간병인을 하루 쓰면 10만~15만 원이 나가니까, 한 달이면 300만 원을 넘습니다. 지급 기준은 ${ { time: '하루 8시간', money: '하루 7~8만원', unknown: '확인 필요' }[m.state.cov.care.basis] }입니다."` });
      y += 8;
      y = s.sectionHead(s.ML, y, s.CW, '01', '근거 통계 — 노후의 실제 지출', '출처: 건보공단 2025 노인장기요양보험 통계연보');
      cr2.facts.forEach((f) => { y = s.bullets(s.ML, y, s.CW, [f], { size: 7, gap: 2 }); });
      y += 4;
      y = s.sectionHead(s.ML, y, s.CW, '02', '오늘의 목표', null);
      y = s.checks(s.ML, y, s.CW, [
        m.state.cov.care.ltc ? '장기요양 담보 금액이 3~5등급 구간을 커버하는지 확인' : '장기요양 담보(1~5등급·인지지원) 보완 여부 결정',
        '간병 일당을 체증형으로 바꿀지, 금액을 올릴지 결정',
        '부모님 보장이 있다면 별도 상담 일정 잡기 (이번 상담에 섞지 않음)'
      ], { size: 7, rowH: 14.5 });
      y = typeCards(s, y + 10, PLAN_EXTRA.care.types);
      y = questionCard(s, y, PLAYBOOK.care.questions[0], '이 페이지에서 쓸 질문 하나');
      foot(s, 23, '5순위 간병 · 판독');
    });

    P.push((s) => {
      let y = head(s, 24, 'PLAN 5 · CARE', '간병 — 세 갈래 구조와 질문', '입원 중 / 퇴원 후 / 노후로 구간을 나눠 설명하면 이해가 빠릅니다.');
      const cols = [
        { t: '간병인 사용일당', when: '입원 중', d: '실제 간병인을 고용했을 때 1일당 정액. 이용확인서·영수증 필수, 가족 간병 불인정 상품 다수.', c: C.blue },
        { t: '간호간병통합', when: '입원 중', d: '보호자 없는 병동 이용 시 일당 또는 정액. 별도 특약이 있어야 지급되는 경우가 많음.', c: C.navy2 },
        { t: '장기요양등급', when: '퇴원 후·노후', d: '1~5등급·인지지원 판정 시 월 단위 요양비. 등급 판정이 전제, 급여 종류별 한도 있음.', c: C.mint }
      ];
      const cw = (s.CW - 16) / 3;
      cols.forEach((c, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 96, { fill: i === 2 ? '#3A2628' : '#fff', r: 6, stroke: C.line });
        s.text(c.when, x + 10, y + 9, { size: 6, weight: 700, color: i === 2 ? '#8FF0DC' : c.c });
        s.text(c.t, x + 10, y + 19, { size: 8.6, weight: 800, color: i === 2 ? '#fff' : C.navy });
        s.para(c.d, x + 10, y + 34, cw - 20, { size: 6.2, color: i === 2 ? '#F0DEDB' : C.ink2, lh: 1.4 });
      });
      y += 106;
      let n = 0;
      cr2.questions.forEach((q) => {
        n += 1;
        s.rect(s.ML, y, s.CW, 40, { fill: '#F7FAFE', r: 4, stroke: C.line });
        s.iconCircle(s.ML + 15, y + 13, 7, { fill: C.mintSoft, num: n, size: 6.6, color: C.mint });
        s.text(q.q, s.ML + 28, y + 6, { size: 7.8, weight: 700, color: C.navy });
        s.text(`의도 — ${q.why}`, s.ML + 28, y + 18, { size: 6, color: C.ink2 });
        s.text(`기대 — ${q.expect}`, s.ML + 28, y + 28, { size: 6, color: C.muted });
        y += 44;
      });
      y = s.sectionHead(s.ML, y + 2, s.CW, null, '체증형 vs 일반형', null);
      y = s.table(s.ML, y, s.CW, ['구분', '일반형', '체증형'], [
        ['지급 구조', '입원일수와 무관하게 일당 고정', '입원일수가 길어질수록 일당이 올라감'],
        ['유리한 경우', '짧은 입원이 예상될 때', '장기 입원 위험이 클 때'],
        ['보험료', '상대적으로 낮음', '상대적으로 높음']
      ], { widths: [90, 212, 213], size: 6.6, rowH: 17, align: ['left', 'left', 'left'] });
      y = noSay(s, y + 8, PLAN_EXTRA.care.noSay);
      foot(s, 24, '5순위 간병 · 구조');
    });

    P.push((s) => {
      let y = head(s, 25, 'PLAN 5 · CARE', '간병 — 설계 권장안과 반론', '"자식이 돌본다"는 말에는 부담 이야기로 답합니다.');
      const rows = [
        ['간병인 일당', `${won(m.state.cov.care.daily)}만원`, `권장 ${won(m.rows[4].baseRec)}만원`, '1일당 기준'],
        ['지급 방식', m.state.cov.care.mode === 'step' ? '체증형' : '일반형', '장기 위험은 체증형', '상품별 조건 확인'],
        ['간호간병통합', m.state.cov.care.nursing ? '보유' : '없음', '보유 권장', '보호자 없는 병동'],
        ['장기요양', m.state.cov.care.ltc ? '보유' : '없음', '3~5등급·인지지원 포함', '인정자 87.4% 구간']
      ];
      y = s.table(s.ML, y, s.CW, ['항목', '현재', '권장 기준', '이유'], rows, { widths: [78, 100, 182, 155], size: 6.7, rowH: 20, align: ['left', 'center', 'left', 'left'] });
      y += 14;
      cr2.objections.forEach((o) => {
        s.rect(s.ML, y, s.CW, 20, { fill: '#0E6A5C', r: 3 });
        s.text(o.trigger, s.ML + 10, y + 4, { size: 8, weight: 800, color: '#fff' });
        y += 23;
        s.para(`공감 — ${o.empathy}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.ink2, lh: 1.35 }); y += 13;
        s.para(`환기 — ${o.awaken}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.ink2, lh: 1.35 }); y += 17;
        s.para(`대안 — ${o.alternative}`, s.ML + 4, y, s.CW - 8, { size: 6.4, color: C.blue, lh: 1.35 }); y += 19;
      });
      y = noteStrip(s, y + 2, '간병은 "부모님 이야기"로 나오는 경우가 많습니다. 이번 상담에서 부모님 보장까지 한꺼번에 다루면 초점이 흐려집니다. 별도 일정으로 나누세요.', { size: 6.6 });
      y = docOrder(s, y + 4, PLAN_EXTRA.care.docOrder);
      y = afterBlock(s, y + 2, PLAN_EXTRA.care.after);
      foot(s, 25, '5순위 간병 · 설계·반론');
    });

    /* 26 실손 */
    P.push((s) => {
      let y = head(s, 26, 'MANUAL · MEDICAL', '실손 1~5세대 전환 판단 매뉴얼', '2026년 11월, 1·2세대에 두 갈래 선택지가 열렸습니다. 유지가 답인 경우도 분명히 말합니다.');
      const sil = m.state.silson;
      s.rect(s.ML, y, s.CW, 46, { fill: '#3A2628', r: 6 });
      s.text('이 고객의 실손', s.ML + 12, y + 8, { size: 6, weight: 700, color: '#E7CDC9' });
      s.text(sil === 'none' ? '없음 — 실손부터' : `${sil}세대`, s.ML + 12, y + 17, { size: 16, weight: 800, color: '#fff' });
      s.para(sil === '1' || sil === '2' ? '2026년 11월 제도 대상일 가능성이 큽니다. 가입 시기와 재가입 조건을 확인하세요.' : sil === 'none' ? '진단비보다 실손이 먼저입니다. 입원·통원 기본축이 비어 있습니다.' : '선택형 할인·전환 대상이 아닐 수 있습니다. 유지 판단이 먼저입니다.', s.ML + 130, y + 10, s.CW - 150, { size: 6.8, color: '#F2E4E2', lh: 1.4 });
      y += 58;
      y = s.sectionHead(s.ML, y, s.CW, '01', '판단 5단계', null);
      SILSON_DECISION.steps.forEach((st, i) => {
        s.rect(s.ML, y, s.CW, 30, { fill: i % 2 ? C.sky2 : '#fff', r: 3, stroke: C.line });
        s.iconCircle(s.ML + 15, y + 15, 7, { fill: C.navy, num: i + 1, size: 6.4, color: '#fff' });
        s.text(st.t, s.ML + 28, y + 10, { size: 7.6, weight: 800, color: C.navy });
        s.para(st.d, s.ML + 110, y + 9, s.CW - 120, { size: 6.2, color: C.ink2, lh: 1.3 });
        y += 32;
      });
      y = s.sectionHead(s.ML, y + 2, s.CW, '02', '반드시 말해야 하는 3가지', null);
      y = s.bullets(s.ML, y, s.CW, SILSON_DECISION.cautions, { size: 7, gap: 3 });
      y = s.script(s.ML, y + 4, s.CW, { title: '전환 권유 시', text: '"보험료를 아끼는 결정과 보장이 좋아지는 결정은 다릅니다. 5세대로 바꾸면 보험료는 줄지만 비중증 비급여 한도가 줄고 5년 재가입이 생깁니다. 두 가지를 같이 놓고 보시고 결정하시죠."', accent: C.orange });
      y = noteStrip(s, y + 8, '근거: 금융위원회 보도자료(2026.5.6) · 2026년 11월 시행 안내(선택형 할인 특약 · 계약전환 할인) · 5세대는 2026.5.6부터 판매. 할인은 한시 제도이므로 시행 조건 변동을 확인합니다.', { size: 6.2 });
      y = blockTitle(s, y + 4, '두 갈래 한 표로 비교', '같은 표에 놓고 보여줍니다');
      y = s.table(s.ML, y, s.CW, ['구분', 'A · 선택형 할인 특약', 'B · 5세대 전환'], [
        ['계약', '기존 계약 유지', '5세대 신규 전환'],
        ['보험료', '전부 선택 시 약 30~40% 할인', '3년간 50% 할인 (6개월 한시)'],
        ['보장', '선택한 항목만 면책·자기부담 증가', '비중증 비급여 연 1,000만·자기부담 50%'],
        ['되돌림', '특약 해지로 원상 가능', '5년 재가입 · 철회 시 재가입 제한']
      ], { widths: [56, 232, 227], size: 6.3, rowH: 16, align: ['left', 'left', 'left'] });
      foot(s, 26, '실손 매뉴얼');
    });

    /* 27 고지 */
    P.push((s) => {
      let y = head(s, 27, 'MANUAL · DISCLOSURE', '고지의무 현장 체크리스트', '이 페이지는 상담 마지막에 함께 봅니다. 고지 누락은 나중에 계약을 통째로 흔듭니다.');
      y = s.table(s.ML, y, s.CW, ['일반심사', '기간', '간편심사(유병자)'], [
        ['질병 확정진단·의심소견 / 치료·입원·수술 / 투약 / 상시 복용', '3개월', '입원·수술 필요소견 / 추가검사 필요소견'],
        ['추가검사(재검사) 필요소견', '1년', '—'],
        ['입원·수술 / 7일 이상 치료 / 30일 이상 투약 / 10대 질병', '5년', '암·간경화·투석 중 만성신장질환·파킨슨·루게릭'],
        ['—', '2년', '입원·수술(제왕절개 포함)']
      ], { widths: [246, 44, 225], size: 6.3, rowHeight: () => 26, align: ['left', 'center', 'left'] });
      y += 8;
      /* v4: 입력값 기반 심사 판정 */
      const dj = m.disclosure;
      const djCol = dj.tone === 'ok' ? C.mint : dj.tone === 'gap' ? C.red : C.orange;
      s.rect(s.ML, y, s.CW, 54, { fill: dj.tone === 'ok' ? '#F1FAF7' : dj.tone === 'gap' ? '#FDF2F1' : '#FDF7EC', r: 5, stroke: C.line });
      s.rect(s.ML, y, 2.6, 54, { fill: djCol, r: 1.3 });
      s.text('이 고객의 권장 심사', s.ML + 10, y + 6, { size: 6, weight: 700, color: C.muted });
      s.text(dj.label, s.ML + 10, y + 14, { size: 10.4, weight: 800, color: djCol });
      s.text(dj.headline, s.ML + 150, y + 8, { size: 6.6, weight: 700, color: C.navy });
      s.para(dj.advice, s.ML + 150, y + 18, s.CW - 160, { size: 5.8, color: C.ink2, lh: 1.3 });
      s.text(dj.reasons.length ? `체크: ${dj.reasons.join(' · ')}` : '체크된 항목 없음 — 표준체 우선', s.ML + 10, y + 41, { size: 5.6, weight: 600, color: C.muted });
      y += 62;
      y = s.sectionHead(s.ML, y, s.CW, '01', '현장에서 자주 틀리는 5가지', '출처: 금융감독원 간편보험 소비자 유의사항(2024.6.13)');
      DISCLOSURE_MISTAKES.forEach((d, i) => {
        s.rect(s.ML, y, s.CW, 26, { fill: i % 2 ? C.sky2 : '#fff', r: 3, stroke: C.line });
        s.iconCircle(s.ML + 14, y + 13, 6.4, { fill: C.redSoft, num: i + 1, size: 6, color: C.red });
        s.text(d.t, s.ML + 26, y + 5, { size: 7.2, weight: 800, color: C.navy });
        s.text(d.d, s.ML + 26, y + 16, { size: 6, color: C.ink2 });
        y += 28;
      });
      y = s.sectionHead(s.ML, y + 2, s.CW, '02', '청약 전 3분 체크', null);
      y = s.checks(s.ML, y, s.CW, [
        '최근 5년 입원·수술 이력을 고객과 함께 날짜로 확인했다',
        '최근 3개월 진단·검사·약 복용을 서면으로 확인했다',
        '청약서에 서면으로 적었는지 눈으로 확인했다',
        '고지의무 위반 효과(해지권: 안 날부터 1개월, 계약일부터 3년)를 설명했다'
      ], { size: 7, rowH: 14.5 });
      y = noteStrip(s, y + 4, '말로만 알린 고지는 인정되지 않습니다. 청약서에 적히지 않았으면 고지하지 않은 것으로 봅니다. 이 한 문장을 고객에게 반드시 말합니다.', { size: 6.6, fill: '#FFF7F3', stroke: '#F7DDD2', accent: C.orange });
      y = s.script(s.ML, y + 4, s.CW, { title: '청약 직전에 이렇게 말합니다', text: '"마지막으로 하나만 확인하겠습니다. 최근 5년 안에 입원·수술·진단받으신 것 있으시죠? 말로만 하시면 안 되고 청약서에 적어야 효력이 있습니다. 제가 하나씩 여쭙고 같이 적겠습니다."', accent: C.orange });
      foot(s, 27, '고지의무');
    });

    /* 28 반론 6 */
    P.push((s) => {
      let y = head(s, 28, 'FIELD SCRIPT', '현장 6대 거절 돌파 스크립트', '거절은 반박 대상이 아니라 확인 대상입니다. 공감 → 환기 → 대안 순서를 지킵니다.');
      REBUTTALS.forEach((r, i) => {
        s.rect(s.ML, y, s.CW, 17, { fill: i % 2 ? '#4A2E30' : '#3A2628', r: 3 });
        s.text(`Q${i + 1}  ${r.trigger}`, s.ML + 10, y + 3, { size: 7.6, weight: 800, color: i === 3 ? '#FFD47A' : '#fff' });
        y += 19;
        s.text('공감', s.ML + 4, y, { size: 5.6, weight: 800, color: C.mint });
        y = s.para(r.empathy, s.ML + 28, y - 0.5, s.CW - 34, { size: 6.3, color: C.ink2, lh: 1.3 }) + 1;
        s.text('환기', s.ML + 4, y, { size: 5.6, weight: 800, color: C.orange });
        y = s.para(r.awaken, s.ML + 28, y - 0.5, s.CW - 34, { size: 6.3, color: C.ink2, lh: 1.3 }) + 2;
        s.text('대안', s.ML + 4, y, { size: 5.6, weight: 800, color: C.blue });
        y = s.para(r.alternative, s.ML + 28, y - 0.5, s.CW - 34, { size: 6.3, color: C.ink2, lh: 1.3 }) + 1;
        s.text(`→ ${r.close}`, s.ML + 28, y, { size: 6.2, weight: 700, color: C.navy });
        y += 12;
      });
      y = blockTitle(s, y + 2, '거절은 세 가지 유형뿐입니다', '유형을 알면 대응이 정해집니다');
      y = s.table(s.ML, y, s.CW, ['유형', '속뜻', '대응'], [
        ['돈이 아깝다', '가치가 아직 안 보임', '재배치·배서로 "추가 지출 없이"를 먼저 보여줍니다'],
        ['지금은 아니다', '우선순위가 아님', '다음 약속만 받고 PDF로 남깁니다'],
        ['믿음이 부족하다', '설명이 부족했음', '증권·약관·통계로 근거를 보여주고 결정은 미룹니다']
      ], { widths: [90, 140, 285], size: 6.4, rowH: 18, align: ['left', 'left', 'left'] });
      foot(s, 28, '거절 돌파');
    });

    /* 29 클로징 */
    P.push((s) => {
      let y = head(s, 29, 'CLOSING', '클로징 3단계', '결정을 요구하는 게 아니라, 다음 행동을 함께 정하는 것입니다.');
      PLAN_CLOSE.stages.forEach((st) => {
        s.rect(s.ML, y, s.CW, 20, { fill: C.navy, r: 4 });
        s.text(`${st.n}  ${st.t}`, s.ML + 10, y + 4, { size: 9, weight: 800, color: '#fff' });
        y += 24;
        y = s.script(s.ML, y, s.CW, {
          text: st.text.replace(/\{name\}/g, m.client.name).replace(/\{grade\}/g, `${m.letter} 등급`).replace(/\{first\}/g, m.first ? `${m.first.item.name} 한 칸` : '금액 조정').replace(/\{date\}/g, '다음 주 화요일')
        });
        y += 5;
        y = s.checks(s.ML, y, s.CW, st.check, { size: 6.8, rowH: 13.5 });
        y += 8;
      });
      y = noteStrip(s, y, '클로징에서 가장 흔한 실수는 "더 설명하는 것"입니다. 요약 → 결정 요청 → 다음 약속. 이 세 단계를 7분 안에 끝냅니다.', { size: 6.6 });
      y = blockTitle(s, y + 2, '클로징에서 쓰면 안 되는 말', '한마디가 결정을 되돌립니다');
      y = s.bullets(s.ML, y, s.CW, [
        '"오늘만 이 가격입니다" — 한시성 압박은 다음 통화를 없앱니다.',
        '"이거 안 하시면 나중에 후회합니다" — 후회를 예고하면 방어가 생깁니다.',
        '"다른 고객들은 다 하셨어요" — 비교는 판단을 흐리고 신뢰를 깎습니다.'
      ], { size: 6.9, gap: 2.5 });
      foot(s, 29, '클로징');
    });

    /* 30 사후관리 */
    P.push((s) => {
      let y = head(s, 30, 'AFTER CARE', '계약 후 사후관리 · 소개 요청', '상담은 계약이 아니라 그 다음 30일에서 평가됩니다.');
      y = s.sectionHead(s.ML, y, s.CW, '01', '사후관리 캘린더', null);
      y = s.table(s.ML, y, s.CW, ['시점', '할 일'], PLAN_CLOSE.aftercare.map((a) => [
        { text: a.when, weight: 800, color: C.blue }, a.what
      ]), { widths: [80, 435], size: 6.8, rowH: 18, align: ['left', 'left'] });
      y += 12;
      y = s.sectionHead(s.ML, y, s.CW, '02', '소개 요청', null);
      y = s.script(s.ML, y, s.CW, { title: PLAN_CLOSE.referral.title, text: PLAN_CLOSE.referral.text.replace(/\{name\}/g, m.client.name) });
      y += 6;
      y = s.checks(s.ML, y, s.CW, PLAN_CLOSE.referral.check, { size: 6.8, rowH: 13.5 });
      y += 8;
      y = s.sectionHead(s.ML, y, s.CW, '03', '이 앱으로 다음 상담 준비', null);
      y = s.bullets(s.ML, y, s.CW, [
        '상담 저장을 누르면 이 기기에만 기록됩니다 (최대 5건). 다음 방문 전에 불러오세요.',
        '고객용 1장 요약 PDF를 문자·카톡으로 보내면 설명이 반복되지 않습니다.',
        '상령일 D-day가 가까우면 미리 연락해 보험료 변동을 안내합니다.',
        '갱신 3개월 전 알림을 캘린더에 직접 등록해 두세요.'
      ], { size: 7, gap: 3 });
      y = noteStrip(s, y + 4, `오늘 상담 요약 — ${m.client.name}님 · ${m.letter}(${m.score}점) · ${m.first ? `1순위 ${m.first.item.name} ${m.first.pct}%` : '전 항목 기준선 이상'} · 월 ${won(m.premium)}만원`, { size: 6.8, fill: '#F1FAF7', stroke: '#CDECE3', accent: C.mint });
      y = blockTitle(s, y + 4, '소개 요청은 이때만', '타이밍이 결과를 바꿉니다');
      y = s.bullets(s.ML, y, s.CW, [
        '청구를 도와준 직후 — 가장 신뢰가 높은 순간',
        '고객이 먼저 "주변에 소개해도 되냐"고 물을 때 — 이때는 감사만 하고 정보는 받지 않습니다',
        '계약 1년 뒤 보장 점검에서 — 관계가 유지된 것이 확인된 시점'
      ], { size: 6.9, gap: 2.5 });
      foot(s, 30, '사후관리');
    });

    return P;
  }

  /* =========================================================
     공개 API
     ========================================================= */
  function build(kind, state) {
    const m = BK.full(state);
    if (kind === 'summary') return { pages: [summaryPage(m)], m };
    if (kind === 'detail') return { pages: detailPages(m), m };
    if (kind === 'advisor') return { pages: advisorPages(m), m };
    throw new Error('unknown report kind: ' + kind);
  }

  const MEMO = {
    advisor: { memoMax: Infinity, memoLabels: ['고객이 한 말', '내가 약속한 것', '다음 할 일'] },
    detail: { memoMax: 200, memoLabels: ['궁금한 점', '다음 상담까지 확인할 것'] }
  };
  root.BojangReport = { build, summaryPage, detailPages, advisorPages, MEMO };
})(typeof window !== 'undefined' ? window : globalThis);
