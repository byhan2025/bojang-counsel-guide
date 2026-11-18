/* 보장분석 상담 가이드 v7.5 — 터치 우선순위 엔진 (priority.js)

   이 앱의 최대 역할은 "이 고객을 어떤 순서로, 어떤 방식으로 터치할지"를 계산해 주는 것입니다.
   30장 플랜북의 담보 챕터 순서·지면 깊이·터치 방식 배지·예상 반론이 모두 이 엔진에서 나옵니다.

   점수식 (v7.5 확정값 — 김대표 판정 반영)
     score(d) = (1 − 충족도)^1.15 × 상담가중 × 시급가중 × 실효가중 × 난이도가중
     · 암 기본가중 1.35 (1.20 → 상향, 암을 먼저 확인할 항목으로 세우는 현역 감각)
     · 심장 '남 45~59세' 가산 0.05 (0.15 → 하향)
     · 범위 공백 계수 1.15 (1.30 → 하향)

   충족도 95% 이상은 HOLD(유지·조건 확인)로 내리고, 남는 지면을 1순위로 올립니다.
   총 30장은 어떤 경우에도 고정입니다(12장 고정 + 18장 담보 챕터).

   ★ 안전선 (회의실 4호 봇 검수 반영)
   · 이 점수는 "질병에 걸릴 확률"이나 "지급 가능성"이 아닙니다. 상담을 어디서부터 시작할지 정하는
     **기본 상담 우선순위**일 뿐이고, 표기는 항상 "먼저 확인할 항목"으로 합니다.
   · 성별·연령대 값은 인구통계적 질병위험 주장이 아니라, 현장 상담에서 먼저 확인해 온 순서를
     담은 사전 설정 상담가중치입니다. 문서에 "40대 남성은 암 위험이 높다" 같은 문장은 쓰지 않습니다.
   · 고객이 먼저 꺼낸 걱정·청구 질문과 실제 증권 공백에 따라 설계사가 순서를 조정합니다.
   · 보장·지급 여부를 판정하지 않고, 약관·계약자료를 함께 확인할 후보를 정리합니다(금소법 안전선).
   ========================================================= */
(function (root) {
  'use strict';

  const NOTE = '기본 상담 우선순위입니다. 고객이 먼저 꺼낸 걱정·청구 질문과 실제 증권 공백에 따라 설계사가 순서를 조정합니다. 보장·지급 여부를 판정하지 않고 약관·계약자료를 함께 확인할 후보를 정리한 것입니다.';
  const HOLD_AT = 0.95;          /* 충족도 95% 이상 → HOLD */
  const GAP_POW = 1.15;          /* 범위 공백 계수(충족도 지수) */
  const TOTAL_CHAPTER_PAGES = 18; /* 뒤 18장 고정 */

  /* 표 1. 상담가중 기본값 + 가산 (질병위험·지급가능성 점수가 아닙니다) */
  const RISK = {
    cancer: { base: 1.35, add: { family: 0.10, female: 0.05, age50: 0.05 } },
    brain: { base: 1.00, add: { family: 0.20, age60: 0.10 } },
    heart: { base: 1.00, add: { family: 0.20, male45to59: 0.05 } },
    surgery: { base: 0.55, add: {} },
    care: { base: 0.75, add: { age60: 0.25 } }
  };

  const NAME = { cancer: '암', brain: '뇌', heart: '심장', surgery: '수술비', care: '간병비' };
  const ORDER = ['cancer', 'brain', 'heart', 'surgery', 'care'];

  /* ---------- 입력 추출 ---------- */
  const num = (v) => (Number(v) || 0);
  const ageNum = (st) => {
    const a = Number(String((st && st.age) || '').replace(/[^0-9]/g, ''));
    return a || 0;
  };
  const rowOf = (m, key) => (m.rows || []).find((r) => r.item && r.item.key === key) || null;
  const fillOf = (m, key) => {
    const r = rowOf(m, key);
    return r ? Math.max(0, Math.min(1, Number(r.r && r.r.fill) || 0)) : 0;
  };
  function anyDisc(st) {
    const d = (st && st.disc) || {};
    return !!(d.hospitalization || d.surgery || d.medication || d.outpatient || d.exam);
  }
  function premiumShare(st) {
    /* 계약별 보험료 합계 대비 특정 계약 비중이 필요한 경우 사용 (현재는 재원 판단에만) */
    const cs = (st && st.contracts) || [];
    const tot = cs.reduce((a, c) => a + num(c.premium), 0);
    return tot > 0 ? tot / Math.max(1, num(st.premium)) : 0;
  }

  /* ---------- 계수 ---------- */
  function riskOf(key, m) {
    const st = m.state || {};
    const age = ageNum(st);
    const fam = (m.family || []).slice();
    const R = RISK[key] || { base: 1, add: {} };
    let v = R.base;
    const why = [];
    if (key === 'cancer') {
      if (fam.indexOf('cancer') >= 0) { v += R.add.family; why.push(`가족력 가산 +${R.add.family.toFixed(2)}`); }
      if (st.gender === '여') { v += R.add.female; why.push(`성별 가산 +${R.add.female.toFixed(2)}`); }
      if (age >= 50) { v += R.add.age50; why.push(`연령대 가산 +${R.add.age50.toFixed(2)}`); }
    } else if (key === 'brain') {
      if (fam.indexOf('brain') >= 0) { v += R.add.family; why.push(`가족력 가산 +${R.add.family.toFixed(2)}`); }
      if (age >= 60) { v += R.add.age60; why.push(`연령대 가산 +${R.add.age60.toFixed(2)}`); }
    } else if (key === 'heart') {
      if (fam.indexOf('heart') >= 0) { v += R.add.family; why.push(`가족력 가산 +${R.add.family.toFixed(2)}`); }
      if (st.gender === '남' && age >= 45 && age <= 59) { v += R.add.male45to59; why.push(`연령·성별 가산 +${R.add.male45to59.toFixed(2)}`); }
    } else if (key === 'care') {
      if (age >= 60) { v += R.add.age60; why.push(`연령대 가산 +${R.add.age60.toFixed(2)}`); }
    }
    return { value: Math.round(v * 100) / 100, why, base: R.base };
  }

  function urgencyOf(m) {
    const d = (m.client && m.client.ageDay) || null;
    const days = d && Number.isFinite(Number(d.days)) ? Number(d.days) : null;
    if (days != null && days >= 0 && days <= 30) return { value: 1.15, why: `상령일 D-${days}` };
    if (days != null && days >= 0 && days <= 90) return { value: 1.08, why: `상령일 D-${days}` };
    if (anyDisc(m.state)) return { value: 1.25, why: '최근 3개월 고지 대상' };
    return { value: 1, why: '' };
  }

  function rangeGap(m, key) {
    if (key !== 'brain' && key !== 'heart') return false;
    const r = rowOf(m, key);
    const p = r && r.r && (r.r.parts || []).find((x) => x.key === 'dx');
    const core = p && p.dx && p.dx.core;
    if (!core) return false;
    const subs = (p.dx.subs || []).filter((s) => num(s.val) > 0);
    return num(core.val) === 0 && subs.length > 0;
  }

  function effectOf(key, m) {
    const st = m.state || {};
    const why = [];
    let v = 1;
    if (rangeGap(m, key)) { v *= GAP_POW; why.push(`핵심 범위 공백 ×${GAP_POW}`); }
    if (key === 'surgery') {
      if (st.silson === '4' || st.silson === '5') { v *= 0.80; why.push(`실손 ${st.silson}세대 ×0.80`); }
      if (st.silson === 'none') { v *= 1.10; why.push('실손 없음 ×1.10'); }
    }
    /* 1회한 중복 — 같은 담보 상품이 2건 이상이면 재지급이 없어 실효가 떨어집니다 */
    if (key === 'cancer') {
      const cs = (st.contracts || []).filter((c) => /암/.test(String(c.product || '')));
      if (cs.length >= 2) { v *= 0.90; why.push(`암 계약 ${cs.length}건 중복 ×0.90`); }
    }
    return { value: Math.round(v * 100) / 100, why };
  }

  function difficultyOf(key, m) {
    const f = fillOf(m, key);
    let v = 1, why = '';
    if (f > 0.05) { v = 1.10; why = '기존 담보 범위·금액 조정(추가 계약 없이 가능)'; }
    else { v = 0.95; why = '신규 계약 필요'; }
    return { value: v, why };
  }

  /* ---------- 점수 ---------- */
  function score(m) {
    const urg = urgencyOf(m);
    const out = ORDER.map((key) => {
      const fill = fillOf(m, key);
      const gap = Math.max(0.0001, 1 - fill);
      const risk = riskOf(key, m);
      const eff = effectOf(key, m);
      const dif = difficultyOf(key, m);
      const base = Math.pow(gap, GAP_POW);
      const value = Math.round(base * risk.value * urg.value * eff.value * dif.value * 1000) / 1000;
      const row = rowOf(m, key);
      return {
        key, name: NAME[key], fill,
        pct: Math.round(fill * 100),
        gap, risk, urgency: urg, effect: eff, difficulty: dif,
        base: Math.round(base * 1000) / 1000,
        score: value,
        hold: fill >= HOLD_AT,
        gaps: (row && row.gaps) || [],
        row
      };
    });
    const ranked = out.slice().sort((a, b) => b.score - a.score);
    ranked.forEach((x, i) => { x.order = i + 1; });
    return ranked;
  }

  /* ---------- 터치 방식 결정 트리 ---------- */
  const TOUCH = {
    range: { code: '범위형', label: '코드 밴드 + 지급 시나리오', color: 'blue' },
    money: { code: '금액형', label: '실제 진료비 + 소득 공백', color: 'red' },
    remodel: { code: '재배치형', label: '리모델링 워터폴', color: 'orange' },
    system: { code: '제도형', label: '장기요양·상한제 연결', color: 'mint' },
    timing: { code: '시점형', label: '상령일 D-day·인수 조건', color: 'navy' },
    check: { code: '확인형', label: '증권 재확인 3줄', color: 'gray' }
  };
  function touchType(key, m, entry) {
    const st = m.state || {};
    const flags = st.flags || {};
    const fill = entry ? entry.fill : fillOf(m, key);
    /* 터치 방식 결정 트리 — 담보 성격이 먼저, 그 다음 금액 공백, 그 다음 재원 구조 */
    if (key === 'care') return { type: 'system', ...TOUCH.system };
    if (rangeGap(m, key)) return { type: 'range', ...TOUCH.range };
    if (fill < 0.5) return { type: 'money', ...TOUCH.money };
    if (flags.savings || flags.manyRiders) return { type: 'remodel', ...TOUCH.remodel };
    const days = m.client && m.client.ageDay ? Number(m.client.ageDay.days) : null;
    if (days != null && days >= 0 && days <= 30) return { type: 'timing', ...TOUCH.timing };
    return { type: 'check', ...TOUCH.check };
  }

  /* ---------- 예상 반론 지도 (한대리 명세 15훅 중 이 담보 관련 3개) ---------- */
  const OBJ_BY_KEY = {
    cancer: ['cancer-have', 'thyroid', 'metastasis'],
    brain: ['stroke-name', 'brain-survive', 'disclose'],
    heart: ['heart-sudden', 'stent', 'timebar'],
    surgery: ['surgery-silson', 'surgery-count', 'job-class'],
    care: ['family-care', 'silson', 'switch5']
  };
  function objectionsFor(key, m) {
    const st = m.state || {};
    const out = (OBJ_BY_KEY[key] || ['silson', 'premium', 'later']).slice(0, 3);
    if (num(st.premium) >= 25 && out.indexOf('premium') < 0) out[out.length - 1] = 'premium';
    return out;
  }

  /* ---------- 지면 배분 ---------- */
  function allocation(m) {
    const sc = score(m);
    const holds = sc.filter((x) => x.hold);
    const act = sc.filter((x) => !x.hold);
    const pages = {};
    sc.forEach((x) => { pages[x.key] = x.hold ? 1 : 3; });
    const base = [5, 4, 3, 3, 3];
    act.forEach((x, i) => { pages[x.key] = base[Math.min(i, 4)]; });
    let total = sc.reduce((a, x) => a + pages[x.key], 0);
    const caps = [7, 5, 5, 4, 4];
    let guard = 0;
    while (total < TOTAL_CHAPTER_PAGES && guard++ < 40) {
      let moved = false;
      for (let i = 0; i < act.length && total < TOTAL_CHAPTER_PAGES; i++) {
        const cap = caps[Math.min(i, caps.length - 1)];
        if (pages[act[i].key] < cap) { pages[act[i].key] += 1; total += 1; moved = true; }
      }
      if (!moved) break;
    }
    const appendix = Math.max(0, TOTAL_CHAPTER_PAGES - total);
    const allHold = holds.length === sc.length;
    const order = sc.map((x) => ({ ...x, pages: pages[x.key], touch: touchType(x.key, m, x), objections: objectionsFor(x.key, m) }));
    return {
      scored: sc, order,
      first: order.find((x) => !x.hold) || null,
      second: order.filter((x) => !x.hold)[1] || null,
      holds: order.filter((x) => x.hold),
      pages, appendix, allHold,
      totalChapterPages: total + appendix,
      fixedPages: 12
    };
  }

  /* ---------- 카드 문장 ---------- */
  function firstGapLine(entry) {
    if (!entry) return '전 항목 기준선 이상 — 금액 조정과 갱신 대비가 남은 과제입니다.';
    const g = entry.gaps[0];
    return g ? `${g.label} ${Math.round(num(g.val))}만원 → 기준 ${Math.round(num(g.rec))}만원 (${Math.round(num(g.need))}만원 부족)`
      : `${entry.name} 금액은 기준선 이상 — 지급 조건(코드·횟수) 확인 단계`;
  }
  function reasonLines(entry) {
    const out = [];
    if (!entry) return out;
    out.push(`충족도 ${entry.pct}% → 공백 ${Math.round(entry.gap * 100)}% (^${GAP_POW} = ${entry.base})`);
    out.push(`상담가중 ×${entry.risk.value}${entry.risk.why.length ? ` (${entry.risk.why.join(' · ')})` : ''}`);
    out.push(`시급 ×${entry.urgency.value}${entry.urgency.why ? ` (${entry.urgency.why})` : ''}`);
    if (entry.effect.why.length) out.push(`실효 ×${entry.effect.value} (${entry.effect.why.join(' · ')})`);
    out.push(`난이도 ×${entry.difficulty.value} (${entry.difficulty.why})`);
    return out;
  }

  root.BojangPriority = {
    NOTE, HOLD_AT, GAP_POW, RISK, TOUCH, NAME, ORDER,
    score, allocation, touchType, objectionsFor, firstGapLine, reasonLines,
    fillOf, rowOf, rangeGap, anyDisc
  };
})(typeof window !== 'undefined' ? window : globalThis);
