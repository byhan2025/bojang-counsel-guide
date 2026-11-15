/* 보장분석 상담 가이드 — 화면 로직 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const HKEY = 'bojang.history.v1';
  const VKEY = 'bojang.viewmode.v1';

  const state = {
    age: '40',
    gender: '여',
    job: '1',
    silson: '4',
    premium: 22,
    cov: { cancer: 3000, brain: 2000, heart: 0, surgery: 300, care: 10 },
    flags: { nDae: false, longTerm: false, savings: false, renew: true, manyRiders: false },
    guide: 'cancer',
    view: 'advisor',
    analyzed: false,
    label: '',
    history: []
  };

  /* ================= 유틸 ================= */
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* ================= 세그먼트 ================= */
  function buildSeg(el, items, current, onPick) {
    el.innerHTML = '';
    items.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn' + (String(it.value) === String(current) ? ' is-on' : '');
      b.dataset.value = it.value;
      b.textContent = it.label;
      b.setAttribute('aria-pressed', String(it.value) === String(current));
      b.addEventListener('click', () => {
        $$('.seg-btn', el).forEach((x) => {
          x.classList.remove('is-on');
          x.setAttribute('aria-pressed', 'false');
        });
        b.classList.add('is-on');
        b.setAttribute('aria-pressed', 'true');
        onPick(it.value);
      });
      el.appendChild(b);
    });
  }

  function renderSegments() {
    buildSeg($('#seg-age'), AGES.map((a) => ({ value: a, label: a + '대' })), state.age, (v) => {
      state.age = v;
      renderCoverageInputs();
      if (state.analyzed) analyze();
    });
    buildSeg($('#seg-gender'), [{ value: '남', label: '남성' }, { value: '여', label: '여성' }], state.gender, (v) => {
      state.gender = v;
      if (state.analyzed) analyze();
    });
    buildSeg($('#seg-job'), [
      { value: '1', label: '1급' }, { value: '2', label: '2급' }, { value: '3', label: '3급' }
    ], state.job, (v) => {
      state.job = v;
      $('#job-hint').textContent = JOB_HINTS[v];
      if (state.analyzed) analyze();
    });
    buildSeg($('#seg-silson'), [
      { value: 'none', label: '없음' }, { value: '1', label: '1세대' }, { value: '2', label: '2세대' },
      { value: '3', label: '3세대' }, { value: '4', label: '4세대' }, { value: '5', label: '5세대' }
    ], state.silson, (v) => {
      state.silson = v;
      if (state.analyzed) analyze();
    });
    $('#job-hint').textContent = JOB_HINTS[state.job];
    $('#premium').value = state.premium;
  }

  /* ================= 담보 입력 ================= */
  function renderCoverageInputs() {
    const host = $('#coverage-inputs');
    host.innerHTML = '';
    PRIORITY.forEach((item) => {
      const rec = item.rec[state.age];
      const row = document.createElement('div');
      row.className = 'cov-row';
      row.dataset.key = item.key;
      row.innerHTML = `
        <div class="cov-head">
          <span class="cov-rank">${item.rank}</span>
          <div class="cov-title">
            <strong>${item.name}</strong>
            <span>${item.inputLabel} · 권장 ${won(rec)}${item.unit}</span>
          </div>
          <span class="badge badge-idle" data-badge>미입력</span>
        </div>
        <div class="input-row">
          <input type="number" id="cov-${item.key}" inputmode="numeric" min="0" step="${item.step}"
                 value="${state.cov[item.key]}" aria-label="${item.inputLabel} (${item.unit})">
          <span class="unit">${item.unit}</span>
        </div>
        <div class="quick-row">
          ${item.quick.map((q) => `<button type="button" class="quick" data-set="${q}">${q === 0 ? '없음' : won(q)}</button>`).join('')}
        </div>
        ${item.aux ? `<label class="check check-inline"><input type="checkbox" data-aux="${item.aux.key}" ${state.flags[item.aux.key] ? 'checked' : ''}><span>${item.aux.label}</span></label>` : ''}
      `;
      host.appendChild(row);

      const input = $('#cov-' + item.key, row);
      input.addEventListener('input', () => {
        state.cov[item.key] = clamp(Number(input.value || 0), 0, 100000);
        updateBadge(item);
      });
      $$('.quick', row).forEach((b) => {
        b.addEventListener('click', () => {
          state.cov[item.key] = Number(b.dataset.set);
          input.value = state.cov[item.key];
          updateBadge(item);
        });
      });
      const aux = $('[data-aux]', row);
      if (aux) {
        aux.addEventListener('change', () => {
          state.flags[item.aux.key] = aux.checked;
          updateBadge(item);
        });
      }
      updateBadge(item);
    });
  }

  function evalCoverage(item) {
    const rec = item.rec[state.age] || 0;
    const val = Number(state.cov[item.key] || 0);
    const ratio = rec > 0 ? val / rec : 1;
    let level, label;
    if (val <= 0) { level = 'gap'; label = '공백 위험'; }
    else if (ratio < 0.5) { level = 'gap'; label = '공백 위험'; }
    else if (ratio < 1) { level = 'need'; label = '보강 필요'; }
    else { level = 'ok'; label = '적정'; }
    let note = '';
    if (item.aux) {
      const has = !!state.flags[item.aux.key];
      if (!has) {
        if (level === 'ok') { level = 'need'; label = '보강 필요'; }
        note = item.key === 'surgery' ? 'N대 수술비 없음' : '장기요양 보장 없음';
      }
    }
    const gap = Math.max(0, rec - val);
    const auxOk = item.aux ? !!state.flags[item.aux.key] : true;
    const fillRatio = clamp(ratio, 0, 1) * (auxOk ? 1 : 0.8);
    return { rec, val, ratio, level, label, note, gap, auxOk, fillRatio };
  }

  function updateBadge(item) {
    const row = $(`.cov-row[data-key="${item.key}"]`);
    if (!row) return;
    const r = evalCoverage(item);
    const b = $('[data-badge]', row);
    b.className = 'badge badge-' + r.level;
    b.textContent = r.label;
  }

  /* ================= 보험료 구성 ================= */
  const FLAGS = [
    { key: 'savings', label: '적립(저축)성 특약이 포함돼 있다' },
    { key: 'renew', label: '갱신형 담보가 중심이다' },
    { key: 'manyRiders', label: '특약이 6개 이상으로 많다' }
  ];

  function renderFlags() {
    const host = $('#premium-flags');
    host.innerHTML = '';
    FLAGS.forEach((f) => {
      const l = document.createElement('label');
      l.className = 'check';
      l.innerHTML = `<input type="checkbox" data-flag="${f.key}" ${state.flags[f.key] ? 'checked' : ''}><span>${f.label}</span>`;
      const cb = $('input', l);
      cb.addEventListener('change', () => {
        state.flags[f.key] = cb.checked;
        if (state.analyzed) analyze();
      });
      host.appendChild(l);
    });
  }

  /* ================= 점수 ================= */
  function weights() {
    const w = Object.assign({}, SCORE_MODEL.base);
    const ageAdj = SCORE_MODEL.ageAdj[state.age] || {};
    const jobAdj = SCORE_MODEL.jobAdj[state.job] || {};
    Object.keys(ageAdj).forEach((k) => { w[k] = Math.max(4, w[k] + ageAdj[k]); });
    Object.keys(jobAdj).forEach((k) => { w[k] = Math.max(4, w[k] + jobAdj[k]); });
    return w;
  }

  function computeScore(rows) {
    const w = weights();
    let sum = 0, wsum = 0;
    const parts = rows.map(({ item, r }) => {
      const ww = w[item.key] || 0;
      const fill = r.fillRatio != null ? r.fillRatio : clamp(r.val / (r.rec || 1), 0, 1);
      sum += ww * fill;
      wsum += ww;
      return { key: item.key, w: ww, fill };
    });
    let score = wsum ? (sum / wsum) * 100 : 0;
    const penalty = [];
    if (state.silson === 'none') { score += SCORE_MODEL.penalty.silsonNone; penalty.push({ v: SCORE_MODEL.penalty.silsonNone, t: '실손 공백' }); }
    if (state.silson === '5') { score += SCORE_MODEL.penalty.silson5; penalty.push({ v: SCORE_MODEL.penalty.silson5, t: '5세대 비중증 축소' }); }
    if (state.flags.renew) { score += SCORE_MODEL.penalty.renew; penalty.push({ v: SCORE_MODEL.penalty.renew, t: '갱신형 중심' }); }
    score = Math.round(clamp(score, 0, 100));
    const grade = SCORE_MODEL.grades.find((g) => score >= g.min) || SCORE_MODEL.grades[SCORE_MODEL.grades.length - 1];
    return { score, grade, parts, penalty, w };
  }

  function weightComments(rows) {
    const out = [];
    const jobAdj = SCORE_MODEL.jobAdj[state.job] || {};
    if (jobAdj.surgery) out.push({ t: `직업 ${state.job}급 — 상해·수술 위험을 반영해 수술비 가중치를 올렸습니다.`, internal: false });
    if (state.age === '20' || state.age === '30') out.push({ t: '젊은 연령대 — 수술·상해 비중을 높이고 간병 비중은 낮췄습니다.', internal: false });
    if (state.age === '50') out.push({ t: '50대 — 암 발생 구간에 들어 수술비 비중을 줄이고 암·간병을 올렸습니다.', internal: false });
    if (state.age === '60' || state.age === '70') out.push({ t: '노후 구간 — 간병·장기요양 가중치를 가장 크게 높였습니다.', internal: false });
    if (state.silson === 'none') out.push({ t: '실손 공백 — 기본 의료비 축이 비어 점수에서 감점했습니다.', internal: true });
    if (state.silson === '1' || state.silson === '2') out.push({ t: '실손 1·2세대 — 기본 의료비 축이 넓어 구조적으로 유리합니다.', internal: false });
    if (state.silson === '5') out.push({ t: '실손 5세대 — 비중증 비급여 축소를 감점에 반영했습니다.', internal: true });
    if (state.flags.renew) out.push({ t: '갱신형 중심 — 갱신 시점 보험료 리스크를 감점에 반영했습니다.', internal: true });
    const cancer = rows.find((x) => x.item.key === 'cancer');
    if (cancer && cancer.r.level !== 'ok') out.push({ t: '1순위 암이 가장 크게 비어 있어 점수를 끌어내리고 있습니다.', internal: true });
    return out;
  }

  /* ================= 진단 ================= */
  function analyze() {
    const rows = PRIORITY.map((item) => ({ item, r: evalCoverage(item) }));
    const needCount = rows.filter((x) => x.r.level !== 'ok').length;
    const gapCount = rows.filter((x) => x.r.level === 'gap').length;
    const first = rows.find((x) => x.r.level !== 'ok');
    const totalDiag = Number(state.cov.cancer) + Number(state.cov.brain) + Number(state.cov.heart);
    const annual = Number(state.premium || 0) * 12;
    const sc = computeScore(rows);

    // 점수 히어로
    const R = 52, C = 2 * Math.PI * R;
    const dash = C * (1 - sc.score / 100);
    $('#result-hero').innerHTML = `
      <div class="hero-top">
        <span class="hero-eyebrow">COVERAGE SCORE</span>
        <span class="hero-input">${state.age}대 ${state.gender} · ${state.job}급 · 실손 ${SILSON_LABEL[state.silson]}</span>
      </div>
      <div class="score-wrap">
        <div class="ring-box">
          <svg viewBox="0 0 120 120" class="ring" aria-hidden="true">
            <defs>
              <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#8ff0dc"/><stop offset="100%" stop-color="#0fb093"/>
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="${R}" class="ring-bg"/>
            <circle cx="60" cy="60" r="${R}" class="ring-fg" stroke="url(#ringGrad)"
                    style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${dash.toFixed(1)}"/>
          </svg>
          <div class="ring-text">
            <strong>${sc.score}</strong><span>/100</span>
          </div>
        </div>
        <div class="score-copy">
          <span class="score-grade tone-${sc.grade.tone}">${sc.grade.label}</span>
          <h3>${sc.grade.line}</h3>
          <p>${first ? `1순위 착수 — ${first.item.name}${first.r.gap > 0 ? ' · 부족 ' + won(first.r.gap) + first.item.unit : ' · ' + (first.r.note || '구성 보완')}` : '5대 담보가 모두 기준선을 넘었습니다'}</p>
        </div>
      </div>
      <div class="hero-stats">
        <div><span>총 진단비</span><strong>${won(totalDiag)}만원</strong></div>
        <div><span>월 보험료</span><strong>${won(state.premium)}만원</strong></div>
        <div><span>연 보험료 대비</span><strong>${annual > 0 ? (totalDiag / annual).toFixed(1) + '배' : '—'}</strong></div>
      </div>
      <div class="weight-notes">
        ${weightComments(rows).filter((c) => state.view === 'advisor' || !c.internal)
          .map((c) => `<span class="${c.internal ? 'internal' : ''}">${c.t}</span>`).join('')}
      </div>
      <div class="score-formula">${state.view === 'advisor'
        ? '가중치 ' + PRIORITY.map((p) => `${p.name} ${sc.w[p.key]}`).join(' · ') + (sc.penalty.length ? ' / 감점 ' + sc.penalty.map((p) => `${p.t} ${p.v}`).join(', ') : '')
        : '연령대·직업급수·실손 세대를 반영한 가중 평균 (자체 산식)'}</div>
    `;

    // 우선순위 게이지
    const rowsHost = $('#result-rows');
    rowsHost.innerHTML = '';
    rows.forEach(({ item, r }, i) => {
      const fillPct = clamp(Math.round((r.fillRatio != null ? r.fillRatio : r.val / (r.rec || 1)) * 100), 0, 100);
      const pct = fillPct;
      const el = document.createElement('div');
      el.className = 'prow';
      let tail;
      if (r.val <= 0) tail = `미보유 · 권장 ${won(r.rec)}${item.unit}`;
      else if (r.gap > 0) tail = `보유 ${won(r.val)}${item.unit} · 부족 ${won(r.gap)}${item.unit}`;
      else tail = `보유 ${won(r.val)}${item.unit}${r.note ? ' · ' + r.note : ' · 기준선 충족'}`;
      el.innerHTML = `
        <div class="prow-head">
          <span class="prow-rank">${item.rank}</span>
          <div class="prow-name"><strong>${item.name}</strong><span>${item.need}</span></div>
          <span class="prow-pct tone-${r.level}">${pct}<i>%</i></span>
          <span class="badge badge-${r.level}">${r.label}</span>
        </div>
        <div class="gauge">
          <div class="gauge-track">
            <i class="gauge-fill tone-bg-${r.level}" style="width:${r.val <= 0 ? 0 : Math.max(3, fillPct)}%"></i>
          </div>
          <div class="gauge-scale"><span>0</span><span>권장 ${won(r.rec)}${item.unit}</span></div>
        </div>
        <div class="prow-tail"><span>${tail}</span><button type="button" class="prow-jump" data-jump="${item.key}">가이드 ›</button></div>
      `;
      rowsHost.appendChild(el);
    });

    // 체크포인트 (상담자 전용)
    const cps = buildCheckpoints(rows, totalDiag, annual);
    const cpHost = $('#result-checkpoints');
    cpHost.innerHTML = cps.map((c) => `
      <div class="cp cp-${c.level}">
        <div class="cp-title">${c.title}</div>
        <p>${c.body}</p>
      </div>`).join('');

    // 리모델링 3단계
    const steps = buildSteps(rows);
    $('#result-steps').innerHTML = steps.map((s, i) => `
      <div class="step">
        <div class="step-no">${i + 1}</div>
        <div class="step-body"><strong>${s.title}</strong><p>${s.body}</p></div>
      </div>`).join('');

    state.lastResult = { rows, needCount, gapCount, first, totalDiag, annual, cps, steps, score: sc };
    state.analyzed = true;
    $('#result').hidden = false;
    $('#save-bar').hidden = false;
  }

  function buildCheckpoints(rows, totalDiag, annual) {
    const cps = [];
    if (state.silson === 'none') {
      cps.push({ level: 'danger', title: '실손 공백', body: '입원·통원 기본부터 막혀 있습니다. 진단비보다 실손이 먼저입니다(건강보험 본인부담·비급여 대비).' });
    } else if (state.silson === '1' || state.silson === '2') {
      cps.push({ level: 'info', title: '실손 1·2세대 — 보험료를 줄일 두 갈래', body: '2026년 11월부터 ①선택형 할인 특약(보장 일부 제외, 30~40% 할인, 기존 계약 유지) ②5세대 전환(3년간 50% 추가 할인, 6개월 한시) 중 선택할 수 있습니다. 다만 5세대로 가면 비중증 비급여 한도 1,000만원·자기부담 50%로 줄고 5년 재가입이 생깁니다. 평소 도수·주사·MRI 이용량으로 판단하세요.' });
    } else if (state.silson === '3' || state.silson === '4') {
      cps.push({ level: 'ok', title: `실손 ${state.silson}세대 — 유지 판단`, body: '비급여 한도·자기부담 구조가 5세대보다 넓습니다. 의료 이용이 적다면 보험료 차이를 비교해 볼 수 있지만, 서두를 이유는 없습니다.' });
    } else {
      cps.push({ level: 'ok', title: '실손 5세대 — 구조 확인', body: '중증(특약1)과 비중증(특약2)이 분리돼 있습니다. 특약2는 연 1,000만원·자기부담 50%이므로 도수·비급여 주사는 사실상 자기부담으로 보십시오.' });
    }

    rows.forEach(({ item, r }) => {
      if (r.level === 'ok') return;
      if (item.key === 'cancer') {
        cps.push({ level: 'danger', title: '암 진단비가 얇습니다', body: `권장 ${won(r.rec)}만원 대비 ${r.val > 0 ? won(r.val) + '만원' : '미보유'}. 암은 진단비(목돈)와 치료비를 따로 봐야 하므로, 유사암 담보와 항암치료비까지 함께 확인하세요.` });
      }
      if (item.key === 'brain' && r.level === 'gap') {
        cps.push({ level: 'danger', title: '뇌 보장이 뇌출혈에 갇혀 있을 수 있습니다', body: '뇌경색(I63)은 뇌졸중·뇌혈관질환 담보에만 들어갑니다. 담보명이 "뇌출혈"이면 뇌경색은 지급 대상이 아닙니다.' });
      }
      if (item.key === 'heart' && r.level === 'gap') {
        cps.push({ level: 'danger', title: '심장 공백 — 허혈성심장질환 없음', body: '급성심근경색(I21)만으로는 협심증(I20)과 스텐트 시술 단계를 못 받습니다. 허혈성심장질환(I20~I25) 담보를 우선 채우세요.' });
      }
      if (item.key === 'surgery') {
        cps.push({ level: 'warn', title: '수술비 구성 점검', body: (r.val > 0 ? `5종 ${won(r.val)}만원` : '5종 수술비 미보유') + (state.flags.nDae ? ' + N대 수술비 보유' : ' · N대 수술비 없음') + '. 질병/상해 구분과 횟수 제한(1회한·연간 1회한)을 확인하세요.' });
      }
      if (item.key === 'care' && r.level !== 'ok') {
        cps.push({ level: 'warn', title: '간병 공백 — 매일 나가는 돈', body: '간병비는 진단비로 대체되지 않습니다. 간병인 사용일당(증빙 필요)·간호간병통합·장기요양등급 중 최소 한 갈래를 확보하세요.' });
      }
    });

    if (state.flags.savings) {
      cps.push({ level: 'info', title: '적립(저축)성 특약 확인', body: '보장 대비 저축 비중이 크면 같은 보험료로 보장을 더 넓힐 수 있습니다. 해지환급금과 보장 비중을 분리해 보여 주세요.' });
    }
    if (state.flags.renew) {
      cps.push({ level: 'warn', title: '갱신형 중심 구조', body: '갱신 시점에 보험료가 크게 오르고, 재가입 심사에서 가입이 막힐 수 있습니다. 갱신 예정 연령과 예상 보험료를 미리 표로 보여 주세요.' });
    }
    if (state.flags.manyRiders) {
      cps.push({ level: 'info', title: '특약 정리 여지', body: '중복·미사용 특약(예: 유사암 중복, 이미 소진된 1회한 담보)을 확인하세요. 정리한 금액으로 우선순위 보강에 배분합니다.' });
    }
    if (Number(state.premium) >= 40) {
      cps.push({ level: 'warn', title: `월 ${won(state.premium)}만원 — 구성 점검 우선`, body: '보험료 절대액이 큽니다. 해지가 아니라 배분 문제로 접근하세요. 진단비 대비 보험료가 얇으면 재배치 여지가 큽니다.' });
    }
    if (annual > 0 && totalDiag / annual < 12) {
      cps.push({ level: 'warn', title: '보험료 대비 진단비가 얇습니다', body: `연 보험료 ${won(annual)}만원에 핵심 진단비(암·뇌·심장) 합계 ${won(totalDiag)}만원입니다. 지금 내는 돈에서 적립·중복을 덜어내 진단비로 옮기는 재배치를 검토하세요.` });
    }
    if (Number(state.age) >= 60 && evalCoverage(PRIORITY[4]).level !== 'ok') {
      cps.push({ level: 'danger', title: '60대 이상 — 간병이 최대 리스크', body: '이 연령대에서 실제로 돈이 새는 곳은 간병입니다. 장기요양등급 보장과 간병 일당을 함께 확인하세요.' });
    }
    if (cps.length === 0) {
      cps.push({ level: 'ok', title: '구조적 구멍 없음', body: '5대 담보와 실손 구성이 기준선을 넘습니다. 이제는 금액 조정과 갱신 대비가 남은 과제입니다.' });
    }
    return cps;
  }

  function buildSteps(rows) {
    const targets = rows.filter((x) => x.r.level !== 'ok').slice(0, 3);
    const targetText = targets.length
      ? targets.map((x) => `${x.item.name}${x.r.gap > 0 ? ` +${won(x.r.gap)}${x.item.unit}` : ' 구성 보완'}`).join(' → ')
      : '없음 (금액 조정만)';
    return [
      {
        title: '기존 핵심 사수',
        body: '지금 가진 암·뇌·심장 진단비 중 가장 두꺼운 담보는 해지하지 않습니다. 나이와 병력 때문에 같은 조건으로 다시 들 수 없습니다. 먼저 "무엇을 지킬지"를 정하고 시작하세요.'
      },
      {
        title: '배서 다이어트',
        body: `적립(저축)성·중복·미사용 특약을 정리해 보험료를 확보합니다.${state.silson === '1' || state.silson === '2' ? ' 실손은 선택형 할인 특약과 5세대 전환을 같은 표에 놓고 비교하세요.' : ' 갱신형은 다음 갱신 시점의 예상 보험료까지 확인합니다.'}`
      },
      {
        title: '우선순위별 핀셋 보강',
        body: `1순위부터 부족분만 채웁니다. 보강 대상: ${targetText}. 한 번에 다 하지 말고 1순위 한 칸씩, 예산 안에서 끝내세요.`
      }
    ];
  }

  /* ================= 카톡 요약 ================= */
  function kakaoText() {
    const res = state.lastResult;
    if (!res) return '';
    const L = [];
    L.push('[보장분석 요약]');
    L.push(`${state.age}대 ${state.gender} · 직업 ${state.job}급 · 실손 ${SILSON_LABEL[state.silson]}`);
    L.push(`종합 보장 밸런스 ${res.score.score}점 (${res.score.grade.label})`);
    L.push('');
    L.push('■ 5대 담보 진단');
    res.rows.forEach(({ item, r }) => {
      let line = `${item.rank}. ${item.name} ${r.val > 0 ? won(r.val) + item.unit : '0' + item.unit} — ${r.label}`;
      if (r.level !== 'ok') {
        if (r.gap > 0) line += ` (권장 ${won(r.rec)}${item.unit}, 부족 ${won(r.gap)}${item.unit})`;
        else if (r.note) line += ` (${r.note})`;
      }
      L.push(line);
    });
    L.push('');
    const targets = res.rows.filter((x) => x.r.level !== 'ok');
    L.push('■ 먼저 채울 곳');
    if (!targets.length) L.push('· 지금 구조 유지 + 금액 조정');
    else targets.slice(0, 3).forEach((x, i) => {
      L.push(`${i + 1}) ${x.item.name} — ${x.r.gap > 0 ? `${won(x.r.gap)}${x.item.unit} 보강` : x.r.note || '구성 보완'}`);
    });
    L.push('');
    L.push('■ 리모델링 3단계');
    res.steps.forEach((s, i) => L.push(`${i + 1}단계 ${s.title} — ${s.body.replace(/\s+/g, ' ').slice(0, 90)}${s.body.length > 90 ? '…' : ''}`));
    L.push('');
    L.push('※ 상담 참고용 요약입니다. 실제 지급 여부와 금액은 가입하신 상품의 약관과 증권을 기준으로 안내드립니다.');
    return L.join('\n');
  }

  /* ================= SVG 도식 ================= */
  function dgContain(tiers) {
    const H = 196, W = 340, bh = 44, gap = 14;
    let y = 18;
    let out = `<svg viewBox="0 0 ${W} ${H}" class="dg" role="img" aria-label="보장 범위 포함관계 도식">`;
    out += `<defs>
      <linearGradient id="gDeep" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#122f52"/><stop offset="100%" stop-color="#0a1d33"/></linearGradient>
      <linearGradient id="gMid" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1b4a78"/><stop offset="100%" stop-color="#0f3155"/></linearGradient>
      <linearGradient id="gLight" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2b6f8f"/><stop offset="100%" stop-color="#1a4f6b"/></linearGradient>
    </defs>`;
    tiers.forEach((t, i) => {
      const w = t.width;
      const x = (W - w) / 2;
      const yy = y + i * (bh + gap);
      const fill = t.tone === 'deep' ? 'url(#gDeep)' : t.tone === 'mid' ? 'url(#gMid)' : 'url(#gLight)';
      out += `<rect x="${x}" y="${yy}" width="${w}" height="${bh}" rx="12" fill="${fill}"/>`;
      out += `<text x="${x + 14}" y="${yy + 20}" class="dg-l light">${esc(t.label)}</text>`;
      out += `<text x="${x + 14}" y="${yy + 34}" class="dg-s on-dark">${esc(t.note)}</text>`;
      out += `<text x="${x + w - 14}" y="${yy + 24}" text-anchor="end" class="dg-code">${esc(t.code)}</text>`;
    });
    // 포함 화살표
    const ax = 16;
    out += `<path d="M${ax} ${y + bh + 4} L${ax} ${y + 2 * (bh + gap) + bh - 4}" stroke="#9fb8cf" stroke-width="1.2" fill="none" stroke-dasharray="3 3"/>`;
    out += `<path d="M${ax - 3.5} ${y + bh + 8} L${ax} ${y + bh + 2} L${ax + 3.5} ${y + bh + 8}" fill="none" stroke="#9fb8cf" stroke-width="1.2"/>`;
    out += `<text x="${ax + 8}" y="${H - 8}" class="dg-t">⊂ 포함</text>`;
    out += `<text x="${W - 6}" y="${H - 8}" text-anchor="end" class="dg-s">바깥으로 갈수록 넓은 담보</text>`;
    out += `</svg>`;
    return out;
  }

  function dgCancer() {
    const out = [];
    out.push(`<svg viewBox="0 0 340 250" class="dg" role="img" aria-label="암 보장 구조 도식">
      <defs>
        <linearGradient id="cNavy" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#153a60"/><stop offset="100%" stop-color="#0a1d33"/></linearGradient>
      </defs>
      <rect x="8" y="10" width="324" height="140" rx="14" fill="#f7f9fc" stroke="#cfdaea" stroke-dasharray="5 4"/>
      <text x="20" y="30" class="dg-s">악성신생물 분류표 · C00~C97</text>

      <rect x="20" y="42" width="138" height="94" rx="10" fill="url(#cNavy)"/>
      <text x="32" y="66" class="dg-l light">일반암</text>
      <text x="32" y="84" class="dg-s on-dark">C00~C97 − 유사암</text>
      <text x="32" y="104" class="dg-s on-dark">진단비 100% 기준</text>
      <text x="32" y="122" class="dg-s on-dark">(상품별 지급액)</text>

      <rect x="170" y="42" width="150" height="94" rx="10" fill="#fdf6e6" stroke="#e8c777" stroke-dasharray="4 3"/>
      <text x="182" y="60" class="dg-l dark">유사암 4종</text>
      <rect x="182" y="68" width="60" height="20" rx="6" fill="#fff" stroke="#e8d3a4"/><text x="212" y="82" text-anchor="middle" class="dg-c dark">C73 갑상선</text>
      <rect x="246" y="68" width="62" height="20" rx="6" fill="#fff" stroke="#e8d3a4"/><text x="277" y="82" text-anchor="middle" class="dg-c dark">C44 피부</text>
      <rect x="182" y="92" width="60" height="20" rx="6" fill="#fff" stroke="#e8d3a4"/><text x="212" y="106" text-anchor="middle" class="dg-c dark">D00~09 제자리</text>
      <rect x="246" y="92" width="62" height="20" rx="6" fill="#fff" stroke="#e8d3a4"/><text x="277" y="106" text-anchor="middle" class="dg-c dark">D37~48 경계성</text>
      <text x="182" y="128" class="dg-s dark">일반암보다 낮은 금액 · 별도 담보</text>

      <path d="M245 142 L245 160" stroke="#c9a44c" stroke-width="1.4" fill="none"/>
      <path d="M240 156 L245 162 L250 156" fill="none" stroke="#c9a44c" stroke-width="1.4"/>
      <rect x="8" y="164" width="324" height="34" rx="10" fill="#fff" stroke="#e4d3a8"/>
      <text x="20" y="185" class="dg-l dark">유사암 진단비</text>
      <text x="320" y="185" text-anchor="end" class="dg-s dark">별도 한도 · "유사암 제외" 문구 확인</text>

      <rect x="8" y="208" width="324" height="34" rx="10" fill="#eef4fb" stroke="#cfdaea"/>
      <text x="20" y="229" class="dg-l dark">암 주요치료비</text>
      <text x="320" y="229" text-anchor="end" class="dg-s dark">항암약물 · 방사선 · 수술 — 진단비와 별도 축</text>
    </svg>`);
    return out.join('');
  }

  function dgSurgery() {
    return `<svg viewBox="0 0 340 266" class="dg" role="img" aria-label="수술비 두 축 도식">
      <circle cx="106" cy="84" r="76" fill="#eef4fb" stroke="#b7cbe3" stroke-width="1.2"/>
      <circle cx="234" cy="84" r="76" fill="#fdf6e6" stroke="#e5c37a" stroke-width="1.2"/>
      <text x="78" y="70" text-anchor="middle" class="dg-l dark">1~5종</text>
      <text x="78" y="88" text-anchor="middle" class="dg-s dark">수술비</text>
      <text x="78" y="104" text-anchor="middle" class="dg-s dark">질병 · 상해</text>
      <text x="262" y="70" text-anchor="middle" class="dg-l dark">N대</text>
      <text x="262" y="88" text-anchor="middle" class="dg-s dark">수술비</text>
      <text x="262" y="104" text-anchor="middle" class="dg-s dark">질환별 한도</text>
      <text x="170" y="76" text-anchor="middle" class="dg-s dark">중복</text>
      <text x="170" y="90" text-anchor="middle" class="dg-s dark">가능</text>
      <path d="M170 162 L170 180" stroke="#9fb8cf" stroke-width="1.2" fill="none"/>
      <path d="M165.5 176 L170 182 L174.5 176" fill="none" stroke="#9fb8cf" stroke-width="1.2"/>
      <rect x="20" y="184" width="300" height="34" rx="10" fill="#fff" stroke="#cfdaea"/>
      <text x="32" y="205" class="dg-l dark">같은 수술 · 두 담보에서 각각 청구</text>
      <text x="308" y="205" text-anchor="end" class="dg-s dark">약관 확인</text>
      <rect x="20" y="226" width="300" height="34" rx="10" fill="#0f2a49"/>
      <text x="32" y="247" class="dg-l light">종수가 낮을수록 고액 · 1종 관혈 &gt; 5종 내시경</text>
    </svg>`;
  }

  function dgCare() {
    const cols = [
      { x: 8, title: '간병인 사용일당', tag: '입원 중', lines: ['실제 간병인 고용', '1일당 정액', '이용확인서·영수증'] },
      { x: 118, title: '간호간병통합', tag: '입원 중', lines: ['보호자 없는 병동', '일당 또는 정액', '별도 특약 필요'] },
      { x: 228, title: '장기요양등급', tag: '퇴원 후', lines: ['1~5등급·인지지원', '월 단위 요양비', '등급 판정 필요'] }
    ];
    let out = `<svg viewBox="0 0 340 210" class="dg" role="img" aria-label="간병비 세 가지 방식 도식">
      <defs><linearGradient id="careG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#173c63"/><stop offset="100%" stop-color="#0b2440"/></linearGradient></defs>`;
    cols.forEach((c, i) => {
      const fill = i === 2 ? 'url(#careG)' : '#fff';
      const stroke = i === 2 ? 'none' : '#cfdaea';
      const cls = i === 2 ? 'on-dark' : 'dark';
      out += `<rect x="${c.x}" y="10" width="104" height="130" rx="12" fill="${fill}" stroke="${stroke}"/>`;
      out += `<text x="${c.x + 12}" y="32" class="dg-s ${cls}">${c.tag}</text>`;
      out += `<text x="${c.x + 12}" y="52" class="dg-l ${i === 2 ? 'light' : 'dark'}">${c.title}</text>`;
      c.lines.forEach((l, j) => {
        out += `<text x="${c.x + 12}" y="${76 + j * 18}" class="dg-s ${cls}">· ${l}</text>`;
      });
      if (i === 2) out += `<text x="${c.x + 12}" y="130" class="dg-s on-dark">노후 핵심</text>`;
    });
    out += `<path d="M16 168 L318 168" stroke="#8ba0b8" stroke-width="1.2" stroke-dasharray="4 4"/>`;
    out += `<path d="M312 163 L320 168 L312 173" fill="none" stroke="#8ba0b8" stroke-width="1.2"/>`;
    out += `<text x="16" y="188" class="dg-s dark">입원 중</text>`;
    out += `<text x="320" y="188" text-anchor="end" class="dg-s dark">퇴원 후 · 노후</text>`;
    out += `<text x="170" y="188" text-anchor="middle" class="dg-s dark">진단비로 대체되지 않는 매일의 비용</text>`;
    out += `</svg>`;
    return out;
  }

  /* ================= 탭 2 ================= */
  function renderGuideChips() {
    const host = $('#guide-chips');
    host.innerHTML = PRIORITY.map((p) => `
      <button type="button" class="chip${state.guide === p.key ? ' is-on' : ''}" data-key="${p.key}" role="tab" aria-selected="${state.guide === p.key}">
        <span class="chip-rank">${p.rank}</span>${p.name}
      </button>`).join('');
    $$('.chip', host).forEach((c) => {
      c.addEventListener('click', () => {
        state.guide = c.dataset.key;
        renderGuideChips();
        renderGuideBody();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function renderGuideBody() {
    const g = GUIDES[state.guide];
    const host = $('#guide-body');
    if (!g) return;

    let diagram = '';
    if (g.diagram === 'contain') diagram = dgContain(g.tiers);
    else if (g.diagram === 'cancer') diagram = dgCancer();
    else if (g.diagram === 'surgery') diagram = dgSurgery();
    else if (g.diagram === 'care') diagram = dgCare();

    const structHtml = g.structures ? `
      <div class="struct-list">
        ${g.structures.map((s) => `
          <div class="struct-card">
            <div class="struct-head"><strong>${s.label}</strong><span class="tag">${s.tag}</span></div>
            <p>${s.desc}</p>
          </div>`).join('')}
      </div>` : '';

    const sections = [
      {
        key: 'range', title: g.diagram === 'cancer' ? '암 보장 구조' : g.diagram === 'surgery' ? '수술비 두 축' : g.diagram === 'care' ? '간병비 세 갈래' : '보장 범위 포함관계',
        html: `<div class="diagram-wrap">${diagram}</div>${structHtml}<p class="diagram-note">${g.diagramNote || ''}</p>`,
        internal: false
      },
      { key: 'talk', title: '고객 1분 설명 화법', html: `<div class="talk-list">${g.talk.map((t, i) => `<div class="talk"><p>${t}</p><button type="button" class="copy-mini" data-copy="${i}">복사</button></div>`).join('')}</div>`, internal: true },
      { key: 'traps', title: '증권 분석 함정', html: `<ul class="trap-list">${g.traps.map((t) => `<li>${t}</li>`).join('')}</ul>`, internal: true },
      { key: 'claim', title: '청구 · 약관 주의사항', html: `<ul class="claim-list">${g.claim.map((t) => `<li>${t}</li>`).join('')}</ul>`, internal: false }
    ].filter((s) => state.view === 'advisor' || !s.internal);

    host.innerHTML = `
      <div class="guide-head">
        <div class="guide-rank">${g.title}</div>
        <h2>${g.head}</h2>
        <p>${g.lead}</p>
      </div>
      ${sections.map((s, i) => `
        <details class="acc"${i === 0 ? ' open' : ''}>
          <summary><span class="acc-no">${i + 1}</span>${s.title}</summary>
          <div class="acc-body">${s.html}</div>
        </details>`).join('')}
    `;

    $$('.copy-mini', host).forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const i = Number(b.dataset.copy);
        copy(g.talk[i].replace(/^"|"$/g, ''), '화법을 복사했습니다');
      });
    });
  }

  /* ================= 탭 3 ================= */
  function renderToolkit() {
    $('#disclosure-general').innerHTML = DISCLOSURE_GENERAL.map((d) => `
      <div class="disc-row">
        <div class="disc-period">${d.period}</div>
        <ul>${d.items.map((i) => `<li>${i}</li>`).join('')}</ul>
      </div>`).join('');

    $('#disclosure-simple').innerHTML = DISCLOSURE_SIMPLE.map((d) => `
      <div class="disc-row">
        <div class="disc-period">${d.period}</div>
        <ul>${d.items.map((i) => `<li>${i}</li>`).join('')}</ul>
      </div>`).join('');

    const rowKeys = ['급여', '비급여', '자기부담', '재가입', '특징'];
    const cards = $('#silson-cards');
    if (cards) {
      cards.innerHTML = SILSON_GENERATIONS.map((g) => `
        <div class="silson-card${g.gen === '5세대' ? ' is-current' : ''}">
          <div class="sg-head"><strong>${g.gen}</strong><span>${g.period}</span></div>
          <dl>${rowKeys.map((k) => `<div><dt>${k}</dt><dd>${g.rows[k]}</dd></div>`).join('')}</dl>
        </div>`).join('');
    }
    $('#silson-table').innerHTML = `
      <thead>
        <tr><th class="sticky-col">구분</th>${SILSON_GENERATIONS.map((g) => `<th><strong>${g.gen}</strong><span>${g.period}</span></th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rowKeys.map((k) => `<tr><th class="sticky-col">${k}</th>${SILSON_GENERATIONS.map((g) => `<td>${g.rows[k]}</td>`).join('')}</tr>`).join('')}
      </tbody>`;

    const ob = $('#objections');
    ob.innerHTML = OBJECTIONS.map((o, i) => `
      <div class="obj">
        <button type="button" class="obj-head" aria-expanded="false">
          <span class="obj-trigger">${o.trigger}</span>
          <svg class="obj-caret" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="obj-body" hidden>
          <div class="obj-step"><span class="obj-tag">공감</span><p>${o.empathy}</p></div>
          <div class="obj-step"><span class="obj-tag">환기</span><p>${o.awaken}</p></div>
          <div class="obj-step"><span class="obj-tag">대안</span><p>${o.alternative}</p></div>
          <button type="button" class="btn-ghost obj-copy" data-i="${i}">이 화법 복사</button>
        </div>
      </div>`).join('');

    $$('.obj-head', ob).forEach((h) => {
      h.addEventListener('click', () => {
        const body = h.nextElementSibling;
        const open = !body.hidden;
        body.hidden = open;
        h.setAttribute('aria-expanded', String(!open));
        h.parentElement.classList.toggle('is-open', !open);
      });
    });
    $$('.obj-copy', ob).forEach((b) => {
      b.addEventListener('click', () => {
        const o = OBJECTIONS[Number(b.dataset.i)];
        copy(`${o.trigger}\n\n[공감] ${o.empathy}\n[환기] ${o.awaken}\n[대안] ${o.alternative}`, '화법을 복사했습니다');
      });
    });
  }

  /* ================= 상담 저장 / 불러오기 ================= */
  function loadHistory() {
    const list = lsGet(HKEY, []);
    state.history = Array.isArray(list) ? list.slice(0, 5) : [];
    renderHistory();
  }

  function saveConsult() {
    if (!state.lastResult) { toast('먼저 진단해 주세요'); return; }
    const label = ($('#cust-label').value || '').trim() || `${state.age}대 ${state.gender}`;
    const entry = {
      id: 'c' + Date.now(),
      label,
      savedAt: new Date().toISOString(),
      score: state.lastResult.score.score,
      grade: state.lastResult.score.grade.label,
      inputs: {
        age: state.age, gender: state.gender, job: state.job, silson: state.silson,
        premium: state.premium, cov: Object.assign({}, state.cov), flags: Object.assign({}, state.flags)
      }
    };
    const next = [entry].concat(state.history).slice(0, 5);
    if (lsSet(HKEY, next)) {
      state.history = next;
      renderHistory();
      toast('최근 상담에 저장했습니다 (최대 5건)');
    } else {
      toast('저장 공간을 쓸 수 없습니다');
    }
  }

  function renderHistory() {
    const host = $('#history-list');
    if (!host) return;
    if (!state.history.length) {
      host.innerHTML = `<p class="empty">저장된 상담이 없습니다. 진단 후 "상담 저장"을 누르면 이 기기에만 기록됩니다.</p>`;
      return;
    }
    host.innerHTML = state.history.map((h) => {
      const d = new Date(h.savedAt);
      const when = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `
        <div class="hist" data-id="${h.id}">
          <div class="hist-main">
            <strong>${esc(h.label)}</strong>
            <span>${when} · ${h.inputs.age}대 ${h.inputs.gender} · 실손 ${SILSON_LABEL[h.inputs.silson]}</span>
          </div>
          <span class="hist-score">${h.score}<i>점</i></span>
          <button type="button" class="hist-load" data-load="${h.id}">불러오기</button>
          <button type="button" class="hist-del" data-del="${h.id}" aria-label="삭제">×</button>
        </div>`;
    }).join('');

    $$('[data-load]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const h = state.history.find((x) => x.id === b.dataset.load);
        if (!h) return;
        applyInputs(h.inputs);
        analyze();
        $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast(`"${h.label}" 상담을 불러왔습니다`);
      });
    });
    $$('[data-del]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const next = state.history.filter((x) => x.id !== b.dataset.del);
        if (lsSet(HKEY, next)) {
          state.history = next;
          renderHistory();
          toast('삭제했습니다');
        }
      });
    });
  }

  function applyInputs(inputs) {
    state.age = inputs.age;
    state.gender = inputs.gender;
    state.job = inputs.job;
    state.silson = inputs.silson;
    state.premium = inputs.premium;
    state.cov = Object.assign({}, inputs.cov);
    state.flags = Object.assign({}, state.flags, inputs.flags);
    syncSegments();
    renderCoverageInputs();
    renderFlags();
    $('#premium').value = state.premium;
  }

  function syncSegments() {
    const map = { '#seg-age': state.age, '#seg-gender': state.gender, '#seg-job': state.job, '#seg-silson': state.silson };
    Object.keys(map).forEach((sel) => {
      $$('.seg-btn', $(sel)).forEach((b) => {
        const on = b.dataset.value === String(map[sel]);
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    });
    $('#job-hint').textContent = JOB_HINTS[state.job];
  }

  /* ================= 화면 모드 ================= */
  function applyView() {
    document.body.classList.toggle('is-client', state.view === 'client');
    $$('.viewswitch button').forEach((b) => {
      const on = b.dataset.mode === state.view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (state.view === 'client') {
      const active = $('.view.is-active');
      if (active && active.id === 'view-toolkit') switchView('analysis');
    }
    renderGuideChips();
    renderGuideBody();
    if (state.analyzed) analyze();
    renderHistory();
  }

  /* ================= 복사 · 토스트 ================= */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2000);
  }

  async function copy(text, okMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast(okMsg || '복사했습니다');
    } catch (e) {
      toast('복사가 막혔습니다. 길게 눌러 직접 선택해 주세요');
    }
  }

  /* ================= 탭 전환 ================= */
  function switchView(name) {
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + name));
    $$('.tab').forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ================= 초기화 ================= */
  function init() {
    state.view = lsGet(VKEY, 'advisor') === 'client' ? 'client' : 'advisor';

    renderSegments();
    renderCoverageInputs();
    renderFlags();
    renderGuideChips();
    renderGuideBody();
    renderToolkit();
    loadHistory();
    applyView();

    $('#premium').addEventListener('input', (e) => {
      state.premium = clamp(Number(e.target.value || 0), 0, 300);
      if (state.analyzed) analyze();
    });

    $('#btn-analyze').addEventListener('click', () => {
      analyze();
      $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('진단을 완료했습니다');
    });

    $('#btn-kakao').addEventListener('click', () => copy(kakaoText(), '카톡 요약을 복사했습니다'));
    $('#btn-save').addEventListener('click', saveConsult);

    $$('.viewswitch button').forEach((b) => {
      b.addEventListener('click', () => {
        state.view = b.dataset.mode;
        lsSet(VKEY, state.view);
        applyView();
        toast(state.view === 'client' ? '고객 공유 화면으로 전환했습니다' : '상담자 화면으로 전환했습니다');
      });
    });

    $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

    document.addEventListener('click', (e) => {
      const j = e.target.closest('[data-jump]');
      if (!j) return;
      state.guide = j.dataset.jump;
      renderGuideChips();
      renderGuideBody();
      switchView('guide');
    });

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
