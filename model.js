/* 보장분석 상담 가이드 — 공용 진단 모델 (v4.1)
   화면·라이브 상담·고객 30장 슬라이드·PDF 리포트가 모두 이 계산 하나를 씁니다.
   v4 추가: 가족력 · 간편고지 판정 · 계약 납입상태/만기 집계.
   v4.1 추가: 암 주요치료비 5종(암수술·항암약물·항암방사선·중환자실·비급여) 세분화.
   모든 점수·권장선은 상담 보조용 자체 산식이며 보험사 기준이 아닙니다. */
(function (root) {
  'use strict';

  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  /* ---------- 암 주요치료비 5종 ---------- */
  const TREAT_SUBS = (typeof CANCER_TREAT_SUBS !== 'undefined' && CANCER_TREAT_SUBS.length)
    ? CANCER_TREAT_SUBS
    : [
      { key: 'surgery', label: '암수술비', hint: '수술 1회당', factor: 0.20 },
      { key: 'drug', label: '항암약물치료비', hint: '표적·면역항암', factor: 0.30 },
      { key: 'radio', label: '항암방사선치료비', hint: '방사선 치료', factor: 0.12 },
      { key: 'icu', label: '중환자실 입원', hint: '암 치료 중 중환자실', factor: 0.10 },
      { key: 'extra', label: '비급여 추가 치료비', hint: '비급여 주사·검사', factor: 0.18 }
    ];
  const TREAT_MIN = 500, TREAT_MAX = 3000;
  const CANCER_ITEM = () => PRIORITY[0];

  /* 세부 1종의 권장 금액(만원) — 500~3,000만원, 100만원 단위 */
  function treatRec(baseRec, sub) {
    const f = (sub && sub.factor) || 0;
    const raw = Math.round(((Number(baseRec) || 0) * f) / 100) * 100;
    return clamp(raw, TREAT_MIN, TREAT_MAX);
  }
  function treatRecs(baseRec) {
    return TREAT_SUBS.map((s) => treatRec(baseRec, s));
  }
  function emptyTreat() {
    const o = {};
    TREAT_SUBS.forEach((s) => { o[s.key] = 0; });
    return o;
  }
  function treatObj(cov) {
    const t = cov && cov.cancer && cov.cancer.treatment;
    return (t && typeof t === 'object') ? t : null;
  }
  /* 세부 값이 아직 숫자(구버전 단일 항목)여도 합계는 읽힙니다 */
  function treatSum(state) {
    const t = state && state.cov && state.cov.cancer ? state.cov.cancer.treatment : 0;
    if (t && typeof t === 'object') return TREAT_SUBS.reduce((a, s) => a + Number(t[s.key] || 0), 0);
    return Number(t || 0) || 0;
  }
  function treatCount(state) {
    const t = treatObj(state && state.cov);
    if (!t) return treatSum(state) > 0 ? 1 : 0;
    return TREAT_SUBS.filter((s) => Number(t[s.key] || 0) > 0).length;
  }
  function treatMissing(state) {
    const t = treatObj(state && state.cov) || {};
    return TREAT_SUBS.filter((s) => !(Number(t[s.key] || 0) > 0)).map((s) => s.label);
  }

  /* 구버전 단일 숫자(cov.cancer.treatment) → 5종으로 분배 (권장 비중대로, 합계 보존) */
  function normalizeCov(state) {
    if (!state || !state.cov || !state.cov.cancer) return { migrated: false };
    const c = state.cov.cancer;
    const t = c.treatment;
    if (t && typeof t === 'object') {
      TREAT_SUBS.forEach((s) => { if (typeof t[s.key] !== 'number') t[s.key] = Number(t[s.key] || 0) || 0; });
      return { migrated: false };
    }
    const legacy = Number(t || 0) || 0;
    const recs = treatRecs(CANCER_ITEM().rec[state.age] || 0);
    const recSum = recs.reduce((a, b) => a + b, 0) || 1;
    const out = emptyTreat();
    TREAT_SUBS.forEach((s, i) => {
      out[s.key] = legacy > 0 ? Math.round((legacy * recs[i]) / recSum / 10) * 10 : 0;
    });
    c.treatment = out;
    if (legacy > 0) c.treatmentLegacy = legacy;
    return { migrated: true, legacy };
  }

  function getVal(state, item, part) {
    const c = state.cov && state.cov[item.key];
    return c ? c[part.key] : undefined;
  }

  /* ---------- 담보 1개 평가 ---------- */
  function evalItem(state, item) {
    const baseRec = item.rec[state.age] || 0;
    const parts = item.parts.map((p) => {
      let fill = 0, rec = 0, val = 0, option = null, subs = null;
      if (p.type === 'amount') {
        rec = Math.round(baseRec * p.factor);
        val = Number(getVal(state, item, p) || 0);
        fill = rec > 0 ? clamp(val / rec, 0, 1) : 0;
      } else if (p.type === 'group') {
        /* 5종 세분화 — 세부별 권장 대비 충족도(권장 비중 가중) */
        const raw = getVal(state, item, p);
        const src = (raw && typeof raw === 'object') ? raw : {};
        const list = (p.subs || TREAT_SUBS);
        subs = list.map((sp) => {
          const srec = treatRec(baseRec, sp);
          const sval = Number(src[sp.key] || 0) || 0;
          const sfill = srec > 0 ? clamp(sval / srec, 0, 1) : 0;
          return {
            key: sp.key, label: sp.label, hint: sp.hint, rec: srec, val: sval, fill: sfill,
            pct: Math.round(sfill * 100), level: partLevel(sfill, sval), part: sp
          };
        });
        rec = subs.reduce((a, s) => a + s.rec, 0);
        val = subs.reduce((a, s) => a + s.val, 0);
        fill = rec > 0 ? subs.reduce((a, s) => a + Math.min(s.val, s.rec), 0) / rec : 0;
      } else if (p.type === 'scale') {
        const v = getVal(state, item, p) || 'none';
        option = p.options.find((o) => o.v === v) || p.options[0];
        fill = option.score;
      } else {
        val = !!getVal(state, item, p);
        fill = val ? 1 : 0;
      }
      return { key: p.key, label: p.label, type: p.type, weight: p.weight, fill, rec, val, option, part: p, subs };
    });
    const fill = parts.reduce((a, p) => a + p.weight * p.fill, 0);
    const primary = parts[0].fill;
    let level, label;
    if (primary <= 0) { level = 'gap'; label = '공백 위험'; }
    else if (fill >= 0.9) { level = 'ok'; label = '적정'; }
    else { level = 'need'; label = '보강 필요'; }
    return { item, baseRec, parts, fill, level, label, primary };
  }

  /* ---------- 보장 요약 문장 ---------- */
  function summaryOf(state, item, r) {
    const c = state.cov[item.key] || {};
    if (item.key === 'cancer') {
      const bits = [`일반암 ${won(c.general)}만원`];
      bits.push(c.similar > 0 ? `유사암 ${won(c.similar)}만원` : '유사암 없음');
      const ts = treatSum(state), tc = treatCount(state);
      bits.push(ts > 0 ? `치료비 5종 ${won(ts)}만원 ${tc}/5` : '치료비 5종 없음');
      if (c.recur) bits.push('재진단 보장');
      return bits.join(' · ');
    }
    if (item.key === 'brain' || item.key === 'heart') {
      const p = r.parts[0];
      const opt = p.option || { label: '미보유' };
      const extra = state.cov[item.key][item.key === 'brain' ? 'treat' : 'surgery'];
      return `${opt.label}${opt.hint ? ' (' + opt.hint + ')' : ''}` + (extra ? ' · 수술·치료비 보유' : ' · 수술·치료비 없음');
    }
    if (item.key === 'surgery') {
      const bits = [`질병 5종 ${won(c.disease)}만원`];
      bits.push(c.nDae ? 'N대 보유' : 'N대 없음');
      if (c.injury) bits.push('상해 보유');
      return bits.join(' · ');
    }
    const bits = [`일당 ${won(c.daily)}만원`, c.mode === 'step' ? '체증형' : '일반형'];
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
    if (state.flags.renew) { score += SCORE_MODEL.penalty.renew; penalty.push({ v: SCORE_MODEL.penalty.renew, t: '갱신형 중심' }); }
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

  function partLevel(fill, val) {
    if (fill >= 0.999) return 'enough';
    if (fill >= 0.6) return 'check';
    if (fill > 0 || val) return 'short';
    return 'none';
  }

  function partRows(state, rows) {
    const out = [];
    rows.forEach(({ item, r }) => {
      r.parts.forEach((p) => {
        out.push({
          itemKey: item.key, itemName: item.name, rank: item.rank,
          key: p.key, label: p.label, type: p.type,
          fill: p.fill, pct: Math.round(p.fill * 100),
          val: p.val, rec: p.rec, option: p.option,
          subs: p.subs ? p.subs.map((s) => ({ label: s.label, key: s.key, val: s.val, rec: s.rec, fill: s.fill, pct: s.pct, level: s.level })) : null,
          level: partLevel(p.fill, p.val),
          text: p.type === 'amount' ? `${won(p.val)}만원 / ${won(p.rec)}만원`
            : p.type === 'group' ? `5종 합계 ${won(p.val)}만원 / ${won(p.rec)}만원`
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
    const f = (state.family || []).filter((k) => FAMILY_KEYS.indexOf(k) >= 0);
    return f;
  }

  function familyNotes(state) {
    const keys = familyList(state);
    return keys.map((k) => ({ key: k, label: FAMILY_NOTE[k].title, body: FAMILY_NOTE[k].body }));
  }

  /* ---------- 간편 고지(알릴 의무) 판정 ---------- */
  /* 기준: 간편심사는 3개월(입원·수술·추가검사 소견) / N년(입원·수술) / 5년(암 등 중대질병) 구조.
     3·5·5는 N=5(질문 넓음·경할증), 3·2·5는 N=2(질문 좁음·중할증). 상품별 청약서 문항이 최종 기준입니다. */
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
    if (state.silson === 'none') {
      cps.push({ level: 'danger', title: '실손 공백', body: '입원·통원 기본부터 막혀 있습니다. 진단비보다 실손이 먼저입니다.' });
    } else if (state.silson === '1' || state.silson === '2') {
      cps.push({ level: 'info', title: '실손 1·2세대 — 보험료를 줄일 두 갈래', body: '2026년 11월부터 ①선택형 할인 특약(30~40% 할인) ②5세대 전환(3년간 50% 추가 할인, 6개월 한시) 중 선택할 수 있습니다. 5세대는 비중증 비급여 한도 1,000만원·자기부담 50%로 줄고 5년 재가입이 생깁니다.' });
    } else if (state.silson === '3' || state.silson === '4') {
      cps.push({ level: 'ok', title: `실손 ${state.silson}세대 — 유지 판단`, body: '비급여 한도·자기부담 구조가 5세대보다 넓습니다. 의료 이용이 적다면 보험료 차이를 비교해 볼 수 있지만 서두를 이유는 없습니다.' });
    } else {
      cps.push({ level: 'ok', title: '실손 5세대 — 구조 확인', body: '중증(특약1)과 비중증(특약2)이 분리돼 있습니다. 특약2는 연 1,000만원·자기부담 50%이므로 도수·비급여 주사는 사실상 자기부담입니다.' });
    }

    const get = (k) => rows.find((x) => x.item.key === k);
    const care = get('care');

    if (state.cov.cancer.similar <= 0) cps.push({ level: 'warn', title: '유사암 담보 없음', body: '갑상선암(C73)·기타피부암(C44)·제자리암(D00~D09)·경계성종양(D37~D48)은 일반암에서 빠져 별도 담보로 지급됩니다. 이 담보가 없으면 지급액이 0이거나 아주 작습니다.' });
    if (treatSum(state) <= 0) cps.push({ level: 'warn', title: '암 주요치료비 5종 없음', body: '표적·면역항암·방사선·비급여 치료는 진단비와 별도 축입니다. 진단비만 있으면 장기 치료에서 공백이 생깁니다. 5종(암수술·항암약물·항암방사선·중환자실·비급여)을 각각 확인하세요.' });
    else {
      if (!(Number(treatObj(state.cov) ? treatObj(state.cov).drug : 0) > 0)) cps.push({ level: 'info', title: '항암약물치료비 없음', body: '표적·면역항암제는 1년에 수천만원이 나가는 구간입니다. 5종 중에서 가장 먼저 채워야 하는 칸입니다.' });
      const missing = treatMissing(state);
      if (missing.length) cps.push({ level: 'info', title: `암 주요치료비 5종 중 ${missing.length}종 비어 있음`, body: `없는 항목: ${missing.join(' · ')}. 한 번에 다 채우지 말고 항암약물 → 비급여 → 수술 순으로 채웁니다.` });
    }
    if (state.cov.brain.scope === 'bleed') cps.push({ level: 'danger', title: '뇌 보장이 뇌출혈에 갇혀 있습니다', body: '뇌경색(I63)은 뇌졸중·뇌혈관질환 담보에만 들어갑니다. 공식 통계에서도 뇌경색 환자가 뇌내출혈보다 약 5.1배 많습니다.' });
    else if (state.cov.brain.scope === 'stroke' || state.cov.brain.scope === 'vascular') {
      if (!state.cov.brain.treat) cps.push({ level: 'warn', title: '뇌혈관 수술·혈전용해치료비 없음', body: '혈전용해술·스텐트는 약관상 "수술"이 아닌 처치로 분류될 수 있어, 진단비 외 치료비 담보가 따로 필요합니다.' });
    }
    if (state.cov.heart.scope === 'mi') cps.push({ level: 'danger', title: '심장이 급성심근경색에 갇혀 있습니다', body: '협심증(I20)은 허혈성심장질환(I20~I25) 담보에만 들어갑니다. 스텐트 시술은 협심증 단계에서 많이 이뤄집니다.' });
    if (state.cov.heart.scope !== 'none' && !state.cov.heart.surgery) cps.push({ level: 'warn', title: '심혈관 수술비 없음', body: '스텐트·관상동맥우회술 등 심혈관 수술비 담보가 따로 있는지 확인하세요.' });
    if (!state.cov.surgery.nDae) cps.push({ level: 'info', title: 'N대 수술비 없음', body: '1~5종만 있으면 큰 수술에서 금액이 부족합니다. N대 수술비는 질환별 한도를 따로 둡니다.' });
    if (!state.cov.surgery.injury) cps.push({ level: 'info', title: '상해수술비 없음', body: '질병 수술비만 있으면 사고로 다쳐 수술해도 지급되지 않습니다.' });
    if (!state.cov.care.ltc) cps.push({ level: 'warn', title: '장기요양등급 보장 없음', body: '공식 통계상 장기요양 인정자의 87.4%가 3~5등급·인지지원입니다. 1~2등급만 대비하면 대부분의 구간이 비어 있습니다.' });
    if (!state.cov.care.nursing) cps.push({ level: 'info', title: '간호간병통합서비스 미보장', body: '보호자 없는 병동은 별도 특약이 있어야 지급되는 경우가 많습니다.' });

    /* v4: 가족력 · 고지 판정 · 계약 납입/만기 */
    familyNotes(state).forEach((f) => {
      if (f.key === 'cancer' && state.cov.cancer.general < (PRIORITY[0].rec[state.age] || 0)) cps.push({ level: 'warn', title: f.label, body: f.body });
      else if (f.key === 'brain' && state.cov.brain.scope !== 'vascular') cps.push({ level: 'warn', title: f.label, body: f.body });
      else if (f.key === 'heart' && state.cov.heart.scope !== 'ischemic' && state.cov.heart.scope !== 'cardiac') cps.push({ level: 'warn', title: f.label, body: f.body });
      else if (f.key === 'dementia' && !state.cov.care.ltc) cps.push({ level: 'warn', title: f.label, body: f.body });
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
    if (Number(state.age) >= 60 && care && care.r.level !== 'ok') cps.push({ level: 'danger', title: '60대 이상 — 간병이 최대 리스크', body: '이 연령대에서 실제로 돈이 새는 곳은 간병입니다. 장기요양등급과 간병 일당을 함께 확인하세요.' });

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
    normalizeCov(state);
    const rows = PRIORITY.map((item) => {
      const r = evalItem(state, item);
      const gaps = r.parts.filter((p) => (p.type === 'amount' || p.type === 'group') && p.rec > 0 && p.val < p.rec)
        .map((p) => ({ label: p.label, val: p.val, rec: p.rec, need: p.rec - p.val, pct: Math.round(p.fill * 100) }));
      const pct = Math.round(clamp(r.fill, 0, 1) * 100);
      return { item, r, pct, baseRec: r.baseRec, level: r.level, label: r.label, summary: summaryOf(state, item, r), gaps };
    });
    const parts = partRows(state, rows);
    const sc = computeScore(state, rows);
    const totalSum = Number(state.cov.cancer.general || 0) + Number(state.cov.cancer.similar || 0)
      + treatSum(state) + Number(state.cov.surgery.disease || 0);
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
    return {
      state, rows, parts, score: sc.score, grade: sc.grade, letter: gradeLetter(sc.score),
      weights: sc.w, penalty: sc.penalty,
      counts: counts(parts, state.silson),
      totalSum, annual, premium: Number(state.premium || 0), ratio: annual > 0 ? totalSum / annual : 0,
      checkpoints: cps, steps: st, needList, first: needList[0] || null,
      contracts: state.contracts || [], contractTotal, contractStats: cstats,
      family, familyLabels: family.map((k) => FAMILY_NOTE[k].title), familyNotes: familyNotes(state),
      disclosure: disc, MATURITY,
      cancerTreat: { subs: (rows[0].r.parts[2].subs || []), sum: treatSum(state), count: treatCount(state), missing: treatMissing(state), legacy: state.cov.cancer.treatmentLegacy || 0 },
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

  /* 간단 요약 문장 (카톡·라이브 공용) */
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
    TREAT_SUBS, TREAT_MIN, TREAT_MAX, treatRec, treatRecs, emptyTreat, treatObj, treatSum, treatCount, treatMissing, normalizeCov
  };
})(typeof window !== 'undefined' ? window : globalThis);
