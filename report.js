/* 보장분석 상담 가이드 — 3종 리포트 레이아웃 (v3)
   1장 요약 · 10장 상세 · 30장 설계사 플랜북.
   모두 PDFKit.Sheet 프리미티브로 그려 캔버스 → PDF로 저장됩니다. */
(function (root) {
  'use strict';

  const BK = root.BojangModel, K = root.PDFKit;
  const won = K.won;
  const C = K.C;

  /* 상태별 색 — 테마 팔레트가 바뀌면 build() 시작에서 다시 맞춥니다(v5.5) */
  const TONE_COLOR = { ok: C.mint, need: C.orange, gap: C.red, warn: C.orange, danger: C.red, info: C.blue, enough: C.mint, check: C.orange, short: C.short, none: C.gray };
  function refreshToneColor() {
    TONE_COLOR.ok = C.mint; TONE_COLOR.enough = C.mint;
    TONE_COLOR.need = C.orange; TONE_COLOR.check = C.orange; TONE_COLOR.warn = C.orange;
    TONE_COLOR.gap = C.red; TONE_COLOR.danger = C.red;
    TONE_COLOR.info = C.blue; TONE_COLOR.short = C.short; TONE_COLOR.none = C.gray;
  }
  const LEVEL_LABEL = { enough: '충분', check: '점검', short: '보완 후보', none: '미가입' };
  /* 리포트 표에서 쓰는 5종 짧은 이름 (칸 넘잘 방지) */
  const TREAT_SHORT = { surgery: '암수술', drug: '항암약물', radio: '항암방사선', icu: '중환자실', extra: '비급여' };

  const statById = (id) => STATS.find((s) => s.id === id);

  /* v4.2: 세부 항목을 위치가 아니라 키로 찾습니다 (수술 6축·간병 6칸으로 늘어남) */
  const PK = (row, key) => (row && row.r.parts.find((p) => p.key === key)) || { val: 0, rec: 0, fill: 0, subs: [], pct: 0, option: null };
  /* v5.6 — 세부 칸의 '실효' 값(직접 기재 담보 포함). 직접 기재가 없으면 val과 같습니다. */
  const subEff = (s) => Number(s && (s.eff != null ? s.eff : s.val)) || 0;
  const effVal = (p) => ((p && p.subs && p.subs.length) ? p.subs.reduce((a, s) => a + subEff(s), 0) : Number((p && p.val) || 0));
  const subHave = (p) => (p.subs || []).filter((s) => subEff(s) > 0).length;

  /* 1장 요약·표처럼 좁은 칸에 들어가는 짧은 현재 보장 문장 (v4.2) */
  const REC_SCOPE = { brain: '뇌혈관질환 I60~I69', heart: '허혈성심장 I20~I25' };
  const BASIS_SHORT = { time: '시간 기준', money: '금액 기준', unknown: '기준 미확인' };
  /* v7.4 — 1~5종 종별 · 뇌·심장 주요치료비 서식 도우미 */
  const t5Range = (st, f) => (BK.tier5Range ? BK.tier5Range(st, f) : '');
  const t5Detail = (st, f) => (BK.tier5Detail ? BK.tier5Detail(st, f) : '');
  const mainOf = (st, k) => (BK.mainOf ? BK.mainOf(st, k) : 0);
  const mainShared = (st, k) => (BK.mainSharedOf ? BK.mainSharedOf(st, k) : false);
  function shortSummary(row, m) {
    const k = row.item.key;
    if (k === 'cancer') {
      return `일반암 ${won(PK(row, 'general').val)}만원 · 치료비 ${subHave(PK(row, 'treatment'))}/5`;
    }
    if (k === 'brain' || k === 'heart') {
      const dxp = PK(row, 'dx');
      const core = dxp.dx && dxp.dx.core;
      const sc = core && core.val > 0 ? `${BK.dxShort(core.label)} ${won(core.val)}` : (dxp.dx && dxp.dx.gapWarn ? '범위 공백' : '미보유');
      return `${sc} · 치료비 ${subHave(PK(row, 'treat'))}/3${m && mainOf(m.state, k) > 0 ? ` + 주요치료비 ${won(mainOf(m.state, k))}` : ''}`;
    }
    if (k === 'surgery') {
      const dz = ['disease', 'disease15', 'diseaseNdae', 'diseaseNonPay'].filter((x) => PK(row, x).val > 0).length;
      const ij = ['injury', 'injury15'].filter((x) => PK(row, x).val > 0).length;
      const r15 = m ? t5Range(m.state, 'disease15') : '';
      return `질병 ${dz}/4 · 상해 ${ij}/2${r15 ? ` · 1~5종 ${r15}` : ''}`;
    }
    const daily = PK(row, 'daily').val, nd = PK(row, 'nDaily').val;
    const basis = (PK(row, 'basis').option || {}).label || '';
    return `일반 ${won(daily)} · 요양 ${nd ? won(nd) : '없음'} · ${basis}`;
  }

  /* =========================================================
     v5.6 — 증권 담보 직접 기재 (통합형 · 개별형)
     고객 증권에 적힌 담보명·금액을 그대로 인쇄합니다.
     ========================================================= */
  const CUSTOM_MODE_TXT = { bundle: '통합형', individual: '개별형' };
  function customOf(m, key) {
    if (BK.customList) return BK.customList(m.state, key);
    const box = m.state && m.state.cov && m.state.cov.custom;
    return (box && Array.isArray(box[key])) ? box[key] : [];
  }
  function customAllOf(m) {
    if (BK.customAll) return BK.customAll(m.state);
    return [];
  }
  /* 긴 담보명은 잘라서 한 줄에 맞춥니다 (넘침 방지) */
  function cutName(t, n) {
    const v = String(t == null ? '' : t).trim() || '담보명 미입력';
    if (v.length <= n) return v;
    let cut = n - 1;
    /* 괄호·공백 한가운데서 끊기지 않게 — 바로 뒤에 닫는 괄호가 있으면 함께 닫습니다 */
    const open = v.lastIndexOf('(', cut);
    const close = v.indexOf(')', cut);
    if (open >= 0 && close >= 0 && close - cut <= 6) cut = close + 1;
    return v.slice(0, cut).replace(/[\s(·,]+$/, '') + '…';
  }
  /* 한 줄에 들어가는 길이로 항목을 줄이고 남은 건수를 붙입니다 (넘침 방지) */
  function withAreaTag(x, o) {
    return (o && o.withArea && x.area) ? '[' + x.area + '] ' : '';
  }
  function customFit(s, items, w, size, withArea) {
    const parts = items.map((x) => `${withArea && x.area ? '[' + x.area + '] ' : ''}${cutName(x.name, 26)} ${won(x.amount)}만원(${CUSTOM_MODE_TXT[x.mode] || '통합형'})`);
    const tail = (n) => (n > 0 ? `   외 ${n}건` : '');
    for (let n = parts.length; n >= 1; n -= 1) {
      const cand = parts.slice(0, n).join('   ') + tail(parts.length - n);
      if (n === 1 || s.measure(cand, size, 500) <= w) return cand;
    }
    return parts[0] || '';
  }
  /* 컴팩트 참고 박스 — 해당 영역 페이지용 (항목이 없으면 아무것도 그리지 않습니다) */
  function customBox(s, y, items, o) {
    o = o || {};
    if (!items || !items.length) return y;
    /* v6.2 — 꼬리말(면책) 영역을 침범하지 않도록 남은 자리 안에서만 그립니다.
       자리가 좁으면 두 줄을 더 붙여 압축하고, 아주 좁으면 한 줄로 줄입니다. */
    const limit = s.limit || (s.H - s.MB);
    const avail = limit - y;
    if (avail < 14) return y;
    const tight = avail < 34;
    const h = Math.min(o.h || 28, Math.max(14, avail - 2));
    const total = items.reduce((a, x) => a + Number(x.amount || 0), 0);
    s.rect(s.ML, y, s.CW, h, { fill: o.fill || C.tint2, r: 4, stroke: C.tintLine });
    s.rect(s.ML, y, 2.4, h, { fill: o.accent || C.blue, r: 1.2 });
    /* 한 줄밖에 못 들어가는 자리(높이 24pt 미만)에서는 제목과 항목을 한 줄로 합쳐 겹침 없이 보여 줍니다 */
    if (h < 24) {
      const head = `${o.title || '증권 직접 기재 담보'} — `;
      const body = items.map((x) => `${withAreaTag(x, o)}${cutName(x.name, 26)} ${won(x.amount)}만원(${CUSTOM_MODE_TXT[x.mode] || '통합형'})`).join('   ');
      let line = head + body;
      const wmax = s.CW - 22;
      if (s.measure(line, 5.4, 600) > wmax) {
        while (line.length > 8 && s.measure(line + '…', 5.4, 600) > wmax) line = line.slice(0, -1);
        line += '…';
      }
      s.text(line, s.ML + 10, y + Math.max(2.6, (h - 7) / 2), { size: 5.4, weight: 600, color: C.ink2 });
      return y + h + (o.gap || 0);
    }
    s.text(o.title || '증권 직접 기재 담보', s.ML + 10, y + (tight ? 3.6 : 5), { size: tight ? 5.8 : 6.2, weight: 800, color: o.accent || C.blue });
    s.text(`${items.length}건 · 합계 ${won(total)}만원`, s.ML + s.CW - 10, y + (tight ? 3.6 : 5), { size: tight ? 5.4 : 5.8, weight: 600, color: C.muted, align: 'right' });
    s.text(customFit(s, items, s.CW - 22, tight ? 5.5 : 6.0, !!o.withArea), s.ML + 10, y + h - (tight ? 8.6 : 12.5), { size: tight ? 5.5 : 6.0, weight: 500, color: C.ink2 });
    return y + h + (o.gap || 0);
  }


  /* =========================================================
     v5.5 — 브랜드·담당자 · 진단비 분해 · 리모델링 연동
     ========================================================= */
  const mix = (K.mix || ((a) => a));

  function brandInfo(m) {
    let b = null;
    try { b = (root.BojangBrand && root.BojangBrand.get) ? root.BojangBrand.get() : null; } catch (e) { b = null; }
    b = b || {};
    return {
      name: b.name || '보장분석 라이프 리포트',
      slogan: b.slogan || '',
      title: b.title || '보험설계사',
      consultant: b.consultant || (m && m.client ? m.client.consultant : '') || '담당자',
      phone: b.phone || '',
      kakao: b.kakao || ''
    };
  }
  function brandPartsOf(name) {
    if (root.BojangBrand && root.BojangBrand.parts) {
      try { return root.BojangBrand.parts(name); } catch (e) { /* fallthrough */ }
    }
    return { head: name || '', tail: '' };
  }

    /* 02p '진단비·치료비·수술비 합계' 분해 — 직접 기재·공유 담보 포함, 합계는 모델 totalSum과 같습니다 */
  function dxBreakdown(m) {
    const sums = m.sums || {};
    if (sums.cancerDx != null) {
      return {
        cancerDx: sums.cancerDx, treat: sums.cancerTreat, neuroDx: (sums.brainDx || 0) + (sums.heartDx || 0),
        neuroTreat: (sums.brainTreat || 0) + (sums.heartTreat || 0), surgery: sums.surgery || 0, customDx: sums.customDx || 0,
        total: m.totalSum
      };
    }
    const c = (m.state && m.state.cov && m.state.cov.cancer) || {};
    const sg = (m.state && m.state.cov && m.state.cov.surgery) || {};
    const cancerDx = Number(c.general || 0) + Number(c.similar || 0);
    const treat = effVal(PK(m.rows[0], 'treatment'));
    const neuroDx = (m.dx && m.dx.brain ? Number(m.dx.brain.core || 0) : 0) + (m.dx && m.dx.heart ? Number(m.dx.heart.core || 0) : 0);
    const surgery = ['disease', 'disease15', 'diseaseNdae', 'diseaseNonPay', 'injury', 'injury15'].reduce((a, k) => a + Number(sg[k] || 0), 0);
    return { cancerDx, treat, neuroDx, neuroTreat: 0, customDx: 0, surgery, total: cancerDx + treat + neuroDx + surgery };
  }

  /* 월 보험료 적정성 — 소득 기준선(7~10%)을 보험료에서 역산해 비교합니다 */
  function premiumGuide(m) {
    const gd = (typeof PREMIUM_GUIDE !== 'undefined') ? PREMIUM_GUIDE : { minPct: 7, recPct: 10, maxPct: 13 };
    const p = Number(m.premium || 0);
    const incomeAt = (pct) => (pct > 0 ? Math.round(p / (pct / 100)) : 0);
    return {
      minPct: gd.minPct, recPct: gd.recPct, maxPct: gd.maxPct,
      premium: p,
      incomeMin: incomeAt(gd.recPct),   /* 권장 10%로 볼 때의 소득 */
      incomeMax: incomeAt(gd.minPct),   /* 최소선 7%로 볼 때의 소득 */
      annual: Number(m.annual || 0)
    };
  }

  /* 리모델링 계산 결과 — 조정안이 입력됐는지까지 함께 돌려줍니다 */
  function remodelOf() {
    const R = root.BojangRemodel;
    if (!R || !R.calc) return null;
    let c = null;
    try { c = R.calc(); } catch (e) { return null; }
    if (!c) return null;
    const edited = (c.contractRows || []).some((r) => r.act !== 'keep') || (c.axes || []).some((a) => a.changed) || Number(c.extraTotal || 0) > 0;
    return { c, edited };
  }

  /* 담당자 소견 박스 — 고객이 읽고 납득하는 문장만 넣습니다 (설계사 코칭 멘트 금지) */
  function ownerNote(s, m, y, text, o) {
    o = o || {};
    const b = brandInfo(m);
    const w = o.w || s.CW;
    const x = o.x || s.ML;
    const size = o.size || 7.1;
    const bodyH = s.height(text, w - 32, size, 1.5);
    const h = 26 + bodyH + 10;
    s.rect(x, y, w, h, { fill: o.fill || C.tint2, r: 6, stroke: o.stroke || C.tintLine });
    s.rect(x, y, 3, h, { fill: o.accent || C.blue, r: 1.5 });
    s.text(o.title || '담당자 소견', x + 14, y + 8, { size: 6.6, weight: 800, color: o.accent || C.blue });
    s.text(`${b.consultant} · ${m.dateLabel || ''}`, x + w - 14, y + 8, { size: 6, weight: 600, color: C.muted, align: 'right' });
    s.para(text, x + 14, y + 23, w - 32, { size, color: o.color || C.ink, lh: 1.5 });
    return y + h;
  }

  /* 명함형 담당자 블록 — 표지(세로) · 끝장(가로) 공용 */
  function nameCard(s, x, y, w, m, o) {
    o = o || {};
    const b = brandInfo(m);
    const h = o.h || 164;
    s.rect(x, y, w, h, { fill: '#fff', r: 8, stroke: C.tintLine });
    s.rect(x, y, w, 3.2, { fill: C.blue, r: 1.6 });
    let cy = y + 14;
    const mx = s.brandMark(x + 14, cy - 1, 15, { lw: 1.15, color: C.blue });
    const parts = brandPartsOf(b.name);
    const ns = 9.2, avail = w - (mx - x) - 22;
    if (s.measure((parts.head || '') + (parts.tail || ''), ns, 800) <= avail) {
      s.text(parts.head, mx + 5, cy, { size: ns, weight: 800, color: C.navy });
      s.text(parts.tail, mx + 5 + s.measure(parts.head || '', ns, 800), cy, { size: ns, weight: 800, color: C.blue });
      cy += 18;
    } else {
      cy = s.para(b.name, mx + 5, cy - 1, avail, { size: 8.2, weight: 800, color: C.navy, lh: 1.3 });
    }
    if (b.slogan) cy = s.para(b.slogan, x + 14, cy, w - 28, { size: 5.7, color: C.muted, lh: 1.35 }) + 5;
    s.line(x + 14, cy, x + w - 14, cy, { color: C.tintLine });
    cy += 7;
    s.text('담당 설계사', x + 14, cy, { size: 5.5, weight: 700, color: C.muted });
    s.text(b.title || '', x + w - 14, cy, { size: 5.5, weight: 600, color: C.muted, align: 'right' });
    s.text(b.consultant, x + 14, cy + 8, { size: 10.2, weight: 800, color: C.navy });
    cy += 24;
    if (b.phone) {
      s.text('T.', x + 14, cy, { size: 6, weight: 800, color: C.blue });
      s.text(b.phone, x + 26, cy - 0.4, { size: 6.9, weight: 700, color: C.ink2 });
    }
    if (b.kakao) {
      s.text('카카오톡 상담', x + 14, cy + 11, { size: 5.8, weight: 700, color: C.muted });
      s.text(b.kakao, x + 58, cy + 10.4, { size: 6.6, weight: 600, color: C.ink2 });
    }
    const vy = cy + (b.kakao ? 23 : 12);
    const vh = Math.max(30, y + h - 12 - vy);
    /* v5.8 — 40 → 46pt: 인쇄·모바일 스캔성 강화(카드 높이는 166 으로 함께 키워 넘침 0) */
    const qs = 46;
    const hasQR = !!(qrInfo(m) && root.BojangQR);
    const vw = hasQR ? w - 24 - qs - 16 : w - 24;
    s.rect(x + 12, vy, vw, vh, { fill: C.tint2, r: 5, stroke: C.tintLine });
    s.text('담당자 총평', x + 20, vy + 5, { size: 5.3, weight: 800, color: C.blue });
    s.para(o.verdict || ownerVerdict(m), x + 20, vy + 14, vw - 18, { size: 5.7, color: C.ink2, lh: 1.38 });
    /* v5.7 — 명함 QR: 카카오톡 상담 링크 또는 전화번호 */
    if (hasQR) qrBlock(s, x + w - 12 - qs, vy + Math.max(2, (vh - qs) / 2), qs, m, { label: false });
    return y + h;
  }

  /* 가로형 명함 — 마지막 장 */
  function closingCard(s, y, m) {
    const b = brandInfo(m);
    const h = 96, w = s.CW, x = s.ML;
    s.rect(x, y, w, h, { fill: '#fff', r: 8, stroke: C.tintLine });
    s.rect(x, y, 3.4, h, { fill: C.blue, r: 1.7 });
    const mx = s.brandMark(x + 16, y + 16, 16, { lw: 1.15, color: C.blue });
    const parts = brandPartsOf(b.name);
    const nm = 9.6;
    s.text(parts.head, mx + 5, y + 14, { size: nm, weight: 800, color: C.navy });
    s.text(parts.tail, mx + 5 + s.measure(parts.head || '', nm, 800), y + 14, { size: nm, weight: 800, color: C.blue });
    if (b.slogan) s.para(b.slogan, x + 16, y + 30, 228, { size: 5.7, color: C.muted, lh: 1.35 });
    s.line(x + 16, y + 47, x + 244, y + 47, { color: C.tintLine });
    s.text('담당 설계사', x + 16, y + 54, { size: 5.4, weight: 700, color: C.muted });
    s.text(`${b.consultant}${b.title ? ' · ' + b.title : ''}`, x + 16, y + 63, { size: 8.4, weight: 800, color: C.navy });
    if (b.phone) s.text(`T. ${b.phone}`, x + 16, y + 78, { size: 6.4, weight: 700, color: C.ink2 });
    else s.text('연락처는 상담 시 안내드립니다', x + 16, y + 78, { size: 5.8, weight: 500, color: C.muted });
    if (b.kakao) s.text(`카카오톡 상담  ${b.kakao}`, x + 150, y + 78, { size: 6.2, weight: 600, color: C.ink2 });
    s.line(x + 260, y + 12, x + 260, y + h - 12, { color: C.tintLine });
    /* v5.7 — 끝장 명함 QR (카카오톡 상담 링크 / 전화) */
    const qs = 60;
    const hasQR = !!(qrInfo(m) && root.BojangQR);
    const qx = x + w - 14 - qs;
    const tw = hasQR ? qx - 12 - (x + 274) : w - 290;
    s.text('담당자 총평', x + 274, y + 10, { size: 5.6, weight: 800, color: C.blue });
    s.para(ownerVerdict(m), x + 274, y + 19, tw, { size: 6.2, color: C.ink2, lh: 1.45 });
    if (hasQR) {
      s.line(qx - 12, y + 12, qx - 12, y + h - 12, { color: C.tintLine });
      qrBlock(s, qx, y + (h - qs) / 2, qs, m, { label: true });
    }
    return y + h;
  }

  /* 표지 '이번 상담의 결론' 한 줄 */
  function ownerActionLine(m) {
    if (!m.needList.length) return '금액 조정';
    const f = m.first;
    return f ? `${f.item.name}부터` : '배분 조정';
  }

  /* 페이지별 담당자 소견 — 모두 고객 데이터로만 씁니다 */
  function cancerNote(m) {
    const cr = m.rows[0], g = PK(cr, 'general'), sim = PK(cr, 'similar'), t = PK(cr, 'treatment');
    const out = [`일반암 진단비는 ${won(g.val)}만원으로 권장 ${won(g.rec)}만원의 ${Math.round(g.fill * 100)}%입니다.`];
    if (sim.val <= 0) out.push('유사암 담보가 없어 갑상선암·기타피부암처럼 유사암으로 분류되는 진단은 지급되지 않습니다.');
    if (t.val < t.rec) {
      const miss = (t.subs || []).filter((x) => x.val <= 0).map((x) => x.label);
      out.push(`암 주요치료비 5종은 ${subHave(t)}종·${won(effVal(t))}만원이고, ${miss.slice(0, 2).join('·') || '일부 항목'}이 비어 있습니다.`);
    }
    if (!m.state.cov.cancer.recur) out.push('재진단·전이 담보가 없어 완치 후 재발했을 때 다시 받을 금액이 없습니다.');
    /* v5.6 — 증권 직접 기재 담보를 소견에 반영 */
    const cus = customOf(m, 'cancer');
    if (cus.length) {
      const cusSum = cus.reduce((a, x) => a + Number(x.amount || 0), 0);
      out.push(`증권에 직접 기재한 ${cus.map((x) => `${cutName(x.name, 16)} ${won(x.amount)}만원(${CUSTOM_MODE_TXT[x.mode] || '통합형'})`).slice(0, 3).join('·')}${cus.length > 3 ? ` 외 ${cus.length - 3}건` : ''}은 합계 ${won(cusSum)}만원으로 치료비 축에 합산해 위 금액에 반영했습니다.`);
    }
    const gap = cr.gaps[0];
    out.push(gap
      ? `그래서 이번 설계는 ${gap.label} ${won(gap.need)}만원을 먼저 채우고, 나머지는 지금 보험료 안에서 순서를 정하는 쪽으로 잡았습니다.`
      : '금액은 기준선을 넘었으니 재진단 조건과 1회한 조항을 확인하시면 됩니다.');
    return out.join(' ');
  }

  function brainHeartNote(m) {
    const b = m.rows[1], h = m.rows[2];
    const bcore = ((PK(b, 'dx').dx || {}).core) || { val: 0 };
    const hcore = ((PK(h, 'dx').dx || {}).core) || { val: 0 };
    const out = [`뇌혈관질환 진단비 ${won(bcore.val)}만원, 허혈성심장질환 진단비 ${won(hcore.val)}만원입니다.`];
    if (!bcore.val) out.push('뇌혈관질환 범위가 비어 있어 가장 흔한 뇌경색(I63)은 뇌졸중 담보 금액만 지급됩니다.');
    if (!hcore.val) out.push('허혈성심장 범위가 비어 있어 협심증(I20)과 스텐트 시술은 지급되지 않습니다.');
    /* v5.6 — 증권 직접 기재 담보(통합형/개별형)를 소견에 반영 */
    const cusBH = [].concat(
      customOf(m, 'brain').map((x) => Object.assign({}, x, { area: '뇌' })),
      customOf(m, 'heart').map((x) => Object.assign({}, x, { area: '심장' }))
    );
    if (cusBH.length) {
      out.push(`증권에 직접 기재한 ${cusBH.map((x) => `${x.area} ${cutName(x.name, 14)} ${won(x.amount)}만원(${CUSTOM_MODE_TXT[x.mode] || '통합형'})`).slice(0, 3).join('·')}${cusBH.length > 3 ? ` 외 ${cusBH.length - 3}건` : ''}은 주요치료비 3종 합계에 합산해 위 판단에 넣었습니다.`);
    }
    /* v7.4 — 단독 치료비와 주요치료비(통합형)를 나눠 설명 */
    const bMain = mainOf(m.state, 'brain'), hMain = mainOf(m.state, 'heart');
    if (bMain || hMain) {
      const bits = [];
      if (bMain) bits.push(`뇌 ${won(bMain)}만원`);
      if (hMain) bits.push(`심장 ${won(hMain)}만원`);
      const shared = mainShared(m.state, 'brain') || mainShared(m.state, 'heart');
      out.push(`단독 치료비(혈전용해제·수술·중환자실)와 별도로 묶음형 주요치료비가 ${bits.join(' · ')}${shared ? ' (뇌·심장 공통 담보)' : ''} 있습니다 — 중복 지급 여부는 약관으로 확인합니다.`);
    }
    const gap = (b.gaps[0] || h.gaps[0]);
    out.push(gap
      ? `두 축을 함께 보면 ${gap.label} ${won(gap.need)}만원이 가장 먼저 채울 금액입니다.`
      : '금액은 기준선을 넘었으니 주요치료비 3종과 후유장해 담보를 확인하는 순서입니다.');
    return out.join(' ');
  }

  function careNote(m) {
    const sv = m.rows[3], ca = m.rows[4];
    const out = [`수술비는 질병 ${['disease', 'disease15', 'diseaseNdae', 'diseaseNonPay'].filter((k) => PK(sv, k).val > 0).length}/4축 · 상해 ${['injury', 'injury15'].filter((k) => PK(sv, k).val > 0).length}/2축입니다.`];

    out.push(`간병은 일반병원 일당 ${won(m.state.cov.care.daily)}만원, 요양병원 ${m.state.cov.care.nDaily ? won(m.state.cov.care.nDaily) + '만원' : '담보 없음'}이고 지급 기준은 ${({ time: '하루 8시간', money: '하루 7~8만원', unknown: '확인 필요' })[m.state.cov.care.basis]}입니다.`);
    if (m.state.silson === 'none') out.push('실손이 없어 입원·통원 의료비를 받을 축이 비어 있습니다. 진단비보다 실손을 먼저 세우는 것이 순서입니다.');
    else out.push(`실손은 ${m.state.silson}세대입니다. 09p에서 선택형 할인 특약과 5세대 전환을 같은 표에 놓고 비교했습니다.`);
    if (ca.gaps.length) out.push(`보완이 필요하다면 ${ca.gaps[0].label} ${won(ca.gaps[0].need)}만원부터입니다.`);
    /* v5.6 — 증권 직접 기재 담보 */
    const cusSC = [].concat(
      customOf(m, 'surgery').map((x) => Object.assign({}, x, { area: '수술' })),
      customOf(m, 'care').map((x) => Object.assign({}, x, { area: '간병' }))
    );
    if (cusSC.length) {
      out.push(`증권에 직접 기재한 ${cusSC.map((x) => `${x.area} ${cutName(x.name, 14)} ${won(x.amount)}만원`).slice(0, 3).join('·')}${cusSC.length > 3 ? ` 외 ${cusSC.length - 3}건` : ''}은 고정 6축 밖의 특약이라 축 판정에는 더하지 않고 증권 확인표에 그대로 적었습니다.`);
    }
    return out.join(' ');
  }

  /* 리모델링 페이지 소견 — 조정안 입력 여부에 따라 두 가지 문장 */
  function remodelNote(m, c, edited, sim, v) {
    const out = [];
    if (edited && c) {
      const cuts = c.contractRows.filter((r) => r.act !== 'keep');
      const closed = cuts.filter((r) => r.act === 'close').length;
      const reduced = cuts.filter((r) => r.act === 'reduce').length;
      if (closed || reduced) out.push(`계약 ${closed ? `${closed}건 정리` : ''}${closed && reduced ? '·' : ''}${reduced ? `${reduced}건 감액` : ''}으로 월 ${won(Math.abs(c.contractDelta))}만원을 마련했습니다.`);
      const boosted = (c.axes || []).filter((a) => {
        if (!a.changed) return false;
        const row = (c.rows || []).find((r) => r.key === a.axis.key);
        return !row || row.afterPct > row.beforePct;
      });
      if (boosted.length) out.push(`${boosted.map((a) => a.axis.name).join('·')} 보강으로 충족도가 올라갔습니다.`);
      out.push(`그 결과 월 보험료는 ${won(v.beforePrem)}만원에서 ${won(v.afterPrem)}만원(${c.premDelta === 0 ? '변동 없음' : `${c.premDelta > 0 ? '+' : '−'}${won(Math.abs(c.premDelta))}만원`}), 종합 점수는 ${v.beforeScore}점에서 ${v.afterScore}점(${c.scoreDelta >= 0 ? '+' : '−'}${Math.abs(c.scoreDelta)})이 됩니다.`);
      out.push(c.premDelta <= 0 ? '추가 부담 없이 배분만 바꾼 안입니다. 기존 핵심 담보는 그대로 두었습니다.' : `늘어나는 부담은 월 ${won(c.premDelta)}만원이고, 이 부분은 고객님이 선택하실 수 있습니다.`);
    } else {
      out.push('아직 조정안이 입력되지 않아 현재 보장을 그대로 기준으로 계산했습니다.');
      if (m.first) out.push(`${m.first.item.name}을(를) 권장선까지 채우면 같은 보험료에서 종합 점수 ${v.beforeScore}→${v.afterScore}점, 5대 평균 ${v.avgBefore}→${v.avgAfter}%가 됩니다(시뮬레이션).`);
      out.push('리모델링 비교기에서 계약별 유지·감액·정리와 보강 금액을 입력하시면 이 페이지가 실제 Before/After 표로 바뀝니다.');
    }
    if (m.state.silson === '1' || m.state.silson === '2') out.push(`실손은 ${m.state.silson}세대라 선택형 할인 특약과 5세대 전환을 같은 표에 놓고 비교했습니다. 보험료를 아끼는 결정과 보장이 좋아지는 결정은 다릅니다.`);
    return out.join(' ');
  }

  function renewNote(m) {    const csn = m.contractStats;
    const out = [];
    if (m.state.flags.renew) out.push('보유 계약에 갱신형 담보가 포함되어 있습니다. 다음 갱신 연령과 그때의 예상 보험료를 증권의 갱신 보험료 표로 확인하시면 노후 보험료를 미리 가늠할 수 있습니다.');
    else out.push('갱신형 담보 비중이 크지 않아 보험료가 상대적으로 안정적입니다. 대신 만기 이후 보장 공백을 함께 설계해야 합니다.');
    if (csn.shortMaturityCount) out.push(`만기 80·90세 계약이 ${csn.shortMaturityCount}건이라 80세 이후 보장이 먼저 끊깁니다. 이 구간은 간병·요양 담보로 따로 준비하는 것이 좋습니다.`);
    if (csn.paidUpCount) out.push(`이미 납입이 끝난 계약 ${csn.paidUpCount}건은 보험료 부담 없이 보장만 남아 있으니 해지하지 않고 유지합니다.`);
    if (m.client.ageDay) out.push(`보험나이가 바뀌는 ${m.client.ageDay.label}(D-${m.client.ageDay.days}) 전에 금액을 결정하면 같은 보장을 조금 더 낮은 보험료로 잡을 수 있습니다.`);
    return out.join(' ');
  }

  /* 담당자 총평 문장 — 고객 데이터로만 만듭니다 */  function ownerVerdict(m) {
    if (!m.needList.length) {
      return `${m.client.name}님은 5대 담보 ${m.score}점으로 기준선을 넘었습니다. 해지 없이 갱신 시점과 만기 구조만 확인하면 되고, 남은 과제는 금액 조정입니다.`;
    }
    const f = m.first;
    const tail = (f && f.gaps.length)
      ? ` ${f.gaps[0].label} 기준 ${won(f.gaps[0].need)}만원을 먼저 채우면 이 한 칸이 채워집니다.`
      : ' 세부 담보의 코드·지급 횟수를 확인하는 것이 다음 순서입니다.';
    return `${m.client.name}님은 ${m.score}점(${m.letter})으로, 지금은 보장을 늘리는 단계가 아니라 배분을 바꾸는 단계입니다. ${f ? `${f.item.rank}순위 ${f.item.name}(${f.pct}%)부터` : ''}${tail}`;
  }

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
    s.rect(s.ML, y, w, h, { fill: C.hero, r: 7 });
    // 왼쪽 등급
    s.text('종합 보장등급', s.ML + 16, y + 13, { size: 6.4, weight: 700, color: C.heroInk });
    s.text(m.letter, s.ML + 16, y + 22, { size: 34, weight: 800, color: '#FFFFFF' });
    s.text(`${m.score}점 / 100`, s.ML + 16, y + h - 22, { size: 7.4, weight: 600, color: C.heroInk2 });
    s.text(m.grade.label, s.ML + 16, y + h - 12, { size: 6.6, weight: 700, color: C.heroOk });

    // 가운데 레이더
    const cx = s.ML + 168, cy = y + h / 2 + 2;
    const axes = m.rows.map((r) => ({ label: '', value: r.r.fill }));
    s.radar(cx, cy, 34, axes, { color: C.heroOk, fill: 'rgba(255,255,255,0.16)', labelSize: 0, showValue: false });

    // 오른쪽 도넛
    const dn = m.counts;
    const dcx = s.ML + 306, dcy = y + h / 2;
    const segs = [
      { value: dn.enough, color: C.mint },
      { value: dn.check, color: C.orange },
      { value: dn.short, color: C.short },
      { value: dn.none, color: C.gray }
    ];
    s.donut(dcx, dcy, 30, segs, { inner: 19, innerFill: C.hero, centerValue: dn.total, centerLabel: '항목', centerSize: 14, centerColor: '#fff' });
    const legend = [['충분', C.mint, dn.enough], ['점검', C.orange, dn.check], ['보완 후보', C.short, dn.short], ['미가입', C.gray, dn.none]];
    legend.forEach((l, i) => {
      const ly = y + h / 2 - 22 + i * 12;
      s.rect(dcx + 36, ly + 1, 5, 5, { fill: l[1], r: 2.5 });
      s.text(`${l[0]} ${l[2]}`, dcx + 45, ly - 0.5, { size: 6.2, weight: 600, color: C.heroInk2 });
    });

    // 우측 끝 보완 우선
    const fx = s.W - s.MR - 92;
    s.text('먼저 채울 곳', fx, y + 13, { size: 6.2, weight: 700, color: C.heroInk });
    if (m.first) {
      s.text(`${m.first.item.rank}순위 ${m.first.item.name}`, fx, y + 24, { size: 11, weight: 800, color: C.heroGold });
      s.text(`${m.first.pct}% · ${m.first.label}`, fx, y + 40, { size: 6.8, weight: 600, color: '#fff' });
      if (m.first.gaps.length) s.text(`보완 후보 ${won(m.first.gaps[0].need)}만원`, fx, y + 50, { size: 6.8, weight: 700, color: C.heroWarn });
    } else {
      s.text('구조 유지', fx, y + 24, { size: 11, weight: 800, color: C.heroOk });
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
      ['보완 후보', s.ML + w - 7, 'right']
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
      s.text(shortSummary(row, m), s.ML + rankW + 6, cy + rowH / 2 - 3.6, { size: 6.4, weight: 500, color: C.ink2 });
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
      s.rect(x, y, cw, h, { fill: i === 0 ? C.tint : i === 1 ? C.orangeSoft : C.mintSoft, r: 6, stroke: C.line });
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
    s.rect(s.ML, y, w, h, { fill: o.fill || C.tint2, r: 4, stroke: o.stroke || C.tintLine });
    s.rect(s.ML, y, 2.4, h, { fill: o.accent || C.blue, r: 1.2 });
    s.para(text, s.ML + 12, y + 7, w - 24, { size: o.size || 7, color: o.color || C.ink2, lh: 1.45 });
    return y + h;
  }

  function todoStrip(s, y, text) {
    return noteStrip(s, y, text, { fill: C.mintSoft, stroke: C.mintLine, accent: C.mint, size: 7.2, color: C.mintInk });
  }

  /* =========================================================
     v5.7 — 불완전판매 방지 경고 스트립 (05·06·07·09p)
     상담 현장에서 반드시 말로 확인해야 하는 면책·감액·지급 제한만 모아,
     해당 영역 페이지에 앰버 색 배지 스트립으로 자동 인쇄합니다.
     ========================================================= */
  function warnData(key) {
    const W = (typeof SALE_WARNINGS !== 'undefined') ? SALE_WARNINGS : null;
    if (!W) return null;
    if (W[key]) return W[key];
    if (key === 'neurolog' || key === 'brainheart') return W.brain;
    return null;
  }
  function warnStrip(s, y, key, o) {
    o = o || {};
    const W = warnData(key);
    if (!W) return y;
    const w = o.w || s.CW, x = o.x || s.ML;
    const items = W.items || [];
    const cols = o.cols || items.length;
    const cw = (w - 24 - (cols - 1) * 8) / cols;
    const tw = cw - 13;
    let bodyH = 0;
    items.forEach((it) => { bodyH = Math.max(bodyH, s.height(it, tw, o.size || 5.6, 1.4)); });
    const h = 16 + bodyH + 7;
    s.rect(x, y, w, h, { fill: o.fill || C.orangeSoft, r: 5, stroke: o.stroke || C.orangeLine });
    s.rect(x, y, 2.8, h, { fill: o.accent || C.orange, r: 1.4 });
    s.badge(x + 10, y + 5, '⚠ 불완전판매 방지 · ' + W.label, 'need', { size: 5.9, h: 11, padX: 4.5 });
    s.text(W.title || '가입 전 확인', x + w - 10, y + 5.5, { size: 5.6, weight: 600, color: C.orange, align: 'right' });
    items.forEach((it, i) => {
      const ix = x + 10 + i * (cw + 8);
      s.iconCircle(ix + 2.6, y + 20, 1.6, { fill: C.orange });
      s.para(it, ix + 8, y + 16, tw, { size: o.size || 5.6, color: o.color || C.ink2, lh: 1.4 });
    });
    return y + h;
  }

  /* =========================================================
     v5.7 — 갱신형 vs 비갱신형 20년 보험료 추이 차트 (08p)
     BK.renewTrend()의 시뮬레이션 값을 축·교차점·범례와 함께 그립니다.
     ========================================================= */
  function renewChart(s, x, y, w, tr, o) {
    o = o || {};
    const h = o.h || 132;
    const padL = 28, padR = 10, padT = 30, padB = 30;
    const footY = y + h - 8;
    const px = x + padL, py = y + padT, pw = w - padL - padR, ph = h - padT - padB;
    const maxY = Math.max(1, tr.max * 1.1);
    const X = (yr) => px + (yr / 20) * pw;
    const Y = (v) => py + ph - (v / maxY) * ph;
    s.rect(x, y, w, h, { fill: '#fff', r: 6, stroke: C.line });
    s.rect(x, y, w, 2.6, { fill: o.accent || C.orange, r: 1.3 });
    s.text('20년 예상 보험료 추이', x + 10, y + 8, { size: 7.6, weight: 800, color: C.navy });
    s.text(`현재 월 ${won(tr.base)}만원 기준 · 세로축 만원${tr.assumed ? ' (금액 미입력 — 예시)' : ''}`, x + 10 + s.measure('20년 예상 보험료 추이', 7.6, 800) + 8, y + 10, { size: 5.6, weight: 500, color: C.muted });
    /* 범례 */
    const lg = [['갱신형', C.orange], ['비갱신형', C.blue]];
    const lx = x + w - 10 - 104;
    lg.forEach(([lab, col], i) => {
      const bx = lx + i * 52;
      s.line(bx, y + 13, bx + 12, y + 13, { color: col, w: 1.8 });
      s.text(lab, bx + 15, y + 9, { size: 5.8, weight: 700, color: C.ink2 });
    });
    /* 격자·Y축 눈금 */
    [0, 0.5, 1].forEach((k) => {
      const yy = py + ph - k * ph;
      s.line(px, yy, px + pw, yy, { color: C.line2, dash: k === 0 ? null : [2, 2] });
      s.text(won(Math.round(maxY * k)), px - 4, yy - 3.2, { size: 5.2, weight: 600, color: C.muted, align: 'right' });
    });
    /* X축 눈금 — 현재 · +5 · +10 · +15 · +20년 (나이 병기) */
    tr.ticks.forEach((t) => {
      const xx = X(t);
      s.line(xx, py, xx, py + ph, { color: C.line2, dash: [2, 2] });
      s.text(t === 0 ? '현재' : `+${t}년`, xx, py + ph + 4, { size: 5.4, weight: 700, color: C.ink2, align: t === 0 ? 'left' : t === 20 ? 'right' : 'center' });
      s.text(`${tr.startAge + t}세`, xx, py + ph + 11, { size: 4.9, weight: 500, color: C.muted, align: t === 0 ? 'left' : t === 20 ? 'right' : 'center' });
    });
    /* 곡선 */
    const c = s.ctx;
    c.save();
    c.beginPath(); c.rect(px, py - 2, pw, ph + 4); c.clip();
    /* 갱신형 아래 면적 */
    c.beginPath();
    tr.years.forEach((yr, i) => { const xx = X(yr), yy = Y(tr.renew[i]); i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); });
    c.lineTo(X(20), py + ph); c.lineTo(X(0), py + ph); c.closePath();
    const grd = c.createLinearGradient(0, py, 0, py + ph);
    grd.addColorStop(0, 'rgba(192,122,44,0.26)');
    grd.addColorStop(1, 'rgba(192,122,44,0.04)');
    c.fillStyle = grd; c.fill();
    const drawLine = (arr, col) => {
      c.beginPath();
      arr.forEach((v, i) => { const xx = X(i), yy = Y(v); i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); });
      c.strokeStyle = col; c.lineWidth = 1.9; c.lineJoin = 'round'; c.stroke();
    };
    drawLine(tr.level, C.blue);
    drawLine(tr.renew, C.orange);
    c.restore();
    /* 교차점 */
    if (tr.crossYear != null) {
      const cx = X(tr.crossYear), cy = Y(tr.level[Math.min(20, Math.round(tr.crossYear))]);
      s.line(cx, py, cx, py + ph, { color: C.red, w: 0.9, dash: [2.5, 2] });
      s.ctx.save();
      s.ctx.beginPath(); s.ctx.arc(cx, cy, 3.1, 0, Math.PI * 2);
      s.ctx.fillStyle = '#fff'; s.ctx.fill();
      s.ctx.strokeStyle = C.red; s.ctx.lineWidth = 1.4; s.ctx.stroke();
      s.ctx.restore();
      const lab = tr.crossYear === 0 ? '이미 교차' : `${tr.crossYear}년 뒤 역전`;
      const lw = s.measure(lab, 5.4, 800) + 10;
      const boxX = Math.min(px + pw - lw, Math.max(px, cx - lw / 2));
      s.rect(boxX, py + 2, lw, 11, { fill: C.redSoft, r: 3, stroke: C.redSoft });
      s.text(lab, boxX + lw / 2, py + 4, { size: 5.4, weight: 800, color: C.red, align: 'center' });
    }
    /* 20년 뒤 수치 */
    s.text(`갱신형 ${won(tr.at20.renew)}`, X(20) - 2, Y(tr.at20.renew) - 7, { size: 5.6, weight: 800, color: C.orange, align: 'right' });
    s.text(`비갱신 ${won(tr.at20.level)}`, X(20) - 2, Y(tr.at20.level) + 2, { size: 5.6, weight: 800, color: C.blue, align: 'right' });
    s.text(`예시 시뮬레이션 — 갱신 5년 주기·연 나이 인상을 가정한 값입니다. 실제 갱신 보험료는 증권의 갱신 보험료 표로 확인하세요.`, x + 10, footY, { size: 5.2, weight: 500, color: C.muted });
    return y + h;
  }

  /* v5.7 — 카카오톡 상담 링크 / 전화번호 → QR 내용 */
  function qrInfo(m) {
    const b = brandInfo(m);
    const phone = String(b.phone || '').trim();
    const kakao = String(b.kakao || '').trim();
    const isUrl = (v) => /^https?:\/\//i.test(v) || /^[a-z0-9.-]+\.(com|net|kr|me|link|io)\/?/i.test(v);
    if (kakao && isUrl(kakao)) {
      return { text: /^https?:\/\//i.test(kakao) ? kakao : 'https://' + kakao, label: '카카오톡 상담', kind: 'kakao' };
    }
    if (phone) {
      const digits = phone.replace(/[^0-9+]/g, '');
      if (digits.length >= 7) return { text: 'tel:' + digits, label: '전화 바로 연결', kind: 'tel' };
    }
    if (kakao) return { text: kakao, label: '카카오톡 ID', kind: 'id' };
    return null;
  }
  /* QR 블록 — 명함 안에 스캔 가능한 크기(≥34pt)로 넣습니다 */
  function qrBlock(s, x, y, size, m, o) {
    o = o || {};
    const info = qrInfo(m);
    if (!info || !root.BojangQR) {
      s.rect(x, y, size, size, { fill: '#fff', r: 3, stroke: C.line2 });
      s.para(o.empty || '브랜드 설정에서 연락처를 입력하면 QR이 인쇄됩니다', x + 4, y + size / 2 - 6, size - 8, { size: 4.6, color: C.muted, lh: 1.3, align: 'center' });
      return false;
    }
    const ok = root.BojangQR.draw(s, x, y, size, info.text, { quiet: 2, fill: o.fill || C.navy, stroke: C.line2, r: 3 });
    if (o.label !== false) s.text(info.label, x + size / 2, y + size + 2.5, { size: 5.0, weight: 700, color: C.muted, align: 'center' });
    return ok;
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
      const tones = [C.hero, C.navy2, C.blue, mix('#FFFFFF', C.blue, 0.3), mix('#FFFFFF', C.blue, 0.55), mix('#FFFFFF', C.blue, 0.76)];
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
    const rowH = o.rowH || 15;
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
    const headH = 16, rowH = o.rowH || 22;
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
      const twoLine = rowH >= 18;
      s.text(c.insurer || '—', s.ML + 7, cy + (twoLine ? 3.5 : 4.4), { size: 6.4, weight: 700, color: C.navy });
      if (twoLine) s.text(c.product || '—', s.ML + 7, cy + 12, { size: 5.8, weight: 500, color: C.ink2 });
      else {
        const ix = s.ML + 10 + s.measure(c.insurer || '—', 6.4, 700);
        s.text(cutName(c.product || '—', 20), ix, cy + 4.4, { size: 5.6, weight: 500, color: C.ink2 });
      }
      s.text(`${won(c.premium)}만원`, s.ML + w * 0.62 - 7, cy + (twoLine ? 7 : 4.4), { size: 6.4, weight: 700, color: C.navy, align: 'right' });
      const paid = (c.pay || '납입중') === '납입완료';
      s.text(paid ? '납입완료' : '납입중', s.ML + w * 0.62 + (w * 0.15) / 2, cy + (twoLine ? 7 : 4.4), { size: 5.9, weight: 700, color: paid ? C.muted : C.mint, align: 'center' });
      s.text(`${c.maturity && c.maturity !== '미입력' ? c.maturity : '만기 미입력'} · ${c.renew ? '갱신형' : '비갱신'}`, s.ML + w * 0.77 + (w * 0.23) / 2, cy + (twoLine ? 7 : 4.4), { size: 5.8, weight: 600, color: c.renew ? C.orange : C.mint, align: 'center' });
      s.line(s.ML, cy + rowH, s.ML + w, cy + rowH, { color: C.line2 });
      cy += rowH;
    });
    if (rows.length > (o.max || 8)) {
      /* v6.1 — 5건 초과분을 조용히 버리지 않고 “외 N건”을 인쇄합니다 */
      s.rect(s.ML, cy, w, 12, { fill: C.orangeSoft });
      s.text(`외 ${rows.length - (o.max || 8)}건 — 앱 입력 화면·30장 플랜북 2p에서 전수 확인`, s.ML + 7, cy + 2.6, { size: 5.8, weight: 700, color: C.orange });
      cy += 12;
    }
    if (rows.length) {
      const cs = m.contractStats || BK.contractStats(m.contracts);
      s.rect(s.ML, cy, w, 16, { fill: C.tint });
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
      y = s.table(s.ML, y, s.CW, ['우선순위', '현재 보장', '권장 기준', '상태', '보완 후보'], rows, {
        widths: [86, 128, 128, 96, 77], size: 6.8, rowH: 16.5, align: ['left', 'left', 'left', 'center', 'right']
      });
      const sT = PK(m.rows[0], 'treatment');
      const tLine = `암 주요치료비 5종 — ${(sT.subs || []).map((x) => `${TREAT_SHORT[x.key] || x.label} ${subEff(x) ? won(subEff(x)) : '없음'}`).join(' · ')} (합계 ${won(effVal(sT))} / 권장 ${won(sT.rec)}만원${sT.customVal + (sT.crossVal || 0) > 0 ? ' · 직접 기재 포함' : ''})`;
      s.rect(s.ML, y + 4, s.CW, 12, { fill: C.tint2, r: 3, stroke: C.tintLine });
      s.rect(s.ML, y + 4, 2, 12, { fill: C.blue, r: 1 });
      s.text(tLine, s.ML + 8, y + 8, { size: 5.3, weight: 600, color: C.ink2 });
      y += 17;
      const bdxS = PK(m.rows[1], 'dx').dx || {};
      const hdxS = PK(m.rows[2], 'dx').dx || {};
      const bSub = bdxS.subs || [], hSub = hdxS.subs || [];
      const dxLine = `뇌 진단비 — 뇌혈관 ${won((bSub[0] || {}).val || 0)} · 뇌졸중 ${won((bSub[1] || {}).val || 0)} · 뇌출혈 ${won((bSub[2] || {}).val || 0)} / 심장 — 허혈성 ${won((hSub[0] || {}).val || 0)} · 급성심근경색 ${won((hSub[1] || {}).val || 0)} (만원)`;
      s.rect(s.ML, y + 3, s.CW, 11, { fill: C.tint, r: 3, stroke: C.tintLine });
      s.rect(s.ML, y + 3, 2, 11, { fill: C.rose, r: 1 });
      s.text(dxLine, s.ML + 8, y + 5.4, { size: 5.5, weight: 600, color: C.navy2 });
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

  /* 현실 비용·기간 근거 스트립 — 고객이 필요성을 직접 체감하는 숫자 (v5.5) */
  function costStrip(s, x, y, w, title, items, o) {
    o = o || {};
    const h = o.h || 44;
    s.rect(x, y, w, h, { fill: C.tint2, r: 5, stroke: C.tintLine });
    s.rect(x, y, 2.6, h, { fill: o.accent || C.blue, r: 1.3 });
    s.text(title, x + 10, y + 6, { size: 6.2, weight: 800, color: o.accent || C.blue });
    const cw = (w - 20) / items.length;
    items.forEach((it, i) => {
      const ix = x + 10 + i * cw;
      if (i) s.line(ix - 5, y + 18, ix - 5, y + h - 7, { color: C.tintLine });
      s.text(it[0], ix, y + 16, { size: 5.3, weight: 600, color: C.muted });
      s.text(it[1], ix, y + 23.5, { size: 8, weight: 800, color: C.navy });
      if (it[2]) s.text(it[2], ix, y + 34, { size: 5, weight: 500, color: C.muted });
    });
    return y + h;
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

    /* 01 표지 & 명함 */
    P.push(function (s) {
      s.photoBand(0, 308, {});
      s.header({ kicker: 'LIFE REPORT', no: '01', total: '10' });
      s.brandWordmark(s.ML, 54, { size: 8.6, contact: false });
      s.text('PREMIUM COVERAGE REPORT', s.ML, 76, { size: 6.4, weight: 800, color: C.blue });
      s.text('보장분석 리포트', s.ML, 86, { size: 30, weight: 800, color: C.navy });
      s.text('과도한 보장은 줄이고, 보완 후보는 채우는', s.ML, 128, { size: 10, weight: 700, color: C.blue });
      s.para(`${m.client.name}님의 보장자산을 한눈에 진단하고, 보완 우선순위를 숫자와 근거로 설명하는 10장 분석 리포트입니다.`, s.ML, 146, 264, { size: 8.2, color: C.ink2, lh: 1.5 });

      s.text(`${m.client.name} 고객님`, s.ML, 196, { size: 10.4, weight: 800, color: C.navy });
      const ageLine = [
        `상담일 ${m.dateLabel}`,
        m.client.insuranceAge ? `보험나이 ${m.client.insuranceAge}세` : `연령대 ${m.state.age}대`,
        `실손 ${m.state.silson === 'none' ? '없음' : m.state.silson + '세대'}`
      ].join(' · ');
      s.text(ageLine, s.ML, 212, { size: 7, weight: 500, color: C.ink2 });

      /* 등급 배지 — 진한 히어로 블록(테마 색) */
      s.rect(s.ML, 232, 186, 54, { fill: C.hero, r: 6 });
      s.text('종합 보장등급', s.ML + 12, 240, { size: 5.8, weight: 700, color: C.heroInk });
      s.text(m.letter, s.ML + 12, 249, { size: 20, weight: 800, color: '#fff' });
      s.text(`${m.score}점`, s.ML + 48, 252, { size: 10, weight: 700, color: C.heroOk });
      s.text(`${m.grade.label} · ${m.counts.enough}개 충분`, s.ML + 48, 266, { size: 6.2, weight: 600, color: C.heroInk2 });

      /* 담당자 명함 */
      nameCard(s, s.W - s.MR - 196, 152, 196, m, { h: 166 });

      let y = 336;
      s.text('이 리포트에서 확인하실 수 있습니다', s.ML, y, { size: 11.6, weight: 800, color: C.navy });
      s.line(s.ML + s.measure('이 리포트에서 확인하실 수 있습니다', 11.6, 800) + 8, y + 8, s.W - s.MR, y + 8, { color: C.tintLine });

      const cards = [
        { n: '01', pg: '02p', t: '보장 진단 결과 요약', d: '전체 보장 현황과 진단비 합계를 항목별로 분해해 보여드립니다.', kind: 'donut' },
        { n: '02', pg: '05~08p', t: '5대 질병 보장 분석', d: '암·뇌·심장·수술·간병 보장의 두께와 실제 비용 근거를 비교합니다.', kind: 'radar' },
        { n: '03', pg: '09p', t: '리모델링 Before / After', d: '계약 정리·감액·보강안과 실손 세대 선택을 한 장에 비교합니다.', kind: 'bars' },
        { n: '04', pg: '10p', t: '요약 · 로드맵 · 담당자', d: '점수 요약, 실행 순서, 상담 창구를 마지막 장에 정리했습니다.', kind: 'road' }
      ];
      const cw = (s.CW - 8 * 3) / 4, ch = 196;
      cards.forEach((c, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y + 16, cw, ch, { fill: '#fff', r: 6, stroke: C.line });
        s.iconCircle(x + 14, y + 32, 7.6, { fill: C.blue, num: c.n, size: 6.4, color: '#fff' });
        s.text(c.pg, x + cw - 8, y + 29, { size: 5.6, weight: 700, color: C.muted, align: 'right' });
        s.para(c.t, x + 8, y + 46, cw - 16, { size: 8.2, weight: 800, color: C.navy, lh: 1.3 });
        s.para(c.d, x + 8, y + 72, cw - 16, { size: 6.2, color: C.ink2, lh: 1.45 });
        const cy = y + 112;
        if (c.kind === 'donut') {
          s.donut(x + cw / 2, cy + 36, 28, [
            { value: m.counts.enough, color: C.mint }, { value: m.counts.check, color: C.orange },
            { value: m.counts.short, color: C.short }, { value: m.counts.none, color: C.gray }
          ], { inner: 17, centerValue: m.counts.total, centerLabel: '항목', centerSize: 13 });
        } else if (c.kind === 'radar') {
          s.radar(x + cw / 2, cy + 30, 28, m.rows.map((r) => ({ label: '', value: r.r.fill })), { color: C.blue, fill: 'rgba(58,110,165,0.14)', labelSize: 0 });
          s.text('5대 보장 밸런스', x + cw / 2, cy + 64, { size: 5.6, weight: 600, color: C.muted, align: 'center' });
        } else if (c.kind === 'bars') {
          m.rows.forEach((r, k) => {
            s.rect(x + 10, cy + 10 + k * 14, cw - 20, 6.5, { fill: C.line2, r: 3.2 });
            s.rect(x + 10, cy + 10 + k * 14, (cw - 20) * Math.max(0.02, r.r.fill), 6.5, { fill: TONE_COLOR[r.level], r: 3.2 });
          });
          s.text('Before 5대 충족도', x + cw / 2, cy + 80, { size: 5.4, weight: 600, color: C.muted, align: 'center' });
        } else {
          m.steps.forEach((st, k) => {
            s.rect(x + 10, cy + 10 + k * 22, cw - 20, 16, { fill: C.tint, r: 3 });
            s.text(`${k + 1}`, x + 15, cy + 13.5 + k * 22, { size: 7, weight: 800, color: C.blue });
            s.text(st.short, x + 25, cy + 14 + k * 22, { size: 6.4, weight: 700, color: C.navy });
          });
        }
      });
      y += 16 + ch;
      y = noteStrip(s, y + 10, `이 리포트는 ${brandInfo(m).consultant}가 ${m.dateLabel} 상담을 기준으로 작성했습니다. 수치는 상담 보조용 자체 산식이며, 통계는 공표 자료(통계청 2024 · 중앙암등록본부 2023 · 중앙심뇌혈관질환센터 2023 · 건보공단 2025)를 인용했습니다.`, { size: 6.3 });

      // 오늘의 결론 3줄
      y += 12;
      s.text('오늘의 결론', s.ML, y, { size: 9.4, weight: 800, color: C.navy });
      y += 14;
      const kpis = [
        { k: '먼저 채울 곳', v: m.first ? `${m.first.item.rank}순위 ${m.first.item.name}` : '구조 유지', s: m.first ? `${m.first.pct}% · ${m.first.label}` : '금액 조정 단계' },
        { k: '보완이 필요한 항목', v: `${m.needList.length}개`, s: m.needList.length ? m.needList.map((x) => x.item.name).join(' · ') : '없음' },
        { k: '이번 상담의 결론', v: ownerActionLine(m), s: `월 ${won(m.premium)}만원 안에서 배분부터 조정` }
      ];
      const kw = (s.CW - 16) / 3;
      kpis.forEach((k, i) => {
        const x = s.ML + i * (kw + 8);
        s.rect(x, y, kw, 58, { fill: i === 0 ? C.tint : '#fff', r: 5, stroke: C.line });
        s.text(k.k, x + 10, y + 8, { size: 6, weight: 600, color: C.muted });
        s.text(k.v, x + 10, y + 18, { size: 10.4, weight: 800, color: C.navy });
        s.para(k.s, x + 10, y + 33, kw - 20, { size: 6, color: C.ink2, lh: 1.35 });
      });
      y += 70;

      /* 받으시는 자료 안내 — 남은 여백을 정보로 채웁니다 */
      const partsInfo = [
        ['함께 받는 자료', '1장 요약', '핵심만 압축한 한 장'],
        ['지금 보고 계신 문서', '10장 상세', '진단 · 분석 · 리모델링'],
        ['상담용 별책', '리모델링 1장', 'Before / After 비교']
      ];
      const pw = (s.CW - 16) / 3;
      partsInfo.forEach((pt, i) => {
        const x = s.ML + i * (pw + 8);
        s.rect(x, y, pw, 44, { fill: '#fff', r: 5, stroke: C.line });
        s.rect(x, y, 2.4, 44, { fill: i === 1 ? C.blue : C.tintLine, r: 1.2 });
        s.text(pt[0], x + 10, y + 7, { size: 5.4, weight: 600, color: C.muted });
        s.text(pt[1], x + 10, y + 16, { size: 8.6, weight: 800, color: C.navy });
        s.text(pt[2], x + 10, y + 31, { size: 5.4, weight: 500, color: C.ink2 });
      });
      y += 54;
      y = noteStrip(s, y, `문의 · ${brandInfo(m).consultant}${brandInfo(m).phone ? ' · ' + brandInfo(m).phone : ''}${brandInfo(m).kakao ? ' · 카카오톡 ' + brandInfo(m).kakao : ''} · 상담일 ${m.dateLabel}. 이 리포트는 ${m.client.name}님 1인 기준으로 작성되었습니다.`, { size: 6.2, fill: C.tint2, accent: C.navy2 });
      s.footer({ left: 'LIFE REPORT · 보장분석 리포트 10장', right: `${m.client.name}님` });
    });

    /* 02 보장 진단 결과 */
    P.push(function (s) {
      let y = H(s, 2, '보장 진단 결과', '전체 보장을 한 장으로 요약했습니다. 충분·점검·보완 후보·미가입의 개수로 먼저 보세요.');
      const dn = m.counts;
      s.rect(s.ML, y, 250, 132, { fill: '#fff', r: 6, stroke: C.line });
      s.text('전체 보장 현황', s.ML + 12, y + 10, { size: 7.4, weight: 800, color: C.navy });
      s.donut(s.ML + 74, y + 78, 46, [
        { value: dn.enough, color: C.mint }, { value: dn.check, color: C.orange },
        { value: dn.short, color: C.short }, { value: dn.none, color: C.gray }
      ], { inner: 29, centerValue: m.score, centerLabel: '종합 점수', centerSize: 18 });
      const lg = [['충분', C.mint, dn.enough], ['점검', C.orange, dn.check], ['보완 후보', C.short, dn.short], ['미가입', C.gray, dn.none]];
      lg.forEach((l, i) => {
        const ly = y + 44 + i * 17;
        s.rect(s.ML + 140, ly + 1, 7, 7, { fill: l[1], r: 3.5 });
        s.text(l[0], s.ML + 152, ly - 1, { size: 7, weight: 600, color: C.ink2 });
        s.text(`${l[2]}개`, s.ML + 224, ly - 1, { size: 7, weight: 800, color: C.navy, align: 'right' });
      });

      const kx = s.ML + 262, kw = s.CW - 262;
      const dxb = dxBreakdown(m);
      const pg = premiumGuide(m);
      const kpis = [
        { label: '종합 보장등급', value: m.letter, sub: `${m.score}점 · ${m.grade.label}`, color: C.blue },
        { label: '진단비·치료비·수술비 합계', value: `${won(m.totalSum)}만원`, sub: `암 ${won(dxb.cancerDx)} · 치료 ${won(dxb.treat)} · 뇌·심장 ${won(dxb.neuroDx + dxb.neuroTreat)} · 수술 ${won(dxb.surgery)}`, color: C.navy },
        { label: '월 보험료', value: `${won(m.premium)}만원`, sub: `연 ${won(m.annual)}만원 · 소득의 ${pg.recPct}% 기준`, color: C.navy },
        { label: '연 보험료 대비 진단비', value: m.ratio ? `${m.ratio.toFixed(1)}배` : '—', sub: '12배 이상이면 균형', color: m.ratio && m.ratio < 12 ? C.orange : C.mint }
      ];
      statTiles(s, kx, y, kw, kpis, { cols: 2, h: 62 });

      /* 진단비 합계 분해 — 02p 한 칸이 어떤 항목의 합인지 밝힙니다 (v5.5) */
      const bx0 = s.ML, by0 = y + 132, bH = 34, bcw = s.CW / 5;
      s.rect(bx0, by0, s.CW, bH, { fill: C.tint2, r: 4, stroke: C.tintLine });
      [
        ['암 진단비', dxb.cancerDx],
        ['암 치료비 5종', dxb.treat],
        ['뇌·심장 진단비', dxb.neuroDx],
        ['수술비 6축', dxb.surgery],
        ['합계', dxb.total, true]
      ].forEach((b, i) => {
        const x = bx0 + i * bcw;
        if (i) s.line(x, by0 + 6, x, by0 + bH - 6, { color: C.tintLine });
        s.text(b[0], x + 8, by0 + 6, { size: 5.6, weight: 600, color: C.muted });
        s.text(`${won(b[1])}만원`, x + 8, by0 + 16, { size: b[2] ? 9.2 : 8.4, weight: 800, color: b[2] ? C.blue : C.navy });
      });

      y += 178;
      y = s.sectionHead(s.ML, y, s.CW, '01', '핵심 진단 3가지', '이 세 문장이 상담의 뼈대입니다');
      const diag = [];
      if (m.thinnest) diag.push({ t: `${m.thinnest.item.rank}순위 ${m.thinnest.item.name}이 충족도 ${m.thinnest.pct}%로 가장 얇습니다`, d: `${m.thinnest.label} · ${m.thinnest.summary}${m.thinnest.gaps.length ? ` — ${m.thinnest.gaps[0].label} 기준 ${won(m.thinnest.gaps[0].need)}만원 부족` : ''}`, tone: 'gap' });
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
      s.text('권장 배분 예시 (상담 보조 · 이 고객의 현재 배분이 아님)', s.ML + 10, y + 8, { size: 6.2, weight: 700, color: C.muted });
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
      y = noteStrip(s, y + 4, `현재 월 보험료는 ${won(m.premium)}만원(연 ${won(m.annual)}만원)입니다. 보장성 보험료의 상담 기준선은 세후 월 소득의 ${pg.minPct}~${pg.recPct}%이고, 이 금액을 그 기준에 맞추면 세후 월 소득 약 ${won(pg.incomeMin)}~${won(pg.incomeMax)}만원 구간에 해당합니다. 배분을 바꾸는 방법은 해지가 아니라 특약 정리(배서)입니다.`, { size: 6.4 });
      const recAge = (k) => { const p0 = PRIORITY.find((x) => x.key === k); return (p0 && p0.rec && p0.rec[m.state.age]) || (p0 && p0.tiers ? p0.tiers.rec : 0); };
      y = noteStrip(s, y + 4, `${m.state.age}대 권장 기준선(상담 보조) — 암 ${won(recAge('cancer'))} · 뇌 ${won(recAge('brain'))} · 심장 ${won(recAge('heart'))} · 수술 ${won(recAge('surgery'))} · 간병 일당 ${won(recAge('care'))}만원. 같은 금액이라도 직업·가족력·실손 세대에 따라 판단이 달라집니다.`, { size: 6.1, fill: C.tint2, accent: C.navy2 });

      y = s.sectionHead(s.ML, y + 12, s.CW, '03', '5대 판정 요약', '이 표만 보셔도 순서가 보입니다');
      const rows5 = m.rows.map((r) => [
        { text: `${r.item.rank}. ${r.item.name}`, weight: 700, color: C.navy },
        r.summary,
        { text: `${r.pct}%`, weight: 700, color: TONE_COLOR[r.level] },
        { text: r.label, badge: r.level, align: 'center' },
        { text: r.gaps.length ? `${won(r.gaps.reduce((a, g) => a + g.need, 0))}만원` : (r.level === 'ok' ? '—' : '범위 점검'), weight: 700, color: r.gaps.length ? C.red : C.muted, align: 'right' }
      ]);
      y = s.table(s.ML, y + 2, s.CW, ['우선순위', '현재 보장', '충족도', '판정', '보완 후보'], rows5, {
        widths: [86, 214, 56, 88, 71], size: 6.6, rowH: 25, align: ['left', 'left', 'center', 'center', 'right']
      });
      s.footer({ left: `${m.client.name}님 · 보장 진단 결과`, right: '02 / 10' });
    });

    /* 03 포트폴리오 */
    P.push(function (s) {
      let y = H(s, 3, '보장 포트폴리오 현황', '보유 계약과 세부 담보를 항목별로 점검합니다. 표의 상태 배지가 다음 상담의 순서를 정합니다.');
      y = s.sectionHead(s.ML, y, s.CW, '01', '보유 계약 목록', m.contracts.length ? `${m.contracts.length}건 · 월 ${won(m.contractTotal)}만원` : '앱에서 계약을 추가할 수 있습니다');
      y = contractTable(s, m, y + 2, { max: 5, rowH: m.contracts.length > 5 ? 15 : 22 });

      /* v4: 가족력 · 고지 판정 */
      y = s.sectionHead(s.ML, y + 10, s.CW, '02', '가족력 · 간편고지 판정', '청약 전에 확인하는 두 가지');
      const half = (s.CW - 8) / 2;
      s.rect(s.ML, y, half, 62, { fill: '#fff', r: 5, stroke: C.line });
      s.text('가족력', s.ML + 10, y + 7, { size: 6.2, weight: 700, color: C.muted });
      const famText = m.family.length ? m.familyLabels.join(' · ') : '미입력';
      s.text(famText, s.ML + 10, y + 17, { size: 9.6, weight: 800, color: m.family.length ? C.navy : C.muted });
      s.para(m.familyNotes.length ? m.familyNotes[0].body : '가족력을 입력하면 같은 위험을 우선 점검합니다.', s.ML + 10, y + 31, half - 20, { size: 5.9, color: C.ink2, lh: 1.35 });
      const dx = s.ML + half + 8;
      const djFill = m.disclosure.tone === 'ok' ? C.mintSoft : m.disclosure.tone === 'gap' ? C.redSoft : C.orangeSoft;
      s.rect(dx, y, half, 62, { fill: djFill, r: 5, stroke: C.line });
      s.text('고지 판정 (3개월 · 1년 · 5년)', dx + 10, y + 7, { size: 6.2, weight: 700, color: C.muted });
      s.text(m.disclosure.label, dx + 10, y + 17, { size: 9.6, weight: 800, color: m.disclosure.tone === 'ok' ? C.mint : m.disclosure.tone === 'gap' ? C.red : C.orange });
      s.para(m.disclosure.headline, dx + 10, y + 31, half - 20, { size: 5.9, color: C.ink2, lh: 1.35 });
      if (m.disclosure.reasons.length) s.text(m.disclosure.reasons.join(' · '), dx + 10, y + 52, { size: 5.4, weight: 600, color: C.orange });
      y += 72;

      y = s.sectionHead(s.ML, y, s.CW, '03', '세부 담보 점검 매트릭스', '충분 / 점검 / 보완 후보 / 미가입');
      const rows = m.parts.map((p) => [
        { text: `${p.rank}. ${p.itemName}`, weight: 700, color: C.navy },
        { text: p.label, weight: 500 },
        { text: p.text, color: C.ink2 },
        { text: LEVEL_LABEL[p.level], badge: p.level === 'enough' ? 'ok' : p.level === 'check' ? 'need' : p.level === 'short' ? 'gap' : 'info', align: 'center' }
      ]);
      y = s.table(s.ML, y + 2, s.CW, ['우선순위', '세부 담보', '현재 / 권장', '상태'], rows, {
        widths: [92, 168, 190, 65], size: 6.5, rowH: 13.0, align: ['left', 'left', 'left', 'center']
      });
      y = noteStrip(s, y + 8, '「미가입」은 담보 자체가 없는 상태, 「보완 후보」는 금액이 권장 기준에 못 미치는 상태, 「점검」은 코드 범위·지급 횟수 확인이 필요한 상태입니다. 권장 기준은 상담 보조용 예시이며 실제 판단은 증권의 담보명·코드·지급 조건으로 확인합니다.', { size: 6.4 });

      /* v5.6 — 증권 직접 기재 추가 담보 (많으면 상위 건 + 남은 건수) */
      const cusAll = customAllOf(m);
      if (cusAll.length) {
        const shown = cusAll.slice(0, 4);
        y = s.sectionHead(s.ML, y + 8, s.CW, '04', '증권 직접 기재 추가 담보', `${cusAll.length}건 · 담보명 그대로 · 치료비 합계 포함`);
        y = s.table(s.ML, y + 2, s.CW, ['담보명', '영역', '구분', '금액'], shown.map((c) => [
          { text: c.name || '담보명 미입력', weight: 700, color: C.navy },
          { text: c.area || '', color: C.ink2, align: 'center' },
          { text: CUSTOM_MODE_TXT[c.mode] || '통합형', badge: c.mode === 'bundle' ? 'info' : 'none', align: 'center' },
          { text: `${won(c.amount)}만원`, weight: 700, color: C.navy, align: 'right' }
        ]), { widths: [250, 62, 88, 115], size: 6.5, rowH: 13, headH: 15, align: ['left', 'center', 'center', 'right'] });
        if (cusAll.length > shown.length) s.text(`그 외 ${cusAll.length - shown.length}건은 각 영역 페이지(05·06·07p)와 앱 입력 화면에서 확인합니다.`, s.ML, y + 3, { size: 5.8, weight: 500, color: C.muted });
      }
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
      const tHave = tsubs.filter((s) => subEff(s) > 0).length;
      const cards = [
        { label: '일반암 진단비', p: PK(cr, 'general'), rec: PK(cr, 'general').rec },
        { label: '유사암 진단비', p: PK(cr, 'similar'), rec: PK(cr, 'similar').rec },
        { label: '암 주요치료비 5종', p: Object.assign({}, tparts, { val: effVal(tparts) }), rec: tparts.rec, note: `5종 중 ${tHave}종` },
        { label: '재진단·전이', p: PK(cr, 'recur'), rec: null }
      ];
      const cw = (s.CW - 8 * 3) / 4;
      cards.forEach((c, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 76, { fill: '#fff', r: 5, stroke: C.line });
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
      y += 80;
      y = s.sectionHead(s.ML, y, s.CW, '01', '왜 이 순서인가 — 공식 통계', '출처를 함께 제시하면 설득이 아니라 확인이 됩니다');
      statCard(s, s.ML, y, (s.CW - 8) / 2, 96, statById('death'));
      statCard(s, s.ML + (s.CW - 8) / 2 + 8, y, (s.CW - 8) / 2, 96, statById('cancer'));
      y += 95;
      y = costStrip(s, s.ML, y, s.CW, '치료비 체감 근거 — 진단비가 아니라 치료비가 길게 나가는 구간', [
        ['표적항암제', '연 수천만 원대', '비급여 구간'],
        ['면역항암제', '연 수천만~1억 원대', '약제·용량별 차이'],
        ['항암 치료 기간', '6개월~수년', '그동안 소득 공백']
      ], { accent: C.blue });
      y = s.sectionHead(s.ML, y + 6, s.CW, '02', '암 담보 코드 · 지급 구조', null);
      y = codeTable(s, s.ML, y + 2, s.CW, PLAYBOOK_CODES('cancer'), { rowH: 12.4 });
      y = s.sectionHead(s.ML, y + 6, s.CW, '03', '지금 채울 것 — 담당자 소견', cr.gaps.length ? `${won(cr.gaps[0].need)}만원 보완 후보` : '기준선 이상');
      y = ownerNote(s, m, y, cancerNote(m), { accent: C.blue });
      y = s.sectionHead(s.ML, y + 6, s.CW, '04', '설계 권장안 — 암 주요치료비 5종 세부', '권장 기준 — 예산에 맞춰 조정합니다');
      const recs = [
        ['일반암 진단비', `${won(m.state.cov.cancer.general)}만원`, `${won(PK(cr, 'general').rec)}만원`, PK(cr, 'general').fill],
        ['유사암 진단비', m.state.cov.cancer.similar ? `${won(m.state.cov.cancer.similar)}만원` : '없음', `${won(PK(cr, 'similar').rec)}만원`, PK(cr, 'similar').fill],
        ['암 주요치료비 5종 합계', `${won(effVal(tparts))}만원`, `${won(tparts.rec)}만원`, tparts.fill]
      ].concat(tsubs.map((sp) => [`　· ${sp.label}`, subEff(sp) ? `${won(subEff(sp))}만원${Number(sp.custom || 0) + Number(sp.cross || 0) > 0 ? ' (직접 기재)' : ''}` : '없음', `${won(sp.rec)}만원`, sp.fill]))
        .concat([['재진단·전이', m.state.cov.cancer.recur ? '보유' : '없음', '보유 권장', m.state.cov.cancer.recur ? 1 : 0]]);
      y = s.table(s.ML, y + 2, s.CW, ['항목', '현재', '권장 기준', '충족도'], recs.map((r) => [
        { text: r[0], weight: 700, color: C.navy }, r[1], { text: r[2], color: C.ink2 },
        { text: `${Math.round(r[3] * 100)}%`, weight: 700, color: r[3] >= 0.99 ? C.mint : r[3] > 0.4 ? C.orange : C.red, align: 'center' }
      ]), { widths: [140, 130, 150, 95], size: 6.3, rowH: 11.6, headH: 13, align: ['left', 'center', 'center', 'center'] });
      y = noteStrip(s, y + 4, '유사암에 묶는 범위와 지급 비율은 상품마다 다릅니다. 원발부위 설명 여부가 다퉈진 판례(대법원 2025.3.13. 선고 2023다250746 — 설명이 없으면 일반암 기준 지급·차액)도 확인하고, 청구권 소멸시효는 상법 제662조에 따라 청구권을 행사할 수 있게 된 때부터 3년임을 안내합니다.', { size: 5.8 });
      /* v5.7 — 불완전판매 방지 경고 */
      y = warnStrip(s, y + 4, 'cancer');
      /* v5.6 — 증권 직접 기재 담보 (실제 특약명·금액 그대로) */
      y = customBox(s, y + 4, customOf(m, 'cancer'), { accent: C.blue, title: '증권 직접 기재 담보 — 암 (증권 담보명 그대로)' });
      s.footer({ left: `${m.client.name}님 · 1순위 암`, right: '05 / 10' });
    });

    /* 06 뇌·심장 */
    P.push(function (s) {
      let y = H(s, 6, '뇌 · 심장 보장범위 분석', '같은 질병이라도 보장 범위에 따라 보장되는 범위가 크게 달라집니다. 담보명이 아니라 코드로 확인합니다.');
      const brain = m.rows[1], heart = m.rows[2];
      const half = (s.CW - 8) / 2;
      const bdx = PK(brain, 'dx').dx || {};
      const hdx = PK(heart, 'dx').dx || {};

      [[brain, '뇌혈관질환', ['뇌혈관질환 I60~I69', '뇌졸중 I60~I63·I65~I66', '뇌출혈 I60~I62'], [C.hero, mix(C.hero, C.blue, 0.45), C.blue], C.blue],
      [heart, '허혈성심장질환', ['허혈성심장 I20~I25', '급성심근경색 I21~I23'], [mix(C.hero, C.red, 0.35), mix('#FFFFFF', C.red, 0.45)], C.red]].forEach((grp, gi) => {
        const [row, title, labels, colors, accent] = grp;
        const x = s.ML + gi * (half + 8);
        s.rect(x, y, half, 146, { fill: gi ? C.tint : C.tint2, r: 6, stroke: C.line });
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
        /* v7.0 — 카드 경계 넘김 방지: 폭을 재어 글자를 줄이고, 긴 줄은 두 줄로 접습니다.
           (4호 봇 지적: 뇌 보장 금액 한 줄이 옆 카드 경계에서 잘리던 결함) */
        const fit = (str, t, w, o) => {
          let size = o.size;
          while (size > o.min && s.measure(String(str), size, o.weight) > w) size -= 0.1;
          s.text(str, t, o.y || y, Object.assign({}, o, { size, y: undefined }));
          return size;
        };
        s.text('핵심 범위 금액', tx, y + 32, { size: 6, weight: 600, color: C.muted });
        fit(`${core ? won(core.val) : '0'}만원`, tx, tw, { y: y + 40, size: 10, weight: 800, min: 7.2, color: core && core.val >= 2000 ? C.mint : C.red });
        s.text('권장 범위', tx, y + 56, { size: 6, weight: 600, color: C.muted });
        fit(gi ? '허혈성심장질환 I20~I25' : '뇌혈관질환 I60~I69', tx, tw, { y: y + 65, size: 6.8, weight: 700, min: 5.4, color: C.navy });
        s.gauge(tx, y + 78, tw, dxp.fill, { color: dxp.fill >= 0.99 ? C.mint : C.orange, h: 6 });
        s.text(`충족 ${Math.round(dxp.fill * 100)}%`, tx, y + 87, { size: 6.2, weight: 600, color: C.ink2 });
        fit(`치료비 3종 ${subHave(PK(row, 'treat'))}/3 · ${won(effVal(PK(row, 'treat')))}만원${mainOf(m.state, row.item.key) > 0 ? ` + 주요치료비 ${won(mainOf(m.state, row.item.key))}` : ''}`, tx, tw, {
          y: y + 97, size: 6.2, weight: 600, min: 5.0, color: (effVal(PK(row, 'treat')) > 0 || mainOf(m.state, row.item.key) > 0) ? C.mint : C.red
        });
        const scen = (dx.scenarios || []).map((sc) => `${BK.dxShort(sc.label.replace(/\(.*/, ''))} ${won(sc.sum)}`).join(' · ');
        s.para(scen, tx, y + 107, tw, { size: 5.5, color: C.navy, lh: 1.24 });
        s.para(gi ? '협심증(I20)은 허혈성심장 담보에서만, 급성심근경색(I21)은 두 담보가 합산됩니다.' : '뇌경색(I63)은 뇌혈관+뇌졸중, 뇌출혈(I61)은 세 담보가 합산됩니다.', tx, y + 123, tw, { size: 5.5, color: C.ink2, lh: 1.26 });
      });
      y += 150;

      y = s.sectionHead(s.ML, y, s.CW, '01', '진단비 3단계·2단계 금액', '핵심 범위 / 현재 / 권장 / 해석');
      const rowOfDx = (dxp, i) => {
        const sp = (dxp.subs || [])[i];
        if (!sp) return ['—', '—', '—', '—'];
        return [sp.label, sp.val ? `${won(sp.val)}만원` : '0원', `${won(sp.rec)}만원`, sp.codes];
      };
      const rows = [
        rowOfDx(PK(brain, 'dx'), 0), rowOfDx(PK(brain, 'dx'), 1), rowOfDx(PK(brain, 'dx'), 2),
        rowOfDx(PK(heart, 'dx'), 0), rowOfDx(PK(heart, 'dx'), 1),
        ['주요치료비 3종', `뇌 ${subHave(PK(brain, 'treat'))}/3 · 심장 ${subHave(PK(heart, 'treat'))}/3`, '혈전용해제·수술·중환자실', '단독 치료비 — 통합형 주요치료비와 별도']
      ];
      y = s.table(s.ML, y + 2, s.CW, ['담보 (범위)', '현재', '권장', '코드'], rows, {
        widths: [150, 90, 90, 185], size: 6.6, rowH: 18, align: ['left', 'center', 'center', 'center']
      });
      y = noteStrip(s, y + 6, (bdx.gapWarn ? '⚠ 뇌혈관질환 진단비가 0원입니다 — 뇌경색(I63)은 뇌졸중 금액만, 뇌혈관 후유증(I69)은 지급되지 않습니다. ' : '')
        + (hdx.gapWarn ? '⚠ 허혈성심장질환 진단비가 0원입니다 — 협심증(I20)·스텐트 시술이 지급되지 않습니다. ' : '')
        + '안쪽 담보는 바깥 담보에 포함되고, 진단 시 금액이 합산됩니다. 실제 지급은 담보명·코드·지급 조건으로 확인합니다.', { size: 5.7 });
      /* v5.7 — 뇌·심장 불완전판매 방지 경고 */
      y = warnStrip(s, y + 3, 'brain');
      /* v5.6 — 증권 직접 기재 담보(통합형/개별형)를 해당 페이지에 표시 */
      const cusBHbox = [].concat(
        customOf(m, 'brain').map((x) => Object.assign({}, x, { area: '뇌' })),
        customOf(m, 'heart').map((x) => Object.assign({}, x, { area: '심장' }))
      );
      if (cusBHbox.length) y = customBox(s, y + 4, cusBHbox, { accent: C.navy2, title: '증권 직접 기재 담보 — 뇌·심장 (통합형/개별형)', withArea: true, gap: 6 });
      y = s.sectionHead(s.ML, y + 6, s.CW, '02', '공식 통계로 확인', '출처: 중앙심뇌혈관질환센터·건강보험통계 2023');
      statCard(s, s.ML, y, s.CW, 92, statById('stroke'));
      y += 96;
      y = costStrip(s, s.ML, y + 2, s.CW, '퇴원 뒤에 더 길게 나가는 돈 — 진단비가 쓰이는 구간', [
        ['뇌경색 입원', '평균 62.7일', '1인당 2,562만원'],
        ['수술·중환자실', '1회 수백만 원대', '치료비 3종'],
        ['회복·재활', '수개월', '그동안 소득 공백']
      ], { accent: C.navy2 });
      y = s.sectionHead(s.ML, y + 6, s.CW, '03', '함께 확인할 것 — 담당자 소견', '진단비 밖의 빈틈');
      y = ownerNote(s, m, y, brainHeartNote(m), { accent: C.navy2 });
      s.footer({ left: `${m.client.name}님 · 뇌·심장`, right: '06 / 10' });
    });

    /* 07 수술·간병·실손 */
    P.push(function (s) {
      let y = H(s, 7, '수술 · 입원 · 간병 · 실손', '매일 나가는 돈과 한 번 나가는 돈을 함께 봅니다. 의료비 방어력은 이 네 축의 합입니다.');
      const surgery = m.rows[3], care = m.rows[4];
      const defence = Math.round(((surgery.r.fill + care.r.fill + (m.state.silson === 'none' ? 0 : 1) + (effVal(PK(m.rows[0], 'treatment')) > 0 ? 1 : 0)) / 4) * 100);
      s.rect(s.ML, y, s.CW, 50, { fill: C.hero, r: 6 });
      s.text('의료비 방어력', s.ML + 14, y + 8, { size: 6.4, weight: 700, color: C.heroInk });
      s.text(`${defence}%`, s.ML + 14, y + 19, { size: 22, weight: 800, color: '#fff' });
      s.gauge(s.ML + 92, y + 30, s.CW - 116, defence / 100, { color: C.heroOk, h: 8, track: C.heroTrack });
      s.text(defence >= 80 ? '기본 방어선이 서 있습니다' : defence >= 50 ? '한두 축이 비어 있습니다' : '의료비 기본축부터 세워야 합니다', s.ML + 92, y + 12, { size: 6.8, weight: 600, color: C.heroInk2 });
      s.text('수술 · 간병 · 실손 · 치료비 4축 평균', s.W - s.MR - 14, y + 10, { size: 5.8, weight: 500, color: C.heroInk, align: 'right' });
      y += 58;

      y = s.sectionHead(s.ML, y, s.CW, '01', '수술비 6축 · 간병 6칸', null);
      const sgr = m.rows[3], carR = m.rows[4];
      const rows = [
        ['수술비', '질병수술비(일반·매회)', `${won(m.state.cov.surgery.disease)}만원`, '수술 1회당 정액'],
        ['수술비', '질병 1~5종', `${t5Range(m.state, 'disease15') ? t5Range(m.state, 'disease15') + '만원' : won(m.state.cov.surgery.disease15) + '만원'}`, '침습도 분류 · 1종 기준'],
        ['수술비', '질병 N대', m.state.cov.surgery.diseaseNdae ? `${won(m.state.cov.surgery.diseaseNdae)}만원` : '없음', '질환 묶음별 한도'],
        ['수술비', '비급여 질병 수술', m.state.cov.surgery.diseaseNonPay ? `${won(m.state.cov.surgery.diseaseNonPay)}만원` : '없음', '5세대 실손 보완'],
        ['수술비', '일반 상해수술', `${won(m.state.cov.surgery.injury)}만원`, '사고 수술 정액'],
        ['수술비', '상해 1~5종', `${t5Range(m.state, 'injury15') ? t5Range(m.state, 'injury15') + '만원' : won(m.state.cov.surgery.injury15) + '만원'}`, '사고 수술 침습도'],
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
      ]), { widths: [48, 170, 92, 205], size: 6.3, rowH: 11.2, headH: 14, align: ['left', 'left', 'center', 'left'] });
      y = s.sectionHead(s.ML, y + 4, s.CW, '02', '의료비 방어력 4축', '지금 어느 축이 비어 있는지');
      const axes4 = [
        ['수술비', m.rows[3].r.fill], ['간병', m.rows[4].r.fill],
        ['실손', m.state.silson === 'none' ? 0 : 1], ['치료비 5종', (() => { const tp0 = PK(m.rows[0], 'treatment'); return (tp0.subs && tp0.subs.length) ? subHave(tp0) / tp0.subs.length : 0; })()]
      ];
      const aw = (s.CW - 6 * 3) / 4;
      axes4.forEach((a, i) => {
        const x = s.ML + i * (aw + 6);
        s.rect(x, y, aw, 39, { fill: '#fff', r: 5, stroke: C.line });
        s.text(a[0], x + 9, y + 6, { size: 6.2, weight: 600, color: C.muted });
        s.text(`${Math.round(a[1] * 100)}%`, x + 9, y + 14, { size: 13, weight: 800, color: a[1] >= 0.9 ? C.mint : a[1] > 0.3 ? C.orange : C.red });
        s.gauge(x + 9, y + 30, aw - 18, a[1], { color: a[1] >= 0.9 ? C.mint : a[1] > 0.3 ? C.orange : C.gray, h: 4.5 });
      });
      y += 47;
      y = s.sectionHead(s.ML, y + 2, s.CW, '03', '장기요양 등급 분포 — 왜 1~2등급만 준비하면 안 되는가', '출처: 건보공단 2025 노인장기요양보험 통계연보');
      statCard(s, s.ML, y, s.CW, 86, statById('ltc'));
      y += 90;
      y = costStrip(s, s.ML, y, s.CW, '간병은 매달 나가는 돈 — 일당이 곱해지는 구조 (2026.7 실단가)', [
        ['간병인 일당', '10~17만원', '24시간 1:1 기준'],
        ['한 달(30일)', '300~500만원', '주말·식대 포함'],
        ['지급 기준', '하루 8시간', '2026.7 전환']
      ], { accent: C.mint, h: 40 });
      y = s.sectionHead(s.ML, y + 2, s.CW, '04', '정리 — 담당자 소견', '실손·간병·수술의 순서');
      y = ownerNote(s, m, y, careNote(m), { accent: C.mint });
      /* v5.6 — 증권 직접 기재 담보(수술·간병) */
      const cusSCbox = [].concat(
        customOf(m, 'surgery').map((x) => Object.assign({}, x, { area: '수술' })),
        customOf(m, 'care').map((x) => Object.assign({}, x, { area: '간병' }))
      );
      if (cusSCbox.length) y = customBox(s, y + 4, cusSCbox, { accent: C.mint, title: '증권 직접 기재 담보 — 수술·간병 (증권 담보명 그대로)', withArea: true, gap: 2 });
      y = noteStrip(s, y + (cusSCbox.length ? 2 : 4), '장기요양은 등급 판정이 전제이고 65세 미만도 노인성 질병이면 신청할 수 있습니다. 일반병동 14만6,292원 vs 간호간병통합 2만3,620원(83.9%↓) — 사설 간병비는 실손 청구 불가, 통합병동 입원료만 실손 대상입니다. 일당 20만원 상품은 한시(현대 20→15·한화 20→10)입니다.', { size: 5.5 });
      /* v5.7 — 수술·간병 불완전판매 방지 경고 */
      y = warnStrip(s, y + 2, 'care');
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
      y = s.table(s.ML, y + 2, s.CW, ['구분', '갱신형', '비갱신형'], rows, { widths: [90, 215, 210], size: 6.8, rowH: 18, align: ['left', 'left', 'left'] });
      /* v5.7 — 20년 보험료 추이 차트 (갱신형 vs 비갱신형) */
      y = s.sectionHead(s.ML, y + 8, s.CW, '02', '20년 예상 보험료 추이', '갱신형 vs 비갱신형 — 예시 시뮬레이션');
      const tr = BK.renewTrend(m.state);
      y = renewChart(s, s.ML, y + 2, s.CW, tr, { h: 132 });
      y = noteStrip(s, y + 5, `현재 입력 기준: 갱신형 담보 ${m.state.flags.renew ? '중심' : '없음'} · 적립성 특약 ${m.state.flags.savings ? '있음' : '없음'}. 갱신 시점에는 보험료 재산정과 인수 심사가 있고, 65세부터 장기요양 신청이 가능하며, 만기 후에는 보장 공백이 생깁니다.`, { size: 5.9 });
      y += 6;
      y = s.sectionHead(s.ML, y, s.CW, '03', '노후 체크포인트 — 담당자 소견', null);
      y = ownerNote(s, m, y, renewNote(m), { accent: C.orange });
      y += 4;
      y = s.sectionHead(s.ML, y + 4, s.CW, '04', '노후 대비 3축 — 지금 결정할 것', '만기 · 요양 · 실손');
      const csn0 = m.contractStats;
      const care0 = m.state.cov.care || {};
      [
        { t: '만기 구조', v: csn0.shortMaturityCount ? `${csn0.shortMaturityCount}건 80·90세 만기` : '만기 100세 · 종신', d: csn0.shortMaturityCount ? '보장이 먼저 끊기는 구간입니다. 간병·요양 담보로 따로 준비합니다.' : '노후까지 유지되는 구조입니다. 갱신 보험료만 확인합니다.', c: csn0.shortMaturityCount ? C.red : C.mint },
        { t: '장기요양', v: care0.ltc ? '보유' : '미보유', d: care0.ltc ? '등급 판정 시 일당이 나옵니다. 65세 전 노인성 질병도 신청 가능합니다.' : '3~5등급이 전체의 84%입니다. 1~2등급만 준비하면 부족합니다.', c: care0.ltc ? C.mint : C.orange },
        { t: '실손', v: m.state.silson === 'none' ? '없음' : `${m.state.silson}세대`, d: '갱신 주기와 재가입 조건을 확인합니다. 노후 지출의 중심이 됩니다.', c: m.state.silson === 'none' ? C.red : C.blue }
      ].forEach((it, i) => {
        const x = s.ML + i * ((s.CW - 16) / 3 + 8);
        const cw8 = (s.CW - 16) / 3;
        s.rect(x, y, cw8, 58, { fill: '#fff', r: 5, stroke: C.line });
        s.rect(x, y, cw8, 2.4, { fill: it.c, r: 1.2 });
        s.text(it.t, x + 10, y + 8, { size: 6, weight: 600, color: C.muted });
        s.text(it.v, x + 10, y + 16, { size: 9.4, weight: 800, color: C.navy });
        s.para(it.d, x + 10, y + 30, cw8 - 20, { size: 5.5, color: C.ink2, lh: 1.32 });
      });
      y += 70;
      y = s.sectionHead(s.ML, y, s.CW, '05', '계약 납입 · 만기 현황', m.state.contracts.length ? `입력 계약 ${m.contractStats.count}건` : '앱에서 계약을 입력하면 채워집니다');
      const cw8 = (s.CW - 16) / 3;
      const csn = m.contractStats;
      [
        ['납입완료', csn.paidUpCount ? `${csn.paidUpCount}건 · ${won(csn.paidUpPremium)}만원` : '없음', csn.paidUpCount ? '보험료 부담 없이 보장만 유지 — 해지하지 않습니다' : '입력된 납입완료 계약이 없습니다', csn.paidUpPremium > 0 ? C.mint : C.gray],
        ['월 보험료 합계', csn.count ? `${won(csn.total)}만원` : '—', csn.count ? `계약 ${csn.count}건 · 납입중 ${csn.activeCount}건` : '앱에서 계약을 입력합니다', C.blue],
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
      if (m.client.ageDay) y = noteStrip(s, y, `상령일 ${m.client.ageDay.label}까지 D-${m.client.ageDay.days}. 이 날이 지나면 보험나이가 ${m.client.ageDay.insuranceAgeAfter}세가 되어 같은 보장도 보험료가 달라질 수 있습니다.`, { size: 6.4, fill: C.orangeSoft, stroke: C.orangeLine, accent: C.orange });
      s.footer({ left: `${m.client.name}님 · 갱신·노후`, right: '08 / 10' });
    });
    /* 09 리모델링 Before / After + 실손 세대 비교 */
    P.push(function (s) {
      let y = H(s, 9, '리모델링 Before / After', '해지하지 않고 계약 정리·감액·보강으로 배분을 바꾸는 안입니다. 리모델링 비교기 입력값이 이 페이지에 자동 반영됩니다.');
      const rm = remodelOf();
      const c = rm ? rm.c : null;
      const edited = !!(rm && rm.edited);
      let sim = null;
      if (!edited) {
        try {
          const boost = {};
          if (m.first) boost[m.first.item.key] = 100;
          sim = BK.simulate(m.state, boost);
        } catch (e) { sim = null; }
      }
      const beforePrem = c ? c.beforePrem : Number(m.premium || 0);
      const afterPrem = edited && c ? c.afterPrem : beforePrem;
      const beforeScore = c ? c.before.score : m.score;
      const afterScore = edited && c ? c.after.score : (sim ? sim.score : beforeScore);
      const rowsBA = m.rows.map((r) => {
        const ar = edited && c ? c.rows.find((x) => x.key === r.item.key) : null;
        const sr = sim ? sim.rows.find((x) => x.item.key === r.item.key) : null;
        return { name: r.item.name, rank: r.item.rank, beforePct: r.pct, afterPct: ar ? ar.afterPct : (sr ? sr.pct : r.pct) };
      });
      const avgBefore = Math.round(rowsBA.reduce((a, x) => a + x.beforePct, 0) / rowsBA.length);
      const avgAfter = Math.round(rowsBA.reduce((a, x) => a + x.afterPct, 0) / rowsBA.length);

      /* KPI 3개 */
      const kw = (s.CW - 16) / 3;
      const premDelta = afterPrem - beforePrem;
      const scoreDelta = afterScore - beforeScore;
      [
        { k: edited ? '월 보험료 (조정안 반영)' : '월 보험료 (현재)', v: `${won(beforePrem)}${afterPrem !== beforePrem ? ' → ' + won(afterPrem) : ''}`, u: '만원',
          d: edited ? (premDelta === 0 ? '변동 없음' : `${premDelta > 0 ? '+' : '−'}${won(Math.abs(premDelta))}만원 ${premDelta > 0 ? '보강' : '절감'}`) : (sim ? '같은 보험료 기준 시뮬레이션' : '비교기 입력 대기'), tone: edited ? (premDelta > 0 ? 'need' : 'ok') : 'info' },
        { k: '종합 보장 점수', v: `${beforeScore}${afterScore !== beforeScore ? ' → ' + afterScore : ''}`, u: '점',
          d: edited ? (scoreDelta === 0 ? '변동 없음' : `${scoreDelta > 0 ? '+' : '−'}${Math.abs(scoreDelta)}점`) : (sim ? `1순위 보완 시 ${scoreDelta >= 0 ? '+' : '−'}${Math.abs(scoreDelta)}점` : '현재 점수'), tone: scoreDelta >= 0 ? 'ok' : 'warn' },
        { k: '5대 담보 평균 충족도', v: `${avgBefore}${avgAfter !== avgBefore ? ' → ' + avgAfter : ''}`, u: '%',
          d: edited ? '조정안 반영 후' : (sim ? '권장선까지 채운 경우(시뮬레이션)' : '현재 입력 기준'), tone: avgAfter >= avgBefore ? 'ok' : 'warn' }
      ].forEach((it, i) => {
        const x = s.ML + i * (kw + 8);
        s.rect(x, y, kw, 60, { fill: i === 0 ? C.tint2 : '#fff', r: 6, stroke: C.line });
        s.text(it.k, x + 12, y + 9, { size: 6, weight: 600, color: C.muted });
        s.text(it.v, x + 12, y + 19, { size: 15, weight: 800, color: C.navy });
        s.text(it.u, x + 12 + s.measure(it.v, 15, 800) + 3, y + 25, { size: 6.2, weight: 600, color: C.muted });
        s.badge(x + 12, y + 42, it.d, it.tone, { size: 5.6, h: 12 });
      });
      y += 72;

      /* 01 5대 담보 Before / After */
      y = s.sectionHead(s.ML, y, s.CW, '01', '5대 담보 충족도 변화', edited ? '리모델링 비교기 조정안 기준' : '같은 보험료로 1순위를 채우는 권장 시뮬레이션');
      const headH = 16, rowH = 18;
      const cxs = [0, 186, 250, 316, 400];
      s.rect(s.ML, y, s.CW, headH, { fill: C.navy });
      s.text('담보', s.ML + 7, y + 5, { size: 6.2, weight: 700, color: '#fff' });
      s.text('Before', s.ML + cxs[1] + 28, y + 5, { size: 6.2, weight: 700, color: '#fff', align: 'center' });
      s.text('After', s.ML + cxs[2] + 28, y + 5, { size: 6.2, weight: 700, color: '#fff', align: 'center' });
      s.text('변화', s.ML + cxs[3] + 30, y + 5, { size: 6.2, weight: 700, color: '#fff', align: 'center' });
      s.text('After 충족도', s.W - s.MR - 7, y + 5, { size: 6.2, weight: 700, color: '#fff', align: 'right' });
      rowsBA.forEach((r, i) => {
        const ry = y + headH + i * rowH;
        s.rect(s.ML, ry, s.CW, rowH, { fill: i % 2 ? C.sky2 : '#fff' });
        s.line(s.ML, ry + rowH, s.ML + s.CW, ry + rowH, { color: C.line2 });
        s.iconCircle(s.ML + 10, ry + rowH / 2, 6, { fill: C.navy, num: r.rank, size: 6, color: '#fff' });
        s.text(r.name, s.ML + 20, ry + rowH / 2 - 3.4, { size: 7.4, weight: 800, color: C.navy });
        s.text(`${r.beforePct}%`, s.ML + cxs[1] + 28, ry + rowH / 2 - 3.4, { size: 6.8, weight: 600, color: C.ink2, align: 'center' });
        s.text(`${r.afterPct}%`, s.ML + cxs[2] + 28, ry + rowH / 2 - 3.4, { size: 6.8, weight: 800, color: r.afterPct > r.beforePct ? C.mint : C.navy, align: 'center' });
        const d = r.afterPct - r.beforePct;
        s.text(d > 0 ? `+${d}%p` : d < 0 ? `${d}%p` : '—', s.ML + cxs[3] + 30, ry + rowH / 2 - 3.4, { size: 6.4, weight: 700, color: d > 0 ? C.mint : d < 0 ? C.red : C.muted, align: 'center' });
        s.gauge(s.W - s.MR - 92, ry + rowH / 2 - 2.4, 66, r.afterPct / 100, { color: r.afterPct >= 99 ? C.mint : r.afterPct >= 50 ? C.orange : C.red, h: 5 });
        s.text(`${r.afterPct}%`, s.W - s.MR - 7, ry + rowH / 2 - 3.4, { size: 6.2, weight: 700, color: C.ink2, align: 'right' });
      });
      y += headH + rowsBA.length * rowH + 10;

      /* 02 계약 정리안 · 보강 설계안 (좌우 배치) */
      y = s.sectionHead(s.ML, y, s.CW, '02', '계약 정리안 · 보강 설계안', edited ? '유지 · 감액 · 정리 / 보강 후 금액' : '현재 계약과 권장 보강 금액');
      const half = (s.CW - 10) / 2;
      const top = y;
      const conRows = c && c.contractRows.length ? Math.min(4, c.contractRows.length) : 3;
      const axisAll = (c ? c.axes : []).filter((a) => (edited ? a.changed : a.rec > a.beforeVal));
      const axisShow = axisAll.slice(0, 4).length || 1;
      const boxH = Math.max(56, 30 + Math.max(conRows, axisShow) * 17 + 10);
      s.rect(s.ML, top, half, boxH, { fill: '#fff', r: 5, stroke: C.line });
      s.text('보유 계약 정리안', s.ML + 10, top + 7, { size: 6.4, weight: 800, color: C.navy });
      const rx = s.ML + half + 10;
      s.rect(rx, top, half, boxH, { fill: '#fff', r: 5, stroke: C.line });
      s.text('보강 설계안 (권장선 기준)', rx + 10, top + 7, { size: 6.4, weight: 800, color: C.navy });
      s.text(edited ? '추가 보험료' : '부족분', rx + half - 10, top + 7, { size: 5.2, weight: 600, color: C.muted, align: 'right' });
      const axisRows = axisAll.slice(0, 4);
      if (c && c.contractRows.length) {
        c.contractRows.slice(0, 4).forEach((r, i) => {
          const ry = top + 20 + i * 17;
          s.text(`${(r.contract.insurer || '보험사')} ${(r.contract.product || '')}`.slice(0, 24), s.ML + 10, ry, { size: 5.7, weight: 600, color: C.ink2 });
          s.text(edited ? `${won(r.now)}→${won(r.next)}` : `${won(r.now)}만원`, s.ML + half - 78, ry, { size: 5.7, weight: 700, color: C.navy, align: 'right' });
          if (edited) {
            const lab = r.act === 'close' ? '정리' : r.act === 'reduce' ? '감액' : '유지';
            s.badge(s.ML + half - 62, ry - 1.6, lab, r.act === 'close' ? 'gap' : r.act === 'reduce' ? 'need' : 'ok', { size: 5.2, h: 10, padX: 3.5 });
          }
        });
        if (!edited) s.text('비교기에서 유지·감액·정리를 고르면 이 표가 채워집니다', s.ML + 10, top + boxH - 11, { size: 5.2, weight: 500, color: C.muted });
      } else {
        s.bullets(s.ML + 10, top + 20, half - 20, [
          '계약·보험료를 입력하면 계약별 월 보험료와 정리안이 계산됩니다.',
          '적립(저축)성·중복 특약은 정리 후보 1순위입니다.',
          '핵심 담보는 남기고 남는 보험료를 빈 칸으로 옮깁니다.'
        ], { size: 5.6, gap: 1.6 });
      }
      if (axisRows.length) {
        axisRows.forEach((a, i) => {
          const ry = top + 20 + i * 17;
          const tgt = Math.max(a.beforeVal, edited ? (a.target || a.rec) : a.rec);
          s.text(`${a.axis.name} ${a.axis.unit}`, rx + 10, ry, { size: 5.7, weight: 600, color: C.ink2 });
          s.text(`${won(a.beforeVal)}→${won(tgt)}만원`, rx + half - 62, ry, { size: 5.7, weight: 700, color: C.navy, align: 'right' });
          s.text(a.extra ? `+${won(a.extra)}만원` : `+${won(Math.max(0, tgt - a.beforeVal))}만원`, rx + half - 10, ry, { size: 5.7, weight: 700, color: C.orange, align: 'right' });
        });
        if (!edited) s.text('추가 보험료는 상품·나이에 따라 달라집니다', rx + 10, top + boxH - 10, { size: 5.2, weight: 500, color: C.muted });
      } else {
        s.para('5대 담보가 모두 권장선 이상입니다. 추가 보강 없이 갱신·만기 점검으로 넘어갑니다.', rx + 10, top + 22, half - 20, { size: 5.8, color: C.muted, lh: 1.4 });
      }
      y = top + boxH + 10;

      /* 03 실손 세대 — 선택형 할인 특약 vs 5세대 전환 */
      const sil = m.state.silson;
      y = s.sectionHead(s.ML, y, s.CW, '03', sil === '1' || sil === '2' ? `실손 ${sil}세대 — 두 가지 선택` : `실손 ${sil === 'none' ? '공백' : sil + '세대'} 점검`, sil === '1' || sil === '2' ? '2026년 11월 기준 · 보험료를 아끼는 길과 보장을 바꾸는 길' : '세대별 구조 확인');
      if (typeof SILSON_FIVE !== 'undefined' && (sil === '1' || sil === '2')) {
        SILSON_FIVE.options.forEach((op, i) => {
          const x = s.ML + i * (half + 10);
          s.rect(x, y, half, 88, { fill: '#fff', r: 5, stroke: C.line });
          s.rect(x, y, half, 2.6, { fill: i ? C.blue : C.mint, r: 1.3 });
          s.text(`${op.key}. ${op.title}`, x + 10, y + 8, { size: 7.6, weight: 800, color: C.navy });
          s.text(op.keep, x + half - 10, y + 9, { size: 5.4, weight: 600, color: C.muted, align: 'right' });
          s.bullets(x + 10, y + 24, half - 20, [
            `보험료: ${op.cut}`,
            `내용: ${op.cost}`,
            `되돌리기: ${op.back}`,
            `주의: ${op.watch}`
          ], { size: 5.5, gap: 1.4 });
        });
        y += 96;
      } else if (typeof SILSON_FIVE !== 'undefined') {
        s.rect(s.ML, y, s.CW, 50, { fill: '#fff', r: 5, stroke: C.line });
        s.bullets(s.ML + 10, y + 8, s.CW - 20, SILSON_FIVE.fiveGen.slice(0, 3), { size: 5.7, gap: 1.2 });
        s.text(sil === 'none' ? '실손이 없으면 진단비보다 의료비 축을 먼저 세우는 것이 순서입니다.' : `${sil}세대는 선택형 할인 특약·5세대 전환 대상이 아닙니다. 구조와 한도 유지 여부만 확인합니다.`, s.ML + 10, y + 38, { size: 5.7, weight: 600, color: C.navy2 });
        y += 58;
      }

      /* 04 리모델링 원칙 — 배분을 바꾸는 방법 */
      y = s.sectionHead(s.ML, y, s.CW, '04', '리모델링 3원칙', '이 순서를 지키면 손해 보는 해지가 줄어듭니다');
      const rules = [
        { t: '해지가 아니라 재배치', d: '적립·중복·미사용 특약을 정리해 빈 칸으로 옮깁니다. 핵심 담보는 그대로 둡니다.' },
        { t: '한 번에 한 칸', d: '1순위 한 칸을 같은 보험료 안에서 채우는 것이 첫 단계입니다. 나머지는 다음 상담에서 정합니다.' },
        { t: '금액은 고객이 선택', d: '추가 지출이 필요할 때는 고객님이 결정합니다. 상담자가 먼저 금액을 정하지 않습니다.' }
      ];
      const rw = (s.CW - 16) / 3;
      rules.forEach((r, i) => {
        const x = s.ML + i * (rw + 8);
        s.rect(x, y, rw, 54, { fill: '#fff', r: 5, stroke: C.line });
        s.iconCircle(x + 16, y + 16, 7, { fill: C.tint, num: i + 1, size: 6.4, color: C.blue });
        s.text(r.t, x + 30, y + 10, { size: 7, weight: 800, color: C.navy });
        s.para(r.d, x + 10, y + 28, rw - 20, { size: 5.7, color: C.ink2, lh: 1.35 });
      });
      y += 62;

      /* v5.7 — 해지·신규 가입 불완전판매 방지 경고 */
      y = warnStrip(s, y, 'remodel', { fill: C.redSoft, stroke: '#F5D5D1', accent: C.red });

      /* 담당자 소견 */
      y = ownerNote(s, m, y + 6, remodelNote(m, c, edited, sim, { beforePrem, afterPrem, beforeScore, afterScore, avgBefore, avgAfter }), { accent: C.blue });
      s.footer({ left: `${m.client.name}님 · 리모델링 실행안`, right: '09 / 10' });
    });

    /* 10 요약 · 로드맵 · 담당자 명함 */
    P.push(function (s) {
      let y = H(s, 10, '보장자산 요약 & 실행 로드맵', '점수 요약, 남은 빈틈, 오늘부터의 실행 순서와 상담 창구를 한 장에 정리했습니다.');
      const b = brandInfo(m);
      /* 등급 히어로 */
      /* v6.2 — 꼬리말 면책 한 줄을 넣기 위해 이 페이지의 세로 리듬을 22pt 압축했습니다 */
      s.rect(s.ML, y, s.CW, 62, { fill: C.hero, r: 6 });
      s.text('종합 보장등급', s.ML + 16, y + 8, { size: 6.4, weight: 700, color: C.heroInk });
      s.text(m.letter, s.ML + 16, y + 17, { size: 26, weight: 800, color: '#fff' });
      s.text(`${m.score} / 100점`, s.ML + 70, y + 26, { size: 9, weight: 700, color: C.heroOk });
      s.text(m.grade.line, s.ML + 70, y + 39, { size: 7.2, weight: 500, color: C.heroInk2 });
      s.text(`보완 필요 ${m.needList.length}개 항목`, s.W - s.MR - 16, y + 10, { size: 7.4, weight: 700, color: '#fff', align: 'right' });
      s.text(`충분 ${m.counts.enough} · 점검 ${m.counts.check} · 보완 후보 ${m.counts.short} · 미가입 ${m.counts.none}`, s.W - s.MR - 16, y + 23, { size: 6.3, weight: 500, color: C.heroInk, align: 'right' });
      s.text(`월 ${won(m.premium)}만원 · 연 ${won(m.annual)}만원 · 연 대비 진단비 ${m.ratio ? m.ratio.toFixed(1) + '배' : '—'}`, s.W - s.MR - 16, y + 38, { size: 6.3, weight: 600, color: C.heroInk2, align: 'right' });
      y += 72;

      /* 01 세부 점수 분포 */
      y = s.sectionHead(s.ML, y, s.CW, '01', '세부 담보 점수', '14개 세부 담보 + 실손 — 50% 미만만 굵게 표시');
      const cw = (s.CW - 10) / 2;
      const perCol = Math.ceil(m.parts.length / 2);
      m.parts.forEach((p, i) => {
        const col = Math.floor(i / perCol), row = i % perCol;
        const x = s.ML + col * (cw + 10), cy = y + row * 13.6;
        const lab = `${p.itemName} · ${p.label}`;
        const lw = p.pct < 50 ? 700 : 500;
        let labFit = lab;
        while (labFit.length > 3 && s.measure(labFit + '…', 6.2, lw) > 100) labFit = labFit.slice(0, -1);
        if (labFit !== lab) labFit += '…';
        s.text(labFit, x, cy, { size: 6.2, weight: p.pct < 50 ? 700 : 500, color: p.pct < 50 ? C.red : C.ink2 });
        s.gauge(x + 118, cy + 1.4, cw - 160, p.fill, { color: TONE_COLOR[p.level === 'enough' ? 'ok' : p.level === 'check' ? 'need' : p.level === 'none' ? 'none' : 'gap'], h: 4.4 });
        s.text(`${p.pct}%`, x + cw, cy, { size: 6, weight: 700, color: C.navy, align: 'right' });
      });
      y += perCol * 13.6 + 8;

      /* 02 남은 빈틈 — 보조보장 */
      y = s.sectionHead(s.ML, y, s.CW, '02', '놓치기 쉬운 보조보장', '진단비 다음에 확인할 칸');
      const chips = [['후유장해', '장해 지급률'], ['배상책임', '생활배상'], ['골절·화상', '상해 소액'], ['치아', '보철·임플란트'], ['수술·입원일당', '입원 매일']];
      const chipW = (s.CW - 8 * 4) / 5;
      chips.forEach((ch, i) => {
        const x = s.ML + i * (chipW + 8);
        s.rect(x, y, chipW, 28, { fill: '#fff', r: 4, stroke: C.line });
        s.text(ch[0], x + 8, y + 5, { size: 6.2, weight: 700, color: C.navy });
        s.text(ch[1], x + 8, y + 15, { size: 5.4, weight: 500, color: C.muted });
      });
      y += 36;

      /* 03 실행 로드맵 */
      y = s.sectionHead(s.ML, y, s.CW, '03', '실행 로드맵', '한 번에 다 하지 않습니다');
      const cw3 = (s.CW - 16) / 3;
      m.steps.forEach((st, i) => {
        const x = s.ML + i * (cw3 + 8);
        s.rect(x, y, cw3, 70, { fill: i === 0 ? C.tint : i === 1 ? C.orangeSoft : C.mintSoft, r: 5, stroke: C.line });
        s.rect(x, y, cw3, 2.6, { fill: [C.blue, C.orange, C.mint][i], r: 1.3 });
        s.text(`STEP ${i + 1}`, x + 9, y + 8, { size: 5.6, weight: 800, color: [C.blue, C.orange, C.mint][i] });
        s.text(st.title.replace(/^[^ ]+ — /, ''), x + 9, y + 17, { size: 8.6, weight: 800, color: C.navy });
        s.para(st.body, x + 9, y + 31, cw3 - 18, { size: 5.9, color: C.ink2, lh: 1.35 });
      });
      y += 78;

      /* v6.1 — 과보장 점검 5종 · 팔지 않는 상담 */
      const oc = (typeof OVER_COVERAGE !== 'undefined' ? OVER_COVERAGE : (m.overCoverage || []));
      if (oc.length) {
        y = s.sectionHead(s.ML, y, s.CW, '04', '과보장 점검 5종 — 더 넣기 전에 확인', m.sellLess ? '5대 담보 90% 이상: 오늘은 추가 가입을 권하지 않습니다' : '이미 충분한 항목이면 추가 가입 대신 조정합니다');
        oc.forEach((o, i) => {
          const cy = y + i * 9.8;
          s.text(`${i + 1}. ${o.t || o.label || ''}`, s.ML, cy, { size: 6.0, weight: 700, color: C.navy });
          s.text(`— ${o.d || o.action || ''}`, s.ML + 186, cy, s.CW - 186, { size: 5.8, weight: 500, color: C.ink2 });
        });
        y += oc.length * 9.8 + 4;
      }

      /* 05 체크리스트 */
      y = s.sectionHead(s.ML, y, s.CW, '05', '다음 단계 체크리스트', '고객과 함께 확인합니다');
      y = s.checks(s.ML, y, s.CW, [
        '증권 원본(또는 앱 캡처)으로 담보명·코드·지급 조건 확인',
        '가장 비어 있는 1순위 한 칸의 금액 결정',
        '실손 세대 확인 후 유지 / 선택형 할인 / 5세대 전환 비교',
        '갱신 시점과 예상 보험료, 만기 이후 대안 확인',
        '고지의무 3·1·5(간편 3·2·5) 질문지 작성 · 다음 상담일 확정'
      ], { size: 7, rowH: 13 });
      y += 4;

      /* 담당자 명함 */
      y = closingCard(s, y, m);
      const noteY = y + 5;
      if (noteY < s.H - 58) {
        s.para(`상담일 ${m.dateLabel} · ${m.client.name}님 1인 기준 · ${b.consultant} 작성. 점수·권장선은 상담 보조용 자체 산식이며 실제 지급은 약관·증권이 기준입니다.`, s.ML, noteY, s.CW, { size: 5.2, color: C.muted, lh: 1.35 });
      }
      s.footer({ left: `${m.client.name}님 · 보장자산 요약`, right: '10 / 10' });
    });

    return P;
  }

  function PLAYBOOK_CODES(key) {
    const pb = PLAYBOOK[key];
    return pb.codes.map((c) => ({ label: c.label, code: c.code, note: c.note }));
  }

  /* =========================================================
     v7.5 — 설계사용 30장: "대본집" → "판단·증거 보조기기"
     · 앞 12장 고정: 표지(오프닝 3줄) · 프로파일 · 터치 로드맵 · 전체 판독 · 리모델링
       · 제도 · 실손 · 고지 · 청구 · 반론 카드 · 클로징 · 사후관리
     · 뒤 18장: 이 고객의 기본 상담 우선순위대로 L3(5p)·L2(4p)·L1(3p) 자동 배분,
       충족도 95% 이상은 HOLD 1p. 총 30장 고정.
     · 화법은 ① 판독 멘트 ② 반론 카드 ③ 오프닝·클로징 3줄에만 남깁니다.
     ========================================================= */
  function advisorPages(m) {
    const P = [];
    const TOTAL = 30;
    const E = root.BojangEvidence;
    const PR = root.BojangPriority;
    const plan = PR.allocation(m);
    const orderEntry = (key) => plan.order.find((x) => x.key === key) || null;
    const rowK = (key) => (m.rows || []).find((r) => r.item && r.item.key === key) || m.rows[0];
    const partK = (key, pk) => (rowK(key).r.parts || []).find((p) => p.key === pk) || { val: 0, rec: 0, fill: 0, subs: [], option: null, dx: {} };
    const num = (v) => Number(v) || 0;
    const fund = (n) => `${won(Math.round(num(n)))}만원`;
    const pctOf = (key) => { const e = orderEntry(key); return e ? e.pct : Math.round(num(rowK(key).r.fill) * 100); };
    const KICK = { cancer: 'CHECK 01 · CANCER', brain: 'CHECK 02 · BRAIN', heart: 'CHECK 03 · HEART', surgery: 'CHECK 04 · SURGERY', care: 'CHECK 05 · CARE' };
    const TOUCH_TONE = { blue: C.blue, red: C.red, orange: C.orange, mint: C.mint, navy: C.navy2, gray: C.muted };

    /* ---------- 공통 머리·꼬리 ---------- */
    const head = (s, no, kicker, title, lead) => {
      s.header({ kicker: 'BOJANG PLAN BOOK', no: String(no).padStart(2, '0'), total: '30' });
      const y = s.pageTitle(kicker, title, lead, 62);
      s.line(s.ML, y - 4, s.W - s.MR, y - 4, { color: C.line });
      return customerStrip(s, y + 2);
    };
    const foot = (s, no, label, extra) => s.footer(Object.assign({ left: `${m.client.name}님 상담 플랜 · ${label} · 설계사용`, right: `${String(no).padStart(2, '0')} / ${TOTAL}` }, extra || {}));
    const blockTitle = (s, y, t, sub) => {
      s.text(t, s.ML, y, { size: 8.4, weight: 800, color: C.navy });
      if (sub) s.text(sub, s.W - s.MR, y + 1.5, { size: 6, weight: 500, color: C.muted, align: 'right' });
      return y + 13;
    };
    const lead = (s, y, t) => { s.text(t, s.ML, y, { size: 6.6, weight: 800, color: C.blue }); return y + 11; };

    /* ---------- 지면 일정 ---------- */
    const ROLES = {
      1: ['hold'],
      2: ['head', 'objection'],
      3: ['head', 'caseDesign', 'objection'],
      4: ['head', 'code', 'caseDesign', 'objection'],
      5: ['head', 'code', 'cases', 'design', 'objection'],
      6: ['head', 'evidence', 'code', 'cases', 'design', 'objection'],
      7: ['head', 'evidence', 'code', 'cases', 'design', 'decision', 'objection']
    };
    const schedule = [
      { kind: 'cover' }, { kind: 'profile' }, { kind: 'roadmap' }, { kind: 'reading' },
      { kind: 'remodel' }, { kind: 'system' }, { kind: 'silson' }, { kind: 'disclose' },
      { kind: 'claim' }, { kind: 'objection' }, { kind: 'closing' }, { kind: 'after' }
    ];
    plan.order.forEach((e) => {
      const roles = ROLES[Math.max(1, Math.min(7, e.pages))] || ROLES[3];
      roles.forEach((role) => schedule.push({ kind: 'chapter', key: e.key, role, entry: e }));
    });
    for (let i = 0; i < plan.appendix; i += 1) schedule.push({ kind: 'appendix', i });
    /* 총 30장 고정 — 넘치면 꼬리에서 덜어내고, 모자라면 증거 부록으로 채웁니다 */
    while (schedule.length > TOTAL) schedule.pop();
    while (schedule.length < TOTAL) schedule.push({ kind: 'appendix', i: schedule.length });

    const range = {};
    schedule.forEach((it, i) => {
      if (it.kind !== 'chapter') return;
      if (!range[it.key]) range[it.key] = [i + 1, i + 1];
      range[it.key][1] = i + 1;
    });

    /* ---------- 고객 값 → 문장 ---------- */
    function mineFor(c) {
      const st = m.state;
      switch (c.check) {
        case 'similar': return `이 고객 유사암 ${st.cov.cancer.similar ? fund(st.cov.cancer.similar) : '0원 — 같은 구조'}`;
        case 'origin': return '이 고객 증권의 원발부위 문구를 함께 확인';
        case 'recur': return `이 고객 재진단 ${st.cov.cancer.recur ? '보유' : '없음'}`;
        case 'drug': { const p = partK('cancer', 'treatment'); const d = (p.subs || []).find((x) => x.key === 'drug'); return `이 고객 항암약물 ${d && subEff(d) ? fund(subEff(d)) : '0원'}`; }
        case 'vascular': return `이 고객 뇌혈관 ${fund(num((partK('brain', 'dx').dx || {}).core ? partK('brain', 'dx').dx.core.val : 0))}`;
        case 'stroke': { const d = partK('brain', 'dx').dx || {}; return `이 고객 뇌졸중 ${fund(num((d.subs || [])[1] ? d.subs[1].val : 0))}`; }
        case 'ischemic': { const d = partK('heart', 'dx').dx || {}; return `이 고객 허혈성심장 ${fund(num(d.core ? d.core.val : 0))}`; }
        case 'surgery': return `이 고객 질병 1~5종 ${fund(st.cov.surgery.disease15)}`;
        case 'tier5': return `이 고객 1~5종 ${t5Range(st, 'disease15') || fund(st.cov.surgery.disease15)}`;
        case 'injury': return `이 고객 상해수술 ${fund(st.cov.surgery.injury)}`;
        case 'daily': return `이 고객 간병일당 ${fund(st.cov.care.daily)}`;
        case 'ndaily': return `이 고객 요양병원 ${st.cov.care.nDaily ? fund(st.cov.care.nDaily) : '없음'}`;
        case 'ltc': return `이 고객 장기요양 ${st.cov.care.ltc ? '보유' : '없음'}`;
        case 'basis': return `이 고객 지급 기준 ${({ time: '시간 기준', money: '금액 기준', unknown: '미확인' })[st.cov.care.basis] || '미확인'}`;
        case 'radio': { const p = partK('cancer', 'treatment'); const d = (p.subs || []).find((x) => x.key === 'radio'); return `이 고객 방사선 ${d && subEff(d) ? fund(subEff(d)) : '0원'}`; }
        case 'disc': return `이 고객 고지 판정 ${m.disclosure.tone === 'ok' ? '대상 없음' : '확인 필요'}`;
        case 'wait': return '이 고객 계약일 확인 — 90일 면책 D-day';
        case 'timebar': return '이 고객 청구 이력 확인 — 3년 이내';
        case 'silson': return `이 고객 실손 ${st.silson === 'none' ? '없음' : st.silson + '세대'}`;
        default: return '';
      }
    }

    /* ---------- 사례 카드 ---------- */
    const casesOf = (key) => E.byArea(key);
    const DOC_HINT = {
      cancer: '진단서(코드)·병리 결과지', brain: 'MRI/CT 판독지·진단서', heart: '관상동맥조영술 결과지',
      surgery: '수술확인서(수술명)', care: '간병인 이용확인서·영수증·등급판정서', system: '진료비 세부내역서'
    };
    function caseCard(s, x, y, w, c, h) {
      const pad = 10;
      const leftW = w * 0.46;
      s.rect(x, y, w, h, { fill: '#fff', r: 5, stroke: C.line });
      s.rect(x, y, 2.6, h, { fill: c.type === '실사례' ? C.navy : c.type === '각색' ? C.blue : C.muted, r: 1.3 });
      s.text(c.title, x + pad, y + 8, { size: 8.2, weight: 800, color: C.navy });
      const bw = s.measure(c.type, 5.8, 800) + 10;
      s.badge(x + w - pad - bw, y + 7, c.type, c.type === '실사례' ? 'info' : c.type === '각색' ? 'check' : 'none', { size: 5.8, h: 10.5, padX: 5 });
      let ly = y + 24;
      [['상황', c.fact], ['사고', c.event], ['결과', c.result]].forEach((r) => {
        s.text(r[0], x + pad, ly, { size: 6.0, weight: 800, color: C.muted });
        const lines = s.wrap(r[1], leftW - pad - 32, 6.2, 500).slice(0, 2);
        lines.forEach((ln, i) => s.text(ln, x + pad + 28, ly + i * 7.8, { size: 6.2, weight: 500, color: C.ink2 }));
        ly += Math.max(1, lines.length) * 7.8 + 2.2;
      });
      const rx = x + leftW + 8;
      const rw = w - leftW - pad - 8;
      s.text('갈린 이유', rx, y + 24, { size: 6.0, weight: 800, color: C.red });
      const reason = s.wrap(c.reason, rw, 6.8, 700).slice(0, 3);
      reason.forEach((ln, i) => s.text(ln, rx, y + 34 + i * 8.6, { size: 6.8, weight: 700, color: C.navy }));
      let by = y + 34 + Math.max(1, reason.length) * 8.6 + 4;
      const mine = mineFor(c);
      if (mine) { s.text(mine, rx, by, { size: 6.0, weight: 700, color: C.blue }); by += 9; }
      s.text(`확인 — ${DOC_HINT[c.area] || '증권·약관'}`, rx, by, { size: 5.6, weight: 500, color: C.ink2 });
      s.text(`출처 ${c.source}`, rx, y + h - 13, { size: 5.0, weight: 500, color: C.muted });
      s.line(x + leftW, y + 20, x + leftW, y + h - 18, { color: C.line2 });
      return y + h;
    }

    /* ---------- 코드 밴드 ---------- */
    function codeBand(s, x, y, w, key) {
      const B = E.BANDS[key];
      const labelW = 102;
      const n = B.slots.length;
      const cw = (w - labelW - 6) / n;
      const heldOf = {
        cancer: { general: num(m.state.cov.cancer.general), similar: num(m.state.cov.cancer.similar) },
        brain: (() => { const d = partK('brain', 'dx').dx || {}; return { vascular: num(d.core ? d.core.val : 0), stroke: num((d.subs || [])[1] ? d.subs[1].val : 0), bleed: num((d.subs || [])[2] ? d.subs[2].val : 0) }; })(),
        heart: (() => { const d = partK('heart', 'dx').dx || {}; return { ischemic: num(d.core ? d.core.val : 0), ami: num((d.subs || [])[1] ? d.subs[1].val : 0) }; })(),
        surgery: { disease15: num(m.state.cov.surgery.disease15), diseaseNdae: num(m.state.cov.surgery.diseaseNdae) },
        care: { daily: num(m.state.cov.care.daily), nDaily: num(m.state.cov.care.nDaily), ltc: m.state.cov.care.ltc ? 1 : 0 }
      }[key] || {};
      let cy = y + 2;
      B.slots.forEach((slot, i) => {
        s.text(B.labels[slot] || slot, x + labelW + cw * i + cw / 2, cy, { size: 5.4, weight: 600, color: C.muted, align: 'center' });
        s.text(slot, x + labelW + cw * i + cw / 2, cy + 7, { size: 4.6, weight: 700, color: C.line2 === '#fff' ? C.muted : C.muted, align: 'center' });
      });
      s.text(B.axis, x, cy + 3, { size: 5.4, weight: 800, color: C.navy });
      cy += 18;
      B.levels.forEach((lv) => {
        const held = num(heldOf[lv.key]) > 0;
        s.text(lv.label, x, cy + 5, { size: 6.0, weight: held ? 800 : 500, color: held ? C.navy : C.muted });
        B.slots.forEach((slot, i) => {
          const on = !!lv.cover[slot];
          s.rect(x + labelW + cw * i + 0.6, cy, cw - 1.2, 14, { fill: on ? (held ? C.mint : C.mintSoft) : '#fff', stroke: on ? C.mintLine : C.line2, r: 2 });
          if (on) s.text(slot, x + labelW + cw * i + cw / 2, cy + 4, { size: 4.8, weight: 700, color: held ? '#fff' : C.mint, align: 'center' });
        });
        if (held) s.text(`${fund(heldOf[lv.key])}`, x + w, cy + 4, { size: 6.0, weight: 800, color: C.mint, align: 'right' });
        cy += 18;
      });
      s.text('색이 채워진 칸 = 지급 대상 · 흐린 칸 = 보유했지만 이 담보는 반응하지 않음', x, cy + 2, { size: 4.6, color: C.muted });
      return cy + 10;
    }
    function valueOfLevel(key, lvKey) {
      if (key === 'cancer') return num(m.state.cov.cancer[lvKey === 'general' ? 'general' : 'similar']);
      const d = partK(key, 'dx').dx || {};
      if (lvKey === 'vascular' || lvKey === 'ischemic') return num(d.core ? d.core.val : 0);
      if (lvKey === 'stroke') return num((d.subs || [])[1] ? d.subs[1].val : 0);
      if (lvKey === 'bleed') return num((d.subs || [])[2] ? d.subs[2].val : 0);
      if (lvKey === 'ami') return num((d.subs || [])[1] ? d.subs[1].val : 0);
      return 0;
    }

    /* ---------- 고객 기준 스트립 (모든 고정 페이지에 이 고객 값 4개) ---------- */
    function customerStrip(s, y) {
      const f = plan.first;
      const items = [
        ['보험나이', m.client.insuranceAge != null ? `${m.client.insuranceAge}세` : `${m.state.age}대`],
        ['상령일', m.client.ageDay ? m.client.ageDay.label : '미입력'],
        ['월 보험료', fund(m.premium)],
        ['먼저 확인', f ? `${f.name} ${f.pct}%` : '유지 점검']
      ];
      const tw = (s.CW - 6 * 3) / 4;
      items.forEach((it, i) => {
        const x = s.ML + i * (tw + 6);
        s.rect(x, y, tw, 24, { fill: C.tint2, r: 4, stroke: C.line });
        s.text(it[0], x + 8, y + 5, { size: 5.2, weight: 600, color: C.muted });
        s.text(it[1], x + 8, y + 13, { size: 6.6, weight: 800, color: C.navy });
      });
      return y + 30;
    }
    /* 보조 보장 5칩 — 진단비 다음에 확인할 칸 */
    function auxChips(s, y) {
      y = blockTitle(s, y, '진단비 다음에 확인할 칸', '이 고객 증권에서 함께 보면 좋은 항목');
      const chips = [['후유장해', '장해 지급률'], ['배상책임', '생활배상'], ['골절·화상', '상해 소액'], ['치아', '보철·임플란트'], ['수술·입원일당', '입원 매일']];
      const cw = (s.CW - 8 * 4) / 5;
      chips.forEach((ch, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 28, { fill: '#fff', r: 4, stroke: C.line });
        s.text(ch[0], x + 8, y + 5, { size: 6.2, weight: 700, color: C.navy });
        s.text(ch[1], x + 8, y + 16, { size: 5.2, weight: 500, color: C.muted });
      });
      return y + 36;
    }

    /* ---------- 터치 배지 ---------- */
    const badge = (s, x, y, touch) => s.badge(x, y, touch.code, touch.color === 'red' ? 'warn' : touch.color === 'orange' ? 'check' : touch.color === 'mint' ? 'ok' : touch.color === 'gray' ? 'none' : 'info', { size: 6.2, h: 12.5, padX: 6 });

    /* ---------- 판독 멘트 (이 고객 숫자로만) ---------- */
    function judgeText(key) {
      const e = orderEntry(key);
      const name = m.client.name;
      if (key === 'cancer') {
        const p = partK('cancer', 'treatment');
        const tN = (p.subs || []).filter((x) => subEff(x) > 0).length;
        const g = e && e.gaps[0];
        return `${name}님 일반암 진단비는 ${fund(m.state.cov.cancer.general)}으로 기준의 ${pctOf('cancer')}%입니다. ` +
          `유사암은 ${m.state.cov.cancer.similar ? fund(m.state.cov.cancer.similar) : '없어서 갑상선암이면 0원이 될 수 있고'}, ` +
          `치료비 5종은 ${tN}종 합계 ${fund(effVal(p))}입니다. ` +
          `${g ? `먼저 확인할 한 칸은 ${g.label} ${fund(g.need)}입니다.` : '금액은 기준선 위이니 재진단·원발부위 문구를 확인하겠습니다.'}`;
      }
      if (key === 'brain' || key === 'heart') {
        const d = partK(key, 'dx').dx || {};
        const core = d.core || { val: 0, label: key === 'brain' ? '뇌혈관질환' : '허혈성심장질환' };
        const sub = (d.subs || [])[1] || { val: 0, label: '' };
        const t = partK(key, 'treat');
        const hasCore = num(core.val) > 0;
        return `${name}님 ${key === 'brain' ? '뇌' : '심장'} 담보는 ${core.label} ${fund(core.val)}, ${sub.label || '세부 담보'} ${fund(sub.val)}입니다. ` +
          (hasCore ? '넓은 범위가 살아 있어 두 담보가 합산되는 구조입니다.' : `${key === 'brain' ? '뇌경색' : '협심증'}이 빠지는 범위라, 가장 흔한 형태가 보장 밖입니다.`) +
          ` 단독 치료비는 3종 중 ${(t.subs || []).filter((x) => subEff(x) > 0).length}종입니다.`;
      }
      if (key === 'surgery') {
        const sg = m.state.cov.surgery;
        return `${name}님 수술비는 질병 일반 ${fund(sg.disease)}, 1~5종 ${t5Range(m.state, 'disease15') || fund(sg.disease15)}, N대 ${sg.diseaseNdae ? fund(sg.diseaseNdae) : '없음'}, 상해 ${fund(sg.injury)}입니다. ` +
          '같은 수술이라도 어느 축에서 나오는지에 따라 금액이 달라집니다.';
      }
      const cg = m.state.cov.care;
      return `${name}님 간병은 일반병원 일당 ${fund(cg.daily)}, 요양병원 ${cg.nDaily ? fund(cg.nDaily) : '없음'}, 지급 기준은 ${({ time: '하루 8시간', money: '하루 7~8만원', unknown: '미확인' })[cg.basis] || '미확인'}입니다. ` +
        `한 달이면 300만~500만원이 나가는 돈이고, 지금은 기준의 ${pctOf('care')}%입니다.`;
    }

    /* =========================================================
       01 표지 + 오늘 설계 (+ 오프닝 3줄)
       ========================================================= */
    P.push(function (s, no) {
      s.photoBand(0, 246, {});
      s.header({ kicker: 'BOJANG PLAN BOOK', no: '01', total: '30' });
      s.text('상담 플랜북', s.ML, 68, { size: 27, weight: 800, color: C.navy });
      s.text('이 고객의 순서와 근거를 한 장에', s.ML, 102, { size: 9.8, weight: 700, color: C.blue });
      s.para(`${m.client.name}님 · ${m.dateLabel} · 담당 ${m.client.consultant}`, s.ML, 120, 300, { size: 7.4, color: C.ink2 });
      s.rect(s.ML, 140, 232, 46, { fill: C.hero, r: 5 });
      s.text('먼저 확인할 항목', s.ML + 12, 147, { size: 5.8, weight: 700, color: C.heroInk });
      s.text(`${plan.first ? plan.first.name : '유지 점검'} · ${m.score}점 ${m.letter}`, s.ML + 12, 157, { size: 11.6, weight: 800, color: '#fff' });
      s.text(`${plan.first ? `충족도 ${plan.first.pct}% · ${plan.first.pages}p 배정` : '5대 담보 기준선 이상'} · ${m.needList.length}개 보완 후보 · 월 ${fund(m.premium)}`, s.ML + 12, 173, { size: 5.8, weight: 600, color: C.heroOk });

      let y = 258;
      const minOf = (pages, w) => Math.max(4, Math.round(pages * w));
      const fMin = plan.first ? minOf(plan.first.pages, 2.6) : 0;
      const sMin = plan.second ? minOf(plan.second.pages, 2.2) : 0;
      const rest = Math.max(0, 35 - fMin - sMin);
      const flow = [
        { t: '오프닝', m: '3분', d: '인사 · 목적 · 시간 약속 · 허락' },
        { t: '판독', m: '8분', d: '점수 · 도넛 · 먼저 확인할 3카드' },
        { t: `${plan.first ? plan.first.name : '유지'}`, m: `${fMin}분`, d: plan.first ? `${plan.first.pages}p · ${plan.first.touch.code}` : '조건 확인' },
        { t: `${plan.second ? plan.second.name : '다음'}`, m: `${sMin + rest}분`, d: plan.second ? `${plan.second.pages}p · ${plan.second.touch.code}` : '다음 약속' },
        { t: '반론·클로징', m: '14분', d: '걱정 먼저 꺼내기 · 요약·결정·약속' }
      ];
      s.text('오늘 상담 60분 설계 — 이 고객 기준', s.ML, y, { size: 10.4, weight: 800, color: C.navy });
      y += 15;
      const fw = (s.CW - 8 * 4) / 5;
      flow.forEach((f, i) => {
        const x = s.ML + i * (fw + 8);
        s.rect(x, y, fw, 54, { fill: i === 2 ? C.tint : '#fff', r: 5, stroke: C.line });
        s.text(f.m, x + 8, y + 7, { size: 6, weight: 800, color: C.blue });
        s.text(f.t, x + 8, y + 17, { size: 8.8, weight: 800, color: C.navy });
        s.para(f.d, x + 8, y + 30, fw - 16, { size: 5.4, color: C.ink2, lh: 1.3 });
      });
      y += 64;
      s.text('오프닝 3줄 — 이대로 시작', s.ML, y, { size: 9.4, weight: 800, color: C.navy });
      s.text('숫자는 그대로, 말은 자기 말로', s.W - s.MR, y + 1.5, { size: 6, weight: 500, color: C.muted, align: 'right' });
      y += 13;
      y = s.script(s.ML, y, s.CW, {
        title: '첫 3분',
        text: `"${m.client.name}님, 오늘은 보험을 더 드리는 자리가 아니라 지금 보장이 어디가 비었는지 한 장으로 보여드리는 자리입니다. ` +
          `40분에서 한 시간 생각하고 있고, 오늘 결정 안 하셔도 됩니다. 대신 어디가 비었는지는 정확히 말씀드리겠습니다. ` +
          `개인정보는 이 기기 안에서만 계산되고 밖으로 나가지 않습니다. 시작해도 될까요?"`,
        note: '팔지 않는다는 신호 → 시간 약속 → 화면 허락. 이 세 가지가 없으면 뒤의 숫자는 들리지 않습니다.'
      });
      y += 8;
      y = blockTitle(s, y, '페이지 지도 — 이 고객 순서', '필요한 구간만 펼쳐도 됩니다');
      const rows = [
        ['01~04', '표지(오프닝 3줄) · 프로파일 · 터치 로드맵 · 전체 판독', '11분'],
        ['05~09', '리모델링 · 제도 · 실손 · 고지 · 청구', '8분'],
        ['10~12', '반론 카드 · 클로징 · 사후관리', '10분']
      ];
      plan.order.forEach((e) => {
        const rg = range[e.key] || [0, 0];
        rows.push([`${String(rg[0]).padStart(2, '0')}~${String(rg[1]).padStart(2, '0')}`, `${e.order}번째 확인 · ${e.name}${e.hold ? ' (유지·조건 확인)' : ` (${e.touch.code})`} — ${e.pages}p`, `${e.hold ? 2 : minOf(e.pages, 2.6)}분`]);
      });
      y = s.table(s.ML, y, s.CW, ['페이지', '내용', '소요'], rows.map((r) => [
        { text: r[0], weight: 800, color: C.blue }, r[1], { text: r[2], color: C.muted }
      ]), { widths: [66, 366, 83], size: 6.0, rowH: 12.4, align: ['left', 'left', 'center'] });
      y += 8;
      y = blockTitle(s, y, '오늘 상담의 성공 기준 3', '계약이 아니라 이 세 가지로 판단합니다');
      const sc3 = (s.CW - 16) / 3;
      PLAN_FRONT.success.forEach((sc, i) => {
        const x = s.ML + i * (sc3 + 8);
        s.rect(x, y, sc3, 44, { fill: C.tint2, r: 4, stroke: C.line });
        s.text(`${i + 1}. ${sc.t}`, x + 9, y + 8, { size: 7, weight: 800, color: C.navy });
        s.para(sc.d, x + 9, y + 21, sc3 - 18, { size: 5.8, color: C.ink2, lh: 1.3 });
      });
      y += 54;
      y = blockTitle(s, y, '이 책을 쓰는 법', '읽는 순서가 곧 상담 순서입니다');
      y = s.bullets(s.ML, y, s.CW, [
        '페이지 순서를 바꾸지 않습니다. 다만 고객이 먼저 꺼낸 걱정이 있으면 그 담보로 바로 넘어갑니다.',
        '파란 박스는 판독 멘트 한 곳뿐입니다. 숫자는 그대로, 말은 자기 말로 바꿔 말합니다.',
        '회색 표는 확인용입니다. 고객에게 다 보여주지 않고 판단 근거로만 씁니다.'
      ], { size: 6.8, gap: 2.6 });
      y += 4;
      s.para(PR.NOTE, s.ML, y, s.CW, { size: 5.4, color: C.muted, lh: 1.4 });
      foot(s, no, '표지');
    });

    /* =========================================================
       02 프로파일 + 리스크 3개
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'CUSTOMER PROFILE', '고객 프로파일', '상담 전에 이 페이지만 다시 읽으면 고객의 현재 위치와 오늘 다룰 쟁점이 잡힙니다.');
      const left = (s.CW - 12) / 2;
      s.rect(s.ML, y, left, 146, { fill: '#fff', r: 6, stroke: C.line });
      s.text('기본 정보', s.ML + 12, y + 9, { size: 7.6, weight: 800, color: C.navy });
      const kv = [
        ['고객명', m.client.name],
        ['생년월일', m.client.birth || '미입력'],
        ['보험나이', m.client.insuranceAge != null ? `${m.client.insuranceAge}세` : `${m.state.age}대 (입력값)`],
        ['상령일', m.client.ageDay ? `${m.client.ageDay.label} · D-${m.client.ageDay.days}` : '생년월일 입력 시 계산'],
        ['성별 · 직업', `${m.state.gender} · ${m.state.job}급`],
        ['실손', m.state.silson === 'none' ? '없음' : `${m.state.silson}세대`],
        ['월 보험료', `${fund(m.premium)} (연 ${fund(m.annual)})`],
        ['계약', m.contracts.length ? `${m.contracts.length}건 / ${fund(m.contractTotal)}` : '미입력']
      ];
      let cy = y + 22;
      kv.forEach((r) => {
        s.text(r[0], s.ML + 12, cy, { size: 6.4, weight: 500, color: C.muted });
        s.text(r[1], s.ML + left - 12, cy, { size: 6.8, weight: 700, color: C.navy, align: 'right' });
        s.line(s.ML + 12, cy + 10, s.ML + left - 12, cy + 10, { color: C.line2 });
        cy += 14.6;
      });
      const rx = s.ML + left + 12;
      s.rect(rx, y, left, 146, { fill: C.hero, r: 6 });
      s.text('진단 요약', rx + 12, y + 9, { size: 7.6, weight: 800, color: C.heroInk });
      s.text(`${m.letter}`, rx + 12, y + 21, { size: 28, weight: 800, color: '#fff' });
      s.text(`${m.score}점 · ${m.grade.label}`, rx + 54, y + 34, { size: 8.2, weight: 700, color: C.heroOk });
      s.text('먼저 확인할 항목', rx + 12, y + 58, { size: 6.2, weight: 700, color: C.heroInk });
      s.para(plan.first ? plannerLine() : '5대 담보가 기준선 이상 — 유지·조건 확인 단계', rx + 12, y + 67, left - 24, { size: 6.8, color: '#fff', lh: 1.4 });
      s.text('오늘의 목표', rx + 12, y + 102, { size: 6.2, weight: 700, color: C.heroInk });
      s.para(plan.first ? `${plan.first.name} 한 칸(${plan.first.touch.code})을 확인하고, 다음 약속 날짜를 받는다.` : '금액 조정과 갱신 대비를 정리한다.', rx + 12, y + 111, left - 24, { size: 7, weight: 600, color: '#fff', lh: 1.4 });
      y += 156;
      function plannerLine() {
        const g = plan.first.gaps[0];
        return `${plan.first.name} ${plan.first.pct}%` + (g ? ` · ${g.label} ${fund(g.need)}` : ' · 조건 확인');
      }

      /* 리스크 3개 — 위험·시급·결정 방식 */
      y = blockTitle(s, y, '상담 전에 잡아둘 3가지', '질병 위험 예측이 아니라 상담 조건입니다');
      const cw3 = (s.CW - 16) / 3;
      const risk3 = [
        { t: '① 먼저 볼 곳', d: plan.first ? `${plan.first.name} ${plan.first.pct}% · ${plan.first.touch.code}` : '전 항목 기준선 이상', c: C.blue },
        { t: '② 시급한 조건', d: m.client.ageDay ? `상령일 D-${m.client.ageDay.days}` : '생년월일 미입력', c: C.orange },
        { t: '③ 결정 방식', d: (m.state.flags || {}).savings ? '적립·갱신 비중 큼 → 보험료 반론 먼저' : (m.state.silson === '1' || m.state.silson === '2' ? '실손 전환이 첫 질문' : '범위·금액 확인부터'), c: C.mint }
      ];
      risk3.forEach((r, i) => {
        const x = s.ML + i * (cw3 + 8);
        s.rect(x, y, cw3, 42, { fill: '#fff', r: 4, stroke: C.line });
        s.rect(x, y, cw3, 2.4, { fill: r.c, r: 1.2 });
        s.text(r.t, x + 9, y + 8, { size: 6.4, weight: 800, color: C.navy });
        s.para(r.d, x + 9, y + 20, cw3 - 18, { size: 6.0, color: C.ink2, lh: 1.3 });
      });
      y += 50;

      const half = (s.CW - 8) / 2;
      s.rect(s.ML, y, half, 50, { fill: '#fff', r: 5, stroke: C.line });
      s.text('가족력', s.ML + 10, y + 7, { size: 6.2, weight: 700, color: C.muted });
      s.text(m.family.length ? m.familyLabels.join(' · ') : '미입력', s.ML + 10, y + 16, { size: 9.2, weight: 800, color: m.family.length ? C.navy : C.muted });
      s.para(m.familyNotes.length ? m.familyNotes.map((f) => f.title).join(' · ') + ' — 해당 담보를 먼저 확인합니다.' : '입력하면 같은 항목의 확인 순서를 앞에 둡니다.', s.ML + 10, y + 29, half - 20, { size: 5.6, color: C.ink2, lh: 1.3 });
      const ddx = s.ML + half + 8;
      s.rect(ddx, y, half, 50, { fill: m.disclosure.tone === 'ok' ? C.mintSoft : m.disclosure.tone === 'gap' ? C.redSoft : C.orangeSoft, r: 5, stroke: C.line });
      s.text('고지 판정 (3개월·1년·5년)', ddx + 10, y + 7, { size: 6.2, weight: 700, color: C.muted });
      s.text(m.disclosure.label, ddx + 10, y + 16, { size: 9.2, weight: 800, color: m.disclosure.tone === 'ok' ? C.mint : m.disclosure.tone === 'gap' ? C.red : C.orange });
      s.para(m.disclosure.reasons.length ? m.disclosure.reasons.join(' · ') : '체크된 항목 없음 — 표준체 우선', ddx + 10, y + 29, half - 20, { size: 5.6, color: C.ink2, lh: 1.3 });
      y += 60;

      y = lead(s, y, '보유 계약');
      y = contractTable(s, m, y, { max: 5, rowH: 17 });
      y += 8;
      y = lead(s, y, '5대 충족도 — 이 고객');
      const bw = s.CW - 210;
      m.rows.forEach((row, i) => {
        const yy = y + i * 11.6;
        const e = orderEntry(row.item.key);
        s.text(`${row.item.name}${e && e.order === 1 ? ' · 먼저 확인' : ''}`, s.ML, yy, { size: 6.2, weight: e && e.order === 1 ? 800 : 500, color: e && e.order === 1 ? C.blue : C.ink2 });
        s.gauge(s.ML + 74, yy + 1.6, bw, row.r.fill, { color: TONE_COLOR[({ ok: 'ok', enough: 'ok', need: 'need', check: 'need', gap: 'gap', short: 'gap', none: 'none' })[row.level] || 'none'], h: 4.4 });
        s.text(`${row.pct}%`, s.ML + 74 + bw + 6, yy, { size: 6, weight: 700, color: C.navy });
        s.text(e ? (e.hold ? '유지·조건 확인' : e.touch.code) : '', s.W - s.MR, yy, { size: 5.6, weight: 600, color: C.muted, align: 'right' });
      });
      y += 62;
      if (m.client.ageDay) y = noteStrip(s, y, `상령일 ${m.client.ageDay.label}(D-${m.client.ageDay.days}) — 이 날이 지나면 보험나이가 한 살 올라 같은 보장도 보험료가 달라질 수 있습니다.`, { size: 6.2 });
      y += 8;
      /* 남은 지면에 맞춰 블록을 골라 그립니다(넘침 0) */
      const room = s.limit - y;
      if (room > 110) {
        y = blockTitle(s, y, '이 고객의 예상 쟁점', '첫 반론을 미리 준비합니다');
        PLAN_FRONT.issues.forEach((it) => {
          if (y + 26 > s.limit - 6) return;
          s.rect(s.ML, y, s.CW, 23, { fill: '#fff', r: 4, stroke: C.line });
          s.text(it.t, s.ML + 9, y + 4, { size: 6.4, weight: 800, color: C.navy });
          s.para(it.d, s.ML + 124, y + 3.5, s.CW - 134, { size: 5.6, color: C.ink2, lh: 1.3 });
          y += 26;
        });
        y += 4;
      }
      if (s.limit - y > 70) {
        y = blockTitle(s, y, '상담 전 3분 준비', '고객 앞에서 확인할 것');
        ['증권에서 담보명·코드·가입일·갱신일을 확인했다',
          '최근 5년 입원·수술·진단 이력을 물어볼 준비가 됐다',
          '가족(배우자·자녀) 동석 여부를 확인했다',
          '오늘 결정할 범위와 아닌 범위를 구분해 두었다'].forEach((t) => {
          if (y + 13 > s.limit - 6) return;
          s.rect(s.ML, y + 2, 6, 6, { fill: '#fff', stroke: C.blue, r: 1.2, lw: 0.9 });
          s.text(t, s.ML + 12, y, { size: 6.4, weight: 500, color: C.ink2 });
          y += 13.2;
        });
      }
      foot(s, no, '프로파일');
    });

    /* =========================================================
       03 터치 로드맵
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'TOUCH ROADMAP', '오늘 어디부터 손댈까 — 기본 상담 우선순위', '이 순서는 앱의 기본값입니다. 고객이 먼저 꺼낸 걱정·청구 질문과 실제 증권 공백에 따라 설계사가 조정합니다.');
      y = noteStrip(s, y, PR.NOTE, { size: 6.2, fill: C.mintSoft, stroke: C.mintLine, accent: C.mint });
      y += 8;

      /* 매트릭스 */
      const mw = 244, mh = 176;
      const mx = s.ML, my = y;
      s.rect(mx, my, mw, mh, { fill: '#fff', r: 6, stroke: C.line });
      const gx = mx + 34, gy = my + 18, gw = mw - 46, gh = mh - 40;
      for (let i = 0; i <= 4; i += 1) {
        s.line(gx, gy + (gh / 4) * i, gx + gw, gy + (gh / 4) * i, { color: C.line2 });
        s.line(gx + (gw / 4) * i, gy, gx + (gw / 4) * i, gy + gh, { color: C.line2 });
      }
      s.text('공백 큼 →', mx + mw - 8, my + mh - 14, { size: 5.2, weight: 600, color: C.muted, align: 'right' });
      s.text('상담가중 ↑', mx + 6, my + 8, { size: 5.2, weight: 600, color: C.muted });
      s.text('충족도 공백', gx + gw, my + mh - 14, { size: 5, weight: 500, color: C.muted, align: 'right' });
      plan.order.forEach((e) => {
        const px = gx + Math.min(1, Math.max(0, e.gap)) * gw;
        const wv = e.risk.value * e.urgency.value;
        const py = gy + gh - Math.min(1, Math.max(0, (wv - 0.7) / 0.9)) * gh;
        const on = e.order === 1;
        s.ctx.save();
        s.ctx.beginPath(); s.ctx.arc(px, py, on ? 6 : 4, 0, Math.PI * 2);
        s.ctx.fillStyle = on ? C.blue : e.hold ? C.mint : C.orange; s.ctx.fill();
        if (on) { s.ctx.strokeStyle = C.blue; s.ctx.globalAlpha = 0.35; s.ctx.lineWidth = 5; s.ctx.stroke(); s.ctx.globalAlpha = 1; }
        s.ctx.restore();
        s.text(`${e.name}`, px + (px > gx + gw * 0.7 ? -8 : 8), py - 3, { size: 5.4, weight: on ? 800 : 600, color: on ? C.blue : C.ink2, align: px > gx + gw * 0.7 ? 'right' : 'left' });
      });
      s.text('가로 = 충족도 공백(1−충족도) · 세로 = 상담가중×시급', mx + 8, my + mh - 10, { size: 4.8, weight: 500, color: C.muted });

      /* 1·2순위 카드 */
      const cx = mx + mw + 10, cw = s.CW - mw - 10;
      const first = plan.first;
      if (first) {
        s.rect(cx, my, cw, 96, { fill: C.tint, r: 6, stroke: C.blue });
        s.text(`먼저 확인할 항목  ${first.order}`, cx + 11, my + 8, { size: 6, weight: 800, color: C.blue });
        s.text(`${first.name}`, cx + 11, my + 17, { size: 13, weight: 800, color: C.navy });
        badge(s, cx + cw - 86, my + 8, first.touch);
        s.text(`${first.pct}% · 점수 ${first.score.toFixed(2)} · ${first.pages}p`, cx + cw - 11, my + 21, { size: 6.2, weight: 700, color: C.blue, align: 'right' });
        s.text('오늘의 한 칸', cx + 11, my + 38, { size: 5.6, weight: 800, color: C.muted });
        s.para(PR.firstGapLine(first), cx + 11, my + 47, cw - 22, { size: 6.6, weight: 600, color: C.ink, lh: 1.35 });
        s.text('왜 이 항목인가', cx + 11, my + 68, { size: 5.6, weight: 800, color: C.muted });
        s.para(PR.reasonLines(first).slice(0, 2).join(' · '), cx + 11, my + 77, cw - 22, { size: 5.4, color: C.ink2, lh: 1.3 });
      }
      const second = plan.second;
      if (second) {
        s.rect(cx, my + 104, cw, 72, { fill: '#fff', r: 6, stroke: C.line });
        s.text(`다음 약속 대상  ${second.order}`, cx + 11, my + 112, { size: 6, weight: 800, color: C.muted });
        s.text(`${second.name}`, cx + 11, my + 121, { size: 11, weight: 800, color: C.navy });
        badge(s, cx + cw - 86, my + 112, second.touch);
        s.para(`${second.pct}% · ${second.pages}p. 다음 상담 안건: ${PR.firstGapLine(second)}`, cx + 11, my + 138, cw - 22, { size: 6.2, color: C.ink2, lh: 1.35 });
      }
      if (!first) {
        s.rect(cx, my, cw, 176, { fill: C.mintSoft, r: 6, stroke: C.mintLine });
        s.text('유지 점검 모드', cx + 12, my + 10, { size: 9.6, weight: 800, color: C.mint });
        s.para('5대 담보가 모두 기준선을 넘었습니다. 오늘은 추가 가입 대신 갱신·만기·중복·제도를 점검하고, 다음 점검 날짜를 잡습니다.', cx + 12, my + 26, cw - 24, { size: 6.8, color: C.ink2, lh: 1.45 });
      }
      y += mh + 10;

      /* 점수표 */
      y = blockTitle(s, y, '우선순위 계산 — 숨기지 않고 보여줍니다', '충족도 공백 × 상담가중 × 시급 × 실효 × 난이도');
      const cols = ['순번', '담보', '충족도', '공백^1.15', '상담가중', '시급', '실효', '난이도', '점수', '터치 방식'];
      const widths = [28, 58, 44, 58, 56, 44, 44, 44, 42, 87];
      y = s.table(s.ML, y, s.CW, cols, plan.order.map((e) => [
        { text: e.hold ? 'HOLD' : String(e.order), weight: 800, color: e.hold ? C.mint : C.blue },
        { text: e.name, weight: 700, color: C.navy },
        `${e.pct}%`,
        e.base.toFixed(2),
        `×${e.risk.value}`,
        `×${e.urgency.value}`,
        `×${e.effect.value}`,
        `×${e.difficulty.value}`,
        { text: e.score.toFixed(2), weight: 800, color: e.order === 1 ? C.blue : C.ink },
        e.hold ? '유지·조건 확인' : e.touch.code
      ]), { widths, size: 6.0, rowH: 14, align: ['center', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'left'] });
      y += 6;

      /* 건드리지 않을 것 + 예상 반론 */
      const hw = (s.CW - 10) / 2;
      s.rect(s.ML, y, hw, 62, { fill: C.mintSoft, r: 5, stroke: C.mintLine });
      s.text('건드리지 않을 것', s.ML + 10, y + 7, { size: 6.6, weight: 800, color: C.mint });
      const holds = plan.holds.length ? plan.holds : [];
      s.para(holds.length ? holds.map((h) => `${h.name} ${h.pct}%`).join(' · ') + ' — 유지하고 지급 조건만 확인' : '없음 — 5개 모두 보완 후보', s.ML + 10, y + 18, hw - 20, { size: 6.4, color: C.ink2, lh: 1.35 });
      s.text('이 담보는 오늘 금액을 올리지 않습니다. 갱신·중복·만기만 확인합니다.', s.ML + 10, y + 46, { size: 5.4, color: C.muted });
      const ox = s.ML + hw + 10;
      s.rect(ox, y, hw, 62, { fill: '#fff', r: 5, stroke: C.line });
      s.text('예상 반론 — 먼저 꺼낼 것', ox + 10, y + 7, { size: 6.6, weight: 800, color: C.navy });
      const objIds = (first ? first.objections : []).slice(0, 2);
      objIds.forEach((id, i) => {
        const o = E.objection(id);
        if (!o) return;
        const by = y + 19 + i * 21;
        s.text(`· ${o.q}`, ox + 10, by, { size: 6.2, weight: 700, color: C.navy });
        s.para(o.a, ox + 10, by + 8, hw - 20, { size: 5.2, color: C.muted, lh: 1.25 });
      });
      y += 68;
      /* 범위 카드 2장 — 심장·뇌혈관은 코드 공백이 가장 자주 나오는 곳 */
      y = blockTitle(s, y, '범위 카드 — 심장·뇌혈관은 함께 봅니다', '담보명이 아니라 코드 범위');
      const hcw = (s.CW - 10) / 2;
      [
        { k: 'heart', t: '심장 — 허혈성 I20~I25', seg: 'I21~I22만 담긴 경우 협심증 스텐트가 빠집니다' },
        { k: 'brain', t: '뇌혈관 — I60~I69', seg: 'I60~I62만 담긴 경우 뇌경색(I63)이 빠집니다' }
      ].forEach((c, i) => {
        const x = s.ML + i * (hcw + 10);
        const d = partK(c.k, 'dx').dx || {};
        const cv = num(d.core ? d.core.val : 0);
        const gap = PR.rangeGap(m, c.k);
        s.rect(x, y, hcw, 44, { fill: gap ? C.redSoft : '#fff', r: 5, stroke: gap ? C.tintLine : C.line });
        s.text(c.t, x + 10, y + 7, { size: 6.4, weight: 800, color: C.navy });
        s.text(gap ? '범위 공백' : `${won(cv)}만원`, x + hcw - 10, y + 6, { size: 7.4, weight: 800, color: gap ? C.red : C.mint, align: 'right' });
        s.para(c.seg, x + 10, y + 20, hcw - 20, { size: 5.6, color: C.ink2, lh: 1.3 });
      });
      y += 52;
      y = blockTitle(s, y, '터치 시나리오 3단', '오늘·다음·3개월 — 한 번에 다 하지 않습니다');
      y = s.table(s.ML, y, s.CW, ['시점', '할 일', '기준'], [
        ['오늘', first ? `${first.name} 한 칸(${first.touch.code}) 결정 — ${PR.firstGapLine(first)}` : '유지·조건 확인', '결정 1개'],
        ['다음 상담', second ? `${second.name} — ${PR.firstGapLine(second)}` : '갱신·만기 점검', `${second ? second.pages : 0}p 배정`],
        ['3개월', plan.holds.length ? `${plan.holds.map((h) => h.name).join(' · ')} 지급 조건 확인` : '청구 동행·제도 신청 확인', '조건 확인']
      ], { widths: [56, 380, 79], size: 6.0, rowH: 16, align: ['left', 'left', 'left'] });
      y += 8;
      y = blockTitle(s, y, '터치 방식 6종 — 무엇으로 말할지', '배지가 바뀌면 준비물이 바뀝니다');
      const legend = [
        ['금액형', '실제 진료비 + 소득 공백'], ['범위형', '코드 밴드 + 지급 시나리오'], ['재배치형', '리모델링 워터폴'],
        ['제도형', '산정특례·상한제·장기요양'], ['시점형', '상령일 D-day·인수 조건'], ['확인형', '증권 재확인 3줄']
      ];
      const lw = (s.CW - 5 * 6) / 6;
      legend.forEach((l, i) => {
        const x = s.ML + i * (lw + 6);
        s.rect(x, y, lw, 34, { fill: '#fff', r: 4, stroke: C.line });
        s.text(l[0], x + 7, y + 6, { size: 6.0, weight: 800, color: C.navy });
        s.para(l[1], x + 7, y + 16, lw - 14, { size: 4.8, color: C.muted, lh: 1.2 });
      });
      y += 42;
      if (y < s.limit - 24) s.para('순서를 바꾸는 신호 — ① 고객이 먼저 특정 담보를 걱정하면 그 담보를 앞으로 ② 청구 질문이 나오면 그 코드 페이지를 먼저 ③ 증권에서 다른 공백이 확인되면 그 항목으로 교체. 순서는 참고값이고 판단은 설계사가 합니다.', s.ML, y, s.CW, { size: 5.6, color: C.muted, lh: 1.4 });
      foot(s, no, '터치 로드맵');
    });

    /* =========================================================
       04 전체 판독
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'READING', '전체 판독 — 3초 결론부터', '숫자 하나 → 도넛 → 이 고객 순서대로 5장. 세부 표부터 펼치지 않습니다.');
      const dn = m.counts;
      s.rect(s.ML, y, 172, 112, { fill: '#fff', r: 6, stroke: C.line });
      s.donut(s.ML + 54, y + 58, 36, [
        { value: dn.enough, color: C.mint }, { value: dn.check, color: C.orange },
        { value: dn.short, color: C.short }, { value: dn.none, color: C.gray }
      ], { inner: 23, centerValue: m.score, centerLabel: '점수', centerSize: 15 });
      [['충분', C.mint, dn.enough], ['점검', C.orange, dn.check], ['보완 후보', C.short, dn.short], ['미가입', C.gray, dn.none]].forEach((l, i) => {
        const ly = y + 30 + i * 13.5;
        s.rect(s.ML + 100, ly + 1, 6, 6, { fill: l[1], r: 3 });
        s.text(l[0], s.ML + 111, ly - 1, { size: 6.2, weight: 600, color: C.ink2 });
        s.text(`${l[2]}`, s.ML + 162, ly - 1, { size: 6.4, weight: 800, color: C.navy, align: 'right' });
      });
      const rx = s.ML + 182, rw = s.CW - 182;
      s.rect(rx, y, rw, 112, { fill: C.hero, r: 6 });
      s.text('3초 결론', rx + 12, y + 9, { size: 6.2, weight: 700, color: C.heroInk });
      const f = plan.first, tn = m.thinnest;
      s.para(`${m.client.name}님은 ${m.letter}등급(${m.score}점)이고, 오늘 먼저 확인할 항목은 ${f ? `${f.name}(${f.pct}%)` : '없음 — 유지 점검'}입니다. ` +
        `${tn && (!f || tn.item.key !== f.key) ? `가장 얇은 항목은 ${tn.item.name} ${tn.pct}%입니다. ` : ''}나머지는 유지하면서 한 칸씩 채웁니다.`,
        rx + 12, y + 20, rw - 24, { size: 8.6, weight: 600, color: '#fff', lh: 1.45 });
      s.text(`${m.needList.length}개 보완 후보 · 월 ${fund(m.premium)}`, rx + 12, y + 92, { size: 6.4, weight: 600, color: C.heroOk });
      y += 122;

      y = blockTitle(s, y, '5대 판정 — 이 고객 순서', '순번은 기본 상담 순서입니다. 판정은 충족도 기준');
      const cols = ['순번', '담보', '지금 보장', '충족도', '판정', '터치 방식', '부족분'];
      const widths = [30, 54, 168, 62, 48, 76, 77];
      const VERD = { ok: '충분', enough: '충분', need: '보완 후보', check: '점검', gap: '보완 후보', none: '미가입' };
      y = s.table(s.ML, y, s.CW, cols, plan.order.map((e) => {
        const row = rowK(e.key);
        return [
          { text: e.hold ? 'HOLD' : String(e.order), weight: 800, color: e.hold ? C.mint : C.blue },
          { text: e.name, weight: 800, color: C.navy },
          shortSummary(row, m),
          `${e.pct}%`,
          { text: e.hold ? '충분' : (VERD[row.level] || '점검'), badge: e.hold ? 'ok' : row.level },
          e.hold ? '유지·조건 확인' : e.touch.code,
          { text: e.gaps.length ? `${won(e.gaps.reduce((a, g) => a + g.need, 0))}만원` : '—', color: e.gaps.length ? C.red : C.muted, weight: 700 }
        ];
      }), { widths, size: 6.2, rowH: 22, align: ['center', 'left', 'left', 'center', 'center', 'left', 'right'] });
      y += 10;

      y = blockTitle(s, y, '먼저 확인할 3카드', '이 세 개만 순서대로');
      const cw = (s.CW - 16) / 3;
      const cards = [
        { t: '① 한 칸', d: f ? PR.firstGapLine(f) : '전 항목 기준선 이상 — 조건 확인', c: C.blue },
        { t: '② 범위·코드', d: rangeLine(), c: C.orange },
        { t: '③ 재원·제도', d: (m.state.flags || {}).savings ? '적립·중복 특약 재배치부터' : `실손 ${m.state.silson === 'none' ? '없음' : m.state.silson + '세대'} · 산정특례·상한제 확인`, c: C.mint }
      ];
      cards.forEach((c, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 58, { fill: '#fff', r: 5, stroke: C.line });
        s.rect(x, y, cw, 2.4, { fill: c.c, r: 1.2 });
        s.text(c.t, x + 9, y + 8, { size: 7, weight: 800, color: C.navy });
        s.para(c.d, x + 9, y + 20, cw - 18, { size: 6.0, color: C.ink2, lh: 1.35 });
      });
      y += 66;
      function rangeLine() {
        const bits = [];
        if (PR.rangeGap(m, 'heart')) bits.push('심장 범위 공백');
        if (PR.rangeGap(m, 'brain')) bits.push('뇌 범위 공백');
        if (!bits.length) bits.push(`실손 ${m.state.silson === 'none' ? '없음' : m.state.silson + '세대'}`);
        bits.push(plan.holds.length ? `유지 ${plan.holds.length}개` : '유지 0개');
        return bits.join(' · ') + ' — 코드 페이지에서 확인';
      }
      y = blockTitle(s, y, '보여주는 순서 4단계', '순서를 바꾸지 않습니다');
      PLAN_OPEN.presentOrder.forEach((p, i) => {
        const x = s.ML + i * ((s.CW - 8 * 3) / 4 + 8);
        const w = (s.CW - 8 * 3) / 4;
        s.rect(x, y, w, 52, { fill: C.tint2, r: 4, stroke: C.line });
        s.iconCircle(x + 13, y + 12, 6.6, { fill: C.blue, num: p.n, size: 5.6, color: '#fff' });
        s.text(p.t, x + 24, y + 7, { size: 6.8, weight: 800, color: C.navy });
        s.para(p.d, x + 8, y + 22, w - 16, { size: 5.6, color: C.ink2, lh: 1.3 });
      });
      y += 60;
      if (y < s.limit - 150) {
        y = blockTitle(s, y, '세부 14칸 — 어디가 가장 얇은가', '50% 미만만 굵게');
        const perCol = Math.ceil(m.parts.length / 2);
        const pcw = (s.CW - 10) / 2;
        m.parts.forEach((pp, i) => {
          const col = Math.floor(i / perCol), row = i % perCol;
          const x = s.ML + col * (pcw + 10), cy = y + row * 12.4;
          const lab = `${pp.itemName} · ${pp.label}`;
          s.text(lab, x, cy, { size: 5.8, weight: pp.pct < 50 ? 800 : 500, color: pp.pct < 50 ? C.red : C.ink2 });
          s.gauge(x + 116, cy + 1.4, pcw - 152, pp.fill, { color: pp.pct < 50 ? C.red : pp.pct < 80 ? C.orange : C.mint, h: 4 });
          s.text(`${pp.pct}%`, x + pcw, cy, { size: 5.6, weight: 700, color: C.navy, align: 'right' });
        });
        y += perCol * 12.4 + 6;
      }
      if (y < s.limit - 70) y = auxChips(s, y);
      if (y < s.limit - 30) y = noteStrip(s, y, '고객이 중간에 끼어들면 그 자리에서 멈춥니다. 끼어든 지점이 고객이 가장 신경 쓰는 지점이고, 그 이야기를 다 들은 뒤 다음 카드로 넘어갑니다. 숫자는 판정이 아니라 확인 후보입니다.', { size: 6.0 });
      foot(s, no, '전체 판독');
    });

    /* =========================================================
       05 리모델링 워터폴
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'REMODEL', '리모델링 — 해지가 아니라 재배치', '추가 부담 0원으로 1순위 한 칸을 채울 수 있는지부터 봅니다. 재원은 증권 확인 후 확정합니다.');
      const prem = num(m.premium);
      const cs = m.contracts || [];
      const renewPrem = cs.filter((c) => c.renew).reduce((a, c) => a + num(c.premium), 0);
      const savePrem = (m.state.flags || {}).savings ? '확인' : '—';
      const stepsW = s.CW;
      const steps = [
        { t: '현재 보험료', v: `${fund(prem)}`, sub: `계약 ${cs.length}건 · 갱신형 ${fund(renewPrem)}`, c: C.navy },
        { t: '적립·저축 특약', v: savePrem === '확인' ? '확인 필요' : '없음 표시', sub: (m.state.flags || {}).savings ? '해지환급금·보장 비중 확인' : '적립 플래그 미입력', c: C.orange },
        { t: '중복·미사용 특약', v: (m.state.flags || {}).manyRiders ? '확인 필요' : '—', sub: '같은 이름 특약 2개 이상, 1회한 중복', c: C.orange },
        { t: '재배치 재원', v: '확인 후 확정', sub: '위 두 칸의 합 — 고객 확인 없이 금액을 말하지 않습니다', c: C.blue },
        { t: 'After 보험료', v: '같거나 낮게', sub: '추가 지출은 고객이 선택', c: C.mint }
      ];
      const bw = (stepsW - 8 * 4) / 5;
      steps.forEach((st, i) => {
        const x = s.ML + i * (bw + 8);
        const h = 74 - i * 6;
        s.rect(x, y + (74 - h), bw, h, { fill: i === 3 ? C.tint : '#fff', r: 5, stroke: C.line });
        s.rect(x, y + (74 - h), bw, 2.4, { fill: st.c, r: 1.2 });
        s.text(st.t, x + 8, y + (74 - h) + 8, { size: 6, weight: 800, color: C.muted });
        s.text(st.v, x + 8, y + (74 - h) + 18, { size: 9.6, weight: 800, color: st.c });
        s.para(st.sub, x + 8, y + (74 - h) + 32, bw - 16, { size: 5.2, color: C.ink2, lh: 1.3 });
      });
      y += 84;
      /* 재배치 시 보장 변화 */
      const f = plan.first;
      const need = f && f.gaps[0] ? f.gaps[0].need : 0;
      y = blockTitle(s, y, '재배치하면 무엇이 채워지나', '재원이 확인되면 이 순서로 배서');
      const rw = (s.CW - 10) / 2;
      s.rect(s.ML, y, rw, 60, { fill: '#fff', r: 5, stroke: C.line });
      s.text('지금', s.ML + 10, y + 7, { size: 6, weight: 800, color: C.muted });
      s.text(f ? `${f.name} ${f.pct}%` : '5대 기준선 이상', s.ML + 10, y + 16, { size: 11, weight: 800, color: C.navy });
      s.para(f ? PR.firstGapLine(f) : '금액 조정 단계', s.ML + 10, y + 33, rw - 20, { size: 5.8, color: C.ink2, lh: 1.3 });
      const rx2 = s.ML + rw + 10;
      s.rect(rx2, y, rw, 60, { fill: C.mintSoft, r: 5, stroke: C.mintLine });
      s.text('재배치 후 (재원 확인 시)', rx2 + 10, y + 7, { size: 6, weight: 800, color: C.mint });
      s.text(f ? `${f.name} ${Math.min(100, f.pct + (need ? 20 : 0))}% 가정` : '유지', rx2 + 10, y + 16, { size: 11, weight: 800, color: C.mint });
      s.para(need ? `${fund(need)}을 재원 안에서 옮기는 시나리오 — 실제 금액은 배서 후 확정` : '추가 가입 없이 조건만 정리', rx2 + 10, y + 33, rw - 20, { size: 5.8, color: C.ink2, lh: 1.3 });
      y += 68;
      y = blockTitle(s, y, '이 고객의 점검 포인트', '입력값에서 자동 추출');
      const cps = m.checkpoints.slice(0, 4);
      const cw2 = (s.CW - 8) / 2;
      cps.forEach((c, i) => {
        const x = s.ML + (i % 2) * (cw2 + 8), cy = y + Math.floor(i / 2) * 44;
        s.rect(x, cy, cw2, 40, { fill: '#fff', r: 4, stroke: C.line });
        s.rect(x, cy, 2.2, 40, { fill: TONE_COLOR[c.level] || C.blue, r: 1.1 });
        s.text(c.title, x + 9, cy + 5, { size: 6.6, weight: 800, color: C.navy });
        s.para(c.body, x + 9, cy + 16, cw2 - 18, { size: 5.4, color: C.ink2, lh: 1.28 });
      });
      y += 44 * Math.ceil(cps.length / 2) + 6;
      y = blockTitle(s, y, '지금 계약 구조', '갱신형·적립 여부가 재원의 출발점');
      y = contractTable(s, m, y, { max: 4, rowH: 16 });
      y += 8;
      y = blockTitle(s, y, '배서 전에 확인할 4가지', '정리해서 확보한 돈의 용도를 먼저 정합니다');
      y = s.checks(s.ML, y, s.CW, PLAN_FRONT.endorsement, { size: 6.4, rowH: 12.6 });
      y += 4;
      y = s.bullets(s.ML, y, s.CW, PREMIUM_GUIDE.remodel, { size: 5.8, gap: 1.8 });
      y += 6;
      if (y < s.limit - 80) {
        y = blockTitle(s, y, '재배치 2안 — 같은 보험료로', '증권 확인 후 확정');
        const f0 = plan.first;
        y = s.table(s.ML, y, s.CW, ['안', '무엇을 정리하나', '무엇을 채우나'], [
          ['A안 · 보장 유지', '적립·저축 특약 일부 해지', f0 ? `${f0.name} ${f0.pct}% → 기준선` : '금액 조정'],
          ['B안 · 구조 변경', '중복 특약 1개 정리 + 갱신형 비중 축소', f0 ? `${f0.name} 한 칸 + 갱신 부담 완화` : '갱신 부담 완화']
        ].map((r) => [{ text: r[0], weight: 700, color: C.navy }, r[1], r[2]]), { widths: [90, 235, 190], size: 6.0, rowH: 18, align: ['left', 'left', 'left'] });
      }
      y += 4;
      if (y < s.limit - 34) y = noteStrip(s, y, '해지는 마지막 수단입니다. 지금 가진 핵심 담보는 나이와 병력 때문에 같은 조건으로 다시 들 수 없습니다. "해지"라는 단어는 고객이 먼저 꺼낼 때만 사용하고, 재원 금액은 증권을 확인한 뒤에만 말합니다.', { size: 6.0, fill: C.orangeSoft, stroke: C.orangeLine, accent: C.orange });
      foot(s, no, '리모델링');
    });

    /* =========================================================
       06 제도 활용
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'SYSTEM', '보험 밖에서 새는 돈 — 제도 4종', '제도로 기본을 받고, 제도가 못 메우는 칸을 보험으로 맞춥니다. 판정이 아니라 확인 안내입니다.');
      const cw = (s.CW - 10) / 2;
      E.SYSTEM.forEach((it, i) => {
        const x = s.ML + (i % 2) * (cw + 10), cy = y + Math.floor(i / 2) * 84;
        s.rect(x, cy, cw, 78, { fill: i === 0 ? C.tint : '#fff', r: 5, stroke: C.line });
        s.text(it.title, x + 10, cy + 7, { size: 7.6, weight: 800, color: C.navy });
        s.text(it.rate, x + cw - 10, cy + 5, { size: 12, weight: 800, color: C.blue, align: 'right' });
        s.text(it.when, x + 10, cy + 19, { size: 5.8, weight: 600, color: C.blue });
        s.para(it.body, x + 10, cy + 29, cw - 20, { size: 5.8, color: C.ink2, lh: 1.35 });
        s.para(`한계 — ${it.limit}`, x + 10, cy + 54, cw - 20, { size: 5.4, weight: 600, color: C.red, lh: 1.3 });
        s.text(`출처 ${it.src}`, x + 10, cy + 69, { size: 4.6, color: C.muted });
      });
      y += 176;
      y = blockTitle(s, y, '같은 1,000만원은 누구 몫인가', '급여·비급여·실손·정액담보의 경계');
      s.stacked(s.ML, y, s.CW, 18, E.STACK.map((x, i) => ({ value: Math.max(0.5, x.value), color: C[E.STACK[i].color] || C.blue })), { showLabel: true, lightFrom: 0 });
      y += 22;
      E.STACK.forEach((x, i) => {
        const bx = s.ML + i * (s.CW / 4);
        s.rect(bx + 2, y, 6, 6, { fill: C[x.color] || C.blue, r: 3 });
        s.text(x.label, bx + 12, y - 1, { size: 5.6, weight: 700, color: C.navy });
        s.text(x.note, bx + 12, y + 8, { size: 5.0, color: C.muted });
      });
      y += 24;
      y = s.table(s.ML, y, s.CW, ['제도', '적용', '한계', '보험의 자리'], E.SYSTEM.map((it) => [
        { text: it.title, weight: 800, color: C.navy }, it.when, { text: it.limit, color: C.red }, it.key === 'special' ? '비급여·소득 공백' : it.key === 'cap' ? '비급여·상급병실' : it.key === 'ltc' ? '본인부담 15~20%' : '가구 기준·사후'
      ]), { widths: [112, 150, 170, 83], size: 5.8, rowH: 15, align: ['left', 'left', 'left', 'left'] });
      y += 6;
      const f = plan.first;
      if (y < s.limit - 40) y = noteStrip(s, y, `${m.client.name}님은 실손 ${m.state.silson === 'none' ? '이 없어 입원 기본축부터' : m.state.silson + '세대'}이고, 지금 먼저 확인할 항목은 ${f ? `${f.name}(${f.pct}%)` : '없음'}입니다. 제도 4종은 "병원비가 0이 된다"가 아니라 "급여는 줄고 비급여·소득은 남는다"를 설명하는 재료입니다.`, { size: 6.0 });
      y += 8;
      y = blockTitle(s, y, '제도 신청 순서 — 놓치면 환급도 놓칩니다', '진단·퇴원 직후에 움직입니다');
      const steps3 = [
        ['① 산정특례', '진단 후 30일 안에 신청해야 확진일부터 적용'],
        ['② 상한제', '다음 해 8월경 사후환급 — 청구하지 않으면 그대로'],
        ['③ 실손', '급여 본인부담 영수증·세부내역서로 청구 (3년 소멸시효)']
      ];
      const sw3 = (s.CW - 16) / 3;
      steps3.forEach((st, i) => {
        const x = s.ML + i * (sw3 + 8);
        s.rect(x, y, sw3, 40, { fill: '#fff', r: 4, stroke: C.line });
        s.text(st[0], x + 9, y + 7, { size: 6.6, weight: 800, color: C.blue });
        s.para(st[1], x + 9, y + 19, sw3 - 18, { size: 5.6, color: C.ink2, lh: 1.3 });
      });
      y += 52;
      if (y < s.limit - 80) {
        y = blockTitle(s, y, '제도별 준비물·신청처', '퇴원 전에 챙기면 환급이 빨라집니다');
        y = s.table(s.ML, y, s.CW, ['제도', '준비물', '신청처'], [
          ['산정특례', '산정특례 등록신청서(의사 서명)', '병원 대행 또는 공단 지사'],
          ['본인부담상한제', '연간 진료비 영수증·세부내역서', '공단 사후환급(다음 해 8월경)'],
          ['장기요양', '장기요양인정신청서·의사소견서', '공단 지사 · 등급판정위원회'],
          ['재난적의료비', '가구 소득·재산 증빙, 진료비 내역', '공단·심사 후 지원']
        ].map((r) => [{ text: r[0], weight: 700, color: C.navy }, r[1], { text: r[2], color: C.ink2 }]), { widths: [84, 236, 195], size: 5.8, rowH: 17, align: ['left', 'left', 'left'] });
      }
      y += 4;
      foot(s, no, '제도 활용');
    });

    /* =========================================================
       07 실손 세대·전환
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'MANUAL · MEDICAL', '실손 1~5세대 — 유지인지 전환인지', '2026년 11월, 1·2세대에 두 갈래 선택지가 열렸습니다. 유지가 답인 경우도 분명히 말합니다.');
      const sil = m.state.silson;
      s.rect(s.ML, y, s.CW, 40, { fill: C.hero, r: 6 });
      s.text('이 고객의 실손', s.ML + 12, y + 7, { size: 5.8, weight: 700, color: C.heroInk });
      s.text(sil === 'none' ? '없음 — 실손부터' : `${sil}세대`, s.ML + 12, y + 15, { size: 14, weight: 800, color: '#fff' });
      s.para(sil === '1' ? '2026년 11월 제도 대상입니다. 도수는 2026.7부터 관리급여(본인부담 95%)로 바뀌었습니다.' : sil === '2' ? ((m.state.silson2 || 'unknown') === 'early' ? '2013.3 이전 초기 2세대 — 2026.11 할인 대상입니다.' : (m.state.silson2 || 'unknown') === 'late' ? '2013.4~2017.3 후기 2세대 — 2026.11 할인 대상이 아닙니다.' : '2세대 — 가입 시기(2013.3 이전/이후)를 확인해야 대상 여부가 갈립니다.') : sil === '4' ? '2026.7.1부터 5년 재가입이 도래합니다. 재가입 시점에 5세대 보장으로 바뀝니다.' : sil === 'none' ? '진단비보다 실손이 먼저입니다. 입원·통원 기본축이 비어 있습니다.' : '선택형 할인·전환 대상이 아닐 수 있습니다. 유지 판단이 먼저입니다.', s.ML + 110, y + 8, s.CW - 126, { size: 6.4, color: C.heroInk2, lh: 1.4 });
      y += 48;
      y = blockTitle(s, y, '판단 3줄', '5단계를 3줄로 압축');
      const lines = [
        '① 세대·재가입 조건 확인 — 2013.3 이전 + 재가입 조건 없음이면 2026.11 대상',
        '② 의료 이용 패턴 — 도수·비급여 주사·MRI를 많이 쓰면 기존 세대 유지가 유리',
        '③ 되돌릴 수 있는지 — 5세대는 5년 재가입, 철회 시 재가입 제한'
      ];
      lines.forEach((t, i) => s.text(t, s.ML, y + i * 10.5, { size: 6.4, weight: i === 2 ? 700 : 500, color: i === 2 ? C.red : C.ink2 }));
      y += 36;
      y = blockTitle(s, y, '두 갈래 한 표로 비교', '같은 표에 놓고 보여줍니다');
      y = s.table(s.ML, y, s.CW, ['구분', 'A · 선택형 할인 특약', 'B · 5세대 전환'], [
        ['계약', '기존 계약 유지', '5세대 신규 전환'],
        ['보험료', '전부 선택 시 약 30~40% 할인', '3년간 50% 할인 (6개월 한시)'],
        ['보장', '선택 항목만 면책·자기부담 증가', '비중증 비급여 연 1,000만·자기부담 50%'],
        ['되돌림', '특약 해지로 원상 가능', '5년 재가입 · 철회 시 재가입 제한']
      ], { widths: [52, 232, 231], size: 6.0, rowH: 12.5, align: ['left', 'left', 'left'] });
      y += 6;
      y = blockTitle(s, y, '5세대 비중증 — 50%가 아니라 0원', '자기부담 50%와 보장 제외를 구분합니다');
      y = s.table(s.ML, y, s.CW, ['항목', '5세대 처리'], [
        ['도수치료 · 근골격계 물리치료', '보장 제외 0원'],
        ['체외충격파 치료', '보장 제외 0원'],
        ['비급여 주사제 (항암·항생·희귀질환 제외)', '보장 제외 0원'],
        ['미등재 신의료기술 (첨단재생의료 등)', '보장 제외 0원'],
        ['MRI · MRA 등 일반 비중증', '연 1,000만원 · 자기부담 50% (MRI 연 200만)']
      ], { widths: [330, 185], size: 5.9, rowH: 11.5, align: ['left', 'left'] });
      y += 5;
      y = noteStrip(s, y, '4세대 재가입 2026.7.1~ — 2021.7 가입자부터 5년 재가입 도래, 재가입 시 5세대 보장으로 변경(별도 심사 없음). 철회는 6개월 이내(3개월 이내 보험금 발생해도 복귀·3~6개월 무사고)·1회 한정.', { size: 5.8, fill: C.orangeSoft, accent: C.orange });
      y += 4;
      const sc = BK.silsonCompare({ dose: 12, dosePrice: 15, shot: 6, shotPrice: 20, mri: 2, mriPrice: 60 });
      y = s.table(s.ML, y, s.CW, ['비급여 사용 예시', '1~4세대', '5세대'], [
        [`자기부담 (사용액 ${won(sc.cost.total)}만원)`, `${won(sc.old.self)}만원`, `${won(sc.five.self)}만원`],
        ['보장(돌려받는 금액)', `${won(sc.old.paid)}만원`, `${won(sc.five.paid)}만원`],
        ['5세대에서 새로 비는 금액', '—', `${won(sc.gap)}만원 (도수·주사 ${won(sc.five.excluded)}만원 0원)`]
      ], { widths: [150, 148, 217], size: 5.9, rowH: 11, align: ['left', 'right', 'right'] });
      if (y < s.limit - 190) {
        y = blockTitle(s, y + 8, '세대별 한눈 비교', '내 세대의 위치만 보면 됩니다');
        y = s.table(s.ML, y, s.CW, ['세대', '가입 시기', '특징'], [
          ['1세대', '~2009.9', '자기부담 적음 · 갱신 없음 · 2026.11 할인 대상'],
          ['2세대', '2009.10~2017.3', '2013.3 이전이면 할인 대상 · 이후는 아님'],
          ['3세대', '2017.4~2021.6', '급여·비급여 구분 · 5년 재가입'],
          ['4세대', '2021.7~2026.4', '비급여 연 5,000만 · 2026.7부터 재가입 도래'],
          ['5세대', '2026.5.6~', '중증/비중증 분리 · 비중증 4종 제외']
        ].map((r) => [{ text: r[0], weight: 700, color: C.navy }, { text: r[1], color: C.ink2 }, r[2]]), { widths: [50, 110, 355], size: 5.8, rowH: 14, align: ['left', 'left', 'left'] });
        y += 8;
      }
      if (y < s.limit - 70) {
        y = blockTitle(s, y, '전환 후 철회 조건', '되돌릴 수 있는지가 결정의 절반입니다');
        y = s.bullets(s.ML, y, s.CW, SILSON_FIVE.withdraw, { size: 5.8, gap: 1.6 });
      }
      if (y < s.limit - 20) s.text('근거: 금융위원회 보도자료(2026.5.6) · 5세대 판매·전환 안내. 할인은 한시 제도이므로 시행 조건 변동을 확인합니다.', s.ML, y + 3, s.CW, { size: 4.8, color: C.muted });
      foot(s, no, '실손 매뉴얼');
    });

    /* =========================================================
       08 고지의무
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'MANUAL · DISCLOSURE', '고지의무 — 청약 직전 3분', '고지 누락은 나중에 계약을 통째로 흔듭니다. 말로만 알린 고지는 인정되지 않습니다.');
      y = s.table(s.ML, y, s.CW, ['일반심사', '기간', '간편심사(유병자)'], [
        ['질병 확정진단·의심소견 / 치료·입원·수술 / 투약 / 상시 복용', '3개월', '입원·수술 필요소견 / 추가검사 필요소견'],
        ['추가검사(재검사) 필요소견', '1년', '—'],
        ['입원·수술 / 7일 이상 치료 / 30일 이상 투약 / 10대 질병', '5년', '암·간경화·투석 중 만성신장질환·파킨슨·루게릭'],
        ['—', '2년', '입원·수술(제왕절개 포함)']
      ], { widths: [240, 40, 235], size: 6.2, rowHeight: () => 24, align: ['left', 'center', 'left'] });
      y += 8;
      const dj = m.disclosure;
      const djCol = dj.tone === 'ok' ? C.mint : dj.tone === 'gap' ? C.red : C.orange;
      s.rect(s.ML, y, s.CW, 50, { fill: dj.tone === 'ok' ? C.mintSoft : dj.tone === 'gap' ? C.redSoft : C.orangeSoft, r: 5, stroke: C.line });
      s.rect(s.ML, y, 2.6, 50, { fill: djCol, r: 1.3 });
      s.text('이 고객의 권장 심사', s.ML + 10, y + 6, { size: 5.8, weight: 700, color: C.muted });
      s.text(dj.label, s.ML + 10, y + 14, { size: 9.6, weight: 800, color: djCol });
      s.text(dj.headline, s.ML + 160, y + 8, { size: 6.2, weight: 700, color: C.navy });
      s.para(dj.advice, s.ML + 160, y + 18, s.CW - 170, { size: 5.6, color: C.ink2, lh: 1.3 });
      s.text(dj.reasons.length ? `체크: ${dj.reasons.join(' · ')}` : '체크된 항목 없음 — 표준체 우선', s.ML + 10, y + 38, { size: 5.4, weight: 600, color: C.muted });
      y += 58;
      y = blockTitle(s, y, '현장에서 자주 틀리는 5가지', '출처: 금융감독원 간편보험 소비자 유의사항(2024.6.13)');
      DISCLOSURE_MISTAKES.forEach((d, i) => {
        s.rect(s.ML, y, s.CW, 24, { fill: i % 2 ? C.sky2 : '#fff', r: 3, stroke: C.line });
        s.iconCircle(s.ML + 13, y + 12, 6, { fill: C.redSoft, num: i + 1, size: 5.6, color: C.red });
        s.text(d.t, s.ML + 24, y + 4, { size: 6.8, weight: 800, color: C.navy });
        s.text(d.d, s.ML + 24, y + 14, { size: 5.6, color: C.ink2 });
        y += 26;
      });
      y = blockTitle(s, y + 2, '청약 전 3분 체크', null);
      y = s.checks(s.ML, y, s.CW, [
        '최근 5년 입원·수술 이력을 고객과 함께 날짜로 확인했다',
        '최근 3개월 진단·검사·약 복용을 서면으로 확인했다',
        '청약서에 서면으로 적었는지 눈으로 확인했다',
        '고지의무 위반 효과(해지권: 안 날부터 1개월, 계약일부터 3년)를 설명했다'
      ], { size: 6.6, rowH: 13 });
      y += 6;
      if (y < s.limit - 130) {
        y = blockTitle(s, y, '청약서에서 함께 읽을 5문항', '고객이 "아니오"라고 말해도 서면이 기준입니다');
        y = s.bullets(s.ML, y, s.CW, [
          '최근 3개월: 의사에게 진단·검사·치료를 받은 사실, 상시 복용 약',
          '최근 1년: 추가검사(재검사) 필요 소견',
          '최근 5년: 입원·수술, 7일 이상 치료, 30일 이상 투약',
          '10대 질병: 암·간경화·투석 중 만성신장질환·파킨슨·루게릭',
          '간편심사는 2년 내 입원·수술(제왕절개 포함)도 확인'
        ], { size: 6.2, gap: 1.8 });
        y += 6;
      }
      if (y < s.limit - 90) {
        y = blockTitle(s, y, '표준체 vs 간편심사', '이 고객이 어느 쪽인지에 따라 인수 조건이 달라집니다');
        y = s.table(s.ML, y, s.CW, ['구분', '표준체', '간편심사(유병자)'], [
          ['고지 문항', '3개월·1년·5년 전 항목', '3개월·2년·5년 / 10대 질병'],
          ['보험료', '기준', '1.2~2배 높은 경우가 많음'],
          ['가입 가능성', '병력에 따라 거절·할증', '고지 항목만 통과하면 가입']
        ], { widths: [80, 200, 235], size: 5.8, rowH: 12, align: ['left', 'left', 'left'] });
        y += 4;
      }
      if (y < s.limit - 34) {
        y = noteStrip(s, y, '청약서에 적히지 않았으면 고지하지 않은 것으로 봅니다. 이 한 문장을 고객에게 반드시 말하고, 서면 기재를 눈으로 확인합니다. 대장내시경 용종 제거도 "수술" 고지 대상입니다.', { size: 6.0, fill: C.orangeSoft, stroke: C.orangeLine, accent: C.orange });
      }
      foot(s, no, '고지의무');
    });

    /* =========================================================
       09 청구 실무
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'MANUAL · CLAIM', '청구 실무 — 서류·기한·감액', '청구를 도와주는 사람은 보험을 파는 사람과 다르게 기억됩니다. 담보별 서류를 미리 알려줍니다.');
      const keys = ['cancer', 'brain', 'heart', 'surgery', 'care'];
      const cw = (s.CW - 8 * 2) / 3;
      keys.forEach((k, i) => {
        const cd = CLAIM_DOCS[k];
        const x = s.ML + (i % 3) * (cw + 8), cy = y + Math.floor(i / 3) * 96;
        s.rect(x, cy, cw, 90, { fill: '#fff', r: 5, stroke: C.line });
        s.text(`${cd ? cd.title : k} 청구`, x + 9, cy + 7, { size: 7, weight: 800, color: C.navy });
        const must = (cd && cd.must) || [];
        must.slice(0, 3).forEach((t, j) => {
          const ln = s.wrap(`· ${t}`, cw - 18, 5.4).slice(0, 2);
          ln.forEach((l, k2) => s.text(l, x + 9, cy + 19 + (j * 2 + k2) * 6.6, { size: 5.4, color: C.ink2 }));
        });
        const extra = (cd && cd.extra) || [];
        if (extra.length) s.text(`+ ${extra.length}건 (청구 시 안내)`, x + 9, cy + 80, { size: 5.0, weight: 600, color: C.blue });
      });
      y += 200;
      y = blockTitle(s, y, '청구가 거절되는 흔한 이유 4', '미리 알려주면 고객이 대비합니다');
      y = s.bullets(s.ML, y, s.CW, [
        '수술명이 약관 분류표와 다르게 적힘 — 병원에 분류표상 명칭으로 요청',
        '시술·처치로 분류되어 수술비 지급 대상이 아님 (스텐트·내시경 절제 등)',
        '고지의무 위반으로 계약이 해지된 경우',
        '청구 소멸시효(3년 · 상법 제662조) 경과'
      ], { size: 6.4, gap: 2.4 });
      y += 4;
      y = blockTitle(s, y, '기한과 감액 — 숫자로 확인', null);
      y = s.table(s.ML, y, s.CW, ['구분', '기준', '이 고객 확인'], [
        ['일반암 면책', '가입 후 90일 (계약일 + 90일)', m.client.ageDay ? `계약일 확인 필요 · 상령일 D-${m.client.ageDay.days}` : '계약일 입력 시 D-day 계산'],
        ['1년 미만 감액', '진단비 50% 감액이 흔함', '증권에서 감액 조항 확인'],
        ['청구 소멸시효', '3년 (상법 제662조)', '진단·수술일부터 계산'],
        ['수술비 지급', '수술 1회당 정액 · 분류표 종수', `이 고객 1~5종 ${t5Range(m.state, 'disease15') || fund(m.state.cov.surgery.disease15)}`]
      ], { widths: [86, 226, 203], size: 6.0, rowH: 15, align: ['left', 'left', 'left'] });
      y += 6;
      y = blockTitle(s, y, '청구 동행 3단계', '고객이 기억하는 것은 이 세 단계입니다');
      const st3 = [
        ['① 사진으로 받기', '진단서·영수증·수술확인서를 카톡으로 받아 코드·수술명을 먼저 확인'],
        ['② 분류표 대조', '수술명이 분류표 문구와 맞는지, 시술 제외 대상인지 확인'],
        ['③ 청구·재확인', '접수 후 지급 내역을 고객과 함께 확인 — 누락·감액 사유 설명']
      ];
      const cw3 = (s.CW - 16) / 3;
      st3.forEach((st, i) => {
        const x = s.ML + i * (cw3 + 8);
        s.rect(x, y, cw3, 40, { fill: C.tint2, r: 4, stroke: C.line });
        s.text(st[0], x + 9, y + 7, { size: 6.6, weight: 800, color: C.navy });
        s.para(st[1], x + 9, y + 19, cw3 - 18, { size: 5.6, color: C.ink2, lh: 1.3 });
      });
      y += 52;
      y = blockTitle(s, y, '실손·수술비 추가 서류', '한 번에 챙기면 두 번 안 갑니다');
      y = s.table(s.ML, y, s.CW, ['청구 종류', '추가로 필요한 것'], [
        ['실손(입원·통원)', '진료비 영수증 + 세부내역서 (비급여 항목 확인)'],
        ['수술비', '수술확인서(수술명·수술일·방법) + 진단서'],
        ['진단비', '진단서(질병코드 기재) + 조직검사 결과지'],
        ['간병비', '간병인 이용확인서 + 결제 영수증 (가족 간병은 별도)']
      ].map((r) => [{ text: r[0], weight: 700, color: C.navy }, r[1]]), { widths: [110, 405], size: 6.2, rowH: 18, align: ['left', 'left'] });
      y += 8;
      if (y < s.limit - 26) y = noteStrip(s, y, '청구 서류는 병원에서 발급되는 그대로가 아니라, 약관이 요구하는 문구로 확인하는 것이 핵심입니다. 분류표 문구와 진단서 코드를 대조해 드리는 것이 이 상담의 실질적 도움입니다.', { size: 6.0 });
      foot(s, no, '청구 실무');
    });

    /* =========================================================
       10 반론 방어 카드 15
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'OBJECTION', '반론 방어 카드 15', '반론은 막는 것이 아니라 먼저 꺼내는 것입니다. 한 줄 대응 + 붙일 근거만 외웁니다.');
      const f = plan.first;
      y = noteStrip(s, y, `${m.client.name}님은 ${f ? `${f.name} ${f.pct}%가 먼저 확인할 항목` : '5대 기준선 이상'}입니다. 마지막 칸은 이 고객 숫자이므로, 표를 읽지 말고 그 숫자만 짚어 주세요.`, { size: 5.9 });
      y += 6;
      const rows = E.OBJECTIONS.map((o) => [
        { text: o.q, weight: 700, color: C.navy },
        o.a,
        { text: o.ev, color: C.blue, weight: 600 },
        { text: thisCustomer(o.id, f), color: C.muted }
      ]);
      function thisCustomer(id, first) {
        const st = m.state;
        if (id === 'metastasis') return `재진단 ${st.cov.cancer.recur ? '보유' : '없음'}`;
        if (id === 'surgery-count') return `1~5종 ${t5Range(st, 'disease15') || fund(st.cov.surgery.disease15)}`;
        if (id === 'job-class') return `직업 ${st.job}급 · 상해 ${fund(st.cov.surgery.injury)}`;
        if (id === 'switch5') return `실손 ${st.silson === 'none' ? '없음' : st.silson + '세대'}`;
        if (id === 'disclose') return m.disclosure.tone === 'ok' ? '고지 대상 없음' : '고지 확인 필요';
        if (id === 'timebar') return '청구 이력 확인';
        const amt = (key) => {
          const r = rowK(key);
          return r && r.gaps && r.gaps[0] ? `${won(r.gaps[0].need)}만` : '기준선↑';
        };
        if (id === 'premium') return `월 ${fund(st.premium)} · 계약 ${m.contracts.length}건`;
        if (id === 'cancer-have') return `암 ${pctOf('cancer')}%·${amt('cancer')}`;
        if (id === 'silson') return `실손 ${st.silson === 'none' ? '없음' : st.silson + '세대'}`;
        if (id === 'thyroid') return `유사암 ${st.cov.cancer.similar ? fund(st.cov.cancer.similar) : '0원'}`;
        if (id === 'stent') return `심장 ${pctOf('heart')}%·${amt('heart')}`;
        if (id === 'heart-sudden') return `심장 ${fund(st.cov.heart.dx.ischemic)} (허혈성)`;
        if (id === 'stroke-name') return `뇌 ${pctOf('brain')}% · 뇌출혈 ${fund(st.cov.brain.dx.bleed)}`;
        if (id === 'brain-survive') return `뇌혈관 ${fund(st.cov.brain.dx.vascular)}`;
        if (id === 'surgery-silson') return `수술 ${pctOf('surgery')}%·${amt('surgery')}`;
        if (id === 'surgery-rare') return `1~5종 ${t5Range(st, 'disease15') || fund(st.cov.surgery.disease15)}`;
        if (id === 'family-care') return `간병 ${fund(st.cov.care.daily)} · ${st.cov.care.family === 'yes' ? '가족 인정' : '가족 미확인'}`;
        if (id === 'ltc-cheap') return `장기요양 ${st.cov.care.ltc ? '보유' : '없음'}`;
        if (id === 'later') return m.client.ageDay ? `상령일 D-${m.client.ageDay.days}` : '상령일 미확인';
        return first ? `${first.name} ${first.pct}%` : '기준선 이상';
      }
      y = s.table(s.ML, y, s.CW, ['고객이 하는 말', '한 줄 대응', '붙일 근거', '이 고객'], rows, { widths: [112, 208, 78, 117], size: 5.8, rowH: 22, align: ['left', 'left', 'left', 'left'] });
      y += 6;
      const hw = (s.CW - 10) / 2;
      s.rect(s.ML, y, hw, 74, { fill: C.hero, r: 5 });
      s.text('거절은 세 유형뿐', s.ML + 10, y + 7, { size: 6.6, weight: 800, color: '#fff' });
      [['돈이 아깝다', '재배치·배서로 "추가 지출 없이"를 먼저'], ['지금은 아니다', '다음 약속만 받고 PDF로 남깁니다'], ['믿음이 부족하다', '증권·약관·코드로 근거를 보여주고 결정은 미룹니다']].forEach((r, i) => {
        s.text(`${r[0]}`, s.ML + 10, y + 20 + i * 15, { size: 5.8, weight: 800, color: C.heroOk });
        s.text(`${r[1]}`, s.ML + 74, y + 20 + i * 15, { size: 5.4, color: C.heroInk2 });
      });
      const ox = s.ML + hw + 10;
      s.rect(ox, y, hw, 74, { fill: '#fff', r: 5, stroke: C.line });
      s.text('금지 표현 5', ox + 10, y + 7, { size: 6.6, weight: 800, color: C.red });
      ['오늘만 이 가격입니다', '이거 안 하시면 후회합니다', '다른 고객들은 다 하셨어요', '큰일 납니다', '확실히 다 받으실 수 있습니다'].forEach((t, i) => {
        s.text(`✕ ${t}`, ox + 10, y + 20 + i * 9.6, { size: 5.4, color: C.ink2 });
      });
      y += 80;
      y = blockTitle(s, y, '반론을 넘긴 직후 3분', '동의를 받았다면 바로 다음 행동');
      y = s.table(s.ML, y, s.CW, ['확인할 것', '말할 것'], [
        ['오늘 결정 범위', `"${f ? f.name : '금액'} 한 칸만 결정하시고, 나머지는 다음에 정리하시죠."`],
        ['재원', '증권 보여주시면 적립·중복 항목을 먼저 짚어 드리겠습니다.'],
        ['다음 약속', '날짜와 시간을 고객 입으로 확인하고 PDF 전달 경로를 정합니다.']
      ], { widths: [100, 415], size: 5.9, rowH: 14, align: ['left', 'left'] });
      y += 4;
      if (y < s.limit - 40) {
        s.para(`근거 출처 — ${E.SRC.death} / ${E.SRC.hiraBrain} / ${E.SRC.surgery} / ${E.SRC.special} / ${E.SRC.silson}`, s.ML, y, s.CW, { size: 4.6, color: C.muted, lh: 1.35 });
        y += 12;
      }
      if (y < s.limit - 24) s.para('반론이 세 번 반복되면 오늘은 여기서 멈춥니다. "오늘은 여기까지 정리해서 보내드리겠습니다"가 다음 통화를 만듭니다.', s.ML, y, s.CW, { size: 5.6, color: C.muted });
      foot(s, no, '반론 카드');
    });

    /* =========================================================
       11 클로징
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'CLOSING', '클로징 — 요약 · 결정 · 다음 약속', '결정을 요구하는 게 아니라 다음 행동을 함께 정합니다. 7분 안에 끝냅니다.');
      const f = plan.first;
      const firstTxt = f ? `${f.name} 한 칸` : '금액 조정';
      y = s.script(s.ML, y, s.CW, {
        title: '클로징 3줄',
        text: `"오늘 얘기 정리하면 ${m.client.name}님은 ${m.letter}등급이고, 가장 먼저 볼 곳은 ${firstTxt}입니다. 제가 이해한 게 맞습니까? ` +
          `제 판단으로는 그 한 칸을 지금 확인하는 게 순서입니다. 오늘 결정하실 부분과 집에서 보실 부분을 나눠볼까요? ` +
          `오늘은 여기까지 정리해서 PDF로 보내드리고, 다음 주 화요일에 10분만 통화하실 수 있을까요?"`,
        note: '금액은 고객이 고릅니다. 결정을 미룰 때도 다음 약속 날짜는 받습니다.'
      });
      y += 8;
      y = blockTitle(s, y, '클로징 체크 3', '말이 아니라 행동으로 확인');
      y = s.checks(s.ML, y, s.CW, [
        '고객이 자기 말로 요약했는가 ("암이 비었다"를 고객이 말했는가)',
        '오늘 결정 가능한 범위를 고객이 직접 말했는가',
        '다음 약속 날짜·시간·방법(PDF·문자)이 정해졌는가'
      ], { size: 6.8, rowH: 14 });
      y += 6;
      const hw = (s.CW - 10) / 2;
      s.rect(s.ML, y, hw, 58, { fill: '#fff', r: 5, stroke: C.line });
      s.text('다음 약속', s.ML + 10, y + 7, { size: 6.4, weight: 800, color: C.navy });
      [['날짜', ''], ['시간', ''], ['방법', '전화 · 문자 · 대면']].forEach((r, i) => {
        s.text(r[0], s.ML + 10, y + 22 + i * 11, { size: 5.8, weight: 600, color: C.muted });
        if (r[1]) s.text(r[1], s.ML + 54, y + 22 + i * 11, { size: 5.8, color: C.ink2 });
        s.line(s.ML + 50, y + 30 + i * 11, s.ML + hw - 10, y + 30 + i * 11, { color: C.line2 });
      });
      const ox = s.ML + hw + 10;
      s.rect(ox, y, hw, 58, { fill: C.mintSoft, r: 5, stroke: C.mintLine });
      s.text('오늘 남길 것', ox + 10, y + 7, { size: 6.4, weight: 800, color: C.mint });
      [`결정한 것 — ${firstTxt} 확인 여부`, `보낼 것 — 고객용 ${m.needList.length > 2 ? '10장 상세' : '1장 요약'} PDF`, `다음 연락 — ${m.dateLabel} 기준 D+7`].forEach((t, i) => {
        s.text(`· ${t}`, ox + 10, y + 21 + i * 10.4, { size: 5.6, color: C.ink2 });
      });
      y += 66;
      y = blockTitle(s, y, 'PDF 전달 문구', '보낸 뒤에 상담이 이어집니다');
      y = noteStrip(s, y, `"${m.client.name}님, 오늘 정리한 자료 보내드립니다. 1페이지에 먼저 볼 한 칸, 3페이지에 순서가 있습니다. 궁금한 점은 이 문자에 답만 주셔도 됩니다."`, { size: 6.0, fill: C.tint2 });
      y += 8;
      y = blockTitle(s, y, '다음 상담 전 준비', null);
      y = s.checks(s.ML, y, s.CW, ['증권 원본 지참 요청', '배우자·자녀 동석 여부 확인', '결정 보류 사유를 문자로 미리 받기'], { size: 6.2, rowH: 12.6 });
      y += 8;
      y = blockTitle(s, y, '클로징 금지 표현 5', '한마디가 결정을 되돌립니다');
      y = s.table(s.ML, y, s.CW, ['쓰지 않는 말', '이유'], [
        ['"오늘만 이 가격입니다"', '한시성 압박은 다음 통화를 없앱니다'],
        ['"이거 안 하시면 후회합니다"', '후회를 예고하면 방어가 생깁니다'],
        ['"다른 고객들은 다 하셨어요"', '비교는 판단을 흐리고 신뢰를 깎습니다'],
        ['"큰일 납니다"', '단정적 표현은 심의 리스크입니다'],
        ['"확실히 다 받으실 수 있습니다"', '지급 판정은 약관·심사가 합니다']
      ].map((r) => [{ text: r[0], weight: 700, color: C.red }, r[1]]), { widths: [160, 355], size: 6.2, rowH: 17, align: ['left', 'left'] });
      y += 8;
      if (y < s.limit - 100) {
        y = blockTitle(s, y, '다음 약속 예시 3', '고객이 고르게 합니다');
        y = s.table(s.ML, y, s.CW, ['제안', '말'], [
          ['이번 주', '"이번 주 목요일 저녁 7시, 10분만 통화하실 수 있을까요?"'],
          ['다음 주', '"다음 주 화요일 오전이 편하세요, 아니면 저녁이 편하세요?"'],
          ['가족 동석', '"배우자분과 함께 보시는 게 좋겠습니다. 주말 오후 어때요?"']
        ].map((r) => [{ text: r[0], weight: 700, color: C.navy }, r[1]]), { widths: [72, 443], size: 6.0, rowH: 16, align: ['left', 'left'] });
        y += 8;
      }
      if (y < s.limit - 34) y = noteStrip(s, y, '클로징에서 가장 흔한 실수는 더 설명하는 것입니다. 요약 → 결정 요청 → 다음 약속, 이 세 단계를 7분 안에 끝냅니다. 한시성 압박·후회 예고·비교는 금지 표현입니다.', { size: 6.0 });
      foot(s, no, '클로징');
    });

    /* =========================================================
       12 사후관리
       ========================================================= */
    P.push(function (s, no) {
      let y = head(s, no, 'AFTER CARE', '사후관리 — D-day를 날짜로', '상담은 계약이 아니라 그 다음 30일에서 평가됩니다. 오늘 날짜 기준으로 자동 계산했습니다.');
      const D = (root.BojangAftercare && root.BojangAftercare.date) || null;
      const today = D ? D.todayISO() : null;
      const dt = (fn, n) => (D && today ? D.koDate(D[fn](today, n)) : `D+${n}`);
      const rows = [
        ['D+1', dt('addDays', 1), 'PDF 전달 확인 문자 — "1페이지만 보셔도 됩니다"'],
        ['D+7', dt('addDays', 7), '질문 확인 통화 5분 — 결정 압박이 아니라 이해 확인'],
        ['D+30', dt('addDays', 30), '증권·청약서 정리 상태 확인, 청구 서류 안내'],
        ['3개월', dt('addMonths', 3), '가입 후 관리 — 고지 누락·특약 구성 확인'],
        ['1년', dt('addYears', 1), '연 1회 보장 점검 — 가족·부모님 보장으로 확장'],
        ['상령일', m.client.ageDay ? m.client.ageDay.label : '생년월일 입력', m.client.ageDay ? `D-${m.client.ageDay.days} · 보험료 변동 안내` : '상령일 계산 대기']
      ];
      y = s.table(s.ML, y, s.CW, ['시점', '날짜', '할 일'], rows.map((r) => [
        { text: r[0], weight: 800, color: C.blue }, { text: r[1], weight: 600, color: C.ink2 }, r[2]
      ]), { widths: [58, 96, 361], size: 6.4, rowH: 22, align: ['left', 'left', 'left'] });
      y += 10;
      y = blockTitle(s, y, '리터치 문구 3', '관계를 유지하는 연락');
      y = s.bullets(s.ML, y, s.CW, [
        `D+7: "${m.client.name}님, 지난번 자료에서 이해 안 되신 부분 있으셨어요? 한 가지만 짚어드릴까요?"`,
        '3개월: "보험금 청구할 일이 생기면 제게 먼저 사진 보내주세요. 제가 분류표부터 확인하겠습니다."',
        '1년: "작년에 정리한 기준으로 지금도 괜찮은지 한 번만 보겠습니다. 추가 가입 권유는 안 드립니다."'
      ], { size: 6.4, gap: 2.6 });
      y += 4;
      const hw = (s.CW - 10) / 2;
      s.rect(s.ML, y, hw, 62, { fill: '#fff', r: 5, stroke: C.line });
      s.text('소개 요청은 이때만', s.ML + 10, y + 7, { size: 6.4, weight: 800, color: C.navy });
      ['청구를 도와준 직후 — 신뢰가 가장 높은 순간', '고객이 먼저 물을 때 — 감사만 하고 정보는 받지 않음', '1년 점검에서 — 관계가 확인된 시점'].forEach((t, i) => s.text(`· ${t}`, s.ML + 10, y + 20 + i * 10, { size: 5.4, color: C.ink2 }));
      const ox = s.ML + hw + 10;
      s.rect(ox, y, hw, 62, { fill: C.tint2, r: 5, stroke: C.line });
      s.text('이 앱으로 다음 상담 준비', ox + 10, y + 7, { size: 6.4, weight: 800, color: C.navy });
      ['상담 저장 → 이 기기에만 기록(최대 5건)', '고객용 1장 요약 PDF를 문자·카톡으로', '상령일·갱신 3개월 전 알림 등록'].forEach((t, i) => s.text(`· ${t}`, ox + 10, y + 20 + i * 10, { size: 5.4, color: C.ink2 }));
      y += 76;
      if (y < s.limit - 160) {
        y = blockTitle(s, y, '재방문 준비 5', '다음 상담이 짧아집니다');
        y = s.checks(s.ML, y, s.CW, [
          '지난 상담 PDF와 고객이 고른 한 칸을 다시 펼친다',
          '증권 원본(또는 사진)으로 코드·지급 횟수를 대조한다',
          'D+7 통화에서 나온 질문을 미리 적어 간다',
          '가족 동석 여부와 결정권자를 확인한다',
          '다음 상담에서 결정할 한 가지만 정해 간다'
        ], { size: 6.4, rowH: 14 });
        y += 8;
      }
      if (y < s.limit - 120) {
        y = blockTitle(s, y, '관계 유지 3원칙', '연락이 부담이 되지 않게');
        y = s.bullets(s.ML, y, s.CW, [
          '연락은 정해 둔 D-day에만 합니다. 급한 일이 아니면 문자로 먼저.',
          '새 상품 이야기보다 지난 상담의 약속을 확인하는 말로 시작합니다.',
          '고객이 답하지 않으면 재촉하지 않고 다음 D-day로 넘깁니다.'
        ], { size: 6.4, gap: 2 });
        y += 8;
      }
      if (y < s.limit - 110) {
        y = blockTitle(s, y, '청구 동행 D+30', '고객이 기억하는 한 가지');
        y = s.table(s.ML, y, s.CW, ['상황', '할 일'], [
          ['입원·수술 발생', '수술확인서·진단서 사진 요청 → 분류표 대조 → 청구'],
          ['진단만 받음', '진단서 코드 확인 → 산정특례 등록 안내 (30일 내)'],
          ['환급 시기', '본인부담상한제 사후환급 안내 (다음 해 8월경)']
        ].map((r) => [{ text: r[0], weight: 700, color: C.navy }, r[1]]), { widths: [96, 419], size: 6.0, rowH: 16, align: ['left', 'left'] });
        y += 8;
      }
      if (y < s.limit - 26) y = noteStrip(s, y, `오늘 상담 요약 — ${m.client.name}님 · ${m.letter}(${m.score}점) · ${f0()} · 월 ${fund(m.premium)}. 다음 점검은 위 D-day 표의 첫 두 줄입니다.`, { size: 6.2, fill: C.mintSoft, stroke: C.mintLine, accent: C.mint });
      function f0() { const f = plan.first; return f ? `먼저 확인 ${f.name} ${f.pct}%` : '5대 기준선 이상'; }
      foot(s, no, '사후관리');
    });

    /* =========================================================
       담보 챕터 (13~30) — head · evidence · code · cases · design · decision · objection · hold
       ========================================================= */
    function chapterHead(s, no, e) {
      let y = head(s, no, KICK[e.key], `${e.order}번째로 확인 · ${e.name} — 지금 위치`, `${e.pages}p 배정 · 터치 방식 ${e.touch.code} · ${e.touch.label}`);
      /* 4 지표 */
      const tiles = tilesOf(e.key);
      const tw = (s.CW - 8 * 3) / 4;
      tiles.forEach((t, i) => {
        const x = s.ML + i * (tw + 8);
        s.rect(x, y, tw, 48, { fill: '#fff', r: 5, stroke: C.line });
        s.text(t.label, x + 8, y + 6, { size: 5.4, weight: 600, color: C.muted });
        s.text(t.value, x + 8, y + 15, { size: 11.2, weight: 800, color: t.color || (t.fill >= 0.99 ? C.mint : t.fill > 0 ? C.orange : C.red) });
        s.text(t.sub || '', x + 8, y + 32, { size: 5.0, color: C.muted });
        s.gauge(x + 8, y + 40, tw - 16, Math.max(0, Math.min(1, t.fill || 0)), { color: t.fill >= 0.99 ? C.mint : t.fill > 0 ? C.orange : C.gray, h: 3.6 });
      });
      y += 56;
      /* 비용 근거 */
      const cost = E.COSTS[e.key];
      const cw = s.CW - 176;
      s.rect(s.ML, y, cw, 150, { fill: '#f9fbfd', r: 5, stroke: C.line });
      s.text(cost.title, s.ML + 10, y + 7, { size: 6.6, weight: 800, color: C.navy });
      s.text(cost.note, s.ML + cw - 10, y + 8, { size: 5.0, color: C.muted, align: 'right' });
      const maxV = Math.max.apply(null, cost.rows.map((r) => r.value).concat([1]));
      const rows = cost.rows.slice(0, 6).map((r) => ({ label: `${r.label} ${r.code}`, value: r.value / maxV, text: `${won(r.value)}만${r.days ? ` · ${r.days}일` : ''}` }));
      s.bars(s.ML + 10, y + 22, cw - 20, rows, { rowH: 16, labelW: 84, valW: 88, size: 5.8 });
      s.text(`출처 ${cost.src}`, s.ML + 10, y + 134, { size: 4.6, color: C.muted });
      /* 이 담보로 몇 개월 */
      const rx = s.ML + cw + 8, rw = s.CW - cw - 8;
      const dxAmt = dxAmount(e.key);
      const refCost = cost.rows[0] ? cost.rows[0].value : 1;
      s.rect(rx, y, rw, 150, { fill: C.tint, r: 5, stroke: C.tintLine });
      s.text('이 보장으로 몇 회 버티나', rx + 10, y + 7, { size: 6.2, weight: 800, color: C.navy });
      s.text(`${(dxAmt / refCost).toFixed(1)}회`, rx + 10, y + 18, { size: 17, weight: 800, color: C.blue });
      s.para(`${cost.rows[0] ? cost.rows[0].label : ''} 1회 ${won(refCost)}만원 기준. 진단비·치료비 합계 ${won(dxAmt)}만원을 나눈 값입니다.`, rx + 10, y + 40, rw - 20, { size: 5.4, color: C.ink2, lh: 1.35 });
      if (cost.extra) {
        cost.extra.slice(0, 2).forEach((x2, i) => {
          s.text(x2.label, rx + 10, y + 76 + i * 20, { size: 5.2, weight: 600, color: C.muted });
          s.text(x2.value, rx + 10, y + 84 + i * 20, { size: 7.4, weight: 800, color: C.navy });
        });
      }
      s.text(`단순 비교 · 비급여 제외`, rx + 10, y + 136, { size: 4.6, color: C.muted });
      y += 160;
      /* 판독 멘트 1블록 */
      y = s.script(s.ML, y, s.CW, { title: '판독 멘트', text: `"${judgeText(e.key)}"`, note: '숫자는 그대로, 말은 자기 말로. 이 담보에서 문장은 여기 한 곳뿐입니다.' });
      y += 8;
      /* 오늘의 한 칸 + 반론 1개 */
      const hw = (s.CW - 10) / 2;
      s.rect(s.ML, y, hw, 52, { fill: C.orangeSoft, r: 5, stroke: C.orangeLine });
      s.text('오늘의 한 칸', s.ML + 10, y + 7, { size: 6.2, weight: 800, color: C.orange });
      s.para(PR.firstGapLine(e), s.ML + 10, y + 18, hw - 20, { size: 6.4, weight: 600, color: C.navy, lh: 1.35 });
      const ob = E.objection(e.objections[0]);
      const ox2 = s.ML + hw + 10;
      s.rect(ox2, y, hw, 52, { fill: '#fff', r: 5, stroke: C.line });
      s.text('먼저 꺼낼 반론', ox2 + 10, y + 7, { size: 6.2, weight: 800, color: C.navy });
      if (ob) {
        s.text(ob.q, ox2 + 10, y + 18, { size: 6.2, weight: 700, color: C.ink });
        s.para(ob.a, ox2 + 10, y + 28, hw - 20, { size: 5.4, color: C.ink2, lh: 1.3 });
      }
      y += 60;
      /* 세부 보장 표 — 이 담보의 칸별 현재/기준 */
      y = blockTitle(s, y, '세부 칸 — 현재와 기준', '판정이 아니라 비교표입니다');
      const detailRows = detailOf(e.key);
      y = s.table(s.ML, y, s.CW, ['세부 담보', '현재', '기준', '충족', '확인 포인트'], detailRows, { widths: [132, 78, 78, 46, 181], size: 5.9, rowH: 15, align: ['left', 'right', 'right', 'center', 'left'] });
      y += 8;
      y = blockTitle(s, y, '증권에서 확인할 세 줄', '금액보다 구조');
      y = s.checks(s.ML, y, s.CW, checkLines(e.key), { size: 6.4, rowH: 13 });
      y += 4;
      if (y < s.limit - 40) y = noteStrip(s, y, `${m.client.name}님 ${e.name}는 기준의 ${e.pct}%입니다. ${e.gaps.length ? `부족분은 ${e.gaps.map((g) => `${g.label} ${fund(g.need)}`).slice(0, 2).join(', ')} 순서로 봅니다.` : '금액은 기준선 이상이므로 지급 조건을 확인합니다.'}`, { size: 5.8 });
      foot(s, no, `${e.order}번째 · ${e.name} 판독`);
    }
    function detailOf(key) {
      const rows = [];
      const row = rowK(key);
      (row.r.parts || []).forEach((p) => {
        if (p.type === 'group' || p.type === 'dxset') {
          (p.subs || []).forEach((sub) => {
            const val = p.type === 'group' ? subEff(sub) : num(sub.val);
            const rec = num(sub.rec);
            rows.push([sub.label, val ? `${won(val)}만` : '없음', rec ? `${won(rec)}만` : '—', rec ? `${Math.min(100, Math.round((val / rec) * 100))}%` : '—', sub.isCore ? '핵심 범위' : '범위 확인']);
          });
        } else if (p.type === 'amount') {
          rows.push([p.label, p.val ? `${won(p.val)}만` : '없음', p.rec ? `${won(p.rec)}만` : '—', p.rec ? `${Math.min(100, Math.round((num(p.val) / num(p.rec)) * 100))}%` : '—', p.tiers5 ? '종별 금액' : '정액']);
        } else if (p.type === 'scale') {
          rows.push([p.label, (p.option || {}).label || '미확인', '—', `${Math.round(num(p.fill) * 100)}%`, '지급 요건']);
        } else if (p.type === 'bool') {
          rows.push([p.label, num(p.val) ? '보유' : '없음', '보유 권장', num(p.val) ? '100%' : '0%', '조건 확인']);
        }
      });
      return rows.slice(0, 7);
    }
    function dxAmount(key) {
      if (key === 'cancer') return num(m.state.cov.cancer.general) + num(m.state.cov.cancer.similar) + effVal(partK('cancer', 'treatment'));
      if (key === 'brain' || key === 'heart') {
        const d = partK(key, 'dx').dx || {};
        return num(d.total) + effVal(partK(key, 'treat')) + mainOf(m.state, key);
      }
      if (key === 'surgery') return ['disease', 'disease15', 'diseaseNdae', 'diseaseNonPay', 'injury', 'injury15'].reduce((a, k) => a + num(m.state.cov.surgery[k]), 0);
      return num(m.state.cov.care.daily) * 30;
    }
    function tilesOf(key) {
      if (key === 'cancer') {
        const p = partK('cancer', 'treatment');
        return [
          { label: '일반암', value: fund(m.state.cov.cancer.general), fill: partK('cancer', 'general').fill, sub: `기준 ${fund(partK('cancer', 'general').rec)}` },
          { label: '유사암', value: m.state.cov.cancer.similar ? fund(m.state.cov.cancer.similar) : '없음', fill: partK('cancer', 'similar').fill, sub: `기준 ${fund(partK('cancer', 'similar').rec)}` },
          { label: '치료비 5종', value: fund(effVal(p)), fill: p.fill, sub: `${(p.subs || []).filter((x) => subEff(x) > 0).length}/5종 채움` },
          { label: '재진단', value: m.state.cov.cancer.recur ? '보유' : '없음', fill: m.state.cov.cancer.recur ? 1 : 0, sub: '1회한 vs 재진단' }
        ];
      }
      if (key === 'brain' || key === 'heart') {
        const d = partK(key, 'dx').dx || {};
        const core = d.core || { val: 0, rec: 0 };
        const sub = (d.subs || [])[1] || { val: 0, rec: 0, label: '' };
        return [
          { label: core.label, value: fund(core.val), fill: core.rec ? core.val / core.rec : 0, sub: `기준 ${fund(core.rec)}` },
          { label: sub.label || '세부', value: fund(sub.val), fill: sub.rec ? sub.val / sub.rec : 0, sub: `기준 ${fund(sub.rec)}` },
          { label: '단독 치료비', value: `${(partK(key, 'treat').subs || []).filter((x) => subEff(x) > 0).length}/3`, fill: partK(key, 'treat').fill, sub: fund(effVal(partK(key, 'treat'))) },
          { label: '합산 진단', value: fund(num(d.total)), fill: num(d.total) > 0 ? 1 : 0, sub: (d.scenarios || []).map((x) => x.label).join(' · ') || '범위 확인' }
        ];
      }
      if (key === 'surgery') {
        const sg = m.state.cov.surgery;
        return [
          { label: '질병 일반', value: fund(sg.disease), fill: partK('surgery', 'disease').fill, sub: '수술 1회당' },
          { label: '질병 1~5종', value: t5Range(m.state, 'disease15') || fund(sg.disease15), fill: partK('surgery', 'disease15').fill, sub: '종별 금액' },
          { label: '질병 N대', value: sg.diseaseNdae ? fund(sg.diseaseNdae) : '없음', fill: partK('surgery', 'diseaseNdae').fill, sub: '질환별 한도' },
          { label: '상해', value: fund(sg.injury), fill: partK('surgery', 'injury').fill, sub: `1~5종 ${t5Range(m.state, 'injury15') || fund(sg.injury15)}` }
        ];
      }
      const cg = m.state.cov.care;
      return [
        { label: '일반병원 일당', value: fund(cg.daily), fill: partK('care', 'daily').fill, sub: '기준 10만' },
        { label: '요양병원 일당', value: cg.nDaily ? fund(cg.nDaily) : '없음', fill: partK('care', 'nDaily').fill, sub: '통상 5~6만' },
        { label: '지급 기준', value: ({ time: '시간', money: '금액', unknown: '미확인' })[cg.basis] || '미확인', fill: partK('care', 'basis').fill, sub: '8시간 / 7~8만' },
        { label: '장기요양', value: cg.ltc ? '보유' : '없음', fill: cg.ltc ? 1 : 0, sub: '1~5등급·인지지원' }
      ];
    }

    function chapterEvidence(s, no, e) {
      let y = head(s, no, KICK[e.key], `${e.name} — 반복 지출과 누적 비용`, '한 번 지급으로 끝나는지, 매년 다시 나가는지가 담보 설계를 가릅니다.');
      const cost = E.COSTS[e.key];
      const one = cost.rows[0] ? cost.rows[0].value : 0;
      const mine = dxAmount(e.key);
      const tw = (s.CW - 8 * 2) / 3;
      [
        ['1회 평균 진료비', `${won(one)}만`, cost.rows[0] ? cost.rows[0].label : ''],
        ['이 고객 보장 합계', `${won(mine)}만`, `기준의 ${e.pct}%`],
        ['3년 반복 가정', `${won(one * 2)}만`, '재발·재시술 1회 포함']
      ].forEach((t, i) => {
        const x = s.ML + i * (tw + 8);
        s.rect(x, y, tw, 44, { fill: i === 1 ? C.tint : '#fff', r: 5, stroke: C.line });
        s.text(t[0], x + 9, y + 6, { size: 5.4, weight: 600, color: C.muted });
        s.text(t[1], x + 9, y + 15, { size: 12, weight: 800, color: i === 1 ? C.blue : C.navy });
        s.text(t[2], x + 9, y + 32, { size: 5.0, color: C.muted });
      });
      y += 52;
      if (e.key === 'cancer') {
        const tl = BK.oneTimeTimeline(m.state);
        y = blockTitle(s, y, '1회한 vs 연 1회한 — 10년 누적', `${won(tl.amount)}만원 기준 예시`);
        y = s.table(s.ML, y, s.CW, ['기간', '1회한', '연 1회한(최대 10년)', '재진단 3년 주기'], [1, 3, 5, 10].map((yy) => [
          { text: `${yy}년 누적`, weight: 700, color: C.navy },
          { text: `${won(tl.rows[yy - 1].onceCum)}만원`, align: 'right' },
          { text: `${won(tl.rows[yy - 1].annualCum)}만원`, weight: 800, color: C.mint, align: 'right' },
          { text: `${won(tl.rows[yy - 1].rejoinCum)}만원`, color: C.ink2, align: 'right' }
        ]), { widths: [110, 110, 170, 125], size: 6.6, rowH: 18, align: ['left', 'right', 'right', 'right'] });
        y += 8;
        y = noteStrip(s, y, `같은 금액이라도 10년 누적은 연 1회한이 ${tl.ratio}배, 재진단이 ${tl.rejoinRatio}배입니다. 이 고객 증권이 1회한인지 먼저 확인합니다.`, { size: 6.2 });
      } else if (e.key === 'care') {
        y = blockTitle(s, y, '등급별 인정자와 비중', '2025 장기요양 통계연보');
        y = s.table(s.ML, y, s.CW, ['구분', '인정자', '비중'], [
          ['4등급', '57만 7,572명', '46.8%'], ['3등급', '32만 5,661명', '26.4%'], ['5등급', '14만 6,088명', '11.8%'],
          ['2등급', '10만 686명', '8.2%'], ['1등급', '5만 4,999명', '4.5%'], ['인지지원', '3만 39명', '2.4%']
        ], { widths: [120, 200, 195], size: 6.6, rowH: 18, align: ['left', 'right', 'right'] });
        y += 6;
        y = noteStrip(s, y, '3~5등급·인지지원이 인정자의 81.5%입니다. 이 고객 담보가 1~2등급만 담고 있으면 가장 흔한 구간이 비어 있는 셈입니다.', { size: 6.2 });
        y += 10;
        y = blockTitle(s, y, '제도와 담보의 경계', '제도로 기본, 부족분은 담보');
        y = s.table(s.ML, y, s.CW, ['구분', '누가 부담하나', '남는 돈'], [
          ['재가급여', '제도 85% · 본인 15%', '본인부담 + 한도 초과분'],
          ['시설급여', '제도 80% · 본인 20%', '본인부담 + 비급여'],
          ['간병인', '전액 본인', '일당 전액 — 담보가 메우는 칸']
        ].map((r) => [{ text: r[0], weight: 700, color: C.navy }, r[1], r[2]]), { widths: [80, 200, 235], size: 6.0, rowH: 18, align: ['left', 'left', 'left'] });
        y += 8;
      } else {
        y = blockTitle(s, y, '한 번 더 나가는 돈 — 재발·재시술', '반복 지출 가정');
        y = s.table(s.ML, y, s.CW, ['구간', '예상 진료비', '이 고객 담보 반응'], [
          ['첫 치료', `${won(one)}만원`, '기준 1회'],
          ['2년 내 재발·재시술', `${won(one)}만원`, '1회한 담보면 0원'],
          ['3년 누적', `${won(one * 2)}만원`, '연 1회한·재진단이면 반응']
        ].map((r) => [{ text: r[0], weight: 700, color: C.navy }, { text: r[1], align: 'right' }, r[2]]), { widths: [140, 120, 255], size: 6.6, rowH: 20, align: ['left', 'right', 'left'] });
        y += 6;
        y = noteStrip(s, y, '진료비는 위 1인당 평균을 2~3회 반복한 가정값입니다. 실제 지급은 약관의 지급 횟수(1회한·연 1회한·재진단)에 따릅니다.', { size: 6.0, fill: C.orangeSoft, accent: C.orange });
      }
      y += 12;
      y = blockTitle(s, y, '지급 횟수가 왜 중요한가', '금액보다 먼저 볼 구조');
      y = s.bullets(s.ML, y, s.CW, [
        '1회한: 첫 지급 후 재지급 없음 — 전이·재발이 와도 0원입니다.',
        '연 1회한: 매년 한 번씩 반응 — 장기 치료에서 차이가 커집니다.',
        '재진단: 일정 기간(3~10년) 뒤 다시 지급 — 가장 넓은 구조입니다.'
      ], { size: 6.6, gap: 2.2 });
      y += 8;
      y = blockTitle(s, y, '증권에서 확인할 세 줄', null);
      y = s.checks(s.ML, y, s.CW, checkLines(e.key), { size: 6.8, rowH: 16 });
      y += 6;
      if (y < s.limit - 34) y = noteStrip(s, y, `이 고객은 ${e.name} ${e.pct}%입니다. 누적 비용이 큰 구조라면 금액을 올리는 것보다 지급 횟수를 먼저 확인하는 편이 효과적입니다.`, { size: 6.2 });
      foot(s, no, `${e.order}번째 · ${e.name} 비용`);
    }
    function checkLines(key) {
      if (key === 'cancer') return ['일반암/유사암 담보명과 코드 범위 (C73·C44·D00~D09·D37~D48)', '치료비 5종의 지급 횟수 (1회한·연 1회한)', '재진단·전이암 조항과 원발부위 기준 문구'];
      if (key === 'brain') return ['담보명의 코드 범위 (I60~I69 / I60~I63 / I60~I62)', 'I64(상세불명) 제외 여부', '후유장해 담보 유무와 지급률'];
      if (key === 'heart') return ['담보명의 코드 범위 (I20~I25 / I21~I22)', 'I23 합병증 포함 여부', '스텐트·우회로가 수술비 분류표에 있는지'];
      if (key === 'surgery') return ['수술 분류표의 1~5종 기준과 N대 한도', '시술·처치 제외 문구 (스텐트·내시경 절제)', '상해 담보의 직업급수와 비례보상 조항'];
      return ['가족 간병 인정 여부와 증빙 요건', '지급 기준(일 8시간 / 일 7~8만원)', '장기요양 담보의 등급 범위(1~5·인지지원)'];
    }

    function scenarioOf(key) {
      const st = m.state;
      if (key === 'cancer') {
        const g = num(st.cov.cancer.general), s2 = num(st.cov.cancer.similar);
        const surgery = num(st.cov.surgery.disease);
        return [
          ['위암 C16', '일반암 진단비 + 암수술비', `${won(g)}만`],
          ['갑상선 C73', s2 ? '유사암 진단비' : '유사암 담보 없음 → 0원', `${won(s2)}만`],
          ['제자리 D05', s2 ? '유사암 진단비 (일반암 제외)' : '유사암 담보 없음 → 0원', `${won(s2)}만`]
        ];
      }
      if (key === 'brain') {
        const d = partK('brain', 'dx').dx || {};
        const v = num(d.core ? d.core.val : 0);
        const str = num((d.subs || [])[1] ? d.subs[1].val : 0);
        const bl = num((d.subs || [])[2] ? d.subs[2].val : 0);
        return [
          ['뇌경색 I63', `뇌혈관 ${won(v)} + 뇌졸중 ${won(str)}`, `${won(v + str)}만`],
          ['뇌출혈 I61', `뇌혈관 ${won(v)} + 뇌출혈 ${won(bl)}`, `${won(v + bl)}만`],
          ['상세불명 I64', `뇌혈관 ${won(v)}만 (뇌졸중 제외 상품)`, `${won(v)}만`]
        ];
      }
      if (key === 'heart') {
        const d = partK('heart', 'dx').dx || {};
        const v = num(d.core ? d.core.val : 0);
        const a = num((d.subs || [])[1] ? d.subs[1].val : 0);
        return [
          ['협심증 I20', `허혈성 ${won(v)} + 급성심근경색 ${won(a)}`, `${won(v + a)}만`],
          ['급성심근경색 I21', `허혈성 ${won(v)} + 급성심근경색 ${won(a)}`, `${won(v + a)}만`],
          ['부정맥·심부전', '별도 심장질환 담보 없으면 0원', '0만']
        ];
      }
      if (key === 'surgery') {
        const sg = st.cov.surgery;
        return [
          ['내시경 절제(ESD)', '수술 분류표상 4~5종이면 지급, 시술 제외면 0원', `${won(Math.max(sg.disease15, sg.disease))}만`],
          ['스텐트 삽입', '대개 처치·시술로 분류 → 수술비 0원', '0만'],
          ['개복 수술(5종)', '1~5종 5종 금액 + N대 한도', `${won(sg.disease15)}만`]
        ];
      }
      const cg = st.cov.care;
      return [
        ['가족 간병', cg.family === 'yes' ? '가족 간병 인정' : '불인정·증빙 필요 → 0원', cg.family === 'yes' ? `${won(cg.daily)}만` : '0만'],
        ['요양병원 입원', `요양병원 일당 ${cg.nDaily ? won(cg.nDaily) + '만' : '없음'}`, `${won(cg.nDaily)}만`],
        ['장기요양 3등급', cg.ltc ? '등급 판정 시 월 단위 지급' : '담보 없음 → 0원', cg.ltc ? '보유' : '0만']
      ];
    }
    function chapterCode(s, no, e) {
      let y = head(s, no, KICK[e.key], `${e.name} — 코드 밴드 지도`, '담보명보다 코드가 정확합니다. 어느 구간이 지급되고 어느 구간이 비는지 한 줄로 보여줍니다.');
      y = codeBand(s, s.ML, y, s.CW, e.key);
      y += 6;
      const B = E.BANDS[e.key];
      y = blockTitle(s, y, '이 담보에서 갈리는 지점', '증권을 펼치면 이 세 줄만');
      B.points.forEach((p, i) => {
        s.rect(s.ML, y, s.CW, 26, { fill: i % 2 ? C.sky2 : '#fff', r: 3, stroke: C.line });
        s.iconCircle(s.ML + 13, y + 13, 6.4, { fill: i === 0 ? C.redSoft : C.orangeSoft, num: i + 1, size: 5.8, color: i === 0 ? C.red : C.orange });
        s.para(p, s.ML + 26, y + 5, s.CW - 32, { size: 6.4, color: C.ink2, lh: 1.3 });
        y += 28;
      });
      y += 4;
      y = blockTitle(s, y, '면책·감액 타임라인', '가입 직후가 가장 위험합니다');
      const tl = [
        { t: '계약일', d: '보장 개시', c: C.mint },
        { t: '90일', d: '일반암 면책 해제', c: C.orange },
        { t: '1년', d: '감액(50%) 해제', c: C.orange },
        { t: '2년', d: '고지의무 해지권 제한', c: C.blue },
        { t: '3년', d: '청구 소멸시효', c: C.red }
      ];
      const tw = (s.CW - 8 * 4) / 5;
      s.line(s.ML + 10, y + 14, s.ML + s.CW - 10, y + 14, { color: C.line });
      tl.forEach((x, i) => {
        const bx = s.ML + i * (tw + 8) + tw / 2;
        s.ctx.save(); s.ctx.beginPath(); s.ctx.arc(bx, y + 14, 4, 0, Math.PI * 2); s.ctx.fillStyle = x.c; s.ctx.fill(); s.ctx.restore();
        s.text(x.t, bx, y + 2, { size: 6.2, weight: 800, color: C.navy, align: 'center' });
        s.para(x.d, bx - tw / 2, y + 22, tw, { size: 5.2, color: C.ink2, align: 'center', lh: 1.25 });
      });
      y += 44;
      if (y < s.limit - 60) {
        y = blockTitle(s, y, '코드 표 — 자주 보는 6개', null);
        const codes = (typeof FC_CODES !== 'undefined' ? FC_CODES : []).filter((c) => c.group === (e.key === 'cancer' ? '암' : e.key === 'brain' ? '뇌' : e.key === 'heart' ? '심장' : '')).slice(0, 6);
        if (codes.length) {
          y = s.table(s.ML, y, s.CW, ['코드', '질환', '이 담보에서 확인'], codes.map((c) => [
            { text: c.code, weight: 800, color: C.blue }, c.name, c.check
          ]), { widths: [66, 148, 301], size: 6.0, rowHeight: () => 18, align: ['left', 'left', 'left'] });
        } else {
          const structRows = e.key === 'surgery' ? [
            ['1종', '경미 수술', '가장 낮은 정액 — 백내장·치핵 등'],
            ['3종', '보통 수술', '담낭 복강경 등 — 시술 제외 문구 확인'],
            ['4~5종', '중증 수술', '개복·암 수술 — 증권의 종별 금액 확인'],
            ['N대', '질환별 한도', '1~5종과 중복 청구 구조']
          ] : [
            ['간병인 사용일당', '입원 중', '8시간 이상 + 이용확인서·결제 증빙'],
            ['간호·간병통합', '입원 중', '보호자 없는 병동 이용 시'],
            ['요양병원 일당', '요양병원', '일반병원과 별도 담보·별도 금액'],
            ['장기요양', '퇴원 후·노후', '1~5등급·인지지원 판정이 전제']
          ];
          y = s.table(s.ML, y, s.CW, ['구간', '의미', '이 담보에서 확인'], structRows.map((r) => [
            { text: r[0], weight: 800, color: C.blue }, r[1], r[2]
          ]), { widths: [108, 92, 315], size: 6.0, rowH: 21, align: ['left', 'left', 'left'] });
        }
      }
      y += 8;
      if (y < s.limit - 110) {
        y = blockTitle(s, y, '지급 시나리오 3 — 이 고객 숫자로', '약관 구조대로 계산하면 이렇게 갈립니다');
        y = s.table(s.ML, y, s.CW, ['진단·시술', '이 고객 담보에서 반응하는 칸', '합계'], scenarioOf(e.key).map((r) => [
          { text: r[0], weight: 700, color: C.navy }, r[1], { text: r[2], weight: 800, color: C.blue, align: 'right' }
        ]), { widths: [96, 336, 83], size: 6.2, rowH: 21, align: ['left', 'left', 'right'] });
        y += 4;
        y = noteStrip(s, y, '계산은 입력된 금액과 담보명 기준입니다. 실제 지급은 약관의 지급 사유·횟수·감액 조항으로 결정되므로, 이 표는 판정이 아니라 확인 후보입니다.', { size: 5.6, fill: C.orangeSoft, accent: C.orange });
      }
      if (y < s.limit - 20) s.text(`출처 ${e.key === 'cancer' ? E.SRC.cancerReg : e.key === 'brain' ? E.SRC.hiraBrain : E.SRC.surgery} · 코드 해석은 약관 분류표 기준이며 지급 판정이 아닙니다.`, s.ML, y + 3, s.CW, { size: 4.6, color: C.muted });
      foot(s, no, `${e.order}번째 · ${e.name} 코드`);
    }

    function chapterCases(s, no, e, many) {
      let y = head(s, no, KICK[e.key], `${e.name} — 실제로 이렇게 갈렸다`, '금액이 아니라 "갈린 이유"가 본문입니다. 표기는 실사례·각색·가상을 구분했습니다.');
      const list = casesOf(e.key).slice(0, many ? 4 : 3);
      const h = many ? 146 : 132;
      list.forEach((c) => { y = caseCard(s, s.ML, y, s.CW, c, h) + 6; });
      if (y < s.limit - 26) y = noteStrip(s, y, '사례는 보장 구조를 설명하기 위한 자료입니다. 같은 사고라도 약관·가입시기·증권 문구에 따라 결과가 달라지므로, 판정이 아니라 "이 고객 증권에서 확인할 지점"으로만 사용합니다.', { size: 5.8 });
      foot(s, no, `${e.order}번째 · ${e.name} 사례`);
    }

    function tiersOf(key) {
      const base = rowK(key).baseRec;
      const fs = [0.6, 1, 1.5];
      return fs.map((f, i) => {
        if (key === 'cancer') {
          const p = partK('cancer', 'treatment');
          const treatAll = BK.treatRecs(base).reduce((a, x) => a + x, 0);
          return {
            name: ['최소', '표준', '확대'][i], f,
            rows: [['일반암', `${won(Math.max(3000, Math.round((base * f) / 500) * 500))}만`], ['유사암', `${won(Math.round((base * 0.2 * f) / 100) * 100)}만`], ['치료비 5종', `${won(Math.round((treatAll * f) / 500) * 500)}만`], ['재진단', i === 0 ? '선택' : '포함']],
            note: i === 0 ? '지금 예산으로 한 칸만' : i === 1 ? '기준선까지 맞추는 안' : '가족력·여유 있을 때'
          };
        }
        if (key === 'brain' || key === 'heart') {
          return {
            name: ['최소', '표준', '확대'][i], f,
            rows: [['핵심 범위', `${won(Math.round((base * f) / 500) * 500)}만`], ['단독 치료비', `${won(Math.round((base * 0.5 * f) / 500) * 500)}만`], ['금액', key === 'brain' ? 'I60~I69' : 'I20~I25'], ['감액 확인', i === 0 ? '필수' : '권장']],
            note: i === 0 ? '범위만 먼저 맞추기' : i === 1 ? '기준선' : '여유 있을 때'
          };
        }
        if (key === 'surgery') {
          const sg = m.state.cov.surgery;
          return {
            name: ['최소', '표준', '확대'][i], f,
            rows: [['질병 일반', `${won(Math.round((PK(rowK('surgery'), 'disease').rec * f) / 10) * 10)}만`], ['1~5종(1종)', `${won(Math.round((PK(rowK('surgery'), 'disease15').rec * f) / 10) * 10)}만`], ['N대', `${won(Math.round((PK(rowK('surgery'), 'diseaseNdae').rec * f) / 100) * 100)}만`], ['상해', `${won(Math.round((PK(rowK('surgery'), 'injury').rec * f) / 10) * 10)}만`]],
            note: i === 0 ? '빈 축 하나만' : i === 1 ? '4축 균형' : '큰 수술 대비'
          };
        }
        return {
          name: ['최소', '표준', '확대'][i], f,
          rows: [['일당', `${won(Math.max(5, Math.round(10 * f)))}만`], ['요양병원', `${won(Math.max(5, Math.round(6 * f)))}만`], ['지급 기준', '8시간'], ['장기요양', i === 0 ? '다음' : '포함']],
          note: i === 0 ? '입원 간병만' : i === 1 ? '장기요양까지' : '체증형 검토'
        };
      });
    }
    function chapterDesign(s, no, e) {
      let y = head(s, no, KICK[e.key], `${e.name} — 3안과 재원`, '금액은 고객이 고릅니다. 이 페이지는 세 가지 크기와 인수 조건만 보여줍니다.');
      const tiers = tiersOf(e.key);
      const cw = (s.CW - 16) / 3;
      tiers.forEach((t, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 150, { fill: i === 1 ? C.tint : '#fff', r: 6, stroke: i === 1 ? C.blue : C.line });
        s.text(t.name, x + 10, y + 9, { size: 9, weight: 800, color: C.navy });
        s.text(`×${t.f}`, x + cw - 10, y + 10, { size: 6.4, weight: 700, color: C.muted, align: 'right' });
        t.rows.forEach((r, j) => {
          s.text(r[0], x + 10, y + 30 + j * 17, { size: 6.2, weight: 600, color: C.muted });
          s.text(r[1], x + cw - 10, y + 30 + j * 17, { size: 7.2, weight: 800, color: C.blue, align: 'right' });
        });
        s.para(t.note, x + 10, y + 118, cw - 20, { size: 6.0, color: C.ink2, lh: 1.35 });
      });
      y += 160;
      const need = e.gaps[0] ? e.gaps[0].need : 0;
      y = blockTitle(s, y, '재원과 인수 조건', '추가 부담 0원 시나리오부터');
      y = s.table(s.ML, y, s.CW, ['구분', '내용'], [
        ['재배치 재원', (m.state.flags || {}).savings ? '적립·중복 특약 확인 후 확정 (5p 워터폴)' : '입력값상 적립 플래그 없음 — 증권 확인'],
        ['부족분', need ? `${fund(need)} — 한 칸만 채우는 금액` : '금액은 기준선 이상'],
        ['인수 조건', m.disclosure.tone === 'ok' ? '표준체 우선 — 고지 3개월 확인' : '간편심사 검토 — 고지 항목 확인'],
        ['상령일', m.client.ageDay ? `${m.client.ageDay.label} D-${m.client.ageDay.days} — 이전 가입이 유리` : '생년월일 입력 필요'],
        ['갱신·만기', m.contracts.some((c) => c.renew) ? '갱신형 포함 — 갱신 시점 보험료 표 필요' : '비갱신 중심']
      ].map((r) => [{ text: r[0], weight: 700, color: C.navy }, r[1]]), { widths: [88, 427], size: 6.6, rowH: 23, align: ['left', 'left'] });
      y += 12;
      y = blockTitle(s, y, '설계 3원칙', '금액은 고객이 고릅니다');
      y = s.bullets(s.ML, y, s.CW, [
        '한 번에 두 칸을 올리지 않습니다. 1순위 한 칸, 그다음 상담에서 한 칸.',
        '금액을 낮추는 대신 지급 조건(1회한·재진단·치료비)을 확인해 실질 보장을 지킵니다.',
        '보험료 총액이 아니라 "지금 쓰는 돈 안에서의 재배치"로 말합니다.'
      ], { size: 6.6, gap: 2.2 });
      y += 8;
      y = blockTitle(s, y, '설계 시 확인 4', null);
      y = s.checks(s.ML, y, s.CW, [
        '같은 보장을 중복으로 두 번 넣지 않았는가 (기존 증권과 겹치는 특약)',
        '갱신형이면 갱신 보험료를 표로 보여줬는가',
        '1회한·감액·면책 조건을 말로 설명했는가',
        '상령일 기준으로 보험료가 달라지는 시점을 확인했는가'
      ], { size: 6.6, rowH: 15 });
      y += 6;
      if (y < s.limit - 34) y = noteStrip(s, y, '보험료 추정치는 상품·나이·인수 조건에 따라 달라지므로 이 자료에는 금액을 단정해 넣지 않았습니다. 실제 보험료는 설계 프로그램 견적으로 확인합니다.', { size: 6.0 });
      foot(s, no, `${e.order}번째 · ${e.name} 설계`);
    }
    function chapterDecision(s, no, e) {
      let y = head(s, no, KICK[e.key], `${e.name} — 오늘 정할 것과 다음에 넘길 것`, '한 번에 다 하지 않습니다. 오늘은 한 칸, 나머지는 다음 약속의 안건으로 넘깁니다.');
      const steps = [
        { t: '오늘 (0~10분)', d: e.gaps[0] ? `${e.gaps[0].label} ${fund(e.gaps[0].need)} — 채울지 말지만 결정` : '지급 조건 확인 후 유지 결정', c: C.blue },
        { t: '다음 상담', d: (`${plan.second ? plan.second.name : '갱신·만기'} 점검 — ${plan.second ? PR.firstGapLine(plan.second) : '보험료 변동 확인'}`), c: C.orange },
        { t: '3개월 뒤', d: '제도 신청·청구 동행 — 산정특례·상한제·실손 청구 확인', c: C.mint }
      ];
      const cw = (s.CW - 16) / 3;
      steps.forEach((st, i) => {
        const x = s.ML + i * (cw + 8);
        s.rect(x, y, cw, 64, { fill: '#fff', r: 5, stroke: C.line });
        s.rect(x, y, cw, 2.4, { fill: st.c, r: 1.2 });
        s.text(st.t, x + 9, y + 8, { size: 6.4, weight: 800, color: C.navy });
        s.para(st.d, x + 9, y + 20, cw - 18, { size: 5.8, color: C.ink2, lh: 1.35 });
      });
      y += 72;
      y = blockTitle(s, y, '제도 연결 — 보험 밖에서 줄일 수 있는 돈', null);
      y = s.table(s.ML, y, s.CW, ['제도', '이 고객에게 확인할 것'], [
        ['산정특례', `${e.key === 'cancer' ? '암 5%·5년' : e.key === 'brain' ? '뇌혈관 5%·최대 30일' : e.key === 'heart' ? '심장 5%·최대 30일' : '해당 시 확인'} — 등록은 의사가, 진단 후 30일 내 신청`],
        ['본인부담상한제', '연간 급여 본인부담 상한(2026년 90만~843만) 초과분 환급 — 비급여 제외'],
        ['실손', `이 고객 ${m.state.silson === 'none' ? '실손 없음 — 기본축부터' : m.state.silson + '세대'} — 급여 본인부담 청구 경로`]
      ], { widths: [92, 423], size: 6.0, rowH: 18, align: ['left', 'left'] });
      y += 8;
      const cases = E.byArea('system');
      cases.forEach((c) => { y = caseCard(s, s.ML, y, s.CW, c, 84) + 6; });
      if (y < s.limit - 26) y = noteStrip(s, y, '제도는 마지막 안전망이지 계획이 아닙니다. 제도로 기본을 받고, 제도가 못 메우는 비급여·소득 공백을 담보로 맞춘다는 순서로 설명합니다.', { size: 5.8 });
      foot(s, no, `${e.order}번째 · ${e.name} 결정`);
    }
    function chapterObjection(s, no, e) {
      let y = head(s, no, KICK[e.key], `${e.name} — 반론과 오늘 결정`, '이 담보에서 실제로 나오는 말 세 개만 준비합니다. 나머지는 10p 통합 카드에 있습니다.');
      const ids = e.objections.slice(0, 3);
      const rows = ids.map((id) => {
        const o = E.objection(id) || { q: '', a: '', ev: '' };
        return [{ text: o.q, weight: 700, color: C.navy }, o.a, { text: o.ev, color: C.blue, weight: 600 }];
      });
      y = s.table(s.ML, y, s.CW, ['고객이 하는 말', '한 줄 대응', '붙일 근거'], rows, { widths: [138, 300, 77], size: 7.0, rowH: 38, align: ['left', 'left', 'left'] });
      y += 10;
      y = blockTitle(s, y, '반론 뒤에 이어서 물을 것', '대응이 아니라 확인 질문');
      y = s.table(s.ML, y, s.CW, ['상황', '이어서 물을 질문'], [
        ['고객이 금액을 물을 때', `"${e.name}은 지금 기준의 ${e.pct}%입니다. 어느 칸이 가장 신경 쓰이세요?"`],
        ['증권을 안 가져왔을 때', '"담보명과 코드만 사진으로 보내주시면 오늘 바로 확인해 드리겠습니다."'],
        ['가족과 상의하겠다고 할 때', '"배우자분께 설명하실 때 필요한 1장 요약을 준비해 드릴까요?"']
      ], { widths: [130, 385], size: 6.4, rowH: 23, align: ['left', 'left'] });
      y += 10;
      y = blockTitle(s, y, '오늘 결정 3택', '하나를 고르게 합니다');
      const cw3 = (s.CW - 16) / 3;
      [
        { t: '채운다', d: e.gaps[0] ? `${e.gaps[0].label} ${fund(e.gaps[0].need)}부터` : '금액 조정', c: C.blue },
        { t: '조건부터', d: '증권 코드·지급 횟수 확인 후 결정', c: C.orange },
        { t: '다음에', d: '다음 약속 날짜를 받고 PDF로 정리', c: C.mint }
      ].forEach((c, i) => {
        const x = s.ML + i * (cw3 + 8);
        s.rect(x, y, cw3, 46, { fill: '#fff', r: 5, stroke: C.line });
        s.rect(x, y, cw3, 2.4, { fill: c.c, r: 1.2 });
        s.text(c.t, x + 9, y + 8, { size: 7.4, weight: 800, color: C.navy });
        s.para(c.d, x + 9, y + 21, cw3 - 18, { size: 6.2, color: C.ink2, lh: 1.3 });
      });
      y += 56;
      y = noteStrip(s, y, e.gaps[0] ? `${m.client.name}님 — ${e.name} ${e.pct}%, ${e.gaps[0].label} ${fund(e.gaps[0].need)}. 오늘은 이 한 칸을 채울지 결정하고, 다음 약속 날짜를 받습니다.` : `${m.client.name}님 — ${e.name} ${e.pct}%. 오늘은 지급 조건을 확인하고 유지 결정을 받습니다.`, { size: 6.8, fill: C.orangeSoft, stroke: C.orangeLine, accent: C.orange });
      y += 10;
      y = blockTitle(s, y, '반론을 넘긴 직후 3분', '동의를 받았다면 바로 다음 행동');
      y = s.table(s.ML, y, s.CW, ['확인할 것', '말할 것'], [
        ['오늘 결정 범위', `"${e.name} 한 칸만 결정하시고 나머지는 다음에 정리하시죠."`],
        ['재원', (m.state.flags || {}).savings ? '증권의 적립·중복 항목을 먼저 짚어 드리겠습니다.' : '추가 지출 없이 조정 가능한 범위를 확인해 드리겠습니다.'],
        ['다음 약속', '날짜와 시간을 고객 입으로 확인하고 PDF 전달 경로를 정합니다.']
      ], { widths: [104, 411], size: 6.2, rowH: 20, align: ['left', 'left'] });
      y += 10;
      y = blockTitle(s, y, '다음 상담 안건', '이 담보를 오늘 다 끝내지 않습니다');
      y = s.checks(s.ML, y, s.CW, [
        plan.second ? `${plan.second.name} ${plan.second.pct}% — 다음 상담 안건` : '갱신 시점과 예상 보험료 확인',
        '증권 원본으로 코드·지급 횟수 대조',
        '가족 동석이 필요하면 다음 약속에 함께'
      ], { size: 6.8, rowH: 16 });
      y += 4;
      s.text(`근거 출처 — 통계청 2024 사망원인통계 · 심평원 뇌혈관질환 진료현황(2023) · 건보공단 2025 주요수술·노인장기요양 통계연보(2026)`, s.ML, y, s.CW, { size: 4.4, color: C.muted });
      y += 9;
      if (y < s.limit - 26) s.para(PR.NOTE, s.ML, y, s.CW, { size: 5.4, color: C.muted, lh: 1.4 });
      foot(s, no, `${e.order}번째 · ${e.name} 반론`);
    }
    function chapterHold(s, no, e) {
      let y = head(s, no, KICK[e.key], `${e.name} — 유지 · 조건 확인 (HOLD)`, `충족도 ${e.pct}%로 기준선을 넘었습니다. 오늘은 금액을 올리지 않고 조건만 확인합니다.`);
      s.rect(s.ML, y, s.CW, 60, { fill: C.mintSoft, r: 6, stroke: C.mintLine });
      s.text('유지 판단', s.ML + 12, y + 8, { size: 6, weight: 800, color: C.mint });
      s.text(`${e.pct}%`, s.ML + 12, y + 18, { size: 19, weight: 800, color: C.mint });
      s.para(`${e.name} 금액은 기준선을 넘었습니다. 추가 가입은 과보장이 될 수 있어 권하지 않고, 지급 조건·중복·갱신만 확인합니다.`, s.ML + 84, y + 11, s.CW - 100, { size: 6.8, color: C.ink2, lh: 1.45 });
      y += 70;
      y = blockTitle(s, y, '그래도 확인할 3가지', '금액이 아니라 조건');
      y = s.checks(s.ML, y, s.CW, checkLines(e.key), { size: 6.8, rowH: 16 });
      y += 10;
      y = blockTitle(s, y, '증액 대신 할 수 있는 3가지', '이미 충분한 고객에게 팔지 않는 상담');
      y = s.bullets(s.ML, y, s.CW, [
        '갱신 시점·만기(80·90세) 확인 — 노후에 보장이 끊기는 구간을 표시합니다.',
        '중복 특약 정리 — 같은 이름 특담 2개 이상이면 하나는 사실상 쓰이지 못합니다.',
        '가족·부모님 보장 점검으로 전환 — 추가 영업이 아니라 확인입니다.'
      ], { size: 6.6, gap: 2.2 });
      y += 10;
      const cases = casesOf(e.key).slice(0, 2);
      cases.forEach((c) => { y = caseCard(s, s.ML, y, s.CW, c, 128) + 6; });
      y += 2;
      if (y < s.limit - 40) y = noteStrip(s, y, '이미 충분한 담보는 그대로 두는 것이 상담의 신뢰를 만듭니다. 대신 갱신 시점·중복 특약·만기 구간을 확인해 노후 공백을 막습니다.', { size: 6.2 });
      foot(s, no, `${e.order}번째 · ${e.name} 유지`);
    }
    function chapterCaseDesign(s, no, e, many) {
      let y = head(s, no, KICK[e.key], `${e.name} — 사례와 3안`, '사례로 갈린 이유를 확인하고, 같은 자리에서 세 가지 크기만 제시합니다.');
      const list = casesOf(e.key).slice(0, many ? 3 : 2);
      const ch = list.length >= 3 ? 140 : 148;
      list.forEach((c) => { y = caseCard(s, s.ML, y, s.CW, c, ch) + 6; });
      y += 4;
      y = blockTitle(s, y, '3안 — 금액은 고객이 고릅니다', '최소·표준·확대');
      const tiers = tiersOf(e.key);
      const cols = ['구분'].concat(tiers.map((t) => `${t.name} ×${t.f}`));
      const rows2 = tiers[0].rows.map((r, i) => [r[0]].concat(tiers.map((t) => t.rows[i][1])));
      y = s.table(s.ML, y, s.CW, cols, rows2.map((r) => r.map((c, i) => ({ text: c, weight: i === 0 ? 700 : 600, color: i === 0 ? C.navy : C.blue, align: i === 0 ? 'left' : 'center' }))), { widths: [130, 129, 128, 128], size: 6.8, rowH: 22, align: ['left', 'center', 'center', 'center'] });
      y += 10;
      y = blockTitle(s, y, '설계 3원칙', null);
      y = s.bullets(s.ML, y, s.CW, [
        '한 번에 두 칸을 올리지 않습니다. 오늘은 1순위 한 칸, 그다음 상담에서 한 칸.',
        '금액을 낮추는 대신 지급 조건(1회한·재진단·치료비)을 확인해 실질 보장을 지킵니다.',
        '보험료 총액이 아니라 "지금 쓰는 돈 안에서의 재배치"로 말합니다.'
      ], { size: 6.6, gap: 2 });
      y += 6;
      if (y < s.limit - 34) s.para(e.gaps[0] ? `오늘 결정 목표 — ${e.gaps[0].label} ${fund(e.gaps[0].need)}를 채울지. 금액은 고객이 고르고, 재원은 5p 워터폴에서 확인합니다.` : '금액은 기준선 이상 — 지급 조건 확인 후 유지 결정.', s.ML, y, s.CW, { size: 6.2, weight: 700, color: C.orange });
      foot(s, no, `${e.order}번째 · ${e.name} 사례·설계`);
    }

    /* ---------- 증거 부록 (배분이 남을 때만) ---------- */
    function appendixPage(s, no, i) {
      const mode = i % 4;
      if (mode === 0) {
        let y = head(s, no, 'EVIDENCE · STATS', '증거 대장 — 출처·기준·한계', '이 자료에 실린 공식 통계를 한 곳에 모았습니다. 수치마다 기준연도와 대상범위를 붙였습니다.');
        const rows = E.STATS.slice(0, 22).map((st) => [
          { text: st.area, weight: 700, color: C.muted }, { text: st.label, weight: 600, color: C.navy }, { text: st.value, weight: 800, color: C.blue, align: 'right' }, { text: st.scope, color: C.ink2 }, { text: st.limit || '—', color: C.muted }
        ]);
        y = s.table(s.ML, y, s.CW, ['영역', '지표', '값', '기준·대상', '한계'], rows, { widths: [40, 176, 74, 150, 115], size: 5.4, rowH: 18, align: ['left', 'left', 'right', 'left', 'left'] });
        if (y < s.limit - 40) s.para('출처별 원문 — ' + Object.keys(E.SRC).map((k) => E.SRC[k]).join(' / '), s.ML, y + 4, s.CW, { size: 4.8, color: C.muted, lh: 1.4 });
        foot(s, no, '증거 대장');
        return;
      }
      if (mode === 1) {
        let y = head(s, no, 'CASE BOOK', '사례 모음 — 갈린 이유만', '실사례·각색·가상을 구분했습니다. 판정이 아니라 확인할 지점으로 씁니다.');
        const seen = {};
        const list = E.CASES.filter((c) => { if (seen[c.id]) return false; seen[c.id] = 1; return true; }).slice(0, 6);
        list.forEach((c) => { y = caseCard(s, s.ML, y, s.CW, c, 96) + 5; });
        foot(s, no, '사례 모음');
        return;
      }
      if (mode === 2) {
        let y = head(s, no, 'RENEWAL', '갱신·만기·과보장 점검', '추가 가입이 아니라 새는 돈을 막는 점검입니다.');
        y = s.table(s.ML, y, s.CW, ['항목', '확인', '이 고객'], [
          ['갱신 예정일', '갱신 시점의 보험료를 표로 보여줍니다', m.contracts.some((c) => c.renew) ? '갱신형 포함' : '비갱신 중심'],
          ['만기 80·90세', '노후에 보장이 먼저 끊기는 구간', '증권에서 만기 확인'],
          ['적립(저축) 특약', '보장 대비 저축 비중', (m.state.flags || {}).savings ? '플래그 있음 — 확인 필요' : '입력값 없음'],
          ['중복 특약', '같은 이름 특약 2개 이상', (m.state.flags || {}).manyRiders ? '확인 필요' : '—'],
          ['1회한 소진', '이미 지급된 담보인지', '청구 이력 확인']
        ], { widths: [90, 260, 165], size: 6.2, rowH: 18, align: ['left', 'left', 'left'] });
        y += 8;
        y = s.checks(s.ML, y, s.CW, PLAN_FRONT.overCoverage.map((o) => `${o.t} — ${o.d}`), { size: 6.0, rowH: 15 });
        foot(s, no, '갱신·과보장');
        return;
      }
      let y = head(s, no, 'MEMO', '상담 메모', '이 페이지는 인쇄해서 손으로 씁니다.');
      s.memoBand(['고객이 한 말', '내가 약속한 것', '다음 할 일'], 620);
      foot(s, no, '상담 메모');
    }

    /* ---------- 렌더 ---------- */
    schedule.forEach((it, idx) => {
      if (it.kind !== 'chapter' && it.kind !== 'appendix') return;
      const no = idx + 1;
      if (it.kind === 'appendix') { P.push(function (s) { appendixPage(s, no, it.i); }); return; }
      const e = orderEntry(it.key) || plan.order[0];
      const role = it.role;
      P.push(function (s) {
        if (role === 'head') return chapterHead(s, no, e);
        if (role === 'evidence') return chapterEvidence(s, no, e);
        if (role === 'code') return chapterCode(s, no, e);
        if (role === 'cases') return chapterCases(s, no, e, true);
        if (role === 'design') return chapterDesign(s, no, e);
        if (role === 'decision') return chapterDecision(s, no, e);
        if (role === 'objection') return chapterObjection(s, no, e);
        if (role === 'hold') return chapterHold(s, no, e);
        return chapterCaseDesign(s, no, e, e.pages >= 4);
      });
    });

    /* 페이지 번호를 확정해 넘깁니다. 메모 밴드는 상담 메모 페이지(마지막 부록)에서만. */
    const memoPages = schedule.map((it, i) => (it.kind === 'appendix' && it.i % 4 === 3 ? i + 1 : 0)).filter(Boolean);
    return P.map((fn, i) => (s) => {
      s.noMemo = memoPages.indexOf(i + 1) < 0;
      s.autoRowDefault = true;   /* 30장은 표 행 높이를 내용에 맞춰 늘려 셀 잘림 0 */
      return fn(s, i + 1);
    });
  }

  /* =========================================================
     공개 API
     ========================================================= */
  /* =========================================================
     v6.1.1 — 가림 모드 ON이면 PDF(1·10·30장) 본문·머리글·꼬리글의 고객명도 마스킹
     · state 원본은 건드리지 않고, 모델 사본의 m.client.name 만 가립니다.
     ========================================================= */
  function privacyOn() {
    try {
      const SK = root.BojangSmartKey;
      return !!(SK && SK.privacy && SK.privacy.enabled && SK.privacy.enabled());
    } catch (e) { return false; }
  }

  function maskPersonName(name) {
    const s = String(name == null ? '' : name).trim();
    if (!s) return s;
    try {
      const SK = root.BojangSmartKey;
      if (SK && SK.privacy && SK.privacy.maskName) return SK.privacy.maskName(s);
    } catch (e) { /* 아래 기본 규칙으로 */ }
    if (s.length === 1) return '*';
    if (s.length === 2) return s[0] + '*';
    return s[0] + '*'.repeat(Math.max(1, s.length - 2)) + s[s.length - 1];
  }

  function maskModelClient(m) {
    if (!m || !m.client) return m;
    const raw = String(m.client.name || '');
    if (!raw) return m;
    /* 모델의 client 객체를 새로 만들어 원본(state.client)을 건드리지 않습니다. */
    m.client = Object.assign({}, m.client, { name: maskPersonName(raw) });
    m.privacyMasked = true;
    return m;
  }

  function build(kind, state) {
    /* v5.5 — 페이지를 그리기 전에 브랜드 테마 팔레트를 맞춥니다(직접 호출 경로 포함) */
    try { K.syncPalette(); } catch (e) { /* 팔레트 동기화 실패는 기본 색으로 진행 */ }
    refreshToneColor();
    const m = BK.full(state);
    /* v6.1.1 — 상담 중 가림 모드가 켜져 있으면 인쇄물에도 실명을 남기지 않습니다 */
    if (privacyOn()) maskModelClient(m);
    if (kind === 'summary') return { pages: [summaryPage(m)], m };
    if (kind === 'detail') return { pages: detailPages(m), m };
    if (kind === 'advisor') return { pages: advisorPages(m), m };
    throw new Error('unknown report kind: ' + kind);
  }

  const MEMO = {
    advisor: { memoMax: Infinity, memoLabels: ['고객이 한 말', '내가 약속한 것', '다음 할 일'] },
    detail: { memoMax: 200, memoLabels: ['궁금한 점', '다음 상담까지 확인할 것'] }
  };
  root.BojangReport = { build, summaryPage, detailPages, advisorPages, MEMO, qrInfo, qrBlock, warnStrip, renewChart,
    privacy: { on: privacyOn, maskName: maskPersonName, maskModelClient } };
})(typeof window !== 'undefined' ? window : globalThis);
