/* 보장분석 상담 가이드 — 화면 로직 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const state = {
    age: '40',
    gender: '여',
    job: '1',
    silson: '4',
    premium: 22,
    cov: { cancer: 3000, brain: 2000, heart: 0, surgery: 300, care: 10 },
    flags: { nDae: false, longTerm: false, savings: false, renew: true, manyRiders: false },
    guide: 'cancer',
    analyzed: false
  };

  /* ---------------- 공통: 세그먼트 버튼 ---------------- */
  function buildSeg(el, items, current, onPick) {
    el.innerHTML = '';
    items.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn' + (String(it.value) === String(current) ? ' is-on' : '');
      b.dataset.value = it.value;
      b.textContent = it.label;
      if (it.hint) b.title = it.hint;
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

  function syncSeg(el, value) {
    $$('.seg-btn', el).forEach((b) => {
      const on = b.dataset.value === String(value);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
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
      { value: '1', label: '1급', hint: JOB_HINTS['1'] },
      { value: '2', label: '2급', hint: JOB_HINTS['2'] },
      { value: '3', label: '3급', hint: JOB_HINTS['3'] }
    ], state.job, (v) => {
      state.job = v;
      $('#job-hint').textContent = JOB_HINTS[v];
      if (state.analyzed) analyze();
    });
    buildSeg($('#seg-silson'), [
      { value: 'none', label: '없음' },
      { value: '1', label: '1세대' },
      { value: '2', label: '2세대' },
      { value: '3', label: '3세대' },
      { value: '4', label: '4세대' },
      { value: '5', label: '5세대' }
    ], state.silson, (v) => {
      state.silson = v;
      if (state.analyzed) analyze();
    });
    $('#job-hint').textContent = JOB_HINTS[state.job];
  }

  /* ---------------- 담보 입력 ---------------- */
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
          <input type="number" id="cov-${item.key}" inputmode="numeric" min="0" step="${item.step}" value="${state.cov[item.key]}" aria-label="${item.inputLabel} (${item.unit})">
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
    let level;
    let label;
    if (val <= 0) {
      level = 'gap';
      label = '공백 위험';
    } else if (ratio < 0.5) {
      level = 'gap';
      label = '공백 위험';
    } else if (ratio < 1) {
      level = 'need';
      label = '보강 필요';
    } else {
      level = 'ok';
      label = '적정';
    }
    let note = '';
    if (item.aux) {
      const has = !!state.flags[item.aux.key];
      if (!has) {
        if (level === 'ok') { level = 'need'; label = '보강 필요'; }
        note = item.key === 'surgery' ? 'N대 수술비 없음' : '장기요양 보장 없음';
      }
    }
    const gap = Math.max(0, rec - val);
    return { rec, val, ratio, level, label, note, gap };
  }

  function updateBadge(item) {
    const row = $(`.cov-row[data-key="${item.key}"]`);
    if (!row) return;
    const r = evalCoverage(item);
    const b = $('[data-badge]', row);
    b.className = 'badge badge-' + r.level;
    b.textContent = r.label;
  }

  /* ---------------- 보험료 구성 체크 ---------------- */
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

  /* ---------------- 진단 ---------------- */
  function analyze() {
    const rows = PRIORITY.map((item) => ({ item, r: evalCoverage(item) }));
    const needCount = rows.filter((x) => x.r.level !== 'ok').length;
    const gapCount = rows.filter((x) => x.r.level === 'gap').length;
    const first = rows.find((x) => x.r.level !== 'ok');
    const totalDiag = Number(state.cov.cancer) + Number(state.cov.brain) + Number(state.cov.heart);
    const annual = Number(state.premium || 0) * 12;

    // hero
    let heroTitle;
    if (needCount === 0) heroTitle = '5대 담보 모두 적정선입니다';
    else if (gapCount >= 2) heroTitle = `${needCount}개 보강 · 공백 ${gapCount}곳`;
    else heroTitle = `${needCount}개 보강이 필요합니다`;

    let heroSub;
    if (!first) heroSub = '지금 구조를 유지하면서 보험료 구성만 점검하세요.';
    else if (first.item.key === 'cancer') heroSub = `1순위 착수: 암 — ${first.r.gap > 0 ? `부족 ${won(first.r.gap)}만원` : first.r.note}`;
    else heroSub = `1순위 착수: ${first.item.name} — ${first.r.gap > 0 ? `부족 ${won(first.r.gap)}만원` : first.r.note}`;

    $('#result-hero').innerHTML = `
      <div class="hero-top">
        <span class="hero-tag">진단 요약</span>
        <span class="hero-input">${state.age}대 ${state.gender} · ${state.job}급 · 실손 ${state.silson === 'none' ? '없음' : state.silson + '세대'}</span>
      </div>
      <h3>${heroTitle}</h3>
      <p>${heroSub}</p>
      <div class="hero-stats">
        <div><span>총 진단비</span><strong>${won(totalDiag)}만원</strong></div>
        <div><span>월 보험료</span><strong>${won(state.premium)}만원</strong></div>
        <div><span>연 보험료 대비</span><strong>${annual > 0 ? (totalDiag / annual).toFixed(1) + '배' : '—'}</strong></div>
      </div>
    `;

    // rows
    const rowsHost = $('#result-rows');
    rowsHost.innerHTML = '';
    rows.forEach(({ item, r }) => {
      const el = document.createElement('div');
      el.className = 'prow';
      const pct = clamp((r.val / (r.rec || 1)) * 100, 0, 100);
      let tail;
      if (r.val <= 0) tail = `권장 ${won(r.rec)}${item.unit} · 미보유`;
      else if (r.gap > 0) tail = `${won(r.val)} / 권장 ${won(r.rec)}${item.unit} · 부족 ${won(r.gap)}${item.unit}`;
      else tail = `${won(r.val)} / 권장 ${won(r.rec)}${item.unit}${r.note ? ' · ' + r.note : ''}`;
      el.innerHTML = `
        <div class="prow-head">
          <span class="prow-rank">${item.rank}</span>
          <div class="prow-name"><strong>${item.name}</strong><span>${item.need}</span></div>
          <span class="badge badge-${r.level}">${r.label}</span>
        </div>
        <div class="bar"><i class="bar-fill bar-${r.level}" style="width:${r.val <= 0 ? 0 : Math.max(6, pct)}%"></i></div>
        <div class="prow-tail"><span>${tail}</span><button type="button" class="prow-jump" data-jump="${item.key}">가이드 ›</button></div>
      `;
      rowsHost.appendChild(el);
    });

    // checkpoints
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

    const cpHost = $('#result-checkpoints');
    cpHost.innerHTML = cps.map((c) => `
      <div class="cp cp-${c.level}">
        <div class="cp-title">${c.title}</div>
        <p>${c.body}</p>
      </div>`).join('');

    // steps
    const steps = buildSteps(rows);
    $('#result-steps').innerHTML = steps.map((s, i) => `
      <div class="step">
        <div class="step-no">${i + 1}단계</div>
        <div class="step-body"><strong>${s.title}</strong><p>${s.body}</p></div>
      </div>`).join('');

    state.lastResult = { rows, needCount, gapCount, first, totalDiag, annual, cps, steps };
    state.analyzed = true;
    $('#result').hidden = false;
  }

  function buildSteps(rows) {
    const targets = rows.filter((x) => x.r.level !== 'ok').slice(0, 3);
    const targetText = targets.length
      ? targets.map((x) => `${x.item.name}${x.r.gap > 0 ? ` +${won(x.r.gap)}${x.item.unit}` : ' 구성 보완'}`).join(' → ')
      : '없음 (금액 조정만)';
    return [
      {
        title: '기존 핵심 사수',
        body: '지금 가진 암·뇌·심장 진단비 중 가장 두꺼운 담보는 절대 해지하지 않습니다. 나이와 병력 때문에 같은 조건으로 다시 들 수 없습니다. 먼저 "무엇을 지킬지"를 정하고 시작하세요.'
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

  /* ---------------- 카톡 요약 ---------------- */
  function kakaoText() {
    const res = state.lastResult;
    if (!res) return '';
    const L = [];
    L.push('[보장분석 요약]');
    L.push(`${state.age}대 ${state.gender} · 직업 ${state.job}급 · 실손 ${state.silson === 'none' ? '없음' : state.silson + '세대'}`);
    L.push(`월 보험료 ${won(state.premium)}만원`);
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
    if (!targets.length) {
      L.push('· 지금 구조 유지 + 금액 조정');
    } else {
      targets.slice(0, 3).forEach((x, i) => {
        L.push(`${i + 1}) ${x.item.name} — ${x.r.gap > 0 ? `${won(x.r.gap)}${x.item.unit} 보강` : x.r.note || '구성 보완'}`);
      });
    }
    L.push('');
    L.push('■ 리모델링 3단계');
    res.steps.forEach((s, i) => L.push(`${i + 1}단계 ${s.title} — ${s.body.replace(/\s+/g, ' ').slice(0, 90)}${s.body.length > 90 ? '…' : ''}`));
    L.push('');
    L.push('■ 보험료 점검');
    res.cps.slice(0, 3).forEach((c) => L.push(`· ${c.title}`));
    L.push('');
    L.push('※ 상담 참고용 요약입니다. 실제 지급 여부와 금액은 가입하신 상품의 약관과 증권을 기준으로 안내드립니다.');
    return L.join('\n');
  }

  /* ---------------- 탭 2: 5대 담보 ---------------- */
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
        const body = $('#guide-body');
        if (body) window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function renderGuideBody() {
    const g = GUIDES[state.guide];
    const host = $('#guide-body');
    if (!g) return;

    const rangeHtml = g.range ? `
      <div class="range-block">
        <div class="range-note">${g.range.note}</div>
        ${g.range.tiers.map((t) => `
          <div class="range-row">
            <div class="range-head">
              <span class="range-label">${t.label}</span>
              <span class="range-value">${t.value}</span>
            </div>
            <div class="bar bar-lg"><i class="bar-fill bar-range" style="width:${t.pct}%"></i></div>
            <div class="range-sub"><code>${t.code}</code> ${t.desc}</div>
          </div>`).join('')}
      </div>` : '';

    const structHtml = g.structures ? `
      <div class="range-block">
        ${g.structures.map((s) => `
          <div class="struct-card">
            <div class="struct-head"><strong>${s.label}</strong><span class="tag">${s.tag}</span></div>
            <p>${s.desc}</p>
          </div>`).join('')}
      </div>` : '';

    host.innerHTML = `
      <div class="guide-head">
        <div class="guide-rank">${g.title}</div>
        <h2>${g.head}</h2>
        <p>${g.lead}</p>
      </div>

      <details class="acc" open>
        <summary><span class="acc-no">1</span>보장 범위 비교</summary>
        <div class="acc-body">${rangeHtml}${structHtml}</div>
      </details>

      <details class="acc">
        <summary><span class="acc-no">2</span>고객 1분 설명 화법</summary>
        <div class="acc-body">
          <div class="talk-list">
            ${g.talk.map((t, i) => `<div class="talk"><p>${t}</p><button type="button" class="copy-mini" data-copy="${i}">복사</button></div>`).join('')}
          </div>
        </div>
      </details>

      <details class="acc">
        <summary><span class="acc-no">3</span>증권 분석 함정</summary>
        <div class="acc-body">
          <ul class="trap-list">${g.traps.map((t) => `<li>${t}</li>`).join('')}</ul>
        </div>
      </details>

      <details class="acc">
        <summary><span class="acc-no">4</span>청구 · 약관 주의사항</summary>
        <div class="acc-body">
          <ul class="claim-list">${g.claim.map((t) => `<li>${t}</li>`).join('')}</ul>
        </div>
      </details>
    `;

    $$('.copy-mini', host).forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const i = Number(b.dataset.copy);
        const raw = g.talk[i].replace(/^"|"$/g, '');
        copy(raw, '화법을 복사했습니다');
      });
    });
  }

  /* ---------------- 탭 3: 툴킷 ---------------- */
  function renderToolkit() {
    const gen = $('#disclosure-general');
    gen.innerHTML = DISCLOSURE_GENERAL.map((d) => `
      <div class="disc-row">
        <div class="disc-period">${d.period}</div>
        <ul>${d.items.map((i) => `<li>${i}</li>`).join('')}</ul>
      </div>`).join('');

    const sim = $('#disclosure-simple');
    sim.innerHTML = DISCLOSURE_SIMPLE.map((d) => `
      <div class="disc-row">
        <div class="disc-period">${d.period}</div>
        <ul>${d.items.map((i) => `<li>${i}</li>`).join('')}</ul>
      </div>`).join('');

    const rowKeys = ['급여', '비급여', '자기부담', '재가입', '특징'];
    const t = $('#silson-table');
    t.innerHTML = `
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

  /* ---------------- 복사 · 토스트 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 1900);
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

  /* ---------------- 탭 전환 ---------------- */
  function switchView(name) {
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + name));
    $$('.tab').forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /* ---------------- 초기화 ---------------- */
  function init() {
    renderSegments();
    renderCoverageInputs();
    renderFlags();
    renderGuideChips();
    renderGuideBody();
    renderToolkit();

    $('#premium').addEventListener('input', (e) => {
      state.premium = clamp(Number(e.target.value || 0), 0, 300);
      if (state.analyzed) analyze();
    });

    $('#btn-analyze').addEventListener('click', () => {
      analyze();
      $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('#btn-kakao').addEventListener('click', () => {
      copy(kakaoText(), '카톡 요약을 복사했습니다');
    });

    $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

    // 탭2 딥링크: 진단 결과에서 담보로 이동
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
