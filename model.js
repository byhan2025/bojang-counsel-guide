/* 보장분석 상담 가이드 — 공용 진단 모델 (v4.2)
   화면·라이브 상담·고객 30장 슬라이드·PDF 리포트가 모두 이 계산 하나를 씁니다.
   v4   : 가족력 · 간편고지 판정 · 계약 납입상태/만기 집계.
   v4.1 : 암 주요치료비 5종(암수술·항암약물·항암방사선·중환자실·비급여) 세분화.
   v4.2 : 암 3,000/5,000/1억 3단계 · 뇌·심장 권장 2,000 + 주요치료비 3종(혈전용해제·수술·중환자실)
          · 수술비 질병 4축 + 상해 2축 · 간병비 일반/요양 분리 + 시간·금액·가족간병 요건.
   모든 점수·권장선은 상담 보조용 자체 산식이며 보험사 기준이 아닙니다. */
(function (root) {
  'use strict';

  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const FALLBACK_TREAT = [
    { key: 'surgery', label: '암수술비', hint: '수술 1회당', factor: 0.20 },
    { key: 'drug', label: '항암약물치료비', hint: '표적·면역항암', factor: 0.30 },
    { key: 'radio', label: '항암방사선치료비', hint: '방사선 치료', factor: 0.12 },
    { key: 'icu', label: '중환자실 입원', hint: '암 치료 중 중환자실', factor: 0.10 },
    { key: 'extra', label: '비급여 추가 치료비', hint: '비급여 주사·검사', factor: 0.18 }
  ];
  const FALLBACK_NEURO = [
    { key: 'lysis', label: '혈전용해제 치료비', hint: 'tPA 투여 · 기계적 혈전제거술은 별도', factor: 0.5 },
    { key: 'surgery', label: '수술비(관혈·비관혈)', hint: '개두·개흉 · 스텐트·색전술', factor: 0.75 },
    { key: 'icu', label: '중환자실 입원비', hint: '중환자실 치료 일당', factor: 0.5 }
  ];

  const TREAT_SUBS = (typeof CANCER_TREAT_SUBS !== 'undefined' && CANCER_TREAT_SUBS.length) ? CANCER_TREAT_SUBS : FALLBACK_TREAT;
  const NEURO_SUBS = (typeof NEURO_TREAT_SUBS !== 'undefined' && NEURO_TREAT_SUBS.length) ? NEURO_TREAT_SUBS : FALLBACK_NEURO;

  /* v5.0 — 뇌·심장 진단비 3단계 / 2단계 (content.js 정의, 없을 때 폴백) */
  const FALLBACK_DX = {
    brain: [
      { key: 'vascular', label: '뇌혈관질환 진단비', codes: 'I60~I69', hint: '가장 넓은 범위 · 후유증(I69) 포함', rec: 2000, factor: 1, core: true },
      { key: 'stroke', label: '뇌졸중 진단비', codes: 'I60~I63·I65~I66', hint: '뇌경색(I63) 포함', rec: 2000, factor: 1, part: 0.5 },
      { key: 'bleed', label: '뇌출혈 진단비', codes: 'I60~I62', hint: '가장 좁은 범위 · 뇌경색 제외', rec: 1000, factor: 0.5, part: 0.3 }
    ],
    heart: [
      { key: 'ischemic', label: '허혈성심장질환 진단비', codes: 'I20~I25', hint: '협심증(I20) 포함 · 핵심 범위', rec: 2000, factor: 1, core: true },
      { key: 'ami', label: '급성심근경색 진단비', codes: 'I21~I23', hint: '협심증(I20) 제외', rec: 2000, factor: 1, part: 0.45 }
    ]
  };
  const DX_SUBS = {
    brain: (typeof BRAIN_DX_SUBS !== 'undefined' && BRAIN_DX_SUBS.length) ? BRAIN_DX_SUBS : FALLBACK_DX.brain,
    heart: (typeof HEART_DX_SUBS !== 'undefined' && HEART_DX_SUBS.length) ? HEART_DX_SUBS : FALLBACK_DX.heart
  };
  const DX_SCENARIOS = (typeof NEURO_DX_SCENARIOS !== 'undefined' && NEURO_DX_SCENARIOS) ? NEURO_DX_SCENARIOS : {
    brain: [
      { label: '뇌경색(I63)', code: 'I63', parts: ['vascular', 'stroke'], note: '뇌출혈 담보는 0원' },
      { label: '뇌출혈(I61)', code: 'I61', parts: ['vascular', 'stroke', 'bleed'], note: '세 담보 모두 합산' },
      { label: '뇌혈관 후유증(I69)', code: 'I69', parts: ['vascular'], note: '뇌혈관질환 담보만' }
    ],
    heart: [
      { label: '협심증(I20)', code: 'I20', parts: ['ischemic'], note: '급성심근경색 담보는 0원' },
      { label: '급성심근경색(I21)', code: 'I21', parts: ['ischemic', 'ami'], note: '두 담보 합산' }
    ]
  };
  const DX_MAX = 5000;

  function dxObj(state, key) {
    const c = state && state.cov && state.cov[key];
    const d = c && c.dx;
    return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  }
  function dxTotal(state, key) {
    const d = dxObj(state, key);
    return Object.keys(d).reduce((a, k) => a + (Number(d[k]) || 0), 0);
  }
  /* 핵심(가장 넓은) 범위 금액 — 평가 주축 */
  function dxCoreVal(state, key) {
    const core = DX_SUBS[key].find((s) => s.core) || DX_SUBS[key][DX_SUBS[key].length - 1];
    return Number(dxObj(state, key)[core.key] || 0) || 0;
  }
  /* 진단 시 합산 지급액 시나리오 */
  function dxScenarios(state, key) {
    const d = dxObj(state, key);
    return (DX_SCENARIOS[key] || []).map((sc) => ({
      label: sc.label, code: sc.code, note: sc.note,
      parts: sc.parts.map((k) => ({ key: k, val: Number(d[k] || 0) || 0, label: (DX_SUBS[key].find((s) => s.key === k) || {}).label || k })),
      sum: sc.parts.reduce((a, k) => a + (Number(d[k] || 0) || 0), 0)
    }));
  }
  const TREAT_MIN = 500, TREAT_MAX = 3000;
  const NEURO_MIN = 500, NEURO_MAX = 3000;
  const CANCER_ITEM = () => PRIORITY[0];

  /* 세부 1종의 권장 금액(만원) — 100만원 단위, 500~3,000만원 */
  function subRec(baseRec, sub, part) {
    const f = (sub && sub.factor) || 0;
    const min = (part && part.min) || TREAT_MIN;
    const max = (part && part.max) || TREAT_MAX;
    const raw = Math.round(((Number(baseRec) || 0) * f) / 100) * 100;
    return clamp(raw, min, max);
  }
  function treatRec(baseRec, sub) { return subRec(baseRec, sub, { min: TREAT_MIN, max: TREAT_MAX }); }
  function treatRecs(baseRec) { return TREAT_SUBS.map((s) => treatRec(baseRec, s)); }

  function emptyGroup(subs) {
    const o = {};
    (subs || []).forEach((s) => { o[s.key] = 0; });
    return o;
  }
  function emptyTreat() { return emptyGroup(TREAT_SUBS); }
  function emptyNeuro() { return emptyGroup(NEURO_SUBS); }

  function groupObj(state, key, partKey) {
    const c = state && state.cov && state.cov[key];
    const t = c && c[partKey];
    return (t && typeof t === 'object' && !Array.isArray(t)) ? t : null;
  }
  /* 세부 값이 아직 숫자(구버전 단일 항목)여도 합계는 읽힙니다 */
  function groupSum(state, key, partKey) {
    const c = state && state.cov && state.cov[key];
    const t = c ? c[partKey] : 0;
    if (t && typeof t === 'object') return Object.keys(t).reduce((a, k) => a + (Number(t[k]) || 0), 0);
    return Number(t || 0) || 0;
  }
  function treatSum(state) { return groupSum(state, 'cancer', 'treatment'); }
  function treatObj(state) { return groupObj(state, 'cancer', 'treatment'); }
  function treatCount(state) {
    const t = treatObj(state);
    if (!t) return treatSum(state) > 0 ? 1 : 0;
    return TREAT_SUBS.filter((s) => Number(t[s.key] || 0) > 0).length;
  }
  function treatMissing(state) {
    const t = treatObj(state) || {};
    return TREAT_SUBS.filter((s) => !(Number(t[s.key] || 0) > 0)).map((s) => s.label);
  }
  function neuroSum(state, key) { return groupSum(state, key, 'treat'); }
  function dxShort(label) { return String(label || '').replace(/\s*진단비$/, ''); }
  function neuroCount(state, key) {
    const t = groupObj(state, key, 'treat') || {};
    return NEURO_SUBS.filter((s) => Number(t[s.key] || 0) > 0).length;
  }
  function neuroMissing(state, key) {
    const t = groupObj(state, key, 'treat') || {};
    return NEURO_SUBS.filter((s) => !(Number(t[s.key] || 0) > 0)).map((s) => s.label);
  }

  /* ---------- 구버전 데이터 마이그레이션 (v4.2) ----------
     저장된 localStorage 세션·상담 이력·가져온 JSON을 지금 구조로 옮깁니다.
     금액을 알 수 없는 boolean 보유 표시는 표준 금액으로 채우고, 확인이 필요하다는 메모를 남깁니다. */
  function normalizeState(state) {
    const res = { migrated: false, notes: [] };
    if (!state || !state.cov) return res;
    const cov = state.cov;

    /* 1) 암 주요치료비: 단일 숫자 → 5종 분배 (합계 보존) */
    if (cov.cancer) {
      const c = cov.cancer;
      const t = c.treatment;
      if (!(t && typeof t === 'object')) {
        const legacy = Number(t || 0) || 0;
        const recs = treatRecs(CANCER_ITEM().rec[state.age] || 5000);
        const recSum = recs.reduce((a, b) => a + b, 0) || 1;
        const out = emptyTreat();
        TREAT_SUBS.forEach((s, i) => {
          out[s.key] = legacy > 0 ? Math.round((legacy * recs[i]) / recSum / 10) * 10 : 0;
        });
        c.treatment = out;
        if (legacy > 0) { c.treatmentLegacy = legacy; res.migrated = true; res.notes.push('암 주요치료비 단일 금액을 5종으로 나눠 옮겼습니다(합계 유지).'); }
      } else {
        TREAT_SUBS.forEach((s) => { if (typeof t[s.key] !== 'number') t[s.key] = Number(t[s.key] || 0) || 0; });
      }
      if (typeof c.general !== 'number') c.general = 0;
      if (typeof c.similar !== 'number') c.similar = 0;
      c.recur = !!c.recur;
    }

    /* 2) 뇌·심장 주요치료비: boolean/단일 → 3종 + 진단비 3단계/2단계 (v5.0) */
    ['brain', 'heart'].forEach((key) => {
      const c = cov[key];
      if (!c) return;
      /* 2-a) 진단비 금액 칸 (v5.0) — 구버전 범위 선택(scope)을 금액으로 옮깁니다 */
      const subs = DX_SUBS[key];
      const isObj = c.dx && typeof c.dx === 'object' && !Array.isArray(c.dx);
      if (!isObj) {
        const out = {};
        subs.forEach((s) => { out[s.key] = 0; });
        const legacyScope = c.scope;
        const map = { bleed: 'bleed', stroke: 'stroke', vascular: 'vascular', mi: 'ami', ischemic: 'ischemic', cardiac: 'ischemic' };
        const k = legacyScope && legacyScope !== 'none' ? map[legacyScope] : null;
        if (k && out[k] != null) {
          out[k] = 2000;
          res.migrated = true;
          res.notes.push(`${key === 'brain' ? '뇌' : '심장'} 보장 범위 선택을 진단비 2,000만원으로 옮겼습니다 — 실제 가입금액을 확인하세요.`);
        }
        c.dx = out;
      } else {
        subs.forEach((s) => {
          if (typeof c.dx[s.key] !== 'number') c.dx[s.key] = Number(c.dx[s.key]) || 0;
          c.dx[s.key] = Math.max(0, Math.min(DX_MAX, c.dx[s.key]));
        });
      }
      delete c.scope;
      const legacyBool = (typeof c.treat === 'boolean') ? c.treat : (typeof c.surgery === 'boolean' ? c.surgery : null);
      if (!(c.treat && typeof c.treat === 'object')) {
        const out = emptyNeuro();
        if (legacyBool) {
          NEURO_SUBS.forEach((s) => { out[s.key] = 1000; });
          res.migrated = true;
          res.notes.push(`${key === 'brain' ? '뇌' : '심장'} 주요치료비 보유 표시를 3종 각 1,000만원으로 옮겼습니다 — 실제 가입금액을 확인하세요.`);
        }
        c.treat = out;
      } else {
        NEURO_SUBS.forEach((s) => { if (typeof c.treat[s.key] !== 'number') c.treat[s.key] = Number(c.treat[s.key + ''] || 0) || 0; });
      }
      delete c.surgery;
    });

    /* 3) 수술비: 질병 4축 + 상해 2축 */
    if (cov.surgery) {
      const s = cov.surgery;
      const legacy = typeof s.injury === 'boolean' || typeof s.nDae === 'boolean';
      if (legacy) {
        const d15 = Number(s.disease || 0);
        s.disease15 = d15;
        s.disease = 0;
        s.diseaseNdae = s.nDae ? 500 : 0;
        s.diseaseNonPay = 0;
        s.injury15 = 0;
        s.injury = s.injury ? 50 : 0;
        delete s.nDae;
        res.migrated = true;
        res.notes.push('수술비를 질병 4축·상해 2축으로 세분화했습니다 — 기존 1~5종 금액은 그대로 옮겼습니다.');
      }
      ['disease', 'disease15', 'diseaseNdae', 'diseaseNonPay', 'injury', 'injury15'].forEach((k) => {
        if (typeof s[k] !== 'number') s[k] = Number(s[k] || 0) || 0;
      });
    }

    /* 4) 간병비: 일반/요양 분리 + 약관 요건 */
    if (cov.care) {
      const c = cov.care;
      if (typeof c.daily !== 'number') c.daily = Number(c.daily || 0) || 0;
      if (typeof c.nDaily !== 'number') { c.nDaily = Number(c.nDaily || 0) || 0; if (c.daily > 0) { res.notes.push('간병 일당을 일반병원 칸으로 옮겼습니다 — 요양병원 해당 여부를 확인하세요.'); } }
      if (!c.basis) c.basis = 'unknown';
      if (!c.family) c.family = 'conditional';
      c.nursing = !!c.nursing;
      c.ltc = !!c.ltc;
      if (!c.mode) c.mode = 'normal';
    }

    if (typeof state.premium !== 'number') state.premium = Number(state.premium || 0) || 0;
    if (!state.flags) state.flags = {};
    if (!Array.isArray(state.contracts)) state.contracts = [];
    if (!Array.isArray(state.family)) state.family = [];
    if (!state.disc || typeof state.disc !== 'object') state.disc = {};
    return res;
  }

  /* 하위 호환: 예전 이름 */
  function normalizeCov(state) { return normalizeState(state); }

  function getVal(state, item, part) {
    const c = state.cov && state.cov[item.key];
    return c ? c[part.key] : undefined;
  }

  function partLevel(fill, val) {
    if (fill >= 0.999) return 'enough';
    if (fill >= 0.6) return 'check';
    if (fill > 0 || val) return 'short';
    return 'none';
  }

  /* 3단계 기준(최소·권장·충분) 게이지 판정 */
  function stageOf(val, tiers, rec) {
    const v = Number(val) || 0;
    if (!tiers) return null;
    if (v <= 0) return { code: 'none', label: '없음', pct: 0 };
    if (v >= tiers.enough) return { code: 'enough', label: '충분', pct: 100 };
    if (v >= tiers.rec) return { code: 'rec', label: '권장 충족', pct: Math.round((v / tiers.enough) * 100) };
    if (v >= tiers.min) return { code: 'min', label: '최소 충족', pct: Math.round((v / tiers.enough) * 100) };
    if (rec > 0) return { code: 'low', label: '최소 미달', pct: Math.round((v / rec) * 100) };
    return { code: 'low', label: '최소 미달', pct: 0 };
  }

  /* ---------- 담보 1개 평가 ---------- */
  function evalItem(state, item) {
    const baseRec = item.rec[state.age] || 0;
    const firstKey = item.parts[0] && item.parts[0].key;
    const parts = item.parts.map((p) => {
      const tiers = p.tiers || (p.key === firstKey ? item.tiers : null) || null;
      let fill = 0, rec = 0, val = 0, option = null, subs = null, stage = null, dx = null;
      if (p.type === 'amount') {
        rec = Math.round(baseRec * p.factor);
        val = Number(getVal(state, item, p) || 0);
        fill = rec > 0 ? clamp(val / rec, 0, 1) : 0;
        stage = stageOf(val, tiers, rec);
      } else if (p.type === 'group') {
        /* 세부별 권장 대비 충족도(권장 비중 가중) */
        const raw = getVal(state, item, p);
        const src = (raw && typeof raw === 'object') ? raw : {};
        const list = (p.subs || TREAT_SUBS);
        subs = list.map((sp) => {
          const srec = subRec(baseRec, sp, p);
          const sval = Number(src[sp.key] || 0) || 0;
          const sfill = srec > 0 ? clamp(sval / srec, 0, 1) : 0;
          return {
            key: sp.key, label: sp.label, hint: sp.hint, rec: srec, val: sval, fill: sfill,
            pct: Math.round(sfill * 100), level: partLevel(sfill, sval), part: sp,
            min: p.min || 500, max: p.max || 3000
          };
        });
        rec = subs.reduce((a, s) => a + s.rec, 0);
        val = subs.reduce((a, s) => a + s.val, 0);
        fill = rec > 0 ? subs.reduce((a, s) => a + Math.min(s.val, s.rec), 0) / rec : 0;
      } else if (p.type === 'dxset') {
        /* v5.0 — 범위별 진단비 금액. 평가 주축 = 가장 넓은 범위(뇌혈관·허혈성심장) */
        const raw = getVal(state, item, p);
        const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
        const list = p.subs || [];
        const coreKey = p.core || ((list.find((s) => s.core) || list[list.length - 1] || {}).key);
        subs = list.map((sp) => {
          const srec = Number(sp.rec) || Math.round(baseRec * (sp.factor || 1));
          const sval = Number(src[sp.key] || 0) || 0;
          const sfill = srec > 0 ? clamp(sval / srec, 0, 1) : 0;
          return {
            key: sp.key, label: sp.label, codes: sp.codes, hint: sp.hint, rec: srec, val: sval, fill: sfill,
            pct: Math.round(sfill * 100), level: partLevel(sfill, sval), part: sp,
            isCore: sp.key === coreKey, min: 0, max: p.max || DX_MAX
          };
        });
        const core = subs.find((s) => s.isCore) || subs[0] || { val: 0, rec: 0, fill: 0, label: '', key: coreKey };
        let f = core.fill;
        if (!(core.val > 0)) {
          /* 넓은 범위가 0원이면 좁은 범위에 부분 점수만 (뇌경색·협심증은 여전히 공백) */
          subs.forEach((s) => { if (!s.isCore) f = Math.max(f, s.fill * (Number(s.part && s.part.part) || 0.4)); });
        }
        fill = clamp(f, 0, 1);
        val = subs.reduce((a, s) => a + s.val, 0);
        rec = core.rec || 0;
        stage = stageOf(core.val, p.tiers || item.tiers, core.rec);
        dx = {
          subs,
          core,
          gapWarn: !(core.val > 0) && subs.some((s) => s.val > 0),
          gapLabel: core.label,
          scenarios: dxScenarios(state, item.key),
          total: val
        };
      } else if (p.type === 'scale') {
        const v = getVal(state, item, p) || p.options[0].v;
        option = p.options.find((o) => o.v === v) || p.options[0];
        fill = option.score;
      } else {
        val = !!getVal(state, item, p);
        fill = val ? 1 : 0;
      }
      return { key: p.key, label: p.label, type: p.type, weight: p.weight, fill, rec, val, option, part: p, subs, stage, tiers, dx };
    });
    const fill = parts.reduce((a, p) => a + p.weight * p.fill, 0);
    const primary = parts[0].fill;
    let level, label;
    if (primary <= 0 && !(parts[1] && parts[1].fill > 0)) { level = 'gap'; label = '공백 위험'; }
    else if (fill >= 0.9) { level = 'ok'; label = '적정'; }
    else { level = 'need'; label = '보강 필요'; }
    return { item, baseRec, parts, fill, level, label, primary, tiers: item.tiers || null };
  }

  /* ---------- 보장 요약 문장 ---------- */
  function summaryOf(state, item, r) {
    const c = state.cov[item.key] || {};
    const P = (k) => r.parts.find((p) => p.key === k) || {};
    if (item.key === 'cancer') {
      const bits = [`일반암 ${won(c.general)}만원`];
      bits.push(c.similar > 0 ? `유사암 ${won(c.similar)}만원` : '유사암 없음');
      const ts = treatSum(state), tc = treatCount(state);
      bits.push(ts > 0 ? `치료비 5종 ${won(ts)}만원 ${tc}/5` : '치료비 5종 없음');
      if (c.recur) bits.push('재진단 보장');
      return bits.join(' · ');
    }
    if (item.key === 'brain' || item.key === 'heart') {
      const p = P('dx');
      const g = P('treat');
      const n = (g.subs || []).filter((s) => s.val > 0).length;
      const d = p.dx || {};
      const core = d.core;
      const narrow = (p.subs || []).filter((s) => !s.isCore && s.val > 0).map((s) => `${dxShort(s.label)} ${won(s.val)}`);
      const coreTxt = core && core.val > 0
        ? `${dxShort(core.label)} ${won(core.val)}만원`
        : (d.gapWarn ? `범위 공백(${dxShort(core ? core.label : '')} 0원)` : '진단비 없음');
      return `${coreTxt}${narrow.length ? ' + ' + narrow.join(' + ') + '만원' : ''} · 치료비 3종 ${n}/3 ${won(g.val)}만원`;
    }
    if (item.key === 'surgery') {
      const dz = ['disease', 'disease15', 'diseaseNdae', 'diseaseNonPay'].filter((k) => Number(P(k).val) > 0).length;
      const ij = ['injury', 'injury15'].filter((k) => Number(P(k).val) > 0).length;
      return `질병 ${dz}/4축 · 상해 ${ij}/2축` + (P('diseaseNdae').val > 0 ? ` · N대 ${won(P('diseaseNdae').val)}만원` : ' · N대 없음');
    }
    const bits = [`일반병원 ${won(c.daily)}만원`, c.nDaily > 0 ? `요양병원 ${won(c.nDaily)}만원` : '요양병원 없음'];
    const basisLabel = { time: '시간 기준', money: '금액 기준', unknown: '지급기준 미확인' }[c.basis] || '지급기준 미확인';
    bits.push(basisLabel);
    if (c.family === 'yes') bits.push('가족간병 인정'); else if (c.family === 'no') bits.push('가족간병 불인정');
    if (c.nursing) bits.push('간호간병');
    if (c.ltc) bits.push('장기요양');
    return bits.join(' · ');
  }

  /* ---------- 점수 ---------- */
  function weights(state) {
    const w = Object.assign({}, SCORE_MODEL.base);
    const ageAdj = SCORE_MODEL.ageAdj[state.age] || {};
    const jobAdj = SCORE_MODEL.jobAdj[state.job] || {};
    Object.keys(ageAdj).forEach((k) => { w[k] = Math.max(4, w[k] + ageAdj[k]); });
    Object.keys(jobAdj).forEach((k) => { w[k] = Math.max(4, w[k] + jobAdj[k]); });
    return w;
  }

  function computeScore(state, rows) {
    const w = weights(state);
    let sum = 0, wsum = 0;
    rows.forEach(({ item, r }) => {
      const ww = w[item.key] || 0;
      sum += ww * clamp(r.fill, 0, 1);
      wsum += ww;
    });
    let score = wsum ? (sum / wsum) * 100 : 0;
    const penalty = [];
    if (state.silson === 'none') { score += SCORE_MODEL.penalty.silsonNone; penalty.push({ v: SCORE_MODEL.penalty.silsonNone, t: '실손 공백' }); }
    if (state.silson === '5') { score += SCORE_MODEL.penalty.silson5; penalty.push({ v: SCORE_MODEL.penalty.silson5, t: '5세대 비중증 축소' }); }
    if (state.flags && state.flags.renew) { score += SCORE_MODEL.penalty.renew; penalty.push({ v: SCORE_MODEL.penalty.renew, t: '갱신형 중심' }); }
    score = Math.round(clamp(score, 0, 100));
    const grade = SCORE_MODEL.grades.find((g) => score >= g.min) || SCORE_MODEL.grades[SCORE_MODEL.grades.length - 1];
    return { score, grade, penalty, w };
  }

  /* 종합 등급 문자(A+~C) — 리포트 표기용 */
  function gradeLetter(score) {
    if (score >= 88) return 'A+';
    if (score >= 78) return 'A';
    if (score >= 68) return 'B+';
    if (score >= 58) return 'B';
    if (score >= 46) return 'C+';
    return 'C';
  }

  /* ---------- 보험나이 · 상령일 ---------- */
  function parseDate(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function monthsBetween(from, to) {
    let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    if (to.getDate() < from.getDate()) m -= 1;
    return m;
  }

  function insuranceAge(birth, ref) {
    const b = parseDate(birth);
    if (!b) return null;
    const m = Math.max(0, monthsBetween(b, ref || new Date()));
    return Math.floor(m / 12) + (m % 12 >= 6 ? 1 : 0);
  }

  /* 상령일 = 생일 + 6개월. 보험나이가 한 살 올라가는 날 */
  function nextAgeDay(birth, ref) {
    const b = parseDate(birth);
    if (!b) return null;
    const now = ref || new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mk = (y) => {
      const d = new Date(y, b.getMonth(), b.getDate());
      d.setMonth(d.getMonth() + 6);
      return d;
    };
    let target = mk(today.getFullYear());
    if (target < today) target = mk(today.getFullYear() + 1);
    const days = Math.round((target - today) / 86400000);
    const fmt = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    return { date: target, label: fmt, days, insuranceAgeBefore: insuranceAge(birth, new Date(target.getTime() - 86400000)), insuranceAgeAfter: insuranceAge(birth, target) };
  }

  function ageBandFromBirth(birth, ref) {
    const a = insuranceAge(birth, ref);
    if (a == null) return null;
    const band = Math.max(20, Math.min(70, Math.floor(a / 10) * 10));
    return String(band);
  }

  /* ---------- 세부 항목 매트릭스 ---------- */
  const LEVEL_LABEL = { enough: '충분', check: '점검', short: '부족', none: '없음' };

  function partRows(state, rows) {
    const out = [];
    rows.forEach(({ item, r }) => {
      r.parts.forEach((p) => {
        out.push({
          itemKey: item.key, itemName: item.name, rank: item.rank,
          key: p.key, label: p.label, type: p.type,
          fill: p.fill, pct: Math.round(p.fill * 100),
          val: p.val, rec: p.rec, option: p.option, stage: p.stage, tiers: p.tiers,
          subs: p.subs ? p.subs.map((s) => ({ label: s.label, key: s.key, val: s.val, rec: s.rec, fill: s.fill, pct: s.pct, level: s.level, codes: s.codes })) : null,
          level: partLevel(p.fill, p.val),
          text: p.type === 'amount' ? `${won(p.val)}만원 / ${won(p.rec)}만원${p.stage ? ` (${p.stage.label})` : ''}`
            : p.type === 'group' ? `${p.subs.filter((s) => s.val > 0).length}/${p.subs.length}종 · ${won(p.val)}만원 / ${won(p.rec)}만원`
              : p.type === 'dxset' ? `${(p.subs || []).filter((s) => s.val > 0).length}/${(p.subs || []).length}단계 · 핵심 ${p.dx && p.dx.core ? (p.dx.core.val ? won(p.dx.core.val) : '0') : '0'}만원 / 권장 ${won(p.rec)}만원`
                : p.type === 'scale' ? (p.option ? p.option.label : '미보유')
                : (p.val ? '보유' : '없음')
        });
      });
    });
    return out;
  }

  function counts(parts, silson) {
    const c = { enough: 0, check: 0, short: 0, none: 0 };
    parts.forEach((p) => { c[p.level] += 1; });
    if (silson === 'none') c.none += 1; else c.enough += 1;
    c.total = c.enough + c.check + c.short + c.none;
    return c;
  }

  /* ---------- 가족력 ---------- */
  const FAMILY_KEYS = ['cancer', 'brain', 'heart', 'dementia'];
  const FAMILY_NOTE = {
    cancer: { title: '암 가족력', body: '부모·형제의 암 이력은 같은 연령대에서 발생 위험을 높게 보는 근거가 됩니다. 일반암·유사암 진단비를 기준선 위에 두고, 1회한이 아닌 재진단 담보까지 확인합니다.' },
    brain: { title: '뇌혈관 가족력', body: '고혈압·당뇨와 함께 뇌경색 위험을 올리는 요인입니다. 뇌출혈이 아니라 뇌혈관질환(I60~I69) 범위로 잡아야 실제 지급 구간이 넓어집니다.' },
    heart: { title: '심장 가족력', body: '협심증·심근경색 이력이 가족에 있으면 스텐트 시술 구간이 문제가 됩니다. 허혈성심장질환(I20~I25) 범위와 심혈관 수술비를 함께 봅니다.' },
    dementia: { title: '치매 가족력', body: '노후 간병의 가장 긴 구간입니다. 장기요양 1~5등급·인지지원 담보와 간병 일당을 함께 준비합니다.' }
  };

  function familyList(state) {
    return (state.family || []).filter((k) => FAMILY_KEYS.indexOf(k) >= 0);
  }

  function familyNotes(state) {
    return familyList(state).map((k) => ({ key: k, label: FAMILY_NOTE[k].title, body: FAMILY_NOTE[k].body }));
  }

  /* ---------- 간편 고지(알릴 의무) 판정 ---------- */
  function disclosureJudge(state) {
    const d = state.disc || {};
    const on = (k) => !!d[k];
    const had3m = on('d3_dx') || on('d3_in') || on('d3_op');
    const had1y = on('y1_test');
    const had5yInOp = on('y5_inop') || on('y5_care');
    const hadMajor = on('y5_major');
    const reasons = [];
    if (had3m) reasons.push('최근 3개월 이내 진단·입원·수술 이력');
    if (had1y) reasons.push('최근 1년 이내 추가검사 필요소견');
    if (on('y5_inop')) reasons.push('최근 5년 이내 입원·수술 이력');
    if (on('y5_care')) reasons.push('최근 5년 이내 7일 이상 계속 치료');
    if (hadMajor) reasons.push('최근 5년 이내 중대질병 진단·치료');

    let code, label, tone, headline, advice;
    if (had3m) {
      code = 'hold'; label = '3개월 경과 후 재검토'; tone = 'warn';
      headline = '간편심사도 3개월 문항을 똑같이 묻습니다';
      advice = '치료·검사가 마무리된 날부터 3개월이 지난 뒤가 가장 넓은 선택지입니다. 그 전에는 인수 조건이 제한될 수 있어 청약 일정을 조정합니다.';
    } else if (hadMajor) {
      code = 'review'; label = '인수 심사 필요'; tone = 'gap';
      headline = '5년 이내 중대질병은 간편심사에서도 고지 대상입니다';
      advice = '암·간경화·투석 중 만성신장질환·파킨슨·루게릭은 3·2·5와 3·5·5 모두 5년 문항에 들어갑니다. 일반심사 할증 인수나 상품별 인수 기준을 먼저 확인합니다.';
    } else if (had5yInOp) {
      code = 'simple325'; label = '간편심사 3·2·5 검토'; tone = 'need';
      headline = '5년 이내 입원·수술은 3·5·5 문항에 걸립니다';
      advice = '2년보다 오래된 이력이면 3·2·5로 통과할 수 있습니다. 2년 이내라면 3·2·5도 걸리므로 초간편 상품이나 일반심사 할증 인수를 함께 봅니다.';
    } else if (had1y) {
      code = 'simple355'; label = '간편심사 3·5·5 검토'; tone = 'info';
      headline = '5년 입원·수술이 없으면 3·5·5가 가장 저렴합니다';
      advice = '1년 이내 추가검사 소견은 일반심사(3·1·5)의 1년 문항에 해당합니다. 간편심사 3·5·5는 3개월·5년·5년만 묻기 때문에 이 이력으로는 걸리지 않습니다. 검사 결과가 정리되면 일반심사 가능 여부를 다시 확인합니다.';
    } else {
      code = 'standard'; label = '표준체 권장'; tone = 'ok';
      headline = '일반심사(표준체)로 가입 가능한 상태입니다';
      advice = '간편심사는 보험료가 1.2~2배 수준으로 높고 보장이 제한될 수 있습니다. 표준체로 먼저 심사하는 것이 순서입니다.';
    }
    return { code, label, tone, headline, advice, reasons, items: d, checked: reasons.length };
  }

  /* ---------- 보유 계약 집계 (납입상태·만기) ---------- */
  const MATURITY = ['80세', '90세', '100세', '종신'];
  function contractStats(contracts) {
    const list = contracts || [];
    const total = list.reduce((a, c) => a + Number(c.premium || 0), 0);
    const active = list.filter((c) => (c.pay || '납입중') === '납입중');
    const paidUp = list.filter((c) => c.pay === '납입완료');
    const activePremium = active.reduce((a, c) => a + Number(c.premium || 0), 0);
    const renewPremium = list.filter((c) => c.renew).reduce((a, c) => a + Number(c.premium || 0), 0);
    const maturity = {};
    list.forEach((c) => { const k = c.maturity || '미입력'; maturity[k] = (maturity[k] || 0) + 1; });
    const shortMaturity = list.filter((c) => c.maturity === '80세' || c.maturity === '90세');
    return {
      count: list.length, total, activePremium, renewPremium,
      activeCount: active.length, paidUpCount: paidUp.length,
      paidUpPremium: total - activePremium,
      maturity, shortMaturityCount: shortMaturity.length,
      renewShare: total ? Math.round((renewPremium / total) * 100) : 0
    };
  }

  /* ---------- 보장 구멍 · 보험료 다이어트 ---------- */
  function checkpoints(state, rows, totalSum, annual) {
    const cps = [];
    const cov = state.cov;
    if (state.silson === 'none') {
      cps.push({ level: 'danger', title: '실손 공백', body: '입원·통원 기본부터 막혀 있습니다. 진단비보다 실손이 먼저입니다.' });
    } else if (state.silson === '1' || state.silson === '2') {
      cps.push({ level: 'info', title: '실손 1·2세대 — 보험료를 줄일 두 갈래', body: '2026년 11월부터 ①선택형 할인 특약(30~40% 할인) ②5세대 전환(3년간 50% 추가 할인, 6개월 한시) 중 선택할 수 있습니다. 5세대는 비중증 비급여 한도 1,000만원·자기부담 50%로 줄고 5년 재가입이 생깁니다.' });
    } else if (state.silson === '3' || state.silson === '4') {
      cps.push({ level: 'ok', title: `실손 ${state.silson}세대 — 유지 판단`, body: '비급여 한도·자기부담 구조가 5세대보다 넓습니다. 의료 이용이 적다면 보험료 차이를 비교해 볼 수 있지만 서두를 이유는 없습니다.' });
    } else {
      cps.push({ level: 'ok', title: '실손 5세대 — 구조 확인', body: '중증(특약1)과 비중증(특약2)이 분리돼 있습니다. 특약2는 연 1,000만원·자기부담 50%이므로 도수·비급여 주사는 사실상 자기부담입니다. 비중증이 줄어든 만큼 정액 수술비·비급여 수술비의 역할이 커집니다.' });
    }

    /* 암 */
    const cg = Number(cov.cancer.general || 0);
    const cTier = PRIORITY[0].tiers;
    if (cg <= 0) cps.push({ level: 'danger', title: '일반암 진단비 없음', body: `암 진단은 곧 소득 중단입니다. 최소 ${won(cTier.min)}만원, 권장 ${won(cTier.rec)}만원이 출발선입니다.` });
    else if (cg < cTier.min) cps.push({ level: 'warn', title: `일반암 ${won(cg)}만원 — 최소선 미달`, body: `초기 치료비 부담 최소선이 ${won(cTier.min)}만원입니다. ${won(cTier.min - cg)}만원이 비어 있습니다.` });
    else if (cg < cTier.rec) cps.push({ level: 'info', title: `일반암 ${won(cg)}만원 — 권장선 미달`, body: `권장 ${won(cTier.rec)}만원(초기 생활비+치료비 여유) 대비 ${won(cTier.rec - cg)}만원 부족합니다. 충분선은 ${won(cTier.enough)}만원입니다.` });
    if (Number(cov.cancer.similar || 0) <= 0) cps.push({ level: 'warn', title: '유사암 담보 없음', body: '갑상선암(C73)·기타피부암(C44)·제자리암(D00~D09)·경계성종양(D37~D48)은 일반암에서 빠져 별도 담보로 지급됩니다. 이 담보가 없으면 지급액이 0이거나 아주 작습니다.' });
    if (treatSum(state) <= 0) cps.push({ level: 'warn', title: '암 주요치료비 5종 없음', body: '표적·면역항암·방사선·비급여 치료는 진단비와 별도 축입니다. 진단비만 있으면 장기 치료에서 공백이 생깁니다. 5종(암수술·항암약물·항암방사선·중환자실·비급여)을 각각 확인하세요.' });
    else {
      if (!(Number((treatObj(state) || {}).drug) > 0)) cps.push({ level: 'info', title: '항암약물치료비 없음', body: '표적·면역항암제는 1년에 수천만원이 나가는 구간입니다. 5종 중에서 가장 먼저 채워야 하는 칸입니다.' });
      const missing = treatMissing(state);
      if (missing.length) cps.push({ level: 'info', title: `암 주요치료비 5종 중 ${missing.length}종 비어 있음`, body: `없는 항목: ${missing.join(' · ')}. 한 번에 다 채우지 말고 항암약물 → 비급여 → 수술 순으로 채웁니다.` });
    }
    if (!cov.cancer.recur) cps.push({ level: 'info', title: '재진단·전이암 보장 없음', body: '1회한 진단비는 한 번 지급되면 끝입니다. 재발·전이는 별도 담보가 있어야 다시 지급됩니다.' });

    /* 뇌 · 심장 */
    /* 뇌 · 심장 — v5.0 진단비 금액 기준 */
    const bdx = dxObj(state, 'brain'), hdx = dxObj(state, 'heart');
    const bCore = dxCoreVal(state, 'brain'), hCore = dxCoreVal(state, 'heart');
    const bNarrow = Number(bdx.stroke || 0) + Number(bdx.bleed || 0);
    const hNarrow = Number(hdx.ami || 0);
    if (bCore <= 0 && bNarrow > 0) {
      cps.push({ level: 'danger', title: '범위 공백 — 뇌혈관질환 진단비 0원', body: `뇌졸중 ${won(bdx.stroke)}만원 · 뇌출혈 ${won(bdx.bleed)}만원이 있어도 뇌혈관질환 금액이 0원입니다. 뇌경색(I63)은 뇌졸중 금액만 받고, 후유증(I69)·기타 뇌혈관질환(I67)은 한 푼도 나오지 않습니다. 권장은 뇌혈관질환 2,000만원입니다.` });
    } else if (bCore > 0 && bCore < 2000) {
      cps.push({ level: 'info', title: `뇌혈관질환 진단비 ${won(bCore)}만원 — 권장 2,000만원`, body: `최소선 1,000만원은 넘었습니다. 뇌경색 입원이 평균 62.7일·진료비 2,562만원인 구간이라 2,000만원을 기준선으로 봅니다.` });
    } else if (bCore <= 0 && bNarrow <= 0) {
      cps.push({ level: 'warn', title: '뇌 진단비 없음', body: '뇌출혈·뇌졸중·뇌혈관질환 진단비가 모두 0원입니다. 범위는 뇌혈관질환(I60~I69)부터 잡고 금액은 최소 1,000만원에서 시작합니다.' });
    }
    if (hCore <= 0 && hNarrow > 0) {
      cps.push({ level: 'danger', title: '범위 공백 — 협심증(I20) 미보장', body: `급성심근경색 ${won(hdx.ami)}만원은 있어도 허혈성심장질환 금액이 0원입니다. 협심증(I20)과 스텐트 시술이 가장 많은 구간이 비어 있고, 급성심근경색만 이 담보에서 지급됩니다. 권장은 허혈성심장질환 2,000만원입니다.` });
    } else if (hCore > 0 && hCore < 2000) {
      cps.push({ level: 'info', title: `허혈성심장질환 진단비 ${won(hCore)}만원 — 권장 2,000만원`, body: '협심증·스텐트 구간을 담보하는 핵심 칸입니다. 2,000만원을 기준선으로 보고 금액을 조정합니다.' });
    } else if (hCore <= 0 && hNarrow <= 0) {
      cps.push({ level: 'warn', title: '심장 진단비 없음', body: '급성심근경색·허혈성심장질환 진단비가 모두 0원입니다. 범위는 허혈성심장질환(I20~I25)부터 잡습니다.' });
    }

    [['brain', '뇌'], ['heart', '심장']].forEach(([key, name]) => {
      const tg = groupObj(state, key, 'treat') || {};
      const n = Number(tg.lysis || 0), s = Number(tg.surgery || 0), icu = Number(tg.icu || 0);
      if (n <= 0) cps.push({ level: 'warn', title: `${name} 혈전용해제 치료비 없음`, body: `진단비는 1회성입니다. ${name === '뇌' ? '뇌경색(I63)' : '급성심근경색(I21)'} 치료의 첫 단계인 혈전용해제(tPA) 투여는 별도 담보입니다. 기계적 혈전제거술(카테터법)은 혈전용해치료에서 제외되므로 그 담보가 있는지도 함께 확인하세요.` });
      if (s <= 0) cps.push({ level: 'warn', title: `${name} 주요치료 수술비 없음`, body: `${name === '뇌' ? '개두술(관혈)·스텐트·색전술(비관혈)' : '관상동맥우회술(관혈)·스텐트(비관혈)'}은 약관상 "수술" 분류에 따라 지급이 갈립니다. 수술비 담보를 따로 확인하세요.` });
      if (icu <= 0) cps.push({ level: 'info', title: `${name} 중환자실 입원비 없음`, body: '중환자실은 하루 비용이 일반 병실의 몇 배입니다. 입원일당과 별도로 중환자실 담보가 있는지 확인합니다.' });
      const missingN = neuroMissing(state, key);
      if (missingN.length && missingN.length < 3) cps.push({ level: 'info', title: `${name} 주요치료비 3종 중 ${missingN.length}종 비어 있음`, body: `없는 항목: ${missingN.join(' · ')}. 대부분 최초 1회한 또는 연 1회한이고, 계약일부터 1년 미만은 50%만 지급됩니다.` });
      if (n > 0 || s > 0) cps.push({ level: 'info', title: `${name} 치료비 — 지급 조건 확인`, body: '혈전용해제 치료비는 뇌경색(I63)·급성심근경색(I21) 진단이 전제이고, 기계적 혈전제거술은 별도 담보입니다. 연 1회한인지, 진단 후 10년 한도인지, 만기까지인지 증권 문구로 확인하세요.' });
    });

    /* 수술비 */
    const sg = cov.surgery;
    if (!(sg.disease > 0)) cps.push({ level: 'info', title: '질병수술비(일반·매회) 없음', body: '수술 1회당 정액으로 나오는 가장 기본 축입니다. 1~5종·N대와 별개 계약입니다.' });
    if (!(sg.disease15 > 0)) cps.push({ level: 'info', title: '질병 1~5종 수술비 없음', body: '1종(관혈)부터 5종(내시경·카테터)까지 침습도로 금액이 갈립니다. 회사별 분류표가 달라 같은 수술도 종수가 다릅니다.' });
    if (!(sg.diseaseNdae > 0)) cps.push({ level: 'info', title: '질병 N대 수술비 없음', body: '1~5종만 있으면 큰 수술에서 금액이 부족합니다. N대는 질환 묶음(21·22·30·33대 등)별 한도를 따로 둡니다. 회사별로 용종·체외충격파 포함 여부가 다릅니다.' });
    if (!(sg.diseaseNonPay > 0)) cps.push({ level: 'info', title: '비급여 질병 수술비 없음', body: '5세대 실손은 비중증 비급여 한도가 연 1,000만원·자기부담 50%입니다. 비급여 수술은 실손으로 다 메워지지 않아 정액 비급여 수술비가 보완합니다.' });
    if (!(sg.injury > 0) && !(sg.injury15 > 0)) cps.push({ level: 'warn', title: '상해 수술비 없음', body: '질병 수술비만 있으면 사고로 다쳐 수술해도 지급되지 않습니다. 일반 상해수술비와 상해 1~5종은 다른 축입니다.' });
    else if (!(sg.injury15 > 0)) cps.push({ level: 'info', title: '상해 1~5종 수술비 없음', body: '일반 상해수술비만 있으면 골절 수술 같은 중한 상해에서 금액이 얇습니다. 1~5종 축을 함께 봅니다.' });
    if (sg.disease15 > 0 || sg.diseaseNdae > 0) cps.push({ level: 'info', title: '수술비 — 1년 미만 50% 감액 확인', body: '수술비 담보는 계약일부터 1년 미만이면 50%만 지급되는 상품이 흔합니다. 가입 시점과 청구 시점을 함께 봐야 합니다.' });

    /* 간병비 */
    const cr = cov.care;
    if (!(cr.daily > 0) && !(cr.nDaily > 0)) cps.push({ level: 'warn', title: '간병비 담보 없음', body: '간병은 하루 10만~15만원, 한 달이면 300만원을 넘습니다. 진단비로 대체되지 않는 매일의 비용입니다.' });
    if (cr.daily > 0 && !(cr.nDaily > 0)) cps.push({ level: 'info', title: '요양병원 간병 일당 없음', body: '대부분 상품이 요양병원을 제외합니다. 요양병원은 통상 5~6만원대이고 별도 담보가 필요합니다. 요양병원 포함 여부를 증권에서 확인하세요.' });
    if (cr.basis === 'unknown') cps.push({ level: 'warn', title: '간병비 지급 기준 미확인', body: '2026년 7월부터 주요 손보사가 "하루 8만원 이상" 금액 기준을 "하루 8시간 이상" 시간 기준으로 전환했습니다. 8시간을 못 채우면 지급액이 깎이거나 지급되지 않습니다. 어떤 기준인지 증권으로 확인하세요.' });
    else if (cr.basis === 'money') cps.push({ level: 'info', title: '간병비 금액 기준 — 8시간 기준으로 전환되는 추세', body: '금액 기준은 7~8만원 이상 사용 시 지급입니다. 신규 가입이면 시간 기준 상품이 늘고 있어, 같은 가입금액이라도 실제 수령액이 달라집니다.' });
    if (cr.family === 'no') cps.push({ level: 'warn', title: '가족 간병 불인정', body: '가족이 간병하면 지급되지 않는 상품입니다. 실제 간병인 고용·업체 등록·결제 증빙이 필요합니다.' });
    else if (cr.family === 'conditional') cps.push({ level: 'info', title: '가족 간병 — 업체 등록·결제 조건', body: '가족 간병을 인정하려면 업체 등록과 결제, 간병일지가 서로 맞아야 합니다. 청구 때 사용계약서·영수증·근무일지를 요구받습니다. 현금으로 주고받으면 인정이 어렵습니다.' });
    if (!cr.nursing) cps.push({ level: 'info', title: '간호·간병통합서비스 미보장', body: '보호자 없는 병동은 별도 특약이 있어야 지급되는 경우가 많습니다. 간병인 사용일당과 다른 담보입니다.' });
    if (!cr.ltc) cps.push({ level: 'warn', title: '장기요양등급 보장 없음', body: '공식 통계상 장기요양 인정자의 87.4%가 3~5등급·인지지원입니다. 1~2등급만 대비하면 대부분의 구간이 비어 있습니다.' });

    /* v4: 가족력 · 고지 판정 · 계약 납입/만기 */
    familyNotes(state).forEach((f) => {
      if (f.key === 'cancer' && cov.cancer.general < (PRIORITY[0].rec[state.age] || 0)) cps.push({ level: 'warn', title: f.label, body: f.body });
      else if (f.key === 'brain' && bCore < 2000) cps.push({ level: 'warn', title: f.label, body: f.body });
      else if (f.key === 'heart' && hCore < 2000) cps.push({ level: 'warn', title: f.label, body: f.body });
      else if (f.key === 'dementia' && !cov.care.ltc) cps.push({ level: 'warn', title: f.label, body: f.body });
      else cps.push({ level: 'info', title: f.label, body: f.body });
    });
    const dj = disclosureJudge(state);
    if (dj.code !== 'standard') cps.push({ level: dj.code === 'review' ? 'danger' : 'info', title: `고지 판정 — ${dj.label}`, body: dj.advice });
    const cs = contractStats(state.contracts);
    if (cs.paidUpCount) cps.push({ level: 'info', title: `납입완료 계약 ${cs.paidUpCount}건`, body: '납입이 끝난 계약은 보험료 부담 없이 보장만 유지됩니다. 해지하지 말고 유지하면서, 아낀 보험료를 빈 칸으로 옮깁니다.' });
    if (cs.shortMaturityCount) cps.push({ level: 'warn', title: `만기 80·90세 계약 ${cs.shortMaturityCount}건`, body: '만기가 짧으면 노후에 보장이 먼저 끊깁니다. 만기 이후를 간병·요양 담보로 미리 설계합니다.' });
    if (cs.renewShare >= 60 && cs.count) cps.push({ level: 'warn', title: `갱신형 비중 ${cs.renewShare}%`, body: '보험료의 절반 이상이 갱신형이면 갱신 시점 인상 폭이 큽니다. 갱신 연령과 예상 보험료를 표로 확인합니다.' });

    if (state.flags.savings) cps.push({ level: 'info', title: '적립(저축)성 특약 확인', body: '보장 대비 저축 비중이 크면 같은 보험료로 보장을 더 넓힐 수 있습니다.' });
    if (state.flags.renew) cps.push({ level: 'warn', title: '갱신형 중심 구조', body: '갱신 시점에 보험료가 크게 오르고, 재가입 심사에서 가입이 막힐 수 있습니다. 갱신 연령과 예상 보험료를 표로 보여 주세요.' });
    if (state.flags.manyRiders) cps.push({ level: 'info', title: '특약 정리 여지', body: '중복·미사용 특약(예: 유사암 중복, 이미 소진된 1회한 담보)을 확인해 우선순위 보강에 배분합니다.' });
    if (Number(state.premium) >= 40) cps.push({ level: 'warn', title: `월 ${won(state.premium)}만원 — 구성 점검 우선`, body: '보험료 절대액이 큽니다. 해지가 아니라 배분 문제로 접근하세요.' });
    if (annual > 0 && totalSum / annual < 12) cps.push({ level: 'warn', title: '보험료 대비 진단비가 얇습니다', body: `연 보험료 ${won(annual)}만원에 주요 진단비 합계 ${won(totalSum)}만원입니다. 적립·중복을 덜어 진단비로 옮기는 재배치를 검토하세요.` });
    if (Number(state.age) >= 60 && (cr.daily || 0) < 10) cps.push({ level: 'danger', title: '60대 이상 — 간병이 최대 리스크', body: '이 연령대에서 실제로 돈이 새는 곳은 간병입니다. 장기요양등급과 간병 일당(요양병원 포함)을 함께 확인하세요.' });

    if (!cps.length) cps.push({ level: 'ok', title: '구조적 구멍 없음', body: '5대 담보와 실손 구성이 기준선을 넘습니다. 이제는 금액 조정과 갱신 대비가 남은 과제입니다.' });
    return cps;
  }

  function steps(state, rows) {
    const targets = rows.filter((x) => x.r.level !== 'ok').slice(0, 3);
    const targetText = targets.length
      ? targets.map((x) => `${x.item.name}(${Math.round(x.r.fill * 100)}%)`).join(' → ')
      : '없음 (금액 조정만)';
    return [
      { title: '유지 — 기존 핵심 사수', short: '유지', body: '지금 가진 암·뇌·심장 진단비 중 가장 두꺼운 담보는 해지하지 않습니다. 나이와 병력 때문에 같은 조건으로 다시 들 수 없습니다.' },
      { title: '조정 — 배서 다이어트', short: '조정', body: `적립(저축)성·중복·미사용 특약을 정리해 보험료를 확보합니다.${state.silson === '1' || state.silson === '2' ? ' 실손은 선택형 할인 특약과 5세대 전환을 같은 표에 놓고 비교하세요.' : ' 갱신형은 다음 갱신 시점의 예상 보험료까지 확인합니다.'}` },
      { title: '보완 — 우선순위 핀셋', short: '보완', body: `1순위부터 부족분만 채웁니다. 보강 대상: ${targetText}. 한 번에 다 하지 말고 1순위 한 칸씩, 예산 안에서 끝내세요.` }
    ];
  }

  /* ---------- 전체 모델 ---------- */
  function full(state) {
    const migration = normalizeState(state);
    const rows = PRIORITY.map((item) => {
      const r = evalItem(state, item);
      const gaps = [];
      r.parts.forEach((p) => {
        if (p.type === 'dxset') {
          const core = p.dx && p.dx.core;
          if (core && core.rec > 0 && core.val < core.rec) gaps.push({ label: core.label, val: core.val, rec: core.rec, need: core.rec - core.val, pct: Math.round(core.fill * 100), code: core.codes });
        } else if ((p.type === 'amount' || p.type === 'group') && p.rec > 0 && p.val < p.rec) {
          gaps.push({ label: p.label, val: p.val, rec: p.rec, need: p.rec - p.val, pct: Math.round(p.fill * 100) });
        }
      });
      const pct = Math.round(clamp(r.fill, 0, 1) * 100);
      return { item, r, pct, baseRec: r.baseRec, level: r.level, label: r.label, summary: summaryOf(state, item, r), gaps };
    });
    const parts = partRows(state, rows);
    const sc = computeScore(state, rows);
    const sg = state.cov.surgery;
    const totalSum = Number(state.cov.cancer.general || 0) + Number(state.cov.cancer.similar || 0) + treatSum(state)
      + dxCoreVal(state, 'brain') + dxCoreVal(state, 'heart')
      + ['disease', 'disease15', 'diseaseNdae', 'diseaseNonPay', 'injury', 'injury15'].reduce((a, k) => a + Number(sg[k] || 0), 0);
    const annual = Number(state.premium || 0) * 12;
    const cps = checkpoints(state, rows, totalSum, annual);
    const st = steps(state, rows);
    const needList = rows.filter((x) => x.r.level !== 'ok');
    const contractTotal = (state.contracts || []).reduce((a, c) => a + Number(c.premium || 0), 0);
    const cstats = contractStats(state.contracts);
    const family = familyList(state);
    const disc = disclosureJudge(state);
    const birth = (state.client && state.client.birth) || '';
    const ageDay = nextAgeDay(birth);
    const cancerRow = rows.find((x) => x.item.key === 'cancer');
    const brainRow = rows.find((x) => x.item.key === 'brain');
    const heartRow = rows.find((x) => x.item.key === 'heart');
    const cancerTreatPart = cancerRow.r.parts.find((p) => p.key === 'treatment');
    const neuroOf = (row) => {
      const g = row.r.parts.find((p) => p.key === 'treat');
      const dd = row.r.parts.find((p) => p.key === 'dx');
      return {
        subs: g.subs || [], sum: g.val, rec: g.rec, count: (g.subs || []).filter((s) => s.val > 0).length, missing: neuroMissing(state, row.item.key),
        dx: dd ? {
          subs: dd.subs || [], core: dd.dx.core, gapWarn: dd.dx.gapWarn, scenarios: dd.dx.scenarios,
          total: dd.dx.total, coreVal: dd.dx.core ? dd.dx.core.val : 0, rec: dd.rec, fill: dd.fill, pct: Math.round(dd.fill * 100)
        } : null
      };
    };
    return {
      state, rows, parts, score: sc.score, grade: sc.grade, letter: gradeLetter(sc.score),
      weights: sc.w, penalty: sc.penalty,
      counts: counts(parts, state.silson),
      totalSum, annual, premium: Number(state.premium || 0), ratio: annual > 0 ? totalSum / annual : 0,
      checkpoints: cps, steps: st, needList, first: needList[0] || null,
      contracts: state.contracts || [], contractTotal, contractStats: cstats,
      family, familyLabels: family.map((k) => FAMILY_NOTE[k].title), familyNotes: familyNotes(state),
      disclosure: disc, MATURITY,
      tiers: { cancer: PRIORITY[0].tiers, brain: PRIORITY[1].tiers, heart: PRIORITY[2].tiers, care: PRIORITY[4].tiers },
      brainTreat: { subs: (cancerTreatPart && cancerTreatPart.subs) || [], sum: treatSum(state), rec: (cancerTreatPart && cancerTreatPart.rec) || 0, count: treatCount(state), missing: treatMissing(state), legacy: state.cov.cancer.treatmentLegacy || 0 },
      neuro: { brain: neuroOf(brainRow), heart: neuroOf(heartRow) },
      dx: {
        brain: { subs: DX_SUBS.brain, values: dxObj(state, 'brain'), core: dxCoreVal(state, 'brain'), total: dxTotal(state, 'brain'), scenarios: dxScenarios(state, 'brain') },
        heart: { subs: DX_SUBS.heart, values: dxObj(state, 'heart'), core: dxCoreVal(state, 'heart'), total: dxTotal(state, 'heart'), scenarios: dxScenarios(state, 'heart') }
      },
      migration,
      client: {
        name: (state.client && state.client.name) || '홍길동',
        consultant: (state.client && state.client.consultant) || '담당 컨설턴트',
        birth,
        insuranceAge: insuranceAge(birth),
        ageDay
      },
      dateLabel: (state.client && state.client.dateLabel) || ''
    };
  }

  /* ---------- 보완 시뮬레이션 (같은 보험료 재배치·추가 보완 점수 미리보기) ----------
     boosts: { cancer: 0~100, brain: 0~100, ... } 보완 정도(%) */
  function simulate(state, boosts) {
    const clone = JSON.parse(JSON.stringify({
      age: state.age, gender: state.gender, job: state.job, silson: state.silson, premium: state.premium,
      client: state.client, contracts: state.contracts, family: state.family, disc: state.disc,
      cov: state.cov, flags: state.flags
    }));
    PRIORITY.forEach((p) => {
      const b = (boosts && boosts[p.key]) || 0;
      if (!b) return;
      const c = clone.cov[p.key] || (clone.cov[p.key] = {});
      const f = b / 100;
      p.parts.forEach((pt) => {
        if (pt.type === 'amount') {
          const rec = Math.round((p.rec[state.age] || 0) * pt.factor);
          c[pt.key] = Math.max(Number(c[pt.key] || 0), Math.round(rec * f));
        } else if (pt.type === 'bool') {
          if (b >= 60) c[pt.key] = true;
        } else if (pt.type === 'group') {
          if (!c[pt.key] || typeof c[pt.key] !== 'object') c[pt.key] = {};
          const brec = p.rec[state.age] || 0;
          (pt.subs || []).forEach((sp) => {
            const rec = subRec(brec, sp, pt);
            c[pt.key][sp.key] = Math.max(Number(c[pt.key][sp.key] || 0), Math.round(rec * f));
          });
        } else if (pt.type === 'dxset') {
          if (!c[pt.key] || typeof c[pt.key] !== 'object') c[pt.key] = {};
          (pt.subs || []).forEach((sp) => {
            const rec = Number(sp.rec) || Math.round((p.rec[state.age] || 0) * (sp.factor || 1));
            c[pt.key][sp.key] = Math.max(Number(c[pt.key][sp.key] || 0), Math.round(rec * f));
          });
        } else if (pt.type === 'scale') {
          const opts = pt.options;
          const idx = Math.min(opts.length - 1, Math.round((opts.length - 1) * f));
          const cand = opts[idx];
          const now = opts.find((o) => o.v === c[pt.key]);
          if (!now || cand.score > now.score) c[pt.key] = cand.v;
        }
      });
    });
    return full(clone);
  }


  function oneLine(state, m) {
    if (!m.needList.length) return '5대 담보가 기준선을 넘었습니다. 금액 조정과 갱신 대비가 남은 과제입니다.';
    const x = m.needList[0];
    return `${x.item.name} ${x.pct}% — ${x.label}. ${x.gaps.length ? `${x.gaps[0].label} ${won(x.gaps[0].need)}만원 부족.` : '세부 담보 점검이 필요합니다.'}`;
  }

  root.BojangModel = {
    won, clamp, evalItem, summaryOf, weights, computeScore, gradeLetter,
    parseDate, insuranceAge, nextAgeDay, ageBandFromBirth,
    partRows, counts, checkpoints, steps, full, oneLine, LEVEL_LABEL,
    FAMILY_KEYS, FAMILY_NOTE, familyList, familyNotes, disclosureJudge, contractStats, MATURITY,
    TREAT_SUBS, NEURO_SUBS, TREAT_MIN, TREAT_MAX, NEURO_MIN, NEURO_MAX,
    treatRec, treatRecs, subRec, emptyTreat, emptyNeuro, treatObj, treatSum, treatCount, treatMissing,
    neuroSum, neuroCount, neuroMissing, groupObj, groupSum, normalizeState, normalizeCov, stageOf, partLevel,
    dxObj, dxTotal, dxCoreVal, dxScenarios, dxShort, DX_SUBS, DX_MAX, simulate
  };
})(typeof window !== 'undefined' ? window : globalThis);
