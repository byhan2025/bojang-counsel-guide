/* 보장분석 상담 가이드 v3 — 화면 로직
   진단은 model.js, 리포트는 report.js/pdfkit.js, 라이브 상담은 live.js가 맡고
   이 파일은 입력·화면·저장·배포 동작을 연결합니다. */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cv = (item, part) => (state.cov[item.key] && state.cov[item.key][part.key]);

  const HKEY = 'bojang.history.v4';
  const VKEY = 'bojang.viewmode.v1';
  const SKEY = 'bojang.session.v4';

  const DEFAULT = {
    age: '40', gender: '남', job: '1', silson: '4', premium: 27,
    client: { name: '홍길동', birth: '', consultant: '' },
    contracts: [],
    family: [],
    disc: {},
    cov: {
      cancer: { general: 5000, similar: 1000, treatment: { surgery: 1000, drug: 1500, radio: 600, icu: 0, extra: 500 }, recur: true },
      brain: { dx: { vascular: 2000, stroke: 2000, bleed: 1000 }, treat: { lysis: 1000, surgery: 1500, icu: 0 } },
      heart: { dx: { ischemic: 2000, ami: 1000 }, treat: { lysis: 0, surgery: 1500, icu: 500 } },
      surgery: { disease: 50, disease15: 300, diseaseNdae: 500, diseaseNonPay: 0, injury: 50, injury15: 300 },
      care: { daily: 10, nDaily: 0, basis: 'time', family: 'conditional', nursing: true, ltc: false, mode: 'normal' }
    },
    flags: { savings: false, renew: true, manyRiders: false }
  };

  function todayLabel() {
    const d = new Date();
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  const state = {
    age: DEFAULT.age, gender: DEFAULT.gender, job: DEFAULT.job, silson: DEFAULT.silson, premium: DEFAULT.premium,
    client: Object.assign({}, DEFAULT.client, { dateLabel: todayLabel() }),
    contracts: [],
    family: [],
    disc: {},
    cov: JSON.parse(JSON.stringify(DEFAULT.cov)),
    flags: Object.assign({}, DEFAULT.flags),
    guide: 'cancer', view: 'advisor', step: 1, expanded: false, tab: 'analysis',
    analyzed: false, lastResult: null, label: '', history: []
  };
  window.__bojangState = state;

  const CLAIM_SHORT = {
    cancer: ['진단서 + 조직검사(병리) 결과지', '유사암은 담보별 1회한 문구 확인'],
    brain: ['진단서 + MRI·CT 판독지', 'I64는 추가 서류를 요구하는 경우 있음'],
    heart: ['심전도 · 트로포닌 · 관상동맥조영술', 'I20(협심증)과 I21(심근경색) 구분'],
    surgery: ['수술확인서(수술명·수술방법)', '수술명이 약관 분류표와 일치해야'],
    care: ['간병인 이용확인서 · 계약서 · 영수증', '장기요양은 인정서(등급정서)']
  };

  /* ================= 저장 ================= */
  function lsGet(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function saveSession() {
    lsSet(SKEY, {
      client: state.client, contracts: state.contracts, age: state.age, gender: state.gender,
      job: state.job, silson: state.silson, premium: state.premium, cov: state.cov, flags: state.flags,
      family: state.family, disc: state.disc
    });
  }
  function loadSession() {
    const s = lsGet(SKEY, null);
    if (!s) return;
    if (s.client) state.client = Object.assign(state.client, s.client, { dateLabel: todayLabel() });
    if (Array.isArray(s.contracts)) state.contracts = s.contracts;
    if (Array.isArray(s.family)) state.family = s.family.filter((k) => FAMILY_HISTORY.some((f) => f.key === k));
    if (s.disc && typeof s.disc === 'object') state.disc = s.disc;
    ['age', 'gender', 'job', 'silson', 'premium'].forEach((k) => { if (s[k] != null) state[k] = s[k]; });
    if (s.cov) state.cov = Object.assign(state.cov, s.cov);
    if (s.flags) state.flags = Object.assign(state.flags, s.flags);
    /* v4.2: 구버전 구조(단일 치료비·boolean 치료비·종수/N대·간병 일당)를 새 구조로 자동 변환 */
    state.migration = BojangModel.normalizeState(state);
  }

  /* ================= 모델 ================= */
  function model() { return BojangModel.full(state); }

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
        $$('.seg-btn', el).forEach((x) => { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
        b.classList.add('is-on');
        b.setAttribute('aria-pressed', 'true');
        onPick(it.value);
      });
      el.appendChild(b);
    });
  }

  function renderSegments() {
    buildSeg($('#seg-age'), AGES.map((a) => ({ value: a, label: a + '대' })), state.age, (v) => {
      state.age = v; state.ageAuto = false; renderCoverageCards(); refreshAll(); saveSession();
    });
    buildSeg($('#seg-gender'), [{ value: '남', label: '남성' }, { value: '여', label: '여성' }], state.gender, (v) => {
      state.gender = v; refreshAll(); saveSession();
    });
    buildSeg($('#seg-job'), [{ value: '1', label: '1급' }, { value: '2', label: '2급' }, { value: '3', label: '3급' }], state.job, (v) => {
      state.job = v; $('#job-hint').textContent = JOB_HINTS[v]; refreshAll(); saveSession();
    });
    buildSeg($('#seg-silson'), [
      { value: 'none', label: '없음' }, { value: '1', label: '1세대' }, { value: '2', label: '2세대' },
      { value: '3', label: '3세대' }, { value: '4', label: '4세대' }, { value: '5', label: '5세대' }
    ], state.silson, (v) => {
      state.silson = v; refreshAll(); saveSession();
    });
    $('#job-hint').textContent = JOB_HINTS[state.job];
    $('#premium').value = state.premium;
  }

  /* ================= 고객 정보 ================= */
  function renderClientFields() {
    $('#client-name').value = state.client.name === '홍길동' ? '' : state.client.name;
    $('#client-name').placeholder = '홍길동';
    $('#client-birth').value = state.client.birth || '';
    $('#consultant').value = state.client.consultant || '';
    updateBirthNote();
    renderClientStrip();
  }

  function updateBirthNote() {
    const note = $('#birth-note');
    const ad = state.client.birth ? BojangModel.nextAgeDay(state.client.birth) : null;
    const ia = state.client.birth ? BojangModel.insuranceAge(state.client.birth) : null;
    if (ad) {
      note.textContent = `보험나이 ${ia}세 · 상령일 ${ad.label} (D-${ad.days}) · 그날 지나면 보험나이 ${ad.insuranceAgeAfter}세`;
      note.classList.add('is-on');
    } else {
      note.textContent = '입력하면 보험나이와 상령일 D-day가 계산됩니다.';
      note.classList.remove('is-on');
    }
    renderClientStrip();
  }

  function renderClientStrip() {
    const m = state.client;
    $('#cs-name').textContent = (m.name || '홍길동') + '님';
    const ia = m.birth ? BojangModel.insuranceAge(m.birth) : null;
    const bits = [];
    bits.push(ia != null ? `보험나이 ${ia}세` : `연령대 ${state.age}대`);
    bits.push(`${state.gender} · ${state.job}급`);
    bits.push(`실손 ${SILSON_LABEL[state.silson]}`);
    bits.push(`월 ${won(state.premium)}만원`);
    if (state.contracts.length) bits.push(`계약 ${state.contracts.length}건`);
    $('#cs-meta').textContent = bits.join(' · ');
    const ad = m.birth ? BojangModel.nextAgeDay(m.birth) : null;
    const badge = $('#cs-dday');
    if (ad) {
      badge.hidden = false;
      badge.textContent = `상령일 D-${ad.days}`;
      badge.classList.toggle('is-soon', ad.days <= 30);
    } else badge.hidden = true;
  }

  function onBirthChange() {
    state.client.birth = $('#client-birth').value || '';
    if (state.client.birth) {
      const band = BojangModel.ageBandFromBirth(state.client.birth);
      if (band && band !== state.age) {
        state.age = band; state.ageAuto = true;
        syncSegments();
        renderCoverageCards();
        refreshAll();
        if ($('#age-hint')) $('#age-hint').textContent = '보험나이로 자동 선택';
      }
    }
    updateBirthNote();
    saveSession();
    if (state.analyzed) analyze();
  }

  /* ================= v4: 가족력 · 간편 고지 ================= */
  function renderFamilyChips() {
    const host = $('#family-chips');
    if (!host) return;
    host.innerHTML = FAMILY_HISTORY.map((f) => {
      const on = state.family.indexOf(f.key) >= 0;
      return `<button type="button" class="fam-chip${on ? ' is-on' : ''}${f.key === 'none' ? ' is-none' : ''}" data-fam="${f.key}" aria-pressed="${on}">
        <b>${f.label}</b><span>${f.note}</span>
      </button>`;
    }).join('');
    $$('.fam-chip', host).forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.fam;
        if (k === 'none') {
          state.family = state.family.indexOf('none') >= 0 ? [] : ['none'];
        } else {
          state.family = state.family.filter((x) => x !== 'none');
          state.family = state.family.indexOf(k) >= 0 ? state.family.filter((x) => x !== k) : state.family.concat(k);
          if (!state.family.length) state.family = [];
        }
        renderFamilyChips();
        refreshAll();
        saveSession();
      });
    });
    const note = $('#family-note');
    if (note) {
      const picked = state.family.filter((k) => k !== 'none');
      note.textContent = !state.family.length
        ? '선택하면 가족력 기반 보완 포인트가 진단·리포트에 함께 반영됩니다.'
        : picked.length
          ? `선택: ${picked.map((k) => (FAMILY_HISTORY.find((f) => f.key === k) || {}).label).join(' · ')} — ${BojangModel.familyNotes(state)[0] ? BojangModel.familyNotes(state)[0].body : ''}`
          : '가족력 해당 없음으로 기록했습니다. 이 경우 예방·정기검진 안내 중심으로 설명합니다.';
      note.classList.add('is-on');
    }
    renderSummary();
  }

  function renderDisclosure() {
    const host = $('#disclosure-checks');
    if (!host) return;
    const groups = ['3개월', '1년', '5년'];
    host.innerHTML = groups.map((g) => {
      const items = DISCLOSURE_ITEMS.filter((d) => d.period === g);
      return `<div class="dc-group">
        <div class="dc-period">${g}<em>${g === '3개월' ? '최근 3개월 이내' : g === '1년' ? '최근 1년 이내' : '최근 5년 이내'}</em></div>
        ${items.map((d) => {
          const on = !!state.disc[d.key];
          return `<button type="button" class="dc-item${on ? ' is-on' : ''}" data-disc="${d.key}" aria-pressed="${on}">
            <span class="dc-box" aria-hidden="true"></span><span class="dc-label">${d.label}</span>
          </button>`;
        }).join('')}
      </div>`;
    }).join('');
    $$('.dc-item', host).forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.disc;
        state.disc[k] = !state.disc[k];
        renderDisclosure();
        saveSession();
        renderSummary();
        if (state.analyzed) analyze();
      });
    });
    const verdict = $('#disclosure-verdict');
    if (verdict) {
      const j = BojangModel.disclosureJudge(state);
      verdict.className = 'verdict tone-' + j.tone;
      verdict.innerHTML = `
        <div class="vd-head"><span class="vd-tag">심사 판정</span><strong>${j.label}</strong></div>
        <p class="vd-main">${j.headline}</p>
        <p class="vd-advice">${j.advice}</p>
        ${j.reasons.length ? `<div class="vd-reasons">${j.reasons.map((r) => `<span>${r}</span>`).join('')}</div>` : '<div class="vd-reasons"><span>체크된 항목 없음 — 표준체 우선</span></div>'}
      `;
    }
  }

  /* ================= 담보 입력 카드 ================= */
  function partBadge(stateKey, part) {
    const item = PRIORITY.find((p) => p.key === stateKey);
    const r = BojangModel.evalItem(state, item);
    const pr = r.parts.find((p) => p.key === part.key);
    const pct = Math.round(pr.fill * 100);
    const tone = pr.fill >= 1 ? 'ok' : pr.fill >= 0.5 ? 'need' : 'gap';
    return `<span class="mini-badge tone-${tone}">${pct}%</span>`;
  }

  /* v4.2: 최소 · 권장 · 충분 3단계 게이지 */
  function tierGaugeHTML(pr) {
    const t = pr.tiers;
    if (!t || !pr.stage) return '';
    const pos = (v) => Math.max(2, Math.min(100, Math.round((Number(v) / t.enough) * 100)));
    const pct = pr.stage.pct;
    return `
      <div class="tier-gauge tone-${pr.stage.code === 'none' ? 'gap' : pr.stage.code === 'low' ? 'warn' : pr.stage.code === 'min' ? 'need' : 'ok'}">
        <div class="tg-track">
          <i style="width:${pct}%"></i>
          <span class="tg-mark" style="left:${pos(t.min)}%"><em>최소</em></span>
          <span class="tg-mark" style="left:${pos(t.rec)}%"><em>권장</em></span>
          <span class="tg-mark end" style="left:100%"><em>충분</em></span>
        </div>
        <div class="tg-legend">
          <span class="tg-state">${pr.stage.label}</span>
          <span>최소 ${won(t.min)} · 권장 ${won(t.rec)} · 충분 ${won(t.enough)}${pr.part && pr.part.key === 'daily' ? '만원' : '만원'}</span>
        </div>
      </div>`;
  }

  /* v5.0: 범위별 진단비 3단계(뇌) · 2단계(심장) — 진단 시 합산 지급 안내 */
  function dxRowHTML(item, part) {
    const ev = BojangModel.evalItem(state, item);
    const pr = ev.parts.find((p) => p.key === part.key) || { subs: [], rec: 0, fill: 0, dx: {} };
    const subs = pr.subs || [];
    const dx = pr.dx || {};
    const core = dx.core;
    const hi = part.max || 5000;
    const scen = dx.scenarios || [];
    return `
      <div class="part dx-group" data-part="${part.key}">
        <div class="part-head">
          <div class="part-label"><strong>${part.label}</strong><span>${part.hint}</span></div>
          <div class="part-side">${core ? `<span class="mini-badge tone-${core.fill >= 1 ? 'ok' : core.fill > 0 ? 'need' : 'gap'}" data-dxbadge>${Math.round(core.fill * 100)}%</span>` : ''}</div>
        </div>
        <div class="dx-core${dx.gapWarn ? ' is-warn' : ''}">
          <span class="dxc-label">핵심 범위</span>
          <b data-dxcore>${won(core ? core.val : 0)}</b><em>만원</em>
          <span class="dxc-rec">권장 ${won(pr.rec)}만원</span>
          <span class="dxc-state">${core && core.val >= 2000 ? '기준선 충족' : '기준선 미달'}</span>
        </div>
        <div class="dx-warn${dx.gapWarn ? ' is-on' : ''}" data-dxwarn>
          ⚠ <b>범위 공백 경고</b> — ${esc(dx.gapLabel || '')} 금액이 0원입니다. ${item.key === 'brain' ? '뇌경색(I63)은 뇌졸중 금액만 지급되고, 뇌혈관 후유증(I69)은 지급되지 않습니다.' : '협심증(I20)과 스텐트 시술 구간이 지급되지 않습니다.'}
        </div>
        <div class="dx-scen">
          <span class="ds-title">진단 시 합산</span>
          ${scen.map((s) => `<span class="ds-chip"><em>${esc(s.label)}</em><b data-dxscen="${esc(s.code)}">${won(s.sum)}만원</b><i>${esc(s.note)}</i></span>`).join('')}
        </div>
        ${subs.map((s) => `
          <div class="sub-row dx-sub${s.isCore ? ' is-core' : ''}" data-sub="${s.key}">
            <div class="sr-head">
              <div class="part-label"><strong>${esc(s.label)}</strong>${s.isCore ? '<span class="core-tag">핵심</span>' : ''}<span class="code-chip">${esc(s.codes || '')}</span></div>
              <span class="mini-badge tone-${s.fill >= 1 ? 'ok' : s.fill > 0 ? 'need' : 'gap'}">${s.pct}%</span>
            </div>
            <div class="input-row">
              <span class="di-tag">직접입력</span>
              <input type="number" inputmode="numeric" min="0" max="${hi}" step="${part.step || 500}"
                     data-item="${item.key}" data-part="${part.key}" data-sub="${s.key}"
                     value="${s.val}" placeholder="0~${won(hi)}" aria-label="${esc(s.label)} 직접입력 (만원)">
              <span class="unit">만원</span>
            </div>
            <div class="quick-row">
              ${(part.quick || []).map((q) => `<button type="button" class="quick" data-set="${q}" data-item="${item.key}" data-part="${part.key}" data-sub="${s.key}">${q === 0 ? '없음' : won(q)}</button>`).join('')}
              <span class="rec-hint">권장 ${won(s.rec)}만원</span>
            </div>
            <p class="sub-hint">${esc(s.hint || '')}</p>
          </div>`).join('')}
        <p class="treat-note">각 칸 0~${won(hi)}만원 · 안쪽 담보는 바깥 담보에 포함되며 진단 시 금액이 합산됩니다. ${item.key === 'brain' ? '뇌혈관질환(권장 2,000)이 0원이면 가장 흔한 뇌경색(I63)과 후유증(I69)이 비어 있습니다.' : '허혈성심장질환(권장 2,000)이 0원이면 협심증(I20)·스텐트 시술이 비어 있습니다.'} 대부분 최초 1회한이고 1년 미만은 50% 감액입니다.</p>
      </div>`;
  }

  function amountRowHTML(item, part) {
    const ev = BojangModel.evalItem(state, item);
    const pr = ev.parts.find((p) => p.key === part.key) || { rec: 0, val: 0, fill: 0 };
    const rec = pr.rec;
    const val = pr.val || 0;
    const lim = (part.min != null || part.max != null)
      ? `<span class="rec-hint">${part.min != null ? won(part.min) + '~' : ''}${part.max != null ? won(part.max) : ''}만원</span>` : '';
    return `
      <div class="part" data-part="${part.key}">
        <div class="part-head">
          <div class="part-label"><strong>${part.label}</strong>${part.hint ? `<span>${part.hint}</span>` : ''}</div>
          <div class="part-side">${pr.stage ? `<span class="mini-badge tone-${pr.stage.code === 'none' ? 'gap' : pr.stage.code === 'low' ? 'warn' : pr.stage.code === 'min' ? 'need' : 'ok'}">${pr.stage.label}</span>` : ''}${partBadge(item.key, part)}</div>
        </div>
        <div class="input-row">
          <span class="di-tag">직접입력</span>
          <input type="number" inputmode="numeric" min="0" step="${part.step}" data-item="${item.key}" data-part="${part.key}"
                 value="${val}" placeholder="숫자 입력" aria-label="${part.label} 직접입력 (만원)">
          <span class="unit">만원</span>
        </div>
        <div class="quick-row">
          ${part.quick.map((q) => `<button type="button" class="quick" data-set="${q}" data-item="${item.key}" data-part="${part.key}">${q === 0 ? '없음' : won(q)}</button>`).join('')}
          ${lim || `<span class="rec-hint">권장 ${won(rec)}만원</span>`}
        </div>
        ${tierGaugeHTML(pr)}
      </div>`;
  }

  /* v4.2: 주요치료비 그룹 — 암 5종 · 뇌/심장 3종 공통 */
  function groupRowHTML(item, part) {
    const baseRec = item.rec[state.age] || 0;
    const cur = cv(item, part);
    const src = (cur && typeof cur === 'object') ? cur : {};
    const list = part.subs || BojangModel.TREAT_SUBS;
    const subs = list.map((sp) => {
      const rec = BojangModel.subRec(baseRec, sp, part);
      const val = Number(src[sp.key] || 0) || 0;
      const fill = rec > 0 ? clamp(val / rec, 0, 1) : 0;
      return { sp, rec, val, fill, pct: Math.round(fill * 100) };
    });
    const valSum = subs.reduce((a, s) => a + s.val, 0);
    const recSum = subs.reduce((a, s) => a + s.rec, 0);
    const have = subs.filter((s) => s.val > 0).length;
    const n = subs.length;
    const lo = part.min || 500, hi = part.max || 3000;
    return `
      <div class="part treat-group" data-part="${part.key}">
        <div class="part-head">
          <div class="part-label"><strong>${part.label}</strong><span>${part.hint}</span></div>
          <div class="part-side">${partBadge(item.key, part)}</div>
        </div>
        <div class="treat-sum">
          <span>${n}종 합계 <b>${won(valSum)}</b>만원<em>${have}/${n}종 보유</em></span>
          <span class="ts-rec">권장 합계 ${won(recSum)}만원</span>
        </div>
        ${subs.map(({ sp, rec, val, pct }) => `
          <div class="sub-row" data-sub="${sp.key}">
            <div class="sr-head">
              <div class="part-label"><strong>${sp.label}</strong><span>${sp.hint}</span></div>
              <span class="mini-badge tone-${pct >= 100 ? 'ok' : pct >= 50 ? 'need' : 'gap'}">${pct}%</span>
            </div>
            <div class="input-row">
              <span class="di-tag">직접입력</span>
              <input type="number" inputmode="numeric" min="0" max="${hi}" step="${part.step || 500}"
                     data-item="${item.key}" data-part="${part.key}" data-sub="${sp.key}"
                     value="${val}" placeholder="${lo}~${won(hi)}" aria-label="${sp.label} 직접입력 (만원)">
              <span class="unit">만원</span>
            </div>
            <div class="quick-row">
              ${(part.quick || []).map((q) => `<button type="button" class="quick" data-set="${q}" data-item="${item.key}" data-part="${part.key}" data-sub="${sp.key}">${q === 0 ? '없음' : won(q)}</button>`).join('')}
              <span class="rec-hint">권장 ${won(rec)}만원</span>
            </div>
          </div>`).join('')}
        <p class="treat-note">각 항목 ${won(lo)}만~${won(hi)}만원 · 미가입은 0 · 직접입력은 권장 범위 밖 값도 저장됩니다.${item.key === 'brain' || item.key === 'heart' ? ' 대부분 최초 1회한·연 1회한이고 1년 미만은 50% 감액됩니다. 혈전용해제를 투여하지 않은 기계적 혈전제거술은 별도 담보입니다.' : ''}</p>
      </div>`;
  }

  function scaleRowHTML(item, part) {
    const cur = cv(item, part) || 'none';
    return `
      <div class="part" data-part="${part.key}">
        <div class="part-head">
          <div class="part-label"><strong>${part.label}</strong><span>담보명 기준 · 포함 범위</span></div>
          <div class="part-side">${partBadge(item.key, part)}</div>
        </div>
        <div class="scale-pick">
          ${part.options.map((o) => `
            <button type="button" class="scale-opt${cur === o.v ? ' is-on' : ''}" data-item="${item.key}" data-part="${part.key}" data-val="${o.v}">
              <span class="so-dot"></span>
              <span class="so-label">${o.label}</span>
              <span class="so-hint">${o.hint || ''}</span>
            </button>`).join('')}
        </div>
      </div>`;
  }

  function boolRowHTML(item, part) {
    const on = !!cv(item, part);
    return `
      <label class="switch-row" data-part="${part.key}">
        <div class="part-label"><strong>${part.label}</strong>${part.hint ? `<span>${part.hint}</span>` : ''}</div>
        <input type="checkbox" data-item="${item.key}" data-part="${part.key}" ${on ? 'checked' : ''}>
        <span class="sw" aria-hidden="true"></span>
      </label>`;
  }

  function cardHTML(item, extra) {
    const r = BojangModel.evalItem(state, item);
    const rowOf = (p) => p.type === 'amount' ? amountRowHTML(item, p)
      : p.type === 'group' ? groupRowHTML(item, p)
        : p.type === 'dxset' ? dxRowHTML(item, p)
          : p.type === 'scale' ? scaleRowHTML(item, p) : boolRowHTML(item, p);
    return `
      <div class="card cov-card" data-item="${item.key}">
        <div class="card-title">
          <span class="cov-rank">${item.rank}</span>${item.name}
          <span class="card-sub">${item.sub}</span>
          <span class="badge badge-${r.level}">${r.label}</span>
        </div>
        ${item.parts.map(rowOf).join('')}
        ${extra || ''}
      </div>`;
  }

  function renderCoverageCards() {
    const cancer = PRIORITY[0], brain = PRIORITY[1], heart = PRIORITY[2], surgery = PRIORITY[3], care = PRIORITY[4];
    $('#card-cancer').innerHTML = cardHTML(cancer, '');
    $('#card-brain').innerHTML = cardHTML(brain, '');
    $('#card-heart').innerHTML = cardHTML(heart, '');
    const careMode = state.cov.care.mode || 'normal';
    $('#card-surgery').innerHTML = cardHTML(surgery, '');
    $('#card-care').innerHTML = cardHTML(care, `
      <div class="part">
        <div class="part-head"><div class="part-label"><strong>일당 지급 방식</strong><span>체증형은 입원일수 증가 시 증액</span></div></div>
        <div class="seg seg-2">
          <button type="button" class="seg-btn${careMode === 'normal' ? ' is-on' : ''}" data-caremode="normal">일반형</button>
          <button type="button" class="seg-btn${careMode === 'step' ? ' is-on' : ''}" data-caremode="step">체증형</button>
        </div>
      </div>`);
    bindCoverageInputs();
  }

  function emptyFor(itemKey, partKey) {
    if (partKey === 'dx') {
      const out = {};
      (BojangModel.DX_SUBS[itemKey] || []).forEach((s) => { out[s.key] = 0; });
      return out;
    }
    return itemKey === 'cancer' ? BojangModel.emptyTreat() : BojangModel.emptyNeuro();
  }

  function bindCoverageInputs() {
    $$('#wiz-panels input[type="number"][data-item]').forEach((input) => {
      input.addEventListener('input', () => {
        const it = input.dataset.item, pt = input.dataset.part, sb = input.dataset.sub;
        const v = clamp(Number(input.value || 0), 0, 100000);
        if (sb) {
          const box = state.cov[it][pt];
          if (box && typeof box === 'object') box[sb] = v;
          else state.cov[it][pt] = Object.assign(emptyFor(it, pt), { [sb]: v });
        } else state.cov[it][pt] = v;
        refreshBadges(); saveSession();
      });
    });
    $$('#wiz-panels .quick[data-set]').forEach((b) => {
      b.addEventListener('click', () => {
        const it = b.dataset.item, pt = b.dataset.part, sb = b.dataset.sub, v = Number(b.dataset.set);
        if (sb) {
          const box = state.cov[it][pt];
          if (box && typeof box === 'object') box[sb] = v;
          else state.cov[it][pt] = Object.assign(emptyFor(it, pt), { [sb]: v });
          const sinput = $(`input[data-item="${it}"][data-part="${pt}"][data-sub="${sb}"]`);
          if (sinput) sinput.value = v;
        } else {
          state.cov[it][pt] = v;
          const input = $(`input[data-item="${it}"][data-part="${pt}"]:not([data-sub])`);
          if (input) input.value = v;
        }
        refreshBadges(); saveSession();
      });
    });
    $$('#wiz-panels .scale-opt').forEach((b) => {
      b.addEventListener('click', () => {
        const it = b.dataset.item, pt = b.dataset.part;
        state.cov[it][pt] = b.dataset.val;
        $$(`.scale-opt[data-item="${it}"][data-part="${pt}"]`).forEach((x) => x.classList.toggle('is-on', x === b));
        refreshBadges(); saveSession();
      });
    });
    $$('#wiz-panels input[type="checkbox"][data-item]').forEach((cb) => {
      cb.addEventListener('change', () => {
        state.cov[cb.dataset.item][cb.dataset.part] = cb.checked;
        refreshBadges(); saveSession();
      });
    });
    $$('[data-caremode]').forEach((b) => {
      b.addEventListener('click', () => {
        state.cov.care.mode = b.dataset.caremode;
        $$('[data-caremode]').forEach((x) => x.classList.toggle('is-on', x === b));
        refreshBadges(); saveSession();
      });
    });
    syncQuickStates();
  }

  function refreshBadges() {
    PRIORITY.forEach((item) => {
      const r = BojangModel.evalItem(state, item);
      const card = $(`.cov-card[data-item="${item.key}"]`);
      if (!card) return;
      const b = $('.card-title .badge', card);
      b.className = 'badge badge-' + r.level;
      b.textContent = r.label;
      r.parts.forEach((p) => {
        const row = $(`.part[data-part="${p.key}"]`, card);
        if (!row) return;
        const badge = $('.mini-badge', row);
        if (badge) {
          const pct = Math.round(p.fill * 100);
          badge.className = 'mini-badge tone-' + (p.fill >= 1 ? 'ok' : p.fill >= 0.5 ? 'need' : 'gap');
          badge.textContent = pct + '%';
        }
        if (p.type === 'dxset') {
          const d = p.dx || {};
          const core = d.core;
          const coreEl = $('[data-dxcore]', row);
          if (coreEl) coreEl.textContent = won(core ? core.val : 0);
          const badgeEl = $('[data-dxbadge]', row);
          if (badgeEl) {
            badgeEl.className = 'mini-badge tone-' + (core && core.fill >= 1 ? 'ok' : core && core.fill > 0 ? 'need' : 'gap');
            badgeEl.textContent = (core ? Math.round(core.fill * 100) : 0) + '%';
          }
          const warnEl = $('[data-dxwarn]', row);
          if (warnEl) warnEl.classList.toggle('is-on', !!d.gapWarn);
          const coreBox = $('.dx-core', row);
          if (coreBox) coreBox.classList.toggle('is-warn', !!d.gapWarn);
          (d.scenarios || []).forEach((sc) => {
            const el = $(`[data-dxscen="${sc.code}"]`, row);
            if (el) el.textContent = won(sc.sum) + '만원';
          });
        }
        if (p.subs) {
          p.subs.forEach((s) => {
            const sr = $(`.sub-row[data-sub="${s.key}"]`, row);
            if (!sr) return;
            const b = $('.mini-badge', sr);
            if (!b) return;
            b.className = 'mini-badge tone-' + (s.fill >= 1 ? 'ok' : s.fill >= 0.5 ? 'need' : 'gap');
            b.textContent = s.pct + '%';
          });
          const sumEl = $('.treat-sum b', row);
          if (sumEl) sumEl.textContent = won(p.val);
          const emEl = $('.treat-sum em', row);
          if (emEl) emEl.textContent = p.subs.filter((s) => s.val > 0).length + '/' + p.subs.length + '종 보유';
          const recEl = $('.treat-sum .ts-rec', row);
          if (recEl) recEl.textContent = `권장 합계 ${won(p.rec)}만원`;
        } else if (p.stage) {
          const g = $('.tier-gauge', row);
          if (g) {
            const t = p.tiers;
            const pos = (v) => Math.max(2, Math.min(100, Math.round((Number(v) / t.enough) * 100)));
            g.className = 'tier-gauge tone-' + (p.stage.code === 'none' ? 'gap' : p.stage.code === 'low' ? 'warn' : p.stage.code === 'min' ? 'need' : 'ok');
            const bar = $('.tg-track i', g);
            if (bar) bar.style.width = p.stage.pct + '%';
            const st = $('.tg-state', g);
            if (st) st.textContent = p.stage.label;
          }
          const sb = $('.part-side .mini-badge', row);
          if (sb) {
            sb.className = 'mini-badge tone-' + (p.stage.code === 'none' ? 'gap' : p.stage.code === 'low' ? 'warn' : p.stage.code === 'min' ? 'need' : 'ok');
            sb.textContent = p.stage.label;
          }
        }
      });
    });
    renderSummary();
    renderClientStrip();
    syncQuickStates();
    refreshQuickValues();
    if (state.analyzed) analyze();
  }

  /* 직접입력 값과 같은 빠른 선택 칭을 켜 둔다 (입력 ↔ 칭 상호 확인) */
  function syncQuickStates() {
    $$('#wiz-panels .quick[data-set]').forEach((b) => {
      const it = b.dataset.item, pt = b.dataset.part, sb = b.dataset.sub;
      let v = 0;
      if (sb) {
        const box = state.cov[it] && state.cov[it][pt];
        v = box && typeof box === 'object' ? Number(box[sb] || 0) : 0;
      } else {
        v = Number((state.cov[it] || {})[pt] || 0);
      }
      b.classList.toggle('is-on', Number(b.dataset.set) === v);
      b.setAttribute('aria-pressed', String(Number(b.dataset.set) === v));
    });
    $$('#premium-quick .quick[data-premium]').forEach((b) => {
      b.classList.toggle('is-on', Number(b.dataset.premium) === Number(state.premium));
    });
  }
  function refreshAll() { refreshBadges(); }

  /* ================= 계약 목록 ================= */
  function renderContracts() {
    const host = $('#contract-list');
    if (!host) return;
    if (!state.contracts.length) {
      host.innerHTML = '<p class="ct-empty">아직 추가한 계약이 없습니다. 있어야 10장 PDF의 포트폴리오 표가 채워집니다.</p>';
    } else {
      host.innerHTML = state.contracts.map((c, i) => `
        <div class="ct-row" data-i="${i}">
          <div class="ct-main">
            <div class="ct-ins">${esc(c.insurer || '보험사 미입력')} <span class="ct-tag ${c.renew ? '' : 'no'}">${c.renew ? '갱신형' : '비갱신'}</span></div>
            <div class="ct-prod">${esc(c.product || '상품명 미입력')}</div>
            <div class="ct-meta">
              <span class="ct-pay ${c.pay === '납입완료' ? 'is-done' : ''}">${c.pay || '납입중'}</span>
              <span class="ct-mat">만기 ${c.maturity || '미입력'}</span>
            </div>
          </div>
          <span class="ct-prem">${won(c.premium)}만원</span>
          <button type="button" class="ct-del" data-del="${i}" aria-label="삭제">×</button>
        </div>`).join('');
      $$('[data-del]', host).forEach((b) => {
        b.addEventListener('click', () => {
          state.contracts.splice(Number(b.dataset.del), 1);
          renderContracts(); renderClientStrip(); saveSession();
          if (state.analyzed) analyze();
        });
      });
    }
    const total = state.contracts.reduce((a, c) => a + Number(c.premium || 0), 0);
    const applyBtn = $('#ct-apply');
    if (applyBtn) applyBtn.hidden = !(state.contracts.length && total > 0 && Math.abs(total - Number(state.premium)) >= 1);
    const el = $('#contract-total');
    if (el) {
      const cs = BojangModel.contractStats(state.contracts);
      el.textContent = state.contracts.length
        ? `계약 ${cs.count}건 · 합계 월 ${won(cs.total)}만원 · 납입중 ${cs.activeCount}건 ${won(cs.activePremium)}만원 · 납입완료 ${cs.paidUpCount}건${cs.shortMaturityCount ? ` · 만기 80·90세 ${cs.shortMaturityCount}건` : ''}${Math.abs(cs.total - Number(state.premium)) >= 1 ? ` (입력한 월 보험료 ${won(state.premium)}만원과 다릅니다)` : ''}`
        : '계약을 추가하면 10장 PDF의 포트폴리오 표와 노후 전망이 채워집니다.';
    }
  }

  function addContract() {
    const insurer = ($('#ct-insurer').value || '').trim();
    const product = ($('#ct-product').value || '').trim();
    const premium = clamp(Number($('#ct-premium').value || 0), 0, 300);
    const renew = $('#ct-renew').checked;
    const pay = ($('#ct-pay').value || '납입중');
    const maturity = ($('#ct-maturity').value || '미입력');
    if (!insurer && !product) { toast('보험사나 상품명을 입력해 주세요'); return; }
    state.contracts.push({ insurer, product, premium, renew, pay, maturity });
    $('#ct-insurer').value = ''; $('#ct-product').value = ''; $('#ct-premium').value = ''; $('#ct-renew').checked = false;
    $('#ct-pay').value = '납입중'; $('#ct-maturity').value = '미입력';
    renderContracts(); renderClientStrip(); saveSession();
    if (state.analyzed) analyze();
    toast('계약을 추가했습니다');
  }

  /* ================= 점수·레이더·통계 ================= */
  function radarSVG(rows) {
    const cx = 116, cy = 108, R = 74;
    const n = rows.length;
    const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pt = (i, r) => [cx + Math.cos(ang(i)) * R * r, cy + Math.sin(ang(i)) * R * r];
    const ringPoly = (r) => rows.map((_, i) => pt(i, r).map((v) => v.toFixed(1)).join(',')).join(' ');
    let s = `<svg viewBox="0 0 240 224" class="radar" role="img" aria-label="보장 밸런스 5축 레이더 차트">`;
    s += `<defs><linearGradient id="radarFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0fb093" stop-opacity=".35"/><stop offset="100%" stop-color="#1b4a78" stop-opacity=".22"/></linearGradient></defs>`;
    [0.25, 0.5, 0.75, 1].forEach((r) => {
      s += `<polygon points="${ringPoly(r)}" fill="none" stroke="#dbe4ef" stroke-width="1"/>`;
    });
    rows.forEach((_, i) => {
      const p = pt(i, 1);
      s += `<line x1="${cx}" y1="${cy}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="#e5ecf5" stroke-width="1"/>`;
    });
    const dataPts = rows.map((row, i) => pt(i, clamp(row.r.fill, 0.04, 1)));
    s += `<polygon points="${dataPts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="url(#radarFill)" stroke="#0fb093" stroke-width="1.8" stroke-linejoin="round"/>`;
    dataPts.forEach((p) => { s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#0fb093"/>`; });
    rows.forEach((row, i) => {
      const p = pt(i, 1.235);
      const anchor = p[0] < cx - 4 ? 'end' : p[0] > cx + 4 ? 'start' : 'middle';
      const dy = p[1] < cy - 40 ? -3 : p[1] > cy + 40 ? 10 : 3;
      s += `<text x="${p[0].toFixed(1)}" y="${(p[1] + dy).toFixed(1)}" text-anchor="${anchor}" class="rd-label">${row.item.name}</text>`;
      s += `<text x="${p[0].toFixed(1)}" y="${(p[1] + dy + 11).toFixed(1)}" text-anchor="${anchor}" class="rd-value">${Math.round(row.r.fill * 100)}%</text>`;
    });
    s += `</svg>`;
    return `<div class="radar-wrap">${s}</div>`;
  }

  function fmtVal(v, unit) { return won(v) + (unit || ''); }

  function statsHTML() {
    return STATS.map((st) => {
      if (st.stacked) {
        const total = st.stacked.reduce((a, b) => a + b.value, 0);
        const tones = ['#0b2545', '#1b4a78', '#3f7ba6', '#6fa3c4', '#a8c8dc', '#d3e2ee'];
        const segs = st.stacked.map((s, i) => {
          const w = (s.value / total) * 100;
          const dark = i >= 3;
          return `<span class="stk-seg${dark ? ' is-light' : ''}" style="width:${w.toFixed(2)}%;background:${tones[i % tones.length]}" title="${s.label} ${s.value}%"><b>${s.value >= 8 ? s.value + '%' : ''}</b></span>`;
        }).join('');
        const legend = st.stacked.map((s, i) => `<span class="stk-li"><i style="background:${tones[i % tones.length]}"></i>${s.label} ${s.value}%</span>`).join('');
        return `
          <div class="stat-card">
            <div class="stat-head"><strong>${st.title}</strong><span class="stat-badge">${st.headlineValue}</span></div>
            <p class="stat-sub">${st.headline}</p>
            <div class="stk-bar">${segs}</div>
            <div class="stk-legend">${legend}</div>
            ${st.notes ? `<div class="stat-notes">${st.notes.map((n) => `<span>${n}</span>`).join('')}</div>` : ''}
            <p class="stat-source">출처: ${st.source}</p>
          </div>`;
      }
      const rowsHTML = st.rows.map((r) => {
        const pctW = Math.max(3, (r.value / st.max) * 100);
        const valText = r.unit === '명' ? fmtVal(r.value, '명') : r.value + '%';
        return `
          <div class="stat-row">
            <span class="sl">${r.label}${r.rank ? `<em>${r.rank}</em>` : ''}</span>
            <span class="sb"><i style="width:${pctW}%"></i></span>
            <b class="sv">${valText}</b>
          </div>`;
      }).join('');
      return `
        <div class="stat-card">
          <div class="stat-head"><strong>${st.title}</strong><span class="stat-badge">${st.headlineValue}</span></div>
          <p class="stat-sub">${st.headline}</p>
          <div class="stat-rows">${rowsHTML}</div>
          ${st.notes ? `<div class="stat-notes">${st.notes.map((n) => `<span>${n}</span>`).join('')}</div>` : ''}
          <p class="stat-source">출처: ${st.source}</p>
        </div>`;
    }).join('');
  }

  /* ================= 진단 ================= */
  function analyze() {
    const m = model();
    const rows = m.rows;
    const sc = { score: m.score, grade: m.grade, penalty: m.penalty, w: m.weights };
    const totalSum = m.totalSum, annual = m.annual;
    const R = 52, Cc = 2 * Math.PI * R;
    const dash = Cc * (1 - sc.score / 100);

    $('#result-hero').innerHTML = `
      <div class="hero-top">
        <span class="hero-eyebrow">COVERAGE SCORE</span>
        <span class="hero-input">${state.client.name}님 · ${state.age}대 ${state.gender} · ${state.job}급 · 실손 ${SILSON_LABEL[state.silson]}</span>
      </div>
      <div class="score-wrap">
        <div class="ring-box">
          <svg viewBox="0 0 120 120" class="ring" aria-hidden="true">
            <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8ff0dc"/><stop offset="100%" stop-color="#0fb093"/></linearGradient></defs>
            <circle cx="60" cy="60" r="${R}" class="ring-bg"/>
            <circle cx="60" cy="60" r="${R}" class="ring-fg" stroke="url(#ringGrad)" style="stroke-dasharray:${Cc.toFixed(1)};stroke-dashoffset:${dash.toFixed(1)}"/>
          </svg>
          <div class="ring-text"><strong>${sc.score}</strong><span>/100</span></div>
        </div>
        <div class="score-copy">
          <span class="score-grade tone-${sc.grade.tone}">${sc.grade.label} · ${m.letter}</span>
          <h3>${sc.grade.line}</h3>
          <p>${BojangModel.oneLine(state, m)}</p>
        </div>
      </div>
      <div class="hero-stats">
        <div><span>주요 진단비 합계</span><strong>${won(totalSum)}만원</strong></div>
        <div><span>월 보험료</span><strong>${won(state.premium)}만원</strong></div>
        <div><span>연 보험료 대비</span><strong>${annual > 0 ? (totalSum / annual).toFixed(1) + '배' : '—'}</strong></div>
      </div>
      <div class="weight-notes">
        ${weightNotes(m).filter((c) => state.view === 'advisor' || !c.internal).map((c) => `<span class="${c.internal ? 'internal' : ''}">${c.t}</span>`).join('')}
      </div>
      <div class="score-formula">${state.view === 'advisor'
        ? '가중치 ' + PRIORITY.map((p) => `${p.name} ${sc.w[p.key]}`).join(' · ') + (sc.penalty.length ? ' / 감점 ' + sc.penalty.map((p) => `${p.t} ${p.v}`).join(', ') : '')
        : '연령대·직업급수·실손 세대를 반영한 가중 평균 (자체 산식)'}</div>
    `;

    $('#radar').innerHTML = radarSVG(rows);
    $('#stats').innerHTML = statsHTML();

    const rowsHost = $('#result-rows');
    rowsHost.innerHTML = '';
    rows.forEach(({ item, r, pct, level, label, summary, gaps }) => {
      const el = document.createElement('div');
      el.className = 'prow';
      const tail = summary + (gaps.length ? ` · 부족 ${gaps.map((g) => won(g.need) + '만원').join(', ')}` : '');
      el.innerHTML = `
        <div class="prow-head">
          <span class="prow-rank">${item.rank}</span>
          <div class="prow-name"><strong>${item.name}</strong><span>${item.sub}</span></div>
          <span class="prow-pct tone-${level}">${pct}<i>%</i></span>
          <span class="badge badge-${level}">${label}</span>
        </div>
        <div class="gauge"><div class="gauge-track"><i class="gauge-fill tone-bg-${level}" style="width:${pct === 0 ? 0 : Math.max(3, pct)}%"></i></div>
          <div class="gauge-scale"><span>0</span><span>기준선 100%</span></div></div>
        <div class="prow-tail"><span>${tail}</span><button type="button" class="prow-jump" data-jump="${item.key}">가이드 ›</button></div>
      `;
      rowsHost.appendChild(el);
    });

    $('#result-checkpoints').innerHTML = m.checkpoints.map((c) => `
      <div class="cp cp-${c.level}"><div class="cp-title">${c.title}</div><p>${c.body}</p></div>`).join('');

    $('#result-steps').innerHTML = m.steps.map((s, i) => `
      <div class="step"><div class="step-no">${i + 1}</div><div class="step-body"><strong>${s.title}</strong><p>${s.body}</p></div></div>`).join('');

    $('#claim-guide').innerHTML = PRIORITY.map((item) => `
      <div class="claim-row"><span class="cr-rank">${item.rank}</span><strong>${item.name}</strong><span>${CLAIM_SHORT[item.key].join(' · ')}</span></div>`).join('');

    $('#ph-client').textContent = `${m.client.name} · ${state.age}대 ${state.gender} · ${state.job}급 · 실손 ${SILSON_LABEL[state.silson]}`;
    $('#ph-date').textContent = m.dateLabel;

    state.lastResult = { rows, m, needCount: m.needList.length, first: m.first, totalSum, annual, score: sc };
    state.analyzed = true;
    $('#result').hidden = false;
    $('#save-bar').hidden = false;
    if (window.BojangLive) window.BojangLive.markDirty();
    if (window.BojangDeck) window.BojangDeck.refresh(state);
  }

  function weightNotes(m) {
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
    if (m.first) out.push({ t: `${m.first.item.rank}순위 ${m.first.item.name}이 ${m.first.pct}%로 가장 크게 비어 있습니다.`, internal: true });
    return out;
  }

  /* ================= 카톡 ================= */
  function kakaoText() {
    const res = state.lastResult;
    if (!res) return '';
    const m = res.m;
    const L = [];
    L.push(`[${m.client.name}님 보장분석 요약]`);
    L.push(`${state.age}대 ${state.gender} · 직업 ${state.job}급 · 실손 ${SILSON_LABEL[state.silson]}`);
    L.push(`종합 보장등급 ${m.letter} · ${m.score}점 (${m.grade.label})`);
    if (m.client.ageDay) L.push(`보험나이 ${m.client.insuranceAge}세 · 상령일 ${m.client.ageDay.label} (D-${m.client.ageDay.days})`);
    L.push('');
    L.push('■ 5대 담보 진단');
    m.rows.forEach(({ item, r, label, summary }) => L.push(`${item.rank}. ${item.name} — ${label} (${summary})`));
    L.push('');
    L.push('■ 먼저 채울 곳');
    if (!m.needList.length) L.push('· 지금 구조 유지 + 금액 조정');
    else m.needList.slice(0, 3).forEach((x, i) => L.push(`${i + 1}) ${x.item.name} — ${x.summary}${x.gaps.length ? ` (${won(x.gaps.reduce((a, g) => a + g.need, 0))}만원 부족)` : ''}`));
    L.push('');
    L.push('■ 실행 로드맵 3단계');
    m.steps.forEach((s, i) => L.push(`${i + 1}단계 ${s.title} — ${s.body.replace(/\s+/g, ' ').slice(0, 70)}${s.body.length > 70 ? '…' : ''}`));
    L.push('');
    L.push('※ 상담 참고용 요약입니다. 실제 지급 여부와 금액은 가입하신 상품의 약관과 증권을 기준으로 안내드립니다.');
    return L.join('\n');
  }

  /* ================= PDF ================= */
  const PDF_LABEL = { summary: '고객용 1장 요약', detail: '고객용 10장 상세', advisor: '설계사용 30장 플랜' };

  function overlay(show, title, msg, pct) {
    const ov = $('#pdf-overlay');
    if (!show) { ov.hidden = true; return; }
    ov.hidden = false;
    if (title != null) $('#pdf-title').textContent = title;
    if (msg != null) $('#pdf-msg').textContent = msg;
    if (pct != null) $('#pdf-bar').style.width = Math.round(pct * 100) + '%';
    $('#pdf-cancel').hidden = true;
  }

  async function buildPdfBlob(kind) {
    const started = performance.now();
    const build = BojangReport.build(kind, state);
    const overflow = [];
    const memoOpts = BojangReport.MEMO[kind] || {};
    /* v5.1: 무료 체험은 1장 요약만 — 하단에 무료 체험판 워터마크를 넣습니다 */
    const free = !(window.BojangPlan && window.BojangPlan.isPro());
    const brand = window.BojangBrand ? window.BojangBrand.get() : { name: '보험에 반하다' };
    const watermark = free && kind === 'summary' ? `${brand.name} · 무료 체험판` : '';
    const blob = await PDFKit.renderPages(build.pages, {
      quality: kind === 'summary' ? 0.92 : kind === 'detail' ? 0.86 : 0.83,
      overflow,
      memo: kind !== 'summary',
      memoMax: memoOpts.memoMax,
      memoLabels: memoOpts.memoLabels,
      watermark,
      meta: { title: `${build.m.client.name}_${PDF_LABEL[kind]}` },
      onProgress: (done, total) => {
        overlay(true, `${PDF_LABEL[kind]} PDF 생성 중`, `${total}페이지 중 ${done}페이지를 그렸습니다`, done / total);
      }
    });
    const filename = PDFKit.fileName(kind, build.m.client.name, isoDate(build.m.dateLabel));
    window.__lastPdf = { kind, watermark: !!watermark, pages: build.pages.length, filename };
    return { blob, filename, pages: build.pages.length, overflow, ms: Math.round(performance.now() - started), model: build.m, watermark };
  }
  window.BojangApp = { buildPdfBlob, doPdf, state, analyze, cursorModel: model };

  function isoDate(label) {
    const m = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(label || '');
    if (m) return `${m[1]}${String(m[2]).padStart(2, '0')}${String(m[3]).padStart(2, '0')}`;
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  async function doPdf(kind) {
    if (!state.analyzed) analyze();
    /* v5.1 무료 체험: 1장 요약만 저장 · 10장/30장은 페이월 */
    if (window.BojangPlan && !window.BojangPlan.isPro() && kind !== 'summary') {
      window.BojangPlan.openPaywall(kind === 'advisor' ? 'pdf30' : 'pdf10');
      return;
    }
    const btn = $(`.pdf-btn[data-pdf="${kind}"]`);
    if (btn) btn.disabled = true;
    overlay(true, `${PDF_LABEL[kind]} PDF 생성 중`, '페이지를 그리는 중…', 0.02);
    try {
      const out = await buildPdfBlob(kind);
      if (out.overflow.length) console.warn('[PDF] 넘침 페이지', out.overflow);
      overlay(false);
      await deliver(out.blob, out.filename, kind, out);
    } catch (e) {
      console.error(e);
      overlay(true, 'PDF를 만들지 못했습니다', (e && e.message ? e.message : '알 수 없는 오류') + ' · 다시 시도해 주세요', 0);
      $('#pdf-cancel').hidden = false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deliver(blob, filename, kind, out) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    const sizeMb = (blob.size / 1048576).toFixed(1);
    if (canShare) {
      // iOS/Android: 공유 시트는 사용자 제스처가 필요하므로 버튼을 한 번 더 받습니다.
      overlay(true, 'PDF가 준비됐습니다', `${filename} · ${out.pages}페이지 · ${sizeMb}MB`, 1);
      const msg = $('#pdf-msg');
      msg.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:grid;gap:8px;margin-top:14px;';
      const bShare = document.createElement('button');
      bShare.type = 'button'; bShare.className = 'pdf-cancel';
      bShare.style.cssText = 'background:#0a1d33;color:#fff;border-color:#0a1d33;margin:0;padding:12px;font-weight:800;';
      bShare.textContent = '공유하기 (파일 앱 · 문자 · 카톡)';
      bShare.addEventListener('click', async () => {
        try {
          await navigator.share({ files: [file], title: filename, text: `${state.client.name}님 ${PDF_LABEL[kind]} 리포트` });
          overlay(false);
          toast('공유했습니다');
        } catch (e) {
          if (e && e.name === 'AbortError') { toast('공유를 취소했습니다'); return; }
          const r = await PDFKit.saveBlob(blob, filename, { share: false });
          overlay(false);
          toast(r === 'download' ? '파일로 저장했습니다 (다운로드 폴더/파일 앱)' : '저장했습니다');
        }
      });
      const bSave = document.createElement('button');
      bSave.type = 'button'; bSave.className = 'pdf-cancel';
      bSave.textContent = '기기에 저장 (다운로드)';
      bSave.addEventListener('click', async () => {
        await PDFKit.saveBlob(blob, filename, { share: false });
        overlay(false);
        toast('PDF를 저장했습니다');
      });
      const bClose = document.createElement('button');
      bClose.type = 'button'; bClose.className = 'pdf-cancel';
      bClose.textContent = '닫기';
      bClose.addEventListener('click', () => overlay(false));
      wrap.appendChild(bShare); wrap.appendChild(bSave); wrap.appendChild(bClose);
      msg.appendChild(wrap);
      $('#pdf-title').textContent = 'PDF가 준비됐습니다';
      return;
    }
    const res = await PDFKit.saveBlob(blob, filename, { picker: false, title: filename });
    if (res === 'cancel') toast('저장을 취소했습니다');
    else toast(res === 'saved' ? 'PDF를 저장했습니다' : `PDF를 저장했습니다 · ${out.pages}페이지 ${sizeMb}MB`);
  }

  /* ================= 상담 저장 ================= */
  function historyMax() {
    return window.BojangPlan && window.BojangPlan.isPro() ? 30 : 1;
  }

  function loadHistory() {
    const list = lsGet(HKEY, []);
    state.history = Array.isArray(list) ? list.slice(0, historyMax()) : [];
    renderHistory();
  }

  function saveConsult() {
    if (!state.lastResult) { toast('먼저 진단해 주세요'); return; }
    if (!(window.BojangPlan && window.BojangPlan.isPro()) && state.history.length >= 1) {
      window.BojangPlan.openPaywall('save2');
      return;
    }
    const label = ($('#cust-label').value || '').trim() || `${state.client.name} · ${state.age}대 ${state.gender}`;
    const entry = {
      id: 'c' + Date.now(), label, savedAt: new Date().toISOString(),
      score: state.lastResult.m.score, letter: state.lastResult.m.letter,
      client: Object.assign({}, state.client),
      contracts: JSON.parse(JSON.stringify(state.contracts)),
      inputs: {
        age: state.age, gender: state.gender, job: state.job, silson: state.silson,
        premium: state.premium, cov: JSON.parse(JSON.stringify(state.cov)), flags: Object.assign({}, state.flags),
        family: state.family.slice(), disc: Object.assign({}, state.disc)
      }
    };
    const next = [entry].concat(state.history).slice(0, historyMax());
    if (lsSet(HKEY, next)) {
      state.history = next; renderHistory();
      toast(window.BojangPlan && window.BojangPlan.isPro() ? '저장했습니다 (Pro · 최대 30건)' : '무료 체험 · 고객 1명을 저장했습니다 (Pro는 30명)');
    } else toast('저장 공간을 쓸 수 없습니다');
  }

  function renderHistory() {
    const hosts = $$('[id="history-list"], [id="history-list2"]');
    if (!hosts.length) return;
    const html = !state.history.length
      ? `<p class="empty">저장된 상담이 없습니다. 진단 후 "상담 저장"을 누르면 이 기기에만 기록됩니다.</p>`
      : state.history.map((h) => {
        const d = new Date(h.savedAt);
        const when = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        return `
        <div class="hist" data-id="${h.id}">
          <div class="hist-main"><strong>${esc(h.label)}</strong>
            <span>${when} · ${h.inputs.age}대 ${h.inputs.gender} · 실손 ${SILSON_LABEL[h.inputs.silson]}</span></div>
          <span class="hist-score">${h.score}<i>점</i></span>
          <button type="button" class="hist-load" data-load="${h.id}">불러오기</button>
          <button type="button" class="hist-del" data-del="${h.id}" aria-label="삭제">×</button>
        </div>`;
      }).join('');
    hosts.forEach((host) => {
      host.innerHTML = html;
      $$('[data-load]', host).forEach((b) => {
        b.addEventListener('click', () => {
          const h = state.history.find((x) => x.id === b.dataset.load);
          if (!h) return;
          applyInputs(h.inputs);
          if (h.client) { state.client = Object.assign(state.client, h.client, { dateLabel: todayLabel() }); renderClientFields(); }
          if (Array.isArray(h.contracts)) { state.contracts = h.contracts; renderContracts(); }
          renderAllInputs();
          analyze();
          switchView('analysis');
          $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
          toast(`"${h.label}" 상담을 불러왔습니다`);
        });
      });
      $$('[data-del]', host).forEach((b) => {
        b.addEventListener('click', () => {
          const next = state.history.filter((x) => x.id !== b.dataset.del);
          if (lsSet(HKEY, next)) { state.history = next; renderHistory(); renderHome(); toast('삭제했습니다'); }
        });
      });
    });
    renderHome();
  }

  function applyInputs(inputs) {
    state.age = inputs.age; state.gender = inputs.gender; state.job = inputs.job;
    state.silson = inputs.silson; state.premium = inputs.premium;
    state.cov = JSON.parse(JSON.stringify(inputs.cov));
    BojangModel.normalizeState(state);
    state.flags = Object.assign({}, state.flags, inputs.flags);
    if (Array.isArray(inputs.family)) state.family = inputs.family.slice();
    if (inputs.disc) state.disc = Object.assign({}, inputs.disc);
    syncSegments();
    renderFamilyChips();
    renderDisclosure();
    renderCoverageCards();
    renderFlags();
    renderSummary();
    $('#premium').value = state.premium;
    saveSession();
  }

  /* v4: 새 상담 시작 — 확인 모달을 거쳐 입력값을 한 번에 비웁니다 */
  function resetConsult() {
    state.age = DEFAULT.age; state.gender = DEFAULT.gender; state.job = DEFAULT.job;
    state.silson = DEFAULT.silson; state.premium = DEFAULT.premium;
    state.cov = JSON.parse(JSON.stringify(DEFAULT.cov));
    state.flags = Object.assign({}, DEFAULT.flags);
    state.family = [];
    state.disc = {};
    state.client = Object.assign({}, DEFAULT.client, { dateLabel: todayLabel() });
    state.contracts = [];
    state.migration = { migrated: false, notes: [] };
    syncSegments();
    renderClientFields();
    renderFamilyChips();
    renderDisclosure();
    renderCoverageCards();
    renderFlags();
    renderContracts();
    renderQuick();
    $('#cust-label').value = '';
    $('#premium').value = state.premium;
    state.analyzed = false; state.lastResult = null;
    $('#result').hidden = true;
    $('#save-bar').hidden = true;
    setStep(1, true);
    renderSummary();
    renderClientStrip();
    renderHome();
    if (window.BojangDeck) window.BojangDeck.refresh(state, { reset: true });
    switchView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    saveSession();
    toast('새 상담을 시작합니다 — 입력값을 모두 비웠습니다');
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
      cb.addEventListener('change', () => { state.flags[f.key] = cb.checked; saveSession(); if (state.analyzed) analyze(); });
      host.appendChild(l);
    });
  }

  /* ================= 화면 모드 ================= */
  function applyView() {
    const isClient = state.view === 'client';
    document.body.classList.toggle('is-client', isClient);
    $$('.viewswitch button').forEach((b) => {
      const on = b.dataset.mode === state.view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (isClient) {
      const active = $('.view.is-active');
      if (active && ['view-toolkit', 'view-live', 'view-home', 'view-quick', 'view-codes', 'view-silson', 'view-disclose', 'view-premium'].indexOf(active.id) >= 0) switchView('analysis');
      const liveTab = $('#tab-live'); if (liveTab) liveTab.style.display = 'none';
      if (!state.analyzed) analyze();
      if (window.BojangDeck) window.BojangDeck.show(state);
    } else {
      const liveTab = $('#tab-live'); if (liveTab) liveTab.style.display = '';
      if (window.BojangDeck) window.BojangDeck.hide();
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
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 2400);
  }

  async function copy(text, okMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      toast(okMsg || '복사했습니다');
    } catch (e) { toast('복사가 막혔습니다. 길게 눌러 직접 선택해 주세요'); }
  }
  window.__bojangCopy = copy;
  window.__bojangToast = toast;

  /* ================= 탭 전환 ================= */
  function switchView(name) {
    name = name || 'home';
    state.tab = name;
    const viewId = 'view-' + name;
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === viewId));
    const tabOf = { home: 'home', analysis: 'analysis', quick: 'analysis', guide: 'guide', live: 'live', toolkit: 'toolkit', codes: 'home', silson: 'home', disclose: 'home', premium: 'home', remodel: 'home', brand: 'home' };
    const active = tabOf[name] || name;
    $$('.tab').forEach((t) => {
      const on = t.dataset.view === active;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (name === 'home') renderHome();
    if (name === 'quick') renderQuick();
    /* 다른 화면에서 값을 바꿨을 수 있으므로 위저드 입력칸을 상태와 맞춥니다 */
    if (name === 'analysis') syncWizardInputs();
    if (name === 'live' && window.BojangLive) window.BojangLive.render();
    if (name === 'remodel' && window.BojangRemodel) window.BojangRemodel.render();
    if (name === 'brand' && window.BojangBrand) window.BojangBrand.render();
    if (window.BojangTools) {
      if (name === 'codes') window.BojangTools.renderCodes();
      else if (name === 'silson') window.BojangTools.renderSilson();
      else if (name === 'disclose') { window.BojangTools.renderDisclosureTool(); window.BojangTools.renderClaimDocs(); }
      else if (name === 'premium') window.BojangTools.renderPremiumTool();
    }
  }

  function syncWizardInputs() {
    renderClientFields();
    syncSegments();
    renderFamilyChips();
    renderDisclosure();
    renderCoverageCards();
    renderContracts();
    renderSummary();
    renderClientStrip();
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
    const ax = 16;
    out += `<path d="M${ax} ${y + bh + 4} L${ax} ${y + 2 * (bh + gap) + bh - 4}" stroke="#9fb8cf" stroke-width="1.2" fill="none" stroke-dasharray="3 3"/>`;
    out += `<path d="M${ax - 3.5} ${y + bh + 8} L${ax} ${y + bh + 2} L${ax + 3.5} ${y + bh + 8}" fill="none" stroke="#9fb8cf" stroke-width="1.2"/>`;
    out += `<text x="${ax + 8}" y="${H - 8}" class="dg-t">⊂ 포함</text>`;
    out += `<text x="${W - 6}" y="${H - 8}" text-anchor="end" class="dg-s">바깥으로 갈수록 넓은 담보</text>`;
    out += `</svg>`;
    return out;
  }

  function dgCancer() {
    return `<svg viewBox="0 0 340 250" class="dg" role="img" aria-label="암 보장 구조 도식">
      <defs><linearGradient id="cNavy" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#153a60"/><stop offset="100%" stop-color="#0a1d33"/></linearGradient></defs>
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
    </svg>`;
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
      c.lines.forEach((l, j) => { out += `<text x="${c.x + 12}" y="${76 + j * 18}" class="dg-s ${cls}">· ${l}</text>`; });
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
        e.preventDefault(); e.stopPropagation();
        const i = Number(b.dataset.copy);
        copy(g.talk[i].replace(/^"|"$/g, ''), '화법을 복사했습니다');
      });
    });
  }

  /* ================= 탭 3 ================= */
  function renderToolkit() {
    $('#disclosure-general').innerHTML = DISCLOSURE_GENERAL.map((d) => `
      <div class="disc-row"><div class="disc-period">${d.period}</div><ul>${d.items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`).join('');
    $('#disclosure-simple').innerHTML = DISCLOSURE_SIMPLE.map((d) => `
      <div class="disc-row"><div class="disc-period">${d.period}</div><ul>${d.items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`).join('');

    const rowKeys = ['급여', '비급여', '자기부담', '재가입', '특징'];
    $('#silson-cards').innerHTML = SILSON_GENERATIONS.map((g) => `
      <div class="silson-card${g.gen === '5세대' ? ' is-current' : ''}">
        <div class="sg-head"><strong>${g.gen}</strong><span>${g.period}</span></div>
        <dl>${rowKeys.map((k) => `<div><dt>${k}</dt><dd>${g.rows[k]}</dd></div>`).join('')}</dl>
      </div>`).join('');
    $('#silson-table').innerHTML = `
      <thead><tr><th class="sticky-col">구분</th>${SILSON_GENERATIONS.map((g) => `<th><strong>${g.gen}</strong><span>${g.period}</span></th>`).join('')}</tr></thead>
      <tbody>${rowKeys.map((k) => `<tr><th class="sticky-col">${k}</th>${SILSON_GENERATIONS.map((g) => `<td>${g.rows[k]}</td>`).join('')}</tr>`).join('')}</tbody>`;

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


  /* ================= 위저드 ================= */
  function setStep(n, silent) {
    const TOTAL_STEP = WIZARD.length;
    state.step = clamp(n, 1, TOTAL_STEP);
    $$('.wiz-panel').forEach((p) => p.classList.toggle('is-active', Number(p.dataset.step) === state.step));
    $('#wiz-count').textContent = `${state.step}/${TOTAL_STEP}`;
    $('#wiz-title').textContent = WIZARD[state.step - 1].title;
    $('#wiz-bar-fill').style.width = ((state.step / TOTAL_STEP) * 100) + '%';
    $('#wiz-prev').disabled = state.step === 1;
    $('#wiz-next').textContent = state.step === TOTAL_STEP ? '진단하기' : '다음';
    if (!silent) {
      const top = $('#wizard').getBoundingClientRect().top + window.scrollY - 78;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    renderSummary();
  }

  function toggleExpand() {
    state.expanded = !state.expanded;
    document.body.classList.toggle('wiz-all', state.expanded);
    $('#btn-expand').textContent = state.expanded ? '단계로 보기' : '한눈에 보기';
    $('#btn-expand').classList.toggle('is-on', state.expanded);
    if (!state.expanded) setStep(state.step, true);
    window.scrollTo({ top: $('#wizard').offsetTop - 78, behavior: 'smooth' });
  }

  function renderSummary() {
    const el = $('#wiz-summary');
    if (!el) return;
    const rows = PRIORITY.map((item) => {
      const r = BojangModel.evalItem(state, item);
      return `<div class="sum-row"><span class="sr-rank">${item.rank}</span><strong>${item.name}</strong><span class="sr-val">${BojangModel.summaryOf(state, item, r)}</span><span class="badge badge-${r.level}">${r.label}</span></div>`;
    }).join('');
    const ad = state.client.birth ? BojangModel.nextAgeDay(state.client.birth) : null;
    const fam = state.family.filter((k) => k !== 'none').map((k) => (FAMILY_HISTORY.find((f) => f.key === k) || {}).label).filter(Boolean);
    const dj = BojangModel.disclosureJudge(state);
    const cs = BojangModel.contractStats(state.contracts);
    el.innerHTML = `
      <div class="sum-top">${esc(state.client.name)} · ${state.age}대 ${state.gender} · 직업 ${state.job}급 · 실손 ${SILSON_LABEL[state.silson]} · 월 ${won(state.premium)}만원</div>
      ${ad ? `<div class="sum-top">보험나이 ${BojangModel.insuranceAge(state.client.birth)}세 · 상령일 ${ad.label} (D-${ad.days})</div>` : ''}
      <div class="sum-tags">
        <span class="sum-tag">가족력 ${fam.length ? fam.join('·') : (state.family.length ? '해당 없음' : '미입력')}</span>
        <span class="sum-tag tone-${dj.tone}">${dj.label}</span>
        <span class="sum-tag">계약 ${cs.count}건${cs.paidUpCount ? ` · 납입완료 ${cs.paidUpCount}` : ''}${cs.shortMaturityCount ? ` · 만기 80·90세 ${cs.shortMaturityCount}` : ''}</span>
      </div>
      ${rows}
      <p class="sum-note">위 내용으로 진단하면 점수 · 고객 30장 슬라이드 · 1장/10장/30장 PDF가 만들어집니다.</p>`;
  }

  /* ================= v4.2 메인 허브 ================= */
  function renderHome() {
    const host = $('#home-client');
    if (!host) return;
    if (window.BojangPlan) window.BojangPlan.renderPlanUI();
    let m = null;
    try { m = model(); } catch (e) { m = null; }
    const ia = state.client.birth ? BojangModel.insuranceAge(state.client.birth) : null;
    host.innerHTML = `
      <div class="hc-avatar" aria-hidden="true">${esc((state.client.name || '홍').slice(0, 1))}</div>
      <div class="hc-main">
        <div class="hc-name">${esc(state.client.name || '홍길동')}님 <span>${ia != null ? `보험나이 ${ia}세` : `${state.age}대`} · ${state.gender} · ${state.job}급</span></div>
        <div class="hc-meta">
          <span>월 ${won(state.premium)}만원</span>
          <span>실손 ${SILSON_LABEL[state.silson]}</span>
          ${m ? `<span class="hc-score tone-${m.grade.tone}">${m.letter} · ${m.score}점</span>` : ''}
          <span>계약 ${state.contracts.length}건</span>
        </div>
      </div>
      ${state.migration && state.migration.notes && state.migration.notes.length
        ? `<div class="mig-note">구버전 데이터를 새 구조로 옮겼습니다 · ${state.migration.notes.join(' / ')}</div>` : ''}`;
    const hc = $('#home-hist-count');
    if (hc) hc.textContent = state.history.length + '건';
    renderPresets();
  }

  function renderPresets() {
    const host = $('#preset-row');
    if (!host) return;
    host.innerHTML = AGES.map((a) => {
      const p = PRESETS[a];
      if (!p) return '';
      return `<button type="button" class="preset${state.age === a ? ' is-on' : ''}" data-preset="${a}">
        <b>${a}대</b><span>${p.label} · 월 ${won(p.premium)}만원</span></button>`;
    }).join('') + `<button type="button" class="preset preset-clear" data-preset="none"><b>비우기</b><span>입력값 초기화</span></button>`;
    $$('[data-preset]', host).forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.preset === 'none') { resetConsult(); return; }
        applyPreset(b.dataset.preset);
      });
    });
  }

  function applyPreset(age) {
    const p = PRESETS[age];
    if (!p) return;
    state.age = age;
    state.premium = p.premium;
    state.silson = p.silson;
    state.gender = p.gender;
    state.job = p.job;
    state.cov = JSON.parse(JSON.stringify(p.cov));
    BojangModel.normalizeState(state);
    renderAllInputs();
    saveSession();
    analyze();
    toast(`${p.label}를 채웠습니다 — 실제 증권 값으로 고쳐 쓰세요`);
  }

  function renderAllInputs() {
    renderClientFields();
    syncSegments();
    renderFamilyChips();
    renderDisclosure();
    renderCoverageCards();
    renderFlags();
    renderContracts();
    renderQuick();
    renderSummary();
    renderClientStrip();
    renderHome();
    $('#premium').value = state.premium;
  }

  /* ================= 한 화면 빠른 입력 (표 모드) ================= */
  function qScaleChips(item, p, cur) {
    return (p.options || []).map((o) => `<button type="button" class="qchip${cur === o.v ? ' is-on' : ''}" data-qscale="${o.v}" data-qitem="${item.key}" data-qpart="${p.key}">${o.label}${o.hint ? `<em>${o.hint}</em>` : ''}</button>`).join('');
  }

  function quickRow(item, p) {
    const ev = BojangModel.evalItem(state, item);
    const pr = ev.parts.find((x) => x.key === p.key) || { val: 0, rec: 0, fill: 0 };
    const tone = pr.fill >= 1 ? 'ok' : pr.fill > 0 ? 'need' : 'gap';
    if (p.type === 'amount') {
      return `
        <div class="qrow" data-qrow="${item.key}.${p.key}">
          <span class="ql"><b>${p.label}</b>${p.hint ? `<em>${p.hint}</em>` : ''}</span>
          <div class="qv">
            <span class="di-tag">직접입력</span>
            <input type="number" inputmode="numeric" min="0" step="${p.step}" data-qitem="${item.key}" data-qpart="${p.key}" value="${pr.val}" aria-label="${p.label} (만원)">
            <span class="unit">만원</span>
            <span class="qstate tone-${tone}">${pr.stage ? pr.stage.label : Math.round(pr.fill * 100) + '%'}</span>
          </div>
          <span class="qc">
            ${(p.quick || []).map((q) => `<button type="button" class="quick" data-qset="${q}" data-qitem="${item.key}" data-qpart="${p.key}">${q === 0 ? '없음' : won(q)}</button>`).join('')}
            <em class="qrec">권장 ${won(pr.rec)}</em>
          </span>
        </div>`;
    }
    if (p.type === 'dxset') {
      const subs = pr.subs || [];
      const d = pr.dx || {};
      const core = d.core;
      return `
        <div class="qrow qgroup-head${d.gapWarn ? ' is-warn' : ''}" data-qrow="${item.key}.${p.key}">
          <span class="ql"><b>${p.label}</b><em>${d.gapWarn ? '⚠ 범위 공백 — ' + esc(d.gapLabel) + ' 0원' : (p.hint || '')}</em></span>
          <div class="qv"><span class="qsum">${won(core ? core.val : 0)}<em>만원</em></span><span class="qstate tone-${tone}">핵심 범위</span></div>
          <span class="qc"><em class="qrec">권장 ${won(pr.rec)}</em></span>
        </div>
        ${subs.map((s) => `
          <div class="qrow qsub${s.isCore ? ' is-core' : ''}" data-qrow="${item.key}.${p.key}.${s.key}">
            <span class="ql"><b>${s.isCore ? '★ ' : '└ '}${esc(s.label)}</b><em>${esc(s.codes || '')}</em></span>
            <div class="qv">
              <span class="di-tag">직접입력</span>
              <input type="number" inputmode="numeric" min="0" max="${s.max || 5000}" step="${p.step || 500}" data-qitem="${item.key}" data-qpart="${p.key}" data-qsub="${s.key}" value="${s.val}" aria-label="${esc(s.label)} (만원)">
              <span class="unit">만원</span>
              <span class="qstate tone-${s.fill >= 1 ? 'ok' : s.val > 0 ? 'need' : 'gap'}">${s.pct}%</span>
            </div>
            <span class="qc">
              ${(p.quick || []).map((q) => `<button type="button" class="quick" data-qset="${q}" data-qitem="${item.key}" data-qpart="${p.key}" data-qsub="${s.key}">${q === 0 ? '없음' : won(q)}</button>`).join('')}
              <em class="qrec">권장 ${won(s.rec)}</em>
            </span>
          </div>`).join('')}`;
    }
    if (p.type === 'group') {
      const subs = pr.subs || [];
      return `
        <div class="qrow qgroup-head" data-qrow="${item.key}.${p.key}">
          <span class="ql"><b>${p.label}</b><em>${p.hint || ''}</em></span>
          <div class="qv"><span class="qsum">${won(pr.val)}<em>만원</em></span><span class="qstate tone-${tone}">${subs.filter((s) => s.val > 0).length}/${subs.length}종</span></div>
          <span class="qc"><em class="qrec">권장 합계 ${won(pr.rec)}</em></span>
        </div>
        ${subs.map((s) => `
          <div class="qrow qsub" data-qrow="${item.key}.${p.key}.${s.key}">
            <span class="ql"><b>└ ${s.label}</b>${s.hint ? `<em>${s.hint}</em>` : ''}</span>
            <div class="qv">
              <span class="di-tag">직접입력</span>
              <input type="number" inputmode="numeric" min="0" max="${s.max || 3000}" step="${p.step || 500}" data-qitem="${item.key}" data-qpart="${p.key}" data-qsub="${s.key}" value="${s.val}" aria-label="${s.label} (만원)">
              <span class="unit">만원</span>
              <span class="qstate tone-${s.fill >= 1 ? 'ok' : s.val > 0 ? 'need' : 'gap'}">${s.pct}%</span>
            </div>
            <span class="qc">
              ${(p.quick || []).map((q) => `<button type="button" class="quick" data-qset="${q}" data-qitem="${item.key}" data-qpart="${p.key}" data-qsub="${s.key}">${q === 0 ? '없음' : won(q)}</button>`).join('')}
              <em class="qrec">권장 ${won(s.rec)}</em>
            </span>
          </div>`).join('')}`;
    }
    if (p.type === 'scale') {
      const cur = cv(item, p) || (p.options[0] && p.options[0].v);
      return `
        <div class="qrow" data-qrow="${item.key}.${p.key}">
          <span class="ql"><b>${p.label}</b>${p.hint ? `<em>${p.hint}</em>` : ''}</span>
          <div class="qv"><div class="qchips">${qScaleChips(item, p, cur)}</div></div>
          <span class="qc"><span class="qstate tone-${tone}">${pr.option ? pr.option.label : ''}</span></span>
        </div>`;
    }
    const on = !!cv(item, p);
    return `
      <div class="qrow" data-qrow="${item.key}.${p.key}">
        <span class="ql"><b>${p.label}</b>${p.hint ? `<em>${p.hint}</em>` : ''}</span>
        <div class="qv"><label class="qswitch"><input type="checkbox" data-qbool="1" data-qitem="${item.key}" data-qpart="${p.key}" ${on ? 'checked' : ''}><span class="sw" aria-hidden="true"></span><em>${on ? '보유' : '없음'}</em></label></div>
        <span class="qc"></span>
      </div>`;
  }

  function renderQuick() {
    const host = $('#quick-tables');
    if (!host) return;
    host.innerHTML = PRIORITY.map((item) => {
      const r = BojangModel.evalItem(state, item);
      return `
        <div class="quick-card" data-qcard="${item.key}">
          <div class="quick-head"><span class="cov-rank">${item.rank}</span><b>${item.name}</b><span>${item.sub}</span>
            <span class="badge badge-${r.level}">${r.label}</span>
            <span class="qh-pct">${Math.round(r.fill * 100)}%</span></div>
          ${item.parts.map((p) => quickRow(item, p)).join('')}
          ${item.tiers ? `<p class="q-tier-note">${item.tierNote || ''}</p>` : ''}
        </div>`;
    }).join('');
    bindQuickInputs();
    fillQuickHeader();
    refreshQuickValues();
  }

  function fillQuickHeader() {
    const n = $('#q-name');
    if (n) n.value = state.client.name === '홍길동' ? '' : state.client.name;
    const pr = $('#q-premium');
    if (pr) pr.value = state.premium;
    const qc = $('#quick-client');
    if (qc) qc.textContent = `${state.client.name} · ${state.age}대 ${state.gender} · 실손 ${SILSON_LABEL[state.silson]} · 월 ${won(state.premium)}만원`;
    if ($('#q-age')) buildSeg($('#q-age'), AGES.map((a) => ({ value: a, label: a + '대' })), state.age, (v) => { state.age = v; state.ageAuto = false; renderAllInputs(); saveSession(); if (state.analyzed) analyze(); });
    if ($('#q-gender')) buildSeg($('#q-gender'), [{ value: '남', label: '남' }, { value: '여', label: '여' }], state.gender, (v) => { state.gender = v; renderAllInputs(); saveSession(); if (state.analyzed) analyze(); });
    if ($('#q-job')) buildSeg($('#q-job'), [{ value: '1', label: '1급' }, { value: '2', label: '2급' }, { value: '3', label: '3급' }], state.job, (v) => { state.job = v; renderAllInputs(); saveSession(); if (state.analyzed) analyze(); });
    if ($('#q-silson')) buildSeg($('#q-silson'), [{ value: 'none', label: '없음' }, { value: '1', label: '1세대' }, { value: '2', label: '2세대' }, { value: '3', label: '3세대' }, { value: '4', label: '4세대' }, { value: '5', label: '5세대' }], state.silson, (v) => { state.silson = v; renderAllInputs(); saveSession(); if (state.analyzed) analyze(); });
  }

  function setCov(itemKey, partKey, val, subKey) {
    const c = state.cov[itemKey];
    if (!c) return;
    if (subKey) {
      if (!c[partKey] || typeof c[partKey] !== 'object') c[partKey] = emptyFor(itemKey, partKey);
      c[partKey][subKey] = val;
    } else c[partKey] = val;
  }

  function bindQuickInputs() {
    $$('#view-quick input[type="number"][data-qitem]').forEach((input) => {
      input.addEventListener('input', () => {
        const v = clamp(Number(input.value || 0), 0, 100000);
        setCov(input.dataset.qitem, input.dataset.qpart, v, input.dataset.qsub);
        refreshBadges(); saveSession();
      });
    });
    $$('#view-quick .quick[data-qset]').forEach((b) => {
      b.addEventListener('click', () => {
        const v = Number(b.dataset.qset);
        setCov(b.dataset.qitem, b.dataset.qpart, v, b.dataset.qsub);
        const sel = `#view-quick input[data-qitem="${b.dataset.qitem}"][data-qpart="${b.dataset.qpart}"]` + (b.dataset.qsub ? `[data-qsub="${b.dataset.qsub}"]` : ':not([data-qsub])');
        const inp = $(sel);
        if (inp) inp.value = v;
        refreshBadges(); saveSession();
      });
    });
    $$('#view-quick .qchip[data-qscale]').forEach((b) => {
      b.addEventListener('click', () => {
        setCov(b.dataset.qitem, b.dataset.qpart, b.dataset.qscale);
        $$(`.qchip[data-qitem="${b.dataset.qitem}"][data-qpart="${b.dataset.qpart}"]`).forEach((x) => x.classList.toggle('is-on', x === b));
        refreshBadges(); saveSession();
      });
    });
    $$('#view-quick input[data-qbool]').forEach((cb) => {
      cb.addEventListener('change', () => {
        setCov(cb.dataset.qitem, cb.dataset.qpart, cb.checked);
        const em = cb.parentElement.querySelector('em');
        if (em) em.textContent = cb.checked ? '보유' : '없음';
        refreshBadges(); saveSession();
      });
    });
    const name = $('#q-name');
    if (name) name.addEventListener('input', (e) => {
      state.client.name = (e.target.value || '').trim() || '홍길동';
      renderClientStrip(); renderSummary(); renderHome(); saveSession();
      const qc = $('#quick-client');
      if (qc) qc.textContent = `${state.client.name} · ${state.age}대 ${state.gender} · 실손 ${SILSON_LABEL[state.silson]} · 월 ${won(state.premium)}만원`;
      if (state.analyzed) analyze();
    });
    const prem = $('#q-premium');
    if (prem) prem.addEventListener('input', (e) => {
      state.premium = clamp(Number(e.target.value || 0), 0, 300);
      $('#premium').value = state.premium;
      renderClientStrip(); renderHome(); syncQuickStates(); saveSession();
      if (state.analyzed) analyze();
    });
  }

  function refreshQuickValues() {
    const host = $('#view-quick');
    if (!host || host.hidden) return;
    const active = document.activeElement;
    $$('#view-quick input[type="number"][data-qitem]').forEach((input) => {
      if (input === active) return;
      let v = 0;
      const c = state.cov[input.dataset.qitem] || {};
      if (input.dataset.qsub) { const g = c[input.dataset.qpart]; v = (g && typeof g === 'object') ? Number(g[input.dataset.qsub] || 0) : 0; }
      else v = Number(c[input.dataset.qpart] || 0) || 0;
      if (String(v) !== input.value) input.value = v;
    });
    $$('#view-quick .quick[data-qset]').forEach((b) => {
      const c = state.cov[b.dataset.qitem] || {};
      let v = 0;
      if (b.dataset.qsub) { const g = c[b.dataset.qpart]; v = (g && typeof g === 'object') ? Number(g[b.dataset.qsub] || 0) : 0; }
      else v = Number(c[b.dataset.qpart] || 0) || 0;
      b.classList.toggle('is-on', Number(b.dataset.qset) === v);
    });
    $$('#view-quick .qchip[data-qscale]').forEach((b) => {
      const c = state.cov[b.dataset.qitem] || {};
      b.classList.toggle('is-on', String(c[b.dataset.qpart]) === String(b.dataset.qscale));
    });
    $$('#view-quick input[data-qbool]').forEach((cb) => {
      const c = state.cov[cb.dataset.qitem] || {};
      cb.checked = !!c[cb.dataset.qpart];
      const em = cb.parentElement.querySelector('em');
      if (em) em.textContent = cb.checked ? '보유' : '없음';
    });
  }

  /* ================= JSON 내보내기 / 가져오기 (PC ↔ 모바일) ================= */
  function snapshotState() {
    return {
      age: state.age, gender: state.gender, job: state.job, silson: state.silson, premium: state.premium,
      client: state.client, contracts: state.contracts, family: state.family, disc: state.disc,
      cov: state.cov, flags: state.flags
    };
  }

  function exportPayload() {
    return {
      app: 'bojang-guide', version: '4.2', exportedAt: new Date().toISOString(),
      summary: { name: state.client.name, age: state.age, gender: state.gender, score: state.lastResult ? state.lastResult.m.score : null },
      state: snapshotState()
    };
  }

  async function exportJson() {
    const text = JSON.stringify(exportPayload(), null, 2);
    const filename = `보장분석_${(state.client.name || '고객').replace(/\s+/g, '')}_${isoDate(state.client.dateLabel)}.json`;
    try {
      const file = new File([text], filename, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename, text: `${state.client.name}님 보장분석 데이터` });
        toast('JSON 파일을 공유했습니다');
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') { toast('공유를 취소했습니다'); return; }
    }
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('JSON 파일을 내려받았습니다');
    } catch (e) {
      await copy(text, 'JSON을 복사했습니다 — 붙여넣기로 옮기세요');
    }
  }

  function applyPayload(obj) {
    const s = obj && obj.state ? obj.state : obj;
    if (!s || !s.cov) throw new Error('보장분석 데이터가 아닙니다 (cov 없음)');
    ['age', 'gender', 'job', 'silson', 'premium'].forEach((k) => { if (s[k] != null) state[k] = s[k]; });
    if (s.client) state.client = Object.assign({}, state.client, s.client, { dateLabel: todayLabel() });
    if (Array.isArray(s.contracts)) state.contracts = JSON.parse(JSON.stringify(s.contracts));
    if (Array.isArray(s.family)) state.family = s.family.slice();
    if (s.disc && typeof s.disc === 'object') state.disc = Object.assign({}, s.disc);
    if (s.flags) state.flags = Object.assign({}, state.flags, s.flags);
    state.cov = JSON.parse(JSON.stringify(s.cov));
    state.migration = BojangModel.normalizeState(state);
    renderAllInputs();
    saveSession();
    analyze();
    switchView('analysis');
    toast('JSON 데이터를 가져왔습니다');
  }

  function openJsonModal() {
    $('#json-modal').hidden = false;
    $('#jm-text').value = '';
    $('#jm-msg').textContent = '';
    $('#jm-file').value = '';
  }
  function closeJsonModal() { $('#json-modal').hidden = true; }

  async function importFromModal() {
    const text = ($('#jm-text').value || '').trim();
    const msg = $('#jm-msg');
    if (!text) { msg.textContent = '파일을 선택하거나 JSON을 붙여넣어 주세요.'; return; }
    try {
      const obj = JSON.parse(text);
      applyPayload(obj);
      closeJsonModal();
    } catch (e) {
      msg.textContent = '가져오지 못했습니다 — ' + (e && e.message ? e.message : 'JSON 형식 오류');
    }
  }

  /* ================= 화면 이동 ================= */
  function goHome() {
    if (state.view === 'client') { state.view = 'advisor'; lsSet(VKEY, 'advisor'); applyView(); }
    switchView('home');
  }
  function goClient() {
    if (!state.analyzed) analyze();
    switchView('analysis');
    state.view = 'client';
    lsSet(VKEY, 'client');
    applyView();
  }

  /* ================= 초기화 ================= */
  function init() {
    state.view = lsGet(VKEY, 'advisor') === 'client' ? 'client' : 'advisor';
    loadSession();

    renderClientFields();
    renderSegments();
    renderFamilyChips();
    renderDisclosure();
    renderCoverageCards();
    renderFlags();
    renderContracts();
    renderGuideChips();
    renderGuideBody();
    renderToolkit();
    loadHistory();
    renderQuick();
    if (window.BojangPlan) window.BojangPlan.init();
    renderHome();
    if (window.BojangTools) window.BojangTools.init();
    switchView('home');
    applyView();
    setStep(1, true);
    renderSummary();

    /* 메인 허브 · 화면 이동 */
    document.addEventListener('click', (e) => {
      const back = e.target.closest('[data-home]');
      if (back) { goHome(); return; }
      const go = e.target.closest('[data-home-go]');
      if (!go) return;
      const k = go.dataset.homeGo;
      if (k === 'analysis') { state.analyzed ? switchView('analysis') : switchView('analysis'); setStep(state.step, true); }
      else if (k === 'quick') switchView('quick');
      else if (k === 'client') goClient();
      else if (k === 'live') switchView('live');
      else if (k === 'guide') switchView('guide');
      else if (k === 'toolkit') switchView('toolkit');
      else if (k === 'codes') switchView('codes');
      else if (k === 'silson') switchView('silson');
      else if (k === 'disclose') switchView('disclose');
      else if (k === 'premium') switchView('premium');
      else if (k === 'remodel') switchView('remodel');
      else if (k === 'brand') switchView('brand');
      else if (k === 'pdf') {
        if (!state.analyzed) analyze();
        switchView('analysis');
        setTimeout(() => { const el = $('#pdf-panel'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
      } else if (k === 'history') {
        switchView('home');
        setTimeout(() => { const el = $('#recent-card'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
      }
    });
    $('#btn-home').addEventListener('click', goHome);
    $('#btn-home-load').addEventListener('click', () => {
      const el = $('#recent-card');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(state.history.length ? '저장된 상담 목록입니다 — 불러오기를 누르세요' : '저장된 상담이 없습니다');
    });
    $('#btn-json-export').addEventListener('click', exportJson);
    $('#btn-json-import').addEventListener('click', openJsonModal);
    $('#jm-cancel').addEventListener('click', closeJsonModal);
    $('#jm-ok').addEventListener('click', importFromModal);
    $('#json-modal').addEventListener('click', (e) => { if (e.target.id === 'json-modal') closeJsonModal(); });
    $('#jm-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { $('#jm-text').value = String(rd.result || ''); $('#jm-msg').textContent = `파일을 읽었습니다 — ${f.name} · 가져오기를 누르세요`; };
      rd.onerror = () => { $('#jm-msg').textContent = '파일을 읽지 못했습니다'; };
      rd.readAsText(f);
    });
    $('#btn-quick-analyze').addEventListener('click', () => { analyze(); switchView('analysis'); $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('진단을 완료했습니다'); });
    $('#btn-quick-done').addEventListener('click', () => { saveSession(); goHome(); toast('입력값을 저장했습니다'); });
    if ($('#btn-reset2')) $('#btn-reset2').addEventListener('click', () => { $('#reset-modal').hidden = false; });

    $('#client-name').addEventListener('input', (e) => {
      state.client.name = (e.target.value || '').trim() || '홍길동';
      renderClientStrip(); renderSummary(); saveSession();
      if (state.analyzed) analyze();
    });
    $('#client-birth').addEventListener('change', onBirthChange);
    $('#consultant').addEventListener('input', (e) => {
      state.client.consultant = (e.target.value || '').trim();
      saveSession();
      if (state.analyzed) analyze();
    });
    $('#ct-add').addEventListener('click', addContract);
    $('#ct-apply').addEventListener('click', () => {
      const total = state.contracts.reduce((a, c) => a + Number(c.premium || 0), 0);
      if (!total) return;
      state.premium = clamp(total, 0, 300);
      $('#premium').value = state.premium;
      renderSummary(); renderClientStrip(); renderContracts(); saveSession();
      if (state.analyzed) analyze();
      toast(`월 보험료를 계약 합계 ${won(state.premium)}만원으로 맞췄습니다`);
    });
    $('#ct-premium').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addContract(); } });

    $('#premium').addEventListener('input', (e) => {
      state.premium = clamp(Number(e.target.value || 0), 0, 300);
      renderSummary(); renderClientStrip(); syncQuickStates(); saveSession();
      if (state.analyzed) analyze();
    });
    $$('#premium-quick .quick[data-premium]').forEach((b) => {
      b.addEventListener('click', () => {
        state.premium = Number(b.dataset.premium);
        $('#premium').value = state.premium;
        renderSummary(); renderClientStrip(); syncQuickStates(); saveSession();
        if (state.analyzed) analyze();
      });
    });

    $('#wiz-prev').addEventListener('click', () => setStep(state.step - 1));
    $('#wiz-next').addEventListener('click', () => {
      if (state.step === WIZARD.length) { analyze(); $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('진단을 완료했습니다'); }
      else setStep(state.step + 1);
    });
    $('#btn-expand').addEventListener('click', toggleExpand);

    $('#btn-analyze').addEventListener('click', () => {
      analyze();
      $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('진단을 완료했습니다');
    });

    $('#btn-kakao').addEventListener('click', () => copy(kakaoText(), '카톡 요약을 복사했습니다'));
    $('#btn-save').addEventListener('click', saveConsult);
    $('#btn-reset').addEventListener('click', () => { $('#reset-modal').hidden = false; });
    $('#rm-cancel').addEventListener('click', () => { $('#reset-modal').hidden = true; });
    $('#reset-modal').addEventListener('click', (e) => { if (e.target.id === 'reset-modal') $('#reset-modal').hidden = true; });
    $('#rm-ok').addEventListener('click', () => {
      $('#reset-modal').hidden = true;
      resetConsult();
    });

    $$('.pdf-btn').forEach((b) => b.addEventListener('click', () => doPdf(b.dataset.pdf)));
    $('#pdf-cancel').addEventListener('click', () => overlay(false));

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
      window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
    }
    const syncHeaderHeight = () => {
      const h = document.querySelector('.app-header');
      if (h) document.documentElement.style.setProperty('--hdr', Math.round(h.getBoundingClientRect().height) + 'px');
    };
    syncHeaderHeight();
    window.addEventListener('resize', syncHeaderHeight);
    if (window.BojangLive) window.BojangLive.init(state, { copy, toast });
    if (window.BojangDeck) {
      window.BojangDeck.init({
        state: state,
        toast: toast,
        copy: copy,
        doPdf: doPdf,
        onExit: () => {
          state.view = 'advisor';
          lsSet(VKEY, 'advisor');
          applyView();
          toast('상담자 화면으로 돌아왔습니다');
        },
        onHome: () => {
          if (window.BojangDeck) window.BojangDeck.hide();
          state.view = 'advisor';
          lsSet(VKEY, 'advisor');
          applyView();
          switchView('home');
          toast('메인 화면으로 돌아왔습니다');
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
