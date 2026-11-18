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

  const HKEY = 'bojang.history.v4';          /* v5.9 부터는 IndexedDB 로 이관 — 옛 키는 호환용 */
  const VKEY = 'bojang.viewmode.v1';
  const SKEY = 'bojang.session.v4';          /* 입력 중인 상담 1건 — 이력(대용량)은 IndexedDB */

  const DEFAULT = {
    age: '40', gender: '남', job: '1', silson: '4', premium: 27,
    client: { name: '홍길동', birth: '', consultant: '', contract: '' },
    contracts: [],
    family: [],
    disc: {},
    cov: {
      cancer: { general: 5000, similar: 1000, treatment: { surgery: 1000, drug: 1500, radio: 600, icu: 0, extra: 500 }, recur: true },
      brain: { dx: { vascular: 2000, stroke: 2000, bleed: 1000 }, treat: { lysis: 1000, surgery: 1500, icu: 0 }, main: 0, mainShared: false },
      heart: { dx: { ischemic: 2000, ami: 1000 }, treat: { lysis: 0, surgery: 1500, icu: 500 }, main: 0, mainShared: false },
      surgery: { disease: 50, disease15: 300, disease15Tiers: { '1': 300, '2': 0, '3': 0, '4': 0, '5': 0 }, diseaseNdae: 500, diseaseNonPay: 0, injury: 50, injury15: 300, injury15Tiers: { '1': 300, '2': 0, '3': 0, '4': 0, '5': 0 } },
      care: { daily: 10, nDaily: 0, basis: 'time', family: 'conditional', nursing: true, ltc: false, mode: 'normal' },
      /* v7.2 — 6번째 생활·실손 참고 축 (점수·색 판정 제외) */
      living: { deathInjury: 0, deathDisease: 0, disabilityInjury: 0, disabilityDisease: 0, driverFine: 0, driverLawyer: 0, driverSupport: 0, driverInjury: 0, liability: 0, fire: 0, fracture: 0, burn: 0, er: 0, inpatientInjury: 0, inpatientDisease: 0, silsonDeduct: 0, silsonNonPay: false, toothCare: false, toothProsthetic: false },
      /* v5.6 — 증권 담보 직접 기재 (영역별) */
      custom: { cancer: [], brain: [], heart: [], surgery: [], care: [] }
    },
    flags: { savings: false, renew: true, manyRiders: false }
  };

  /* v5.9 — 진짜 빈 상담. '새 상담 시작'·'초기화'는 이 값을 씁니다(샘플 고객을 채우지 않습니다).
     샘플은 메인의 '샘플 데이터로 체험하기' 버튼으로만 들어갑니다. */
  const EMPTY = {
    age: '40', gender: '남', job: '1', silson: 'none', premium: 0,
    client: { name: '', birth: '', consultant: '', contract: '' },
    contracts: [], family: [], disc: {},
    cov: {
      cancer: { general: 0, similar: 0, treatment: { surgery: 0, drug: 0, radio: 0, icu: 0, extra: 0 }, recur: false },
      brain: { dx: { vascular: 0, stroke: 0, bleed: 0 }, treat: { lysis: 0, surgery: 0, icu: 0 }, main: 0, mainShared: false },
      heart: { dx: { ischemic: 0, ami: 0 }, treat: { lysis: 0, surgery: 0, icu: 0 }, main: 0, mainShared: false },
      surgery: { disease: 0, disease15: 0, disease15Tiers: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }, diseaseNdae: 0, diseaseNonPay: 0, injury: 0, injury15: 0, injury15Tiers: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } },
      care: { daily: 0, nDaily: 0, basis: 'unknown', family: 'conditional', nursing: false, ltc: false, mode: 'normal' },
      living: { deathInjury: 0, deathDisease: 0, disabilityInjury: 0, disabilityDisease: 0, driverFine: 0, driverLawyer: 0, driverSupport: 0, driverInjury: 0, liability: 0, fire: 0, fracture: 0, burn: 0, er: 0, inpatientInjury: 0, inpatientDisease: 0, silsonDeduct: 0, silsonNonPay: false, toothCare: false, toothProsthetic: false },
      custom: { cancer: [], brain: [], heart: [], surgery: [], care: [] }
    },
    flags: { savings: false, renew: false, manyRiders: false }
  };
  function emptyState() { return JSON.parse(JSON.stringify(EMPTY)); }

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
    analyzed: false, lastResult: null, label: '', history: [],
    /* v5.9 — 첫 실행 상태는 연습용 샘플입니다. 화면에 '샘플'로 표시하고,
       '새 상담 시작'을 누르면 빈 상담(EMPTY)으로 바뀝니다. */
    sample: true
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
  let saveSeq = 0;
  function sessionPayload() {
    return {
      client: state.client, contracts: state.contracts, age: state.age, gender: state.gender,
      job: state.job, jobNote: state.jobNote || '', jobTwoWheel: !!state.jobTwoWheel,
      silson: state.silson, silson2: state.silson2 || 'unknown', premium: state.premium, cov: state.cov, flags: state.flags,
      family: state.family, disc: state.disc, sample: !!state.sample, followUp: state.followUp || ''
    };
  }
  function saveSession() {
    /* v6.2 — 샘플 체험 모드에서는 어떤 경로로도 세션(입력 중 상담)을 덮어쓰지 않습니다 */
    if (state.sampleMode) return;
    const S = window.BojangSecure;
    /* v7.2 — '민감정보 미저장(세션 전용)' 모드: 기기에 아예 남기지 않습니다 */
    if (S && S.privacyMode() === 'session') {
      try { localStorage.removeItem(SKEY); } catch (e) { /* private mode */ }
      return;
    }
    const payload = sessionPayload();
    /* v7.2 — WebCrypto(AES-GCM)로 암호화해 저장. 키는 IndexedDB 의 추출 불가 CryptoKey.
       암호화를 쓸 수 없으면(구형 브라우저) 종전처럼 평문 저장으로 내려갑니다. */
    if (S && S.available && S.available()) {
      const seq = ++saveSeq;
      S.encrypt(payload).then((enc) => { if (seq === saveSeq && enc) lsSet(SKEY, enc); })
        .catch(() => { if (seq === saveSeq) lsSet(SKEY, payload); });
      return;
    }
    lsSet(SKEY, payload);
  }
  async function loadSession() {
    let s = lsGet(SKEY, null);
    if (s == null) return;
    if (window.BojangSecure && window.BojangSecure.isEncrypted(s)) {
      try { s = await window.BojangSecure.decrypt(s); } catch (e) { s = null; }
    }
    if (!s) return;
    if (s.client) state.client = Object.assign(state.client, s.client, { dateLabel: todayLabel() });
    if (Array.isArray(s.contracts)) state.contracts = s.contracts;
    if (Array.isArray(s.family)) state.family = s.family.filter((k) => FAMILY_HISTORY.some((f) => f.key === k));
    if (s.disc && typeof s.disc === 'object') state.disc = s.disc;
    ['age', 'gender', 'job', 'jobNote', 'jobTwoWheel', 'silson', 'silson2', 'premium', 'sample', 'followUp'].forEach((k) => { if (s[k] != null) state[k] = s[k]; });
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
      state.job = v; $('#job-hint').textContent = JOB_HINTS[v]; renderJobNote(); refreshAll(); saveSession();
    });
    buildSeg($('#seg-silson'), [
      { value: 'none', label: '없음' }, { value: '1', label: '1세대' }, { value: '2', label: '2세대' },
      { value: '3', label: '3세대' }, { value: '4', label: '4세대' }, { value: '5', label: '5세대' }
    ], state.silson, (v) => {
      state.silson = v; refreshAll(); saveSession(); renderSilson2();
    });
    renderSilson2();
    $('#job-hint').textContent = JOB_HINTS[state.job];
    renderJobNote();
    $('#premium').value = state.premium;
  }

  /* v6.1 — 2세대 초기(2013.3 이전)/후기 구분 — 할인 대상 판정이 이 값으로만 갈립니다 */
  function renderSilson2() {
    const seg = $('#seg-silson');
    if (!seg) return;
    let wrap = $('#silson2-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'silson2-wrap';
      wrap.className = 'silson2-wrap';
      seg.parentNode.appendChild(wrap);
    }
    const show = state.silson === '2';
    wrap.hidden = !show;
    if (!show) return;
    const cur = state.silson2 || 'unknown';
    wrap.innerHTML = `<span class="s2-label">가입 시기</span>${[['early', '2013.3 이전 · 할인 대상'], ['late', '2013.4~2017.3 · 대상 아님'], ['unknown', '모름']].map(([v, l]) => `<button type="button" class="s2-btn${cur === v ? ' is-on' : ''}" data-silson2="${v}">${l}</button>`).join('')}`;
    $$('[data-silson2]', wrap).forEach((b) => b.addEventListener('click', () => {
      state.silson2 = b.dataset.silson2;
      renderSilson2(); saveSession(); renderSummary();
      if (state.analyzed) analyze();
    }));
  }

  /* ================= 고객 정보 ================= */
  function renderClientFields() {
    $('#client-name').value = state.client.name === '홍길동' ? '' : state.client.name;
    $('#client-name').placeholder = '홍길동';
    $('#client-birth').value = state.client.birth || '';
    $('#consultant').value = state.client.consultant || '';
    updateBirthNote();
    renderClientStrip();
    /* v6.1.1 — 가림 모드 중에는 방금 채운 고객명 입력창도 즉시 다시 가립니다 */
    if (window.BojangSmartKey && BojangSmartKey.privacy) BojangSmartKey.privacy.syncInputs();
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
    const groups = ['3개월', '1년', '2년', '5년'];
    const periodNote = { '3개월': '최근 3개월 이내', '1년': '최근 1년 이내', '2년': '최근 2년 이내 · 간편 3·2·5', '5년': '최근 5년 이내' };
    const majors = (typeof DISCLOSURE_MAJOR10 !== 'undefined' ? DISCLOSURE_MAJOR10 : []).concat(typeof DISCLOSURE_MAJOR5 !== 'undefined' ? DISCLOSURE_MAJOR5.filter((m) => !DISCLOSURE_MAJOR10.some((x) => x.key === m.key)) : []);
    const majorHTML = `<div class="dc-major">
      <div class="dc-major-head">10대 질병 · 간편 중대질병 — 해당 질병마다 진단·치료·입원·수술·투약</div>
      <div class="dc-major-chips">${majors.map((m2) => `<button type="button" class="dc-chip${state.disc[m2.key] ? ' is-on' : ''}" data-disc="${m2.key}" aria-pressed="${state.disc[m2.key] ? 'true' : 'false'}">${m2.label}</button>`).join('')}</div>
      <button type="button" class="dc-item${state.disc.y5_major ? ' is-on' : ''}" data-disc="y5_major" aria-pressed="${state.disc.y5_major ? 'true' : 'false'}"><span class="dc-box" aria-hidden="true"></span><span class="dc-label">10대 질병 중 하나라도 해당 (전체 체크)</span></button>
    </div>`;
    host.innerHTML = groups.map((g) => {
      const items = DISCLOSURE_ITEMS.filter((d) => d.period === g && !d.major);
      return `<div class="dc-group">
        <div class="dc-period">${g}<em>${periodNote[g]}</em></div>
        ${items.map((d) => {
          const on = !!state.disc[d.key];
          return `<button type="button" class="dc-item${on ? ' is-on' : ''}" data-disc="${d.key}" aria-pressed="${on}" title="${esc(d.hint || '')}">
            <span class="dc-box" aria-hidden="true"></span><span class="dc-label">${d.label}${d.hint ? `<em>${esc(d.hint)}</em>` : ''}</span>
          </button>`;
        }).join('')}
        ${g === '5년' ? majorHTML : ''}
      </div>`;
    }).join('');
    $$('.dc-item, .dc-chip', host).forEach((b) => {
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
          <span class="dxc-state">${core && core.val >= 2000 ? '기준선 충족' : '기준선 확인 권장'}</span>
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

  /* v7.4 — 1~5종 종별 입력 (질병·상해). 대표값(1종)은 종전 칸과 같은 disease15/injury15 입니다. */
  function tier5RowHTML(item, part) {
    const ev = BojangModel.evalItem(state, item);
    const pr = ev.parts.find((p) => p.key === part.key) || { rec: 0, val: 0, fill: 0, stage: null };
    const t = BojangModel.tier5Obj(state, part.key);
    const labels = (typeof TIER5_LABELS !== 'undefined' && TIER5_LABELS.length) ? TIER5_LABELS : ['1종', '2종', '3종', '4종', '5종'];
    const sum = [1, 2, 3, 4, 5].reduce((a, i) => a + (Number(t[String(i)]) || 0), 0);
    const have = [1, 2, 3, 4, 5].filter((i) => Number(t[String(i)]) > 0).length;
    const stageTone = pr.stage ? (pr.stage.code === 'none' ? 'gap' : pr.stage.code === 'low' ? 'warn' : pr.stage.code === 'min' ? 'need' : 'ok') : 'gap';
    return `
      <div class="part tier5-group" data-part="${part.key}">
        <div class="part-head">
          <div class="part-label"><strong>${part.label}</strong><span>종별로 따로 입력 · 점수는 1종 기준</span></div>
          <div class="part-side">${pr.stage ? `<span class="mini-badge tone-${stageTone}">${pr.stage.label}</span>` : ''}${partBadge(item.key, part)}</div>
        </div>
        <div class="tier5-sum">
          <span>1~5종 합계 <b>${won(sum)}</b>만원<em>${have}/5종 입력</em></span>
          <span class="ts-rec">1종 기준 권장 ${won(pr.rec)}만원</span>
        </div>
        <div class="tier5-grid">
          ${[1, 2, 3, 4, 5].map((i) => `
            <label class="tier5-cell${i === 1 ? ' is-core' : ''}" data-tier-cell="${i}">
              <span class="t5-label">${labels[i - 1]}${i === 1 ? '<em>기준</em>' : ''}</span>
              <input type="number" inputmode="numeric" min="0" max="100000" step="${part.step || 50}"
                     data-item="${item.key}" data-part="${part.key}" data-tier="${i}"
                     value="${Number(t[String(i)]) || ''}" placeholder="0" aria-label="${esc(part.label)} ${labels[i - 1]} (만원)">
              <i class="unit">만원</i>
            </label>`).join('')}
        </div>
        <p class="tier5-detail" data-tier5-detail="${part.key}">${esc(BojangModel.tier5Detail(state, part.key))}</p>
        <p class="tier5-note">1종(내시경·카테터 등 소액) → 5종(개두·개흉·개복 고액). 같은 수술도 보험사 분류표에 따라 종수가 다르니 증권 분류표를 확인하세요.</p>
      </div>`;
  }

  /* v7.4 — 뇌·심장 ② 주요치료비(통합형) 입력 칸 */
  function mainRiderHTML(item) {
    if (item.key !== 'brain' && item.key !== 'heart') return '';
    const conf = (typeof NEURO_MAIN_CONF !== 'undefined' && NEURO_MAIN_CONF[item.key]) || { label: '주요치료비', hint: '', presets: [], note: '' };
    const quick = (typeof NEURO_MAIN_QUICK !== 'undefined') ? NEURO_MAIN_QUICK : [0, 500, 1000, 2000, 3000];
    const val = BojangModel.mainOf(state, item.key);
    const shared = BojangModel.mainSharedOf(state, item.key);
    const other = item.key === 'brain' ? 'heart' : 'brain';
    const sib = BojangModel.mainOf(state, other);
    const cross = !val && sib > 0 && BojangModel.mainSharedOf(state, other);
    return `
      <div class="part main-group" data-part="main">
        <div class="part-head">
          <div class="part-label"><strong>② ${esc(conf.label)}</strong><span>${esc(conf.hint)}</span></div>
          <div class="part-side">${val > 0 ? `<span class="mini-badge tone-ok">${won(val)}만원</span>` : (cross ? '<span class="mini-badge tone-need">공통 반영</span>' : '')}</div>
        </div>
        <div class="input-row">
          <span class="di-tag">직접입력</span>
          <input type="number" inputmode="numeric" min="0" max="100000" step="100" data-main="${item.key}"
                 value="${val || ''}" placeholder="0" aria-label="${esc(conf.label)} (만원)">
          <span class="unit">만원</span>
        </div>
        <div class="quick-row">
          ${quick.map((q) => `<button type="button" class="quick" data-main-set="${q}" data-main-key="${item.key}">${q === 0 ? '없음' : won(q)}</button>`).join('')}
          <label class="main-shared"><input type="checkbox" data-main-shared="${item.key}" ${shared ? 'checked' : ''}> 뇌·심장 공통</label>
        </div>
        ${cross ? `<p class="main-cross">뇌·심장 공통 담보 — ${other === 'heart' ? '심장' : '뇌'}에 입력한 주요치료비 ${won(sib)}만원이 이 축(혈전용해·수술)에도 반영됩니다.</p>` : ''}
        <p class="tier5-note">${esc(conf.note || '')} 단독 치료비와의 중복 지급 여부는 약관으로 확인합니다.</p>
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

  /* ================= v5.6 증권 담보 직접 기재 =================
     보험사마다 뇌·심장 주요치료비를 통합형으로 파는 곳과 개별형으로 파는 곳이 달라,
     고정 칸에 없는 특약을 증권 담보명 그대로 적습니다. */
  const CUSTOM_LABELS = (typeof CUSTOM_AREA_LABEL !== 'undefined') ? CUSTOM_AREA_LABEL : { cancer: '암', brain: '뇌', heart: '심장', surgery: '수술', care: '간병' };

  function customInto(key) {
    if (!state.cov.custom || typeof state.cov.custom !== 'object' || Array.isArray(state.cov.custom)) state.cov.custom = { cancer: [], brain: [], heart: [], surgery: [], care: [] };
    if (!Array.isArray(state.cov.custom[key])) state.cov.custom[key] = [];
    return state.cov.custom[key];
  }
  function customNewId(key) {
    return `cu_${key}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  }
  /* 화면에는 빈 행(입력 중)도 그대로 보여야 하므로 필터 없이 읽습니다 */
  function customRowsOf(key) {
    return customInto(key).map((it, i) => BojangModel.sanitizeCustom(it, key, i));
  }

  function customBlockHTML(key) {
    const items = customRowsOf(key);
    const total = items.reduce((a, x) => a + Number(x.amount || 0), 0);
    const presets = (typeof CUSTOM_PRESETS !== 'undefined' && CUSTOM_PRESETS[key]) || [];
    const scored = key === 'cancer' || key === 'brain' || key === 'heart';
    const rows = items.map((it) => `
      <div class="custom-row" data-cid="${esc(it.id)}">
        <input type="text" class="cr-name" value="${esc(it.name)}" placeholder="담보명 (증권 표기 그대로)" aria-label="${CUSTOM_LABELS[key]} 직접 기재 담보명" data-custom-name>
        <span class="cr-amt-box">
          <input type="number" inputmode="numeric" min="0" max="100000" step="100" class="cr-amt" value="${it.amount ? it.amount : ''}" placeholder="0" aria-label="직접 기재 담보 금액 (만원)" data-custom-amount>
          <span class="unit">만원</span>
        </span>
        <span class="cr-seg" role="group" aria-label="담보 구분">
          <button type="button" class="cr-seg-btn${it.mode === 'bundle' ? ' is-on' : ''}" data-custom-mode="bundle" aria-pressed="${it.mode === 'bundle'}">통합형</button>
          <button type="button" class="cr-seg-btn${it.mode === 'individual' ? ' is-on' : ''}" data-custom-mode="individual" aria-pressed="${it.mode === 'individual'}">개별형</button>
        </span>
        <button type="button" class="cr-del" data-custom-del aria-label="담보 삭제">×</button>
      </div>`).join('');
    return `
      <div class="part custom-block" data-custom-block="${key}">
        <div class="part-head">
          <div class="part-label"><strong>증권 담보 직접 기재</strong><span>보험사별 담보명 그대로 · 통합형/개별형</span></div>
          <div class="part-side"><span class="mini-badge custom-count tone-${items.length ? 'need' : 'gap'}">${items.length}건</span></div>
        </div>
        ${items.length ? `<div class="custom-list">${rows}</div>` : '<p class="custom-empty">고정 칸에 없는 특약(예: 특정순환계질환(3~5종) 주요치료비)을 증권에 적힌 그대로 적습니다.</p>'}
        ${presets.length ? `<div class="custom-presets">${presets.map((p) => `<button type="button" class="chip-custom" data-custom-preset="${esc(p.name)}" data-preset-mode="${p.mode}">+ ${esc(p.name)}</button>`).join('')}</div>` : ''}
        <button type="button" class="custom-add" data-custom-add="${key}">+ 증권 담보 직접 추가</button>
        <div class="custom-total"${total ? '' : ' hidden'}>직접 기재 합계 <b>${won(total)}</b>만원</div>
        <p class="custom-note">${scored
          ? '진단비 이름의 담보는 치료비 축에서 제외하고 표시만 합니다. 통합형은 하나의 담보가 여러 치료를 함께 지급하는 상품으로 보고 세부 권장 비율로 나눠 반영합니다.'
          : '이 영역은 고정 6축 판정을 그대로 두고, 직접 기재 담보는 증권 기재용으로 리포트에 표시합니다.'}</p>
      </div>`;
  }

  function updateCustomMeta(key) {
    const host = $(`[data-custom-block="${key}"]`);
    if (!host) return;
    const items = customRowsOf(key);
    const total = items.reduce((a, x) => a + Number(x.amount || 0), 0);
    const badge = $('.custom-count', host);
    if (badge) {
      badge.className = 'mini-badge custom-count tone-' + (items.length ? 'need' : 'gap');
      badge.textContent = items.length + '건';
    }
    const box = $('.custom-total', host);
    if (box) {
      box.hidden = !total;
      const b = $('b', box);
      if (b) b.textContent = won(total);
    }
  }

  function renderCustomBlock(key) {
    const host = $(`[data-custom-block="${key}"]`);
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = customBlockHTML(key);
    const fresh = wrap.firstElementChild;
    if (!fresh) return;
    host.replaceWith(fresh);
    bindCustomBlock(fresh);
  }

  function addCustomRider(key, name, mode) {
    const box = customInto(key);
    const nm = String(name || '').trim();
    if (nm && box.some((x) => String(x.name || '').trim() === nm)) { toast('이미 추가한 담보입니다'); return; }
    const id = customNewId(key);
    box.push({ id, name: nm.slice(0, 40), amount: 0, mode: mode === 'bundle' ? 'bundle' : 'individual', note: '' });
    renderCustomBlock(key);
    refreshBadges(); saveSession();
    const target = nm
      ? $(`[data-cid="${id}"] [data-custom-amount]`)
      : $(`[data-cid="${id}"] [data-custom-name]`);
    if (target) { try { target.focus(); if (target.select) target.select(); } catch (e) { /* noop */ } }
  }

  function bindCustomBlock(host) {
    if (!host) return;
    const key = host.dataset.customBlock;
    const box = customInto(key);
    $$('.custom-row', host).forEach((row) => {
      const id = row.dataset.cid;
      const find = () => box.find((x) => x.id === id);
      const nameIn = $('[data-custom-name]', row);
      const amtIn = $('[data-custom-amount]', row);
      if (nameIn) nameIn.addEventListener('input', () => {
        const it = find();
        if (!it) return;
        it.name = nameIn.value.slice(0, 40);
        refreshBadges(); saveSession();
      });
      if (amtIn) amtIn.addEventListener('input', () => {
        const it = find();
        if (!it) return;
        it.amount = clamp(Number(amtIn.value || 0), 0, 100000);
        updateCustomMeta(key);
        refreshBadges(); saveSession();
      });
      $$('[data-custom-mode]', row).forEach((b) => b.addEventListener('click', () => {
        const it = find();
        if (!it) return;
        it.mode = b.dataset.customMode === 'bundle' ? 'bundle' : 'individual';
        $$('[data-custom-mode]', row).forEach((x) => {
          const on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', String(on));
        });
        refreshBadges(); saveSession();
      }));
      const del = $('[data-custom-del]', row);
      if (del) del.addEventListener('click', () => {
        const i = box.findIndex((x) => x.id === id);
        if (i >= 0) box.splice(i, 1);
        renderCustomBlock(key);
        refreshBadges(); saveSession();
      });
    });
    const addBtn = $('[data-custom-add]', host);
    if (addBtn) addBtn.addEventListener('click', () => addCustomRider(key));
    $$('[data-custom-preset]', host).forEach((b) => b.addEventListener('click', () => addCustomRider(key, b.dataset.customPreset, b.dataset.presetMode)));
  }

  function cardHTML(item, extra) {
    const r = BojangModel.evalItem(state, item);
    const rowOf = (p) => p.type === 'amount' ? (p.tiers5 ? tier5RowHTML(item, p) : amountRowHTML(item, p))
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
        ${mainRiderHTML(item)}
        ${extra || ''}
        ${customBlockHTML(item.key)}
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
    renderLivingCard();
    renderRiderQueue();
    bindCoverageInputs();
  }

  /* =========================================================
     v7.2 — 6번째 '생활·실손' 참고 축 카드
     18개 항목을 5개 묶음으로 보여 주고, 금액·보유 여부만 입력합니다.
     점수·색 판정에는 넣지 않고 '빠진 생활 보장'만 알려 줍니다.
     ========================================================= */
  function livingValue(key) {
    const box = state.cov.living || (state.cov.living = {});
    return box[key];
  }
  function renderLivingCard() {
    const host = $('#card-living');
    if (!host) return;
    const L = BojangModel.livingRef(state);
    const groups = L.groups.map((g) => `
      <div class="living-group" data-lg="${g.key}">
        <div class="lg-head"><b>${g.label}</b><span>${g.present}/${g.total}</span></div>
        ${g.items.map((it) => it.type === 'bool'
          ? `<label class="living-row bool"><input type="checkbox" data-live-bool="${it.key}"${it.value ? ' checked' : ''} aria-label="${it.label}"><span>${it.label}<em>${it.hint}</em></span></label>`
          : `<label class="living-row"><span>${it.label}<em>${it.hint}</em></span>
               <input type="number" inputmode="numeric" min="0" max="100000" step="10" value="${it.value ? it.value : ''}" placeholder="0" data-live-amt="${it.key}" aria-label="${it.label} (만원)"><i class="unit">만원</i></label>`).join('')}
      </div>`).join('');
    host.innerHTML = `
      <div class="card cov-card ref-card" data-item="living">
        <div class="card-title">
          <span class="cov-rank">6</span>생활 · 실손
          <span class="card-sub">참고 축 — 점수·색 판정 제외</span>
          <span class="badge badge-ref">참고 ${L.present}/${L.total}</span>
        </div>
        <p class="ref-note">${esc(L.note)} 40·50대 가입 시 상해·운전자·배상·치아 담보는 보험료가 크지 않아 '빠진 칸'을 채우는 편이 좋습니다.</p>
        <div class="living-groups">${groups}</div>
        <p class="ref-foot">${L.missing.length ? '빠진 항목: ' + esc(L.missing.join(' · ')) : '생활·실손 항목이 모두 입력되었습니다.'}</p>
      </div>`;
    $$('#card-living [data-live-amt]').forEach((input) => {
      input.addEventListener('input', () => {
        const box = state.cov.living || (state.cov.living = {});
        box[input.dataset.liveAmt] = clamp(Number(input.value || 0), 0, 100000);
        saveSession();
      });
    });
    $$('#card-living [data-live-bool]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const box = state.cov.living || (state.cov.living = {});
        box[cb.dataset.liveBool] = !!cb.checked;
        saveSession();
      });
    });
  }

  /* =========================================================
     v7.2 — 미매칭 1탭 연결 큐
     담보명 사전에 없는 특약(또는 다른 축으로 분류된 특약)을 6개 축 버튼 한 번으로 연결합니다.
     ========================================================= */
  function renderRiderQueue() {
    const host = $('#rider-queue');
    if (!host) return;
    const list = BojangModel.unmatchedRiders(state);
    if (!list.length) {
      host.innerHTML = '<div class="rq-empty">직접 기재 담보가 모두 담보 축에 연결되었습니다.</div>';
      return;
    }
    const choices = (window.BojangDambo && BojangDambo.choices) ? BojangDambo.choices() : [];
    host.innerHTML = `
      <div class="rq-head"><span class="eyebrow">RIDER LINK</span> 미매칭 특약 ${list.length}건
        <em>1탭으로 담보 축에 연결하세요 — 사전 자동 매칭은 참고용입니다</em></div>
      ${list.map((x) => `
        <div class="rq-row" data-rq-id="${esc(x.id)}" data-rq-area="${x.area}">
          <div class="rq-name"><b>${esc(x.name)}</b><span>${CUSTOM_LABELS[x.area]} 영역 · ${x.amount ? won(x.amount) + '만원' : '금액 미입력'} · ${x.reason === 'mismatch' ? '다른 축(' + esc(x.axisLabel || '') + ')으로 분류됨' : '사전에 없는 이름'}</span></div>
          <div class="rq-choices">${choices.map((c) => `<button type="button" class="rq-btn${x.axis === c.key ? ' is-on' : ''}" data-rq-link="${x.id}" data-rq-axis="${c.key}" data-rq-name="${esc(x.name)}">${c.label}</button>`).join('')}</div>
        </div>`).join('')}`;
    $$('#rider-queue [data-rq-link]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.rqLink, axis = b.dataset.rqAxis;
        const dm = BojangModel.riderMatch(b.dataset.rqName || '');
        const sub = dm && dm.axis === axis ? dm.sub : null;
        const ok = BojangModel.linkRider(state, id, axis, sub);
        if (!ok) { toast('연결할 담보를 찾지 못했습니다'); return; }
        toast(axis === 'living' ? '생활·실손 참고 축으로 연결했습니다' : '연결했습니다');
        renderCoverageCards();
        refreshBadges();
        saveSession();
        if (state.analyzed) analyze();
      });
    });
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
    $$('#wiz-panels input[type="number"][data-item]:not([data-tier])').forEach((input) => {
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
    /* v7.4 — 1~5종 종별 입력 · 대표값(1종) 동기화 */
    $$('#wiz-panels input[type="number"][data-tier]').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.dataset.part, tier = String(Number(input.dataset.tier));
        const sg = state.cov.surgery || (state.cov.surgery = {});
        const box = (sg[field + 'Tiers'] && typeof sg[field + 'Tiers'] === 'object') ? sg[field + 'Tiers'] : (sg[field + 'Tiers'] = {});
        box[tier] = clamp(Number(input.value || 0), 0, 100000);
        BojangModel.syncTier5(sg);
        const host = input.closest('.tier5-group');
        if (host) {
          const t = BojangModel.tier5Obj(state, field);
          const sum = [1, 2, 3, 4, 5].reduce((a, i) => a + (Number(t[String(i)]) || 0), 0);
          const have = [1, 2, 3, 4, 5].filter((i) => Number(t[String(i)]) > 0).length;
          const b = $('.tier5-sum b', host); if (b) b.textContent = won(sum);
          const em = $('.tier5-sum em', host); if (em) em.textContent = `${have}/5종 입력`;
          const dt = $('[data-tier5-detail]', host); if (dt) dt.textContent = BojangModel.tier5Detail(state, field);
        }
        refreshBadges(); saveSession();
      });
    });
    /* v7.4 — 뇌·심장 주요치료비(②) 입력 */
    $$('#wiz-panels input[type="number"][data-main]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.main;
        state.cov[key].main = clamp(Number(input.value || 0), 0, 100000);
        refreshBadges(); saveSession();
      });
    });
    $$('#wiz-panels [data-main-set]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.mainKey, v = Number(b.dataset.mainSet);
        state.cov[key].main = clamp(v, 0, 100000);
        const input = $(`input[data-main="${key}"]`);
        if (input) input.value = v || '';
        renderCoverageCards();
        refreshBadges(); saveSession();
        if (state.analyzed) analyze();
      });
    });
    $$('#wiz-panels [data-main-shared]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.mainShared;
        state.cov[key].mainShared = !!cb.checked;
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
    $$('[data-custom-block]').forEach((host) => bindCustomBlock(host));
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

  /* v7.2 — 직업급수 자동 매칭 · 2·3급/이륜차 알림 */
  function renderJobNote() {
    const host = $('#job-grade-note');
    if (!host) return;
    const J = window.BojangJobGrades;
    if (!J) { host.innerHTML = ''; return; }
    const g = J.of(state.job);
    const m = state.jobNote ? J.match(state.jobNote) : null;
    const twoWheel = !!(state.jobTwoWheel || (m && m.twoWheel));
    const alerts = J.alerts(state.job, twoWheel) || [];
    const who = m ? `${esc(m.label)} — ${esc(m.gradeLabel)}` : `${esc(g.label)}`;
    host.className = 'job-grade-note tone-' + (g.risk === 'high' || twoWheel ? 'gap' : g.risk === 'mid' ? 'need' : 'ok');
    host.innerHTML = `<span class="jgn-badge">${esc(g.short)}</span>
      <div class="jgn-body"><b>${who}</b><em>${esc(g.note)}</em>
      ${alerts.length ? `<span class="jgn-alert">${esc(alerts[0].title)} — ${esc(alerts[0].body)}</span>` : '<span class="jgn-ok">상해 담보 가입 제한이 거의 없는 구분입니다.</span>'}
      ${m && m.check.length ? `<span class="jgn-check">확인: ${esc(m.check.join(' · '))}</span>` : ''}
      <span class="jgn-law">확정 급수는 가입 상품의 직업급수표가 기준입니다.</span></div>`;
  }

  /* ================= 진단 ================= */
  function analyze() {
    renderJobNote();
    const m = model();
    const rows = m.rows;
    const sc = { score: m.score, grade: m.grade, penalty: m.penalty, w: m.weights };
    const totalSum = m.totalSum, annual = m.annual;
    const R = 52, Cc = 2 * Math.PI * R;
    const dash = Cc * (1 - sc.score / 100);

    $('#result-hero').innerHTML = `
      <div class="hero-top">
        <span class="hero-eyebrow">COVERAGE SCORE</span>
        <span class="hero-input">${esc(state.client.name)}님 · ${state.age}대 ${esc(state.gender)} · ${state.job}급 · 실손 ${SILSON_LABEL[state.silson]}</span>
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

    /* v7.2 — 결과 최상단 한 문장 결론 배너 (보완 후보 N개 · 1순위) */
    const conc = (BojangModel.conclusion ? BojangModel.conclusion(state, m) : { text: '', count: 0, first: null });
    const cb = $('#result-conclusion');
    if (cb) {
      cb.className = 'conclusion-banner tone-' + (conc.count === 0 ? 'ok' : conc.count >= 3 ? 'gap' : 'need');
      cb.innerHTML = `
        <span class="cbn-eyebrow">결론</span>
        <b class="cbn-text" id="conclusion-text">${esc(conc.text)}</b>
        <span class="cbn-meta">${conc.count === 0 ? '추가 가입보다 갱신·만기 점검' : '1순위부터 한 칸씩 · 금액 기준선은 연령대별'}</span>`;
    }

    /* v7.2 — 연령대별 권장 기준선: 기준일·출처를 한 줄로 고정 표기 */
    const stdLine = $('#age-standard-line');
    if (stdLine) {
      const std = (typeof ageStandard === 'function') ? ageStandard('cancer', state.age) : null;
      const tier = std ? std.tierLabel : (typeof ageTierOf === 'function' ? ({ young: '20~30대', mid: '40~50대', senior: '60대+' }[ageTierOf(state.age)]) : '');
      stdLine.innerHTML = `<b>${esc(tier)} 권장 기준선</b> · 기준일 2026-11-17 · 출처: 중앙암등록본부 국가암등록통계(2023) · 통계청 2024 사망원인통계 · 건강보험심사평가원 진료비통계 · 국민건강보험공단 노인장기요양 통계연보 · 상품별 인수·약관 기준 우선`;
    }

    $('#radar').innerHTML = radarSVG(rows);
    $('#stats').innerHTML = statsHTML();

    const rowsHost = $('#result-rows');
    rowsHost.innerHTML = '';
    rows.forEach(({ item, r, pct, level, label, summary, gaps }) => {
      const el = document.createElement('div');
      el.className = 'prow';
      const tail = esc(summary) + (gaps.length ? ` · 보완 후보 ${gaps.map((g) => won(g.need) + '만원').join(', ')}` : '');
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
    renderNextAction();
    if (window.BojangLive) window.BojangLive.markDirty();
    if (window.BojangDeck) window.BojangDeck.refresh(state);
  }

  /* =========================================================
     v7.1 — 결과 화면 '이 고객 다음 할 일' 한 줄 요약 띠
     계약일(또는 생년월일)이 있으면 가장 가까운 점검일을 큰 글씨로 바로 보여 주고,
     없을 때는 계약일 입력을 유도합니다. 날짜가 주말·공휴일이면 영업일 보정을 병기합니다.
     ========================================================= */
  function nextActionData() {
    const A = window.BojangAftercare;
    const contract = state.client.contract || '';
    const birth = state.client.birth || '';
    if (!A || (!contract && !birth)) return { empty: true, contract, birth };
    const r = A.calc({ name: state.client.name, contract, birth });
    const upcoming = r.items.filter((i) => i.available && i.days != null && i.days >= 0).sort((a, b) => a.days - b.days);
    return {
      empty: false, contract, birth,
      next: r.nextCheck, item: upcoming[0] || null, second: upcoming[1] || null,
      total: upcoming.length
    };
  }

  function setClientContract(v) {
    state.client.contract = String(v || '');
    saveSession();
    const ac = $('#ac-contract');
    if (ac && ac.value !== state.client.contract) ac.value = state.client.contract;
    renderNextAction();
  }

  function renderNextAction() {
    const host = $('#next-action');
    if (!host) return null;
    const d = nextActionData();
    const P = window.BojangPublicData;
    if (d.empty) {
      host.className = 'next-action internal no-print is-empty';
      host.innerHTML = `
        <div class="na-row">
          <span class="na-eyebrow">NEXT TASK</span>
          <b class="na-empty-title">이 고객 다음 할 일</b>
          <p class="na-empty-copy">계약일을 넣으면 가장 가까운 점검일이 여기에 뜹니다 — 생년월일만 있어도 상령일을 계산합니다.</p>
        </div>
        <label class="na-field"><span>계약일</span><input type="date" id="na-contract" value="${esc(d.contract)}"></label>`;
      const el = $('#na-contract');
      if (el) el.addEventListener('change', () => setClientContract(el.value));
      return d;
    }
    const days = d.next.days;
    const tone = days <= 30 ? 'danger' : days <= 90 ? 'warn' : 'ok';
    const fix = (P && P.calendar && d.next.date) ? P.calendar.correct(d.next.date) : null;
    const fixLine = fix && !fix.ok
      ? `<p class="na-fix">${esc(d.next.date)}은 ${esc(fix.reason)} — 직전 영업일 <b>${esc(fix.prev)}(${esc(P.date.weekday(fix.prev))})</b>${fix.provisional ? ' · 2028 잠정 달력' : ''}<br><em>운영상 연락·서류 접수 참고일이며, 실제 효력일·상령일은 보험사 약관 기준을 따릅니다.</em></p>`
      : '';
    const secondLine = d.second
      ? `<p class="na-second">그다음 · ${esc(d.second.title)} ${esc(d.second.date)} (${esc(BojangAftercare.date.ddayText(d.second.days))})</p>`
      : '';
    host.className = 'next-action internal no-print';
    host.innerHTML = `
      <div class="na-main">
        <span class="na-eyebrow">NEXT TASK · 이 고객 다음 할 일</span>
        <div class="na-big">
          <span class="na-label">다음 점검</span>
          <b class="na-date">${esc(d.next.date)}</b>
          <span class="na-sep" aria-hidden="true">·</span>
          <b class="na-dday tone-${tone}">${esc(BojangAftercare.date.ddayText(days))}</b>
        </div>
        <p class="na-sub">${esc(d.next.title)} · ${esc(BojangAftercare.date.koDate(d.next.date))}(${esc(P && P.date ? P.date.weekday(d.next.date) : '')})</p>
        ${secondLine}
        ${fixLine}
      </div>
      <div class="na-side">
        <label class="na-field"><span>계약일</span><input type="date" id="na-contract" value="${esc(d.contract)}"></label>
        <button type="button" class="btn-ghost sm" data-na-go="aftercare">사후관리 열기 →</button>
      </div>`;
    const el = $('#na-contract');
    if (el) el.addEventListener('change', () => setClientContract(el.value));
    return d;
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
  function brandContact() {
    const b = (window.BojangBrand && window.BojangBrand.get && window.BojangBrand.get()) || {};
    return {
      name: b.consultant || state.client.consultant || '',
      title: b.title || '', phone: b.phone || '', kakao: b.kakao || '', brand: b.name || ''
    };
  }

  /* v5.8 — 고객에게 바로 보내는 5~6줄 카톡 요약 (점수·핵심 부족 1~2순위·담당자 연락처) */
  function kakaoSummary() {
    const res = state.lastResult;
    if (!res) return '';
    const m = res.m;
    const b = brandContact();
    const L = [];
    L.push(`[${m.client.name || '고객'}님 보장분석 요약]`);
    L.push(`· 종합 보장등급 ${m.letter} · ${m.score}점 (${m.grade.label})`);
    const needs = (m.needList || []).slice(0, 2);
    if (needs.length) {
      L.push(`· 먼저 채울 곳 ${needs.map((x, i) => {
        const g = (x.gaps || [])[0];
        const label = g && (g.label || g.key) ? String(g.label || g.key) : x.item.name;
        return `${i + 1}) ${label}`;
      }).join(' · ')}`);
    } else L.push('· 지금 구조는 충분합니다 — 금액 배분만 점검');
    if (m.client.ageDay) L.push(`· 보험나이 ${m.client.insuranceAge}세 · 상령일 ${m.client.ageDay.label} (D-${m.client.ageDay.days})`);
    L.push('· 증권 확인 — 담보명·1회한 여부·유사암 제외 문구');
    L.push(`· 후속 상담 약속일 — ${state.followUp || defaultFollowUp()}`);
    const contact = [b.name, b.phone].filter(Boolean).join(' · ');
    L.push(`· 담당 ${contact || '상담 설계사'}${b.kakao ? ' · ' + b.kakao : ''}`);
    L.push('※ 상담 참고용 요약입니다. 실제 지급 여부·금액은 가입한 상품의 약관과 증권이 기준입니다.');
    return L.join('\n');
  }

  function defaultFollowUp() {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} (1주 뒤 · 협의 가능)`;
  }

  function openKakaoModal(text) {
    const modal = $('#kakao-modal');
    if (!modal) return;
    $('#kakao-preview').textContent = text;
    modal.hidden = false;
    document.body.classList.add('is-modal');
  }

  function closeKakaoModal() {
    const modal = $('#kakao-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('is-modal');
  }

  async function copyKakaoSummary(btn) {
    if (!state.lastResult) { toast('먼저 진단해 주세요'); return ''; }
    const text = kakaoSummary();
    return await copy(text, '카톡 요약을 복사했습니다 — 카톡에 붙여넣으세요', btn || $('#btn-kakao'));
    openKakaoModal(text);
    return text;
  }

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
    else m.needList.slice(0, 3).forEach((x, i) => L.push(`${i + 1}) ${x.item.name} — ${x.summary}${x.gaps.length ? ` (${won(x.gaps.reduce((a, g) => a + g.need, 0))}만원 보완 후보)` : ''}`));
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

  /* v7.2 — PDF 파일명·문서 제목(메타데이터)에 고객 실명을 기본 제외.
     사용자가 원할 때만(#pdf-include-name) 이름을 넣습니다. 본문 표지의 이름은 상담용이라 그대로 둡니다. */
  function pdfIncludeName() {
    const cb = $('#pdf-include-name');
    return !!(cb && cb.checked) || !!state.pdfIncludeName;
  }
  async function buildPdfBlob(kind) {
    const started = performance.now();
    const build = BojangReport.build(kind, state);
    const includeName = pdfIncludeName();
    const pdfName = includeName ? build.m.client.name : '';
    const overflow = [];
    const memoOpts = BojangReport.MEMO[kind] || {};
    /* v5.2 베타: 전 기능 무료 — 워터마크 없음 (잠금 판정은 BojangPlan.unlocked) */
    const free = !(window.BojangPlan && window.BojangPlan.unlocked && window.BojangPlan.unlocked());
    const brand = window.BojangBrand ? window.BojangBrand.get() : { name: '보장분석 라이프 리포트' };
    const watermark = free && kind === 'summary' ? `${brand.name} · 무료 체험판` : '';
    /* v5.9 — 상세(10장) PDF 꼬리말에 발급 식별 워터마크(ID-XXXX)를 넣습니다 */
    const idMark = kind === 'detail' && window.BojangGuard ? window.BojangGuard.mark() : '';
    const blob = await PDFKit.renderPages(build.pages, {
      quality: kind === 'summary' ? 0.92 : kind === 'detail' ? 0.86 : 0.83,
      overflow,
      memo: kind !== 'summary',
      memoMax: memoOpts.memoMax,
      memoLabels: memoOpts.memoLabels,
      watermark,
      idMark,
      meta: { title: includeName ? `${build.m.client.name}_${PDF_LABEL[kind]}` : `보장분석_${PDF_LABEL[kind]}` },
      onProgress: (done, total) => {
        overlay(true, `${PDF_LABEL[kind]} PDF 생성 중`, `${total}페이지 중 ${done}페이지를 그렸습니다`, done / total);
      }
    });
    const filename = PDFKit.fileName(kind, pdfName || '고객', isoDate(build.m.dateLabel));
    window.__lastPdf = { kind, watermark: !!watermark, pages: build.pages.length, filename, idMark, includeName };
    return { blob, filename, pages: build.pages.length, overflow, ms: Math.round(performance.now() - started), model: build.m, watermark, idMark, includeName, nameExcluded: !includeName };
  }
  window.BojangApp = {
    buildPdfBlob, doPdf, state, analyze, cursorModel: model, applyImport, switchView, renderAllInputs,
    /* v5.9 */ newConsult: resetConsult, loadSample: loadSampleConsult, renderHistory, openMoreMenu,
    /* v6.0 */ startNewConsult,
    /* v6.2 — 샘플 체험 모드 */
    openSampleDemo, exitSampleDemo, isSampleMode: () => !!state.sampleMode,
    legal: { open: openLegal, close: closeLegal, render: renderLegal }, guardNumberInput,
    isSample: () => !!state.sample,
    /* v7.1 — 결과 화면 '이 고객 다음 할 일' 띠 */
    renderNextAction, nextActionData, setClientContract,
    /* v6.1 — 도구 탭 고지 체크가 6단계 입력과 같은 state.disc를 쓰도록 */
    discTouched: () => { saveSession(); renderDisclosure(); renderSummary(); if (state.analyzed) analyze(); }
  };

  function isoDate(label) {
    const m = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(label || '');
    if (m) return `${m[1]}${String(m[2]).padStart(2, '0')}${String(m[3]).padStart(2, '0')}`;
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  async function doPdf(kind) {
    if (!state.analyzed) analyze();
    /* v5.2 베타: 1·10·30장 모두 저장 가능 — 잠금이 걸린 경우에만 안내 */
    if (window.BojangPlan && !window.BojangPlan.unlocked() && kind !== 'summary') {
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
          await navigator.share({ files: [file], title: filename, text: `${(out && out.model && out.model.client ? out.model.client.name : state.client.name)}님 ${PDF_LABEL[kind]} 리포트` });
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
    return window.BojangPlan && window.BojangPlan.unlocked() ? 30 : 1;
  }

  /* v5.9 — 상담 이력은 IndexedDB(BojangStore)에 저장합니다. */
  function store() { return window.BojangStore; }

  async function loadHistory() {
    let list = [];
    try {
      if (store()) list = await store().loadHistory();
      else list = lsGet(HKEY, []);
    } catch (e) {
      list = lsGet(HKEY, []);
    }
    state.history = Array.isArray(list) ? list.slice(0, historyMax()) : [];
    renderHistory();
    return state.history;
  }

  function persistHistory(list) {
    const rows = Array.isArray(list) ? list : [];
    if (!store()) { lsSet(HKEY, rows); return; }
    store().saveHistory(rows).catch(() => { lsSet(HKEY, rows); });
  }

  function saveConsult() {
    /* v6.2 — 샘플 체험 모드는 가상 데이터이므로 이력·클라우드에 저장하지 않습니다 */
    if (state.sampleMode) { toast('샘플 체험 모드에서는 저장되지 않습니다 — 가상 데이터입니다'); return; }
    if (!state.lastResult) { toast('먼저 진단해 주세요'); return; }
    if (!(window.BojangPlan && window.BojangPlan.unlocked()) && state.history.length >= 1) {
      window.BojangPlan.openPaywall('save2');
      return;
    }
    const label = ($('#cust-label').value || '').trim() || `${state.client.name || '이름 미입력'} · ${state.age}대 ${state.gender}`;
    /* v5.9 — 저장 직전에 음수·비정상 금액을 0 이상으로 보정합니다 */
    try { if (window.BojangModel && window.BojangModel.clampAmounts) window.BojangModel.clampAmounts(state); } catch (e) { /* noop */ }
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
    persistHistory(next);
    state.history = next; renderHistory();
    toast(window.BojangPlan && window.BojangPlan.unlocked() ? '저장했습니다 (베타 · 최대 30건)' : '무료 체험 · 고객 1명을 저장했습니다 (Pro는 30명)');
      /* v5.8 — 로그인 + 서버 연결 상태면 클라우드(consultations, 없으면 clients)로도 올립니다 */
      if (window.BojangBackend && window.BojangBackend.isLive && window.BojangBackend.isLive()
          && window.BojangBackend.hasSession && window.BojangBackend.hasSession()) {
        const B = window.BojangBackend;
        const push = B.syncConsultation ? B.syncConsultation(entry) : B.syncClient(entry);
        push.then((r) => {
          if (!r || !r.ok) return;
          toast(r.table === 'clients'
            ? '클라우드에도 저장했습니다 — 다른 기기에서 불러올 수 있습니다'
            : '클라우드(상담 기록)에도 저장했습니다 — PC·모바일에서 이어보기');
          updateCloudBadge();
        }).catch(() => {});
      }
  }

  /* ================= v5.8 — 클라우드 상담 기록 이어보기 ================= */
  function cloudReady() {
    const B = window.BojangBackend;
    return !!(B && B.isLive && B.isLive() && B.hasSession && B.hasSession());
  }

  function updateCloudBadge(table) {
    const list = $$('.cloud-state');
    if (!list.length) return;
    const t = table || (window.BojangBackend && window.BojangBackend.cloudTable ? window.BojangBackend.cloudTable() : '');
    const text = cloudReady()
      ? (t === 'clients' ? '기기 + 클라우드(서울) 저장 · 이름·보험료·담보 스냅샷' : '기기 + 클라우드(서울) 저장 · 이름·보험료·담보 스냅샷')
      : '이 기기에만 저장 (로그인하면 클라우드 동기화)';
    list.forEach((el) => { el.textContent = text; el.dataset.tone = cloudReady() ? 'ok' : 'mute'; });
  }

  /* 서버에서 온 상담을 로컬 목록에 합칩니다 — 로컬에 이미 있는 id 는 로컬 것을 유지 */
  function ingestCloud(result, opts) {
    opts = opts || {};
    if (!result || !result.ok) return { ok: false, added: 0 };
    const entries = (result.entries || []).filter((e) => e && e.inputs && e.inputs.cov);
    const byId = {};
    state.history.forEach((h) => { byId[h.id] = h; });
    let added = 0;
    entries.forEach((e) => {
      const cur = byId[e.id];
      if (!cur) { byId[e.id] = e; added++; return; }
      if (cur.cloud) byId[e.id] = Object.assign({}, cur, { cloud: true, cloudTable: e.cloudTable, cloudId: e.cloudId });
    });
    const next = Object.keys(byId).map((k) => byId[k])
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))
      .slice(0, historyMax());
    state.history = next;
    persistHistory(next);
    renderHistory();
    updateCloudBadge(result.table);
    if (added && !opts.silent) toast(`클라우드에서 상담 ${added}건을 불러왔습니다`);
    if (opts.manual && !added) toast('클라우드 기록이 이미 이 기기에 있습니다');
    return { ok: true, added };
  }

  async function syncHistoryFromCloud(opts) {
    opts = opts || {};
    const B = window.BojangBackend;
    if (!B || !B.pullConsultations) { if (opts.manual) toast('클라우드 동기화를 쓸 수 없습니다'); return { ok: false, added: 0 }; }
    if (!cloudReady()) {
      if (opts.manual) toast('로그인하면 다른 기기의 상담 기록을 불러옵니다');
      updateCloudBadge();
      return { ok: false, added: 0, reason: 'offline' };
    }
    const btn = $('#btn-cloud-sync');
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }    let r = { ok: false, entries: [] };
    try { r = await B.pullConsultations(20); } catch (e) { r = { ok: false, entries: [] }; }
    if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
    if (!r.ok) { if (opts.manual) toast('클라우드에서 불러오지 못했습니다'); return { ok: false, added: 0 }; }
    return ingestCloud(r, opts);
  }

  function historyRowHTML(h) {
    const d = new Date(h.savedAt);
    const when = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const inputs = h.inputs || {};
    return `
        <div class="hist${h.cloud ? ' is-cloud' : ''}" data-id="${h.id}">
          <div class="hist-main"><strong>${esc(h.label)}${h.cloud ? '<span class="hist-cloud" title="클라우드에서 불러온 상담">☁</span>' : ''}</strong>
            <span>${when} · ${inputs.age}대 ${inputs.gender} · 실손 ${SILSON_LABEL[inputs.silson]}</span></div>
          <span class="hist-score">${h.score}<i>점</i></span>
          <button type="button" class="hist-load" data-load="${h.id}">불러오기</button>
          <button type="button" class="hist-del" data-del="${h.id}" aria-label="삭제">×</button>
        </div>`;
  }

  function bindHistoryHost(host) {
    if (!host) return;
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
        persistHistory(next);
        state.history = next;
        renderHistory(); renderHome();
        toast('삭제했습니다');
      });
    });
  }

  function renderHistory() {
    const hosts = $$('[id="history-list"], [id="history-list2"]');
    const emptyHTML = `<p class="empty">저장된 상담이 없습니다. 진단 후 "상담 저장"을 누르면 이 기기에 저장됩니다.</p>`;
    const html = !state.history.length ? emptyHTML : state.history.map(historyRowHTML).join('');
    hosts.forEach((host) => { host.innerHTML = html; bindHistoryHost(host); });

    /* v5.9 — 메인 첫 화면 2번 버튼 아래에 최근 3건만 */
    const recent = $('#recent-list');
    if (recent) {
      const top = state.history.slice(0, 3);
      recent.innerHTML = top.length
        ? top.map(historyRowHTML).join('') + `<button type="button" class="recent-all" id="btn-recent-all">전체 이력 ${state.history.length}건 보기</button>`
        : `<p class="recent-empty">저장된 상담이 없습니다 — 첫 상담을 저장하면 여기에 최근 3건이 바로 뜹니다.</p>`;
      bindHistoryHost(recent);
      const allBtn = $('#btn-recent-all');
      if (allBtn) allBtn.addEventListener('click', () => { openMoreMenu(true); const el = $('#history-list'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    }

    const subText = (cloudReady() ? '기기 + 클라우드 저장' : '이 기기에만 저장') + ' · 최대 ' + historyMax() + '건';
    const sub = $('#result-hist-sub');
    if (sub) sub.textContent = subText;
    const hsub = $('#home-hist-sub');
    if (hsub) hsub.textContent = subText;
    const count = state.history.length + '건';
    ['#home-hist-count', '#home-hist-count-card'].forEach((sel) => {
      const el = $(sel);
      if (el) el.textContent = count;
    });
    updateCloudBadge();
    renderHome();
  }

  function applyInputs(inputs) {
    state.sample = false;
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

  /* v4: 새 상담 시작 — 확인 모달을 거쳐 입력값을 한 번에 비웁니다.
     v5.9: 예전에는 '비운다'고 안내하고 샘플 고객(DEFAULT)을 다시 채워 넣어 빈 상담과 구분이 안 됐습니다.
     지금은 EMPTY 로 진짜 빈 상담을 열고, 샘플은 메인의 '샘플 데이터로 체험하기'로만 들어갑니다. */
  function resetConsult(opts) {
    opts = opts || {};
    const e = emptyState();
    state.sample = false;
    state.age = e.age; state.gender = e.gender; state.job = e.job;
    state.silson = e.silson; state.premium = e.premium;
    state.cov = JSON.parse(JSON.stringify(e.cov));
    state.flags = Object.assign({}, e.flags);
    state.family = [];
    state.disc = {};
    state.client = Object.assign({}, e.client, { dateLabel: todayLabel() });
    state.contracts = [];
    state.label = '';
    state.migration = { migrated: false, notes: [], clamped: 0 };
    /* v7.0 — 새 상담을 열면 메모 원문·강조 표시를 함께 비웁니다(원문은 저장하지 않습니다) */
    if (window.BojangMemoFill && window.BojangMemoFill.reset) window.BojangMemoFill.reset();
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
    toast(opts.silent ? '빈 상담으로 초기화했습니다' : '새 상담을 빈 상태로 시작합니다 — 샘플 값은 채우지 않았습니다');
  }

  /* v6.0 — 입력 허브에서 '수기 입력'으로 들어갈 때 연습용 샘플이 새 상담에 섞이지 않게 합니다.
     실제 입력 중인 상담(샘플 아님)은 지우지 않습니다 — 사용자가 입력한 값을 함부로 버리지 않기 위해서입니다. */
  function startNewConsult() {
    if (state.sample) { resetConsult({ silent: true }); return 'reset'; }
    return 'kept';
  }

  /* v5.9 — 샘플 체험은 명시적으로만: 연령대 프리셋을 채우고 '샘플'임을 알립니다 */
  function loadSampleConsult(age) {
    const a = String(age || state.age || '40');
    state.sample = true;
    applyPreset(a);
    toast('샘플 데이터를 채웠습니다 (연습·시연용) — 실제 고객 값으로 바꿔 주세요');
  }

  /* =========================================================
     v6.2 — 로그인 없는 '진짜 30장 샘플 바로 열기'
     · 가상 고객(김서연) 데이터로만 30장 슬라이드·1·10·30장 PDF를 체험합니다.
     · 실제 상담과 완전히 격리합니다 — 세션 저장·상담 이력 저장·클라우드 전송을 모두 막고,
       종료하면 체험 직전 상담 상태를 그대로 되돌립니다.
     ========================================================= */
  const SAMPLE_CUSTOMER = {
    client: { name: '김서연', birth: '1988-05-14', consultant: '' },
    age: '30', gender: '여', job: '2', silson: '4', silson2: 'unknown', premium: 23,
    cov: {
      cancer: { general: 3000, similar: 1000, treatment: { surgery: 500, drug: 0, radio: 0, icu: 0, extra: 0 }, recur: false },
      brain: { dx: { vascular: 2000, stroke: 0, bleed: 0 }, treat: { lysis: 0, surgery: 500, icu: 0 } },
      heart: { dx: { ischemic: 1000, ami: 0 }, treat: { lysis: 0, surgery: 0, icu: 0 } },
      surgery: { disease: 30, disease15: 100, diseaseNdae: 0, diseaseNonPay: 0, injury: 20, injury15: 0 },
      care: { daily: 0, nDaily: 0, basis: 'unknown', family: 'conditional', nursing: false, ltc: false, mode: 'normal' },
      custom: { cancer: [], brain: [], heart: [], surgery: [], care: [] }
    },
    contracts: [
      { insurer: '한빛생명', product: '무배당 종합보험', premium: 9, pay: '납입중', maturity: '100세', renew: false },
      { insurer: '대성화재', product: '실손의료비 4세대', premium: 8, pay: '납입중', maturity: '1년 갱신', renew: true },
      { insurer: '한빛생명', product: '암보험 (20년납)', premium: 6, pay: '납입중', maturity: '80세', renew: false }
    ],
    family: ['cancer', 'heart'],
    disc: { m3_med: true },
    flags: { savings: false, renew: true, manyRiders: false }
  };
  let sampleBackup = null;
  function inSampleMode() { return !!state.sampleMode; }

  function renderSampleBar() {
    const on = inSampleMode();
    const bar = $('#sample-bar');
    if (bar) bar.hidden = !on;
    const menu = $('#sb-menu');
    if (menu && !on) { menu.hidden = true; const pb = $('#btn-sample-pdf'); if (pb) pb.setAttribute('aria-expanded', 'false'); }
    /* 배지 실제 높이만큼 고객 화면(deck)을 내려 겹치지 않게 합니다 (노치·안전영역 포함) */
    if (on && bar) document.documentElement.style.setProperty('--sample-bar-h', Math.round(bar.getBoundingClientRect().height) + 'px');
    document.body.classList.toggle('is-sample', on);
    return on;
  }

  function openSampleDemo() {
    if (inSampleMode()) return false;
    sampleBackup = JSON.parse(JSON.stringify({
      client: state.client, contracts: state.contracts, age: state.age, gender: state.gender,
      job: state.job, silson: state.silson, silson2: state.silson2 || 'unknown', premium: state.premium,
      cov: state.cov, flags: state.flags, family: state.family, disc: state.disc,
      label: state.label, step: state.step, analyzed: !!state.analyzed, sample: !!state.sample
    }));
    const S = SAMPLE_CUSTOMER;
    state.client = Object.assign({}, S.client, { dateLabel: todayLabel() });
    state.age = S.age; state.gender = S.gender; state.job = S.job;
    state.silson = S.silson; state.silson2 = S.silson2;
    state.premium = S.premium;
    state.cov = JSON.parse(JSON.stringify(S.cov));
    state.contracts = JSON.parse(JSON.stringify(S.contracts));
    state.family = S.family.slice();
    state.disc = Object.assign({}, S.disc);
    state.flags = Object.assign({}, S.flags);
    state.label = '';
    try { if (window.BojangModel && BojangModel.normalizeState) BojangModel.normalizeState(state); } catch (e) { /* noop */ }
    state.sample = true;
    state.sampleMode = true;
    state.analyzed = false; state.lastResult = null;
    renderAllInputs();
    $('#cust-label').value = '';
    analyze();
    switchView('analysis');
    state.view = 'client';
    applyView();
    if (window.BojangDeck) window.BojangDeck.goTo(1, true);
    renderSampleBar();
    toast('샘플 체험 모드 — 가상 고객 김서연님으로 30장을 열었습니다 (저장되지 않음)');
    return true;
  }

  function exitSampleDemo() {
    if (!inSampleMode()) return false;
    const b = sampleBackup; sampleBackup = null;
    state.sampleMode = false;
    if (window.BojangDeck) window.BojangDeck.hide();
    state.view = 'advisor'; lsSet(VKEY, 'advisor');
    if (b) {
      state.client = Object.assign({}, b.client, { dateLabel: todayLabel() });
      state.contracts = b.contracts; state.age = b.age; state.gender = b.gender;
      state.job = b.job; state.silson = b.silson; state.silson2 = b.silson2;
      state.premium = b.premium; state.cov = b.cov; state.flags = b.flags;
      state.family = b.family; state.disc = b.disc; state.label = b.label;
      state.sample = !!b.sample;
      try { if (window.BojangModel && BojangModel.normalizeState) BojangModel.normalizeState(state); } catch (e) { /* noop */ }
      state.analyzed = false; state.lastResult = null;
      $('#result').hidden = true; $('#save-bar').hidden = true;
      renderAllInputs();
      $('#cust-label').value = b.label || '';
      if (b.analyzed) analyze();
      setStep(b.step || 1, true);
    } else {
      resetConsult({ silent: true });
    }
    applyView(); renderSampleBar(); renderHome(); renderClientStrip(); renderSummary();
    switchView('home');
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { /* noop */ }
    toast('샘플 체험을 종료했습니다 — 내 상담 데이터는 그대로입니다');
    return true;
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

  /* v7.2 — 복사 완료 피드백: 버튼 상태 전환(복사됨 ✓) + 토스트(aria-live) 를 함께.
     클립보드가 막힌 환경에서도 '복사했습니다'만 띄우지 않고 실패를 분명히 알립니다. */
  const COPY_BTN_LABEL = new WeakMap();
  function copyBtnDone(btn) {
    if (!btn || !btn.dataset) return;
    if (!COPY_BTN_LABEL.has(btn)) COPY_BTN_LABEL.set(btn, btn.textContent);
    btn.dataset.copied = '1';
    btn.classList.add('is-copied');
    btn.setAttribute('aria-label', '복사 완료');
    btn.textContent = '복사됨 ✓';
    setTimeout(() => {
      if (!btn.dataset.copied) return;
      delete btn.dataset.copied;
      btn.classList.remove('is-copied');
      btn.textContent = COPY_BTN_LABEL.get(btn) || '복사';
    }, 1600);
  }
  async function copy(text, okMsg, btn) {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
    } catch (e) { ok = false; }
    if (!ok) {
      /* 클립보드 API 가 막힌 환경(권한 거부·비보안 컨텍스트)은 textarea 폴백 */
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); document.body.removeChild(ta);
      } catch (e) { ok = false; }
    }
    if (ok) {
      copyBtnDone(btn);
      toast(okMsg || '복사했습니다');
      return true;
    }
    if (btn) {
      if (!COPY_BTN_LABEL.has(btn)) COPY_BTN_LABEL.set(btn, btn.textContent);
      btn.classList.add('is-copy-failed');
      btn.textContent = '복사 실패';
      setTimeout(() => { btn.classList.remove('is-copy-failed'); btn.textContent = COPY_BTN_LABEL.get(btn) || '복사'; }, 1800);
    }
    toast('복사가 막혔습니다. 길게 눌러 직접 선택해 주세요');
    return false;
  }
  window.__bojangCopy = copy;
  window.__bojangToast = toast;

  /* ================= 탭 전환 ================= */
  function switchView(name) {
    name = name || 'home';
    const inv = $('#tour-invite');
    if (inv) inv.hidden = true;
    state.tab = name;
    const viewId = 'view-' + name;
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === viewId));
    const tabOf = { home: 'home', analysis: 'analysis', quick: 'analysis', capture: 'analysis', import: 'analysis', guide: 'guide', live: 'live', toolkit: 'toolkit', codes: 'home', silson: 'home', disclose: 'home', premium: 'home', remodel: 'home', brand: 'home' };
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
    /* v7.0 — 가림 모드가 바뀌었을 수 있으니 툴킷 디데이를 다시 그립니다 */
    if (name === 'toolkit' && window.BojangAftercare) window.BojangAftercare.run();
    /* v7.1 — 공공데이터 카드의 맞춤 통계를 현재 고객 조건으로 다시 그립니다 */
    if (name === 'toolkit' && window.BojangPublicData) window.BojangPublicData.refresh();
    if (window.BojangTools) {
      if (name === 'codes') window.BojangTools.renderCodes();
      else if (name === 'silson') window.BojangTools.renderSilson();
      else if (name === 'disclose') { window.BojangTools.renderDisclosureTool(); window.BojangTools.renderClaimDocs(); }
      else if (name === 'premium') window.BojangTools.renderPremiumTool();
    }
  }

  /* ================= v5.3 자동입력 반영 (v5.4: 사진 AI 인식 결과 포함) =================
     검수 화면에서 체크된 항목만 현재 고객 상태에 넣고 점수를 다시 계산합니다.
     field 는 'cancer.treatment.surgery' 같은 경로이며, monthlyPremium·silsonGen은 전용 필드입니다. */
  function applyImport(items, meta) {
    meta = meta || {};
    let applied = 0;
    /* v7.4 — PDF에서 자동 추출한 마스킹 고객정보(이름·성별·생년월일·연령대)를 기본정보에 채웁니다.
       이름은 이미 가운데가 x로 마스킹된 값만 들어옵니다(원문 이름은 저장하지 않음). */
    if (meta.client && typeof meta.client === 'object') {
      const c = meta.client;
      if (c.name) state.client.name = String(c.name).replace(/\s+/g, '').slice(0, 12);
      if (c.birth) state.client.birth = String(c.birth).slice(0, 10);
      if (c.gender === '남' || c.gender === '여') state.gender = c.gender;
      if (c.ageBand && ['20', '30', '40', '50', '60', '70'].indexOf(String(c.ageBand)) >= 0) {
        state.age = String(c.ageBand); state.ageAuto = true;
      }
      applied += 1;
    }
    (items || []).forEach((it) => {
      if (!it || it.apply === false) return;
      if (it.field === 'monthlyPremium') {
        state.premium = clamp(Math.round(Number(it.value) || 0), 0, 300);
        applied++;
        return;
      }
      if (it.field === 'silsonGen') {
        const g = String(it.value);
        if (['none', '1', '2', '3', '4', '5'].indexOf(g) >= 0) { state.silson = g; applied++; }
        return;
      }
      if (it.kind === 'custom') {
        const area = ['cancer', 'brain', 'heart', 'surgery', 'care'].indexOf(String(it.area)) >= 0 ? String(it.area) : 'brain';
        const box = state.cov.custom || (state.cov.custom = { cancer: [], brain: [], heart: [], surgery: [], care: [] });
        if (!Array.isArray(box[area])) box[area] = [];
        const name = String(it.name || it.label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        const amount = Math.max(0, Math.round(Number(it.value) || 0));
        if (!name) return;
        const exist = box[area].find((x) => String(x.name || '').trim() === name);
        if (exist) exist.amount = amount;
        else box[area].push({
          id: 'cu_' + area + '_' + Date.now() + '_' + box[area].length,
          name, amount, mode: it.mode === 'individual' ? 'individual' : 'bundle', note: '사진·PDF 인식'
        });
        applied++;
        return;
      }
      if (it.kind === 'bool' || it.value === true) {
        BojangImport.setByPath(state.cov, it.field, true);
        applied++;
        return;
      }
      const n = Number(it.value);
      if (!isFinite(n) || n < 0) return;
      /* v7.4 — 1~5종 종별 금액: 대표값(1종)과 종별 표를 함께 저장합니다 */
      const tierField = (it.field === 'surgery.disease15') ? 'disease15' : (it.field === 'surgery.injury15') ? 'injury15' : null;
      if (tierField) {
        const sg = state.cov.surgery || (state.cov.surgery = {});
        if (it.tiers && typeof it.tiers === 'object') {
          const box = {};
          [1, 2, 3, 4, 5].forEach((i) => { box[String(i)] = Math.max(0, Number(it.tiers[String(i)] || it.tiers[i] || 0) || 0); });
          sg[tierField + 'Tiers'] = box;
        } else {
          sg[tierField + 'Tiers'] = { '1': n, '2': 0, '3': 0, '4': 0, '5': 0 };
        }
        sg[tierField] = n;
        BojangModel.syncTier5(sg);
        applied++;
        return;
      }
      BojangImport.setByPath(state.cov, it.field, n);
      applied++;
    });
    if (meta.premium != null && !(items || []).some((i) => i && i.field === 'monthlyPremium')) {
      state.premium = clamp(Math.round(Number(meta.premium) || 0), 0, 300);
    }
    if (meta.silson && !(items || []).some((i) => i && i.field === 'silsonGen')) state.silson = String(meta.silson);

    state.migration = BojangModel.normalizeState(state);
    renderAllInputs();
    refreshBadges();
    saveSession();
    analyze();
    switchView('analysis');
    setStep(state.step, true);
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`${applied}건을 입력칸에 반영하고 점수를 다시 계산했습니다`);
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
      <text x="32" y="247" class="dg-l light">종수가 높을수록 고액 · 1종 내시경 &lt; 5종 개두·개흉</text>
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
        copy(g.talk[i].replace(/^"|"$/g, ''), '화법을 복사했습니다', b);
      });
    });
  }

  /* ================= 탭 3 ================= */
  function renderToolkit() {
    $('#disclosure-general').innerHTML = DISCLOSURE_GENERAL.map((d) => `
      <div class="disc-row"><div class="disc-period">${d.period}</div><ul>${d.items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`).join('');
    $('#disclosure-simple').innerHTML = DISCLOSURE_PRODUCTS.map((d) => `
      <div class="disc-row"><div class="disc-period">${d.label.replace('간편심사 ', '')}</div><ul>${d.items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`).join('');

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
        copy(`${o.trigger}\n\n[공감] ${o.empathy}\n[환기] ${o.awaken}\n[대안] ${o.alternative}`, '화법을 복사했습니다', b);
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
        <div class="hc-name">${esc(state.client.name || '홍길동')}님 <span>${ia != null ? `보험나이 ${ia}세` : `${state.age}대`} · ${state.gender} · ${state.job}급</span>
          ${state.sample ? '<em class="hc-sample">샘플</em>' : ''}</div>
        <div class="hc-meta">
          <span>월 ${won(state.premium)}만원</span>
          <span>실손 ${SILSON_LABEL[state.silson]}</span>
          ${m ? `<span class="hc-score tone-${m.grade.tone}">${m.letter} · ${m.score}점</span>` : ''}
          <span>계약 ${state.contracts.length}건</span>
        </div>
      </div>
      ${state.migration && state.migration.notes && state.migration.notes.length
        ? `<div class="mig-note">구버전 데이터를 새 구조로 옮겼습니다 · ${state.migration.notes.join(' / ')}</div>` : ''}`;
    ['#home-hist-count', '#home-hist-count-card'].forEach((sel) => {
      const el = $(sel);
      if (el) el.textContent = state.history.length + '건';
    });
    renderPresets();
  }

  /* v5.9 — 더보기/전체 메뉴 열기·닫기 (첫 화면은 3버튼만 보입니다) */
  function openMoreMenu(open) {
    const box = $('#more-menu');
    const btn = $('#btn-more-menu');
    if (!box || !btn) return;
    const next = typeof open === 'boolean' ? open : box.hidden;
    box.hidden = !next;
    btn.setAttribute('aria-expanded', String(next));
    btn.classList.toggle('is-open', next);
    if (next) { try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* noop */ } }
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
    state.sample = true;
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
    renderSilson2();
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
    if (window.BojangSmartKey && BojangSmartKey.privacy) BojangSmartKey.privacy.syncInputs();
    const pr = $('#q-premium');
    if (pr) pr.value = state.premium;
    const qc = $('#quick-client');
    if (qc) qc.textContent = `${state.client.name} · ${state.age}대 ${state.gender} · 실손 ${SILSON_LABEL[state.silson]} · 월 ${won(state.premium)}만원`;
    if ($('#q-age')) buildSeg($('#q-age'), AGES.map((a) => ({ value: a, label: a + '대' })), state.age, (v) => { state.age = v; state.ageAuto = false; renderAllInputs(); saveSession(); if (state.analyzed) analyze(); });
    if ($('#q-gender')) buildSeg($('#q-gender'), [{ value: '남', label: '남' }, { value: '여', label: '여' }], state.gender, (v) => { state.gender = v; renderAllInputs(); saveSession(); if (state.analyzed) analyze(); });
    if ($('#q-job')) buildSeg($('#q-job'), [{ value: '1', label: '1급' }, { value: '2', label: '2급' }, { value: '3', label: '3급' }], state.job, (v) => { state.job = v; renderJobNote(); renderAllInputs(); saveSession(); if (state.analyzed) analyze(); });
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
      app: 'bojang-guide', version: (window.BojangVersion ? window.BojangVersion.num : '5.9'), exportedAt: new Date().toISOString(),
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
    if (state.sampleMode) { exitSampleDemo(); return; }
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

  /* =========================================================
     v5.7 — 첫 방문 4단계 퀵 가이드 투어
     ① 입력 허브 → ② 5대 담보·직접 기재 → ③ 리모델링 비교기 → ④ PDF 저장
     · 완료/닫힘은 localStorage(bojang.tour.v1)에 기록해 다시 띄우지 않습니다.
     · 첫 방문에는 화면을 가로채지 않는 초대 카드를 띄우고, 누르면 투어가 시작됩니다.
     ========================================================= */
  const TOUR_KEY = 'bojang.tour.v1';
  const TOUR_STEPS = [
    {
      go: 'home',
      target: '#btn-start-consult',
      title: '① 입력 허브 — 사진 · PDF · 수기',
      body: '고객의 보장분석표를 사진으로 찍거나 PDF·텍스트로 붙여넣으면 담보표가 자동으로 정리됩니다. 직접 입력하려면 수기 입력을 고르세요. 모든 처리는 이 기기 안에서만 이뤄집니다.'
    },
    {
      go: 'analysis',
      prep: () => setStep(2, true),
      target: '#card-cancer [data-custom-add]',
      title: '② 5대 담보 확인 · 증권 담보 직접 기재',
      body: '암·뇌·심장·수술·간병 다섯 영역의 금액과 범위를 확인합니다. 증권에만 적힌 특약(예: 특정순환계질환(3~5종) 주요치료비)은 ‘증권 담보 직접 추가’로 담보명 그대로 적으면 치료비 축에 합산됩니다.'
    },
    {
      go: 'remodel',
      target: '#remodel-body .rm-hero-grid',
      title: '③ 리모델링 비교기 — Before / After',
      body: '계약은 유지·감액·정리, 담보는 보강 금액을 넣으면 월 보험료와 종합 점수가 어떻게 달라지는지 실시간으로 비교합니다. 해지 전 확인할 경고도 함께 나옵니다.'
    },
    {
      go: 'analysis',
      prep: () => { if (!state.analyzed) analyze(); },
      target: '#pdf-panel',
      title: '④ PDF 저장 · 공유',
      body: '1장 요약 · 10장 상세 · 30장 상담 플랜을 이 기기에서 바로 PDF로 만들어 저장하거나 카카오톡으로 보냅니다. 10장 상세에는 20년 보험료 추이 차트와 명함 QR이 함께 인쇄됩니다.'
    }
  ];
  let tourIdx = 0;
  let tourTimer = null;

  function tourDone() {
    try { return localStorage.getItem(TOUR_KEY) === '1'; } catch (e) { return false; }
  }
  function tourMark() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { /* private mode */ } }
  /* '나중에'·닫기 — 7일 뒤에 다시 조용히 권합니다 (완료 기록과 구분) */
  const SNOOZE_KEY = 'bojang.tour.snooze';
  const SNOOZE_MS = 7 * 24 * 3600 * 1000;
  function tourSnooze() { try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch (e) { /* private mode */ } }
  function tourSnoozed() {
    try {
      const t = Number(localStorage.getItem(SNOOZE_KEY) || 0);
      return t > 0 && Date.now() - t < SNOOZE_MS;
    } catch (e) { return false; }
  }

  function tourPlace() {
    const step = TOUR_STEPS[tourIdx];
    const overlay = $('#tour');
    if (!overlay || overlay.hidden) return;
    const spot = $('#tour-spot'), card = $('#tour-card');
    const el = step.target ? $(step.target) : null;
    const vw = window.innerWidth, vh = window.innerHeight;
    const pad = 8;
    let box = { top: vh * 0.3, left: pad, width: vw - pad * 2, height: 120 };
    if (el) {
      const r = el.getBoundingClientRect();
      const top = Math.max(pad, Math.round(r.top - 6));
      const left = Math.max(pad, Math.round(r.left - 6));
      box = {
        top,
        left,
        width: Math.max(120, Math.min(vw - left - pad, Math.round(r.width + 12))),
        height: Math.max(40, Math.min(r.height + 12, Math.round(vh * 0.56), vh - top - 100))
      };
    }
    spot.style.top = box.top + 'px';
    spot.style.left = box.left + 'px';
    spot.style.width = box.width + 'px';
    spot.style.height = box.height + 'px';
    card.style.top = '';
    card.style.left = '';
    card.style.bottom = '';
    const cardH = card.offsetHeight || 190;
    const below = box.top + box.height + 14;
    if (below + cardH + 14 < vh) {
      card.style.top = below + 'px';
    } else if (box.top - cardH - 14 > 8) {
      card.style.top = (box.top - cardH - 14) + 'px';
    } else {
      card.style.bottom = '12px';
    }
    card.style.left = pad + 'px';
    card.style.right = pad + 'px';
  }

  function tourShow() {
    const step = TOUR_STEPS[tourIdx];
    $('#tour-step').textContent = `${tourIdx + 1} / ${TOUR_STEPS.length}`;
    $('#tour-title').textContent = step.title;
    $('#tour-body').textContent = step.body;
    $('#tour-dots').innerHTML = TOUR_STEPS.map((_, i) => `<i class="${i === tourIdx ? 'is-on' : ''}${i < tourIdx ? ' is-done' : ''}"></i>`).join('');
    $('#tour-prev').disabled = tourIdx === 0;
    $('#tour-next').textContent = tourIdx === TOUR_STEPS.length - 1 ? '완료' : '다음';
    const overlay = $('#tour');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('tour-open');
    const el = step.target ? $(step.target) : null;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    clearTimeout(tourTimer);
    tourTimer = setTimeout(tourPlace, 60);
    const btn = $('#tour-next');
    if (btn) btn.focus({ preventScroll: true });
  }

  function tourGo(i) {
    if (i < 0) return;
    if (i >= TOUR_STEPS.length) { tourEnd(true); return; }
    tourIdx = i;
    const step = TOUR_STEPS[i];
    if (step.go) switchView(step.go);
    if (step.prep) step.prep();
    $('#tour-invite').hidden = true;
    /* 화면 전환·렌더가 끝난 뒤 위치를 계산합니다 */
    setTimeout(tourShow, 90);
  }

  function tourStart() {
    tourIdx = 0;
    $('#tour-invite').hidden = true;
    tourGo(0);
  }

  function tourEnd(done) {
    clearTimeout(tourTimer);
    const overlay = $('#tour');
    if (overlay) { overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); }
    document.body.classList.remove('tour-open');
    if (done) tourMark();
    else tourSnooze();
    /* v5.9 — 투어가 끝난 뒤에 하던 일(입력 방식 모달 등)을 이어서 엽니다 */
    const cb = afterTour;
    afterTour = null;
    if (cb) setTimeout(cb, 30);
  }

  /* v5.9 — 투어와 입력 방식 선택 모달이 겹치지 않도록 순서를 보장합니다.
     · 투어가 떠 있으면: 투어를 닫고 그 뒤에 하던 일을 실행
     · 초대 카드만 떠 있으면: 카드만 닫고 바로 실행 (다시 권하지 않도록 7일 스누즈) */
  let afterTour = null;
  function tourIsOpen() {
    const o = $('#tour');
    const inv = $('#tour-invite');
    return !!((o && !o.hidden) || (inv && !inv.hidden));
  }
  function anyModalOpen() {
    return $$('.modal').some((m) => !m.hidden && m.id !== 'tour');
  }
  function beforeInputHub(fn) {
    const overlay = $('#tour');
    const inv = $('#tour-invite');
    if (overlay && !overlay.hidden) { afterTour = fn; tourEnd(false); return true; }
    if (inv && !inv.hidden) { inv.hidden = true; tourSnooze(); return false; }
    return false;
  }

  function openInvite() {
    if (tourDone() || tourSnoozed()) return;
    /* 입력·상담을 이미 시작했으면 방해하지 않습니다 (메인 화면에서만 초대) */
    if (state.tab && state.tab !== 'home') return;
    const active = $('.view.is-active');
    if (active && active.id !== 'view-home') return;
    /* v5.9 — 다른 모달(입력 방식·법적 고지 등)이 떠 있으면 겹치지 않게 미룹니다 */
    if (anyModalOpen()) return;
    const inv = $('#tour-invite');
    if (inv) inv.hidden = false;
  }

  window.BojangTour = { start: tourStart, end: tourEnd, next: () => tourGo(tourIdx + 1), prev: () => tourGo(tourIdx - 1), step: () => tourIdx, total: TOUR_STEPS.length, done: tourDone, mark: tourMark, isOpen: tourIsOpen, beforeInputHub };

  /* =========================================================
     v5.9 — 정식 이용약관 · 개인정보처리방침
     푸터와 계정 모달의 버튼이 같은 모달을 엽니다.
     ========================================================= */
  const LEGAL = {
    terms: {
      title: '이용약관',
      sub: '시행일 2026-11-16 · 보장분석 라이프 리포트 (베타)',
      sections: [
        ['제1조 (목적)', '이 약관은 보장분석 라이프 리포트(이하 "서비스")의 이용 조건과 절차, 이용자와 제공자의 권리·의무를 정합니다. 서비스는 보험설계사(FC)의 상담을 돕는 문서 작성·계산 도구입니다.'],
        ['제2조 (서비스의 성격)', '① 서비스는 보험 상품의 모집·권유·중개가 아닌 상담 보조 도구이며, 특정 보험사나 상품을 추천하지 않습니다. ② 점수·권장 보장선·리모델링안은 서비스가 자체적으로 만든 상담 보조 산식이고, 보험사의 인수·지급 기준이 아닙니다. ③ 실제 지급 여부와 금액은 가입한 상품의 약관과 증권이 기준입니다.'],
        ['제3조 (이용자의 의무)', '① 이용자는 고객에게 보장분석 사실과 자료 사용 목적을 알리고 동의를 받아야 합니다. ② 주민등록번호·계좌번호 등 고유식별정보는 입력하지 않습니다. ③ 서비스가 만든 리포트를 고객에게 설명할 때 근거(약관·증권·공표 통계)를 함께 확인합니다.'],
        ['제4조 (금지 행위)', '① 서비스 파일·화면·문구를 무단으로 복제·배포·판매하거나 다른 이름의 상품으로 재판매하는 행위. ② 보호 조치(공식 도메인 잠금·발급 워터마크)를 제거하거나 우회하는 행위. ③ 서비스로 만든 허위·과장 자료로 고객을 기만하는 행위.'],
        ['제5조 (베타 운영)', '베타 기간에는 Pro 전 기능을 무료로 제공하며, 기능·화면·요금제가 예고 없이 바뀌거나 중단될 수 있습니다. 베타 참여자 혜택은 별도 안내로 정합니다.'],
        ['제6조 (책임의 범위)', '서비스는 상담 보조 도구로, 이용자의 판단과 설명 책임을 대신하지 않습니다. 천재지변·통신 장애·이용자 기기 문제로 생긴 손해에 대해 제공자는 고의·중과실이 없는 한 책임을 지지 않습니다.'],
        ['제7조 (준거법)', '이 약관은 대한민국 법령에 따르며, 분쟁은 제공자와 이용자가 성실히 협의해 해결합니다.']
      ]
    },
    privacy: {
      title: '개인정보처리방침',
      sub: '시행일 2026-11-16 · 보장분석 라이프 리포트 (베타)',
      sections: [
        ['1. 수집·이용 항목', '① 이 기기 저장(IndexedDB): 상담 이력 — 고객명(선택)·생년월일(선택)·연령대·성별·직업급수·실손 세대·월 보험료·담보 금액·계약 목록·고지 체크·상담 라벨·점수. ② 이 기기 저장(localStorage): 화면 설정(보기 모드·가이드 확인 여부·큰 글씨)과 입력 중인 상담 1건. ③ 클라우드(로그인해 동기화를 켰을 때만): 이메일, 상담 스냅샷 — 고객명·생년월일·연령대·성별·직업급수·실손 세대·월 보험료·담보 금액·계약 목록·고지 체크·상담 라벨·점수 — 와 브랜드 설정(상호·담당자·연락처·로고)이 Supabase(서울 리전)에 저장됩니다. 로그인하지 않으면 이 기기 저장만 사용합니다.'],
        ['2. 사진 촬영 — 앱·자체 서버에 저장하지 않음', '카메라로 찍은 보장분석표 사진은 이 앱과 자체 Supabase DB에 저장하지 않습니다(서버 저장 0건). 촬영본은 화면 메모리에서 전처리해 인식에 쓰고, localStorage·IndexedDB 어디에도 남기지 않습니다.'],
        ['3. AI 사진 인식 — 공급자별 전송 경로', '사진에서 담보 숫자를 자동으로 읽을 때에만 다음 경로로 이미지가 전송됩니다: ① 이 브라우저 → ② 자체 서버(Supabase Edge Function · parse-coverage-vision) → ③ 외부 AI. ②는 이미지를 DB·스토리지에 저장하지 않고 메모리에서만 처리하며 응답 후 즉시 참조를 해제합니다. ③은 공급자별로 다릅니다. · OpenAI 경로(단일 모델): 모델 1개로 고정되어 오류 시 자동 대체하지 않고 실패를 알립니다. · Gemini 경로(최대 4개 모델 후보): 모델 오류·요청 제한이 나면 사용자 지정 Gemini → gemini-3.8-flash → gemini-4-hydrogen → gemini-flash-latest 순으로 최대 4개 후보를 재시도합니다. 전송된 이미지의 공급자 측 보관·삭제는 해당 API 개인정보·남용방지 정책을 따르며, 앱이 공급자 측 즉시 삭제를 보증하지는 않습니다. 인식 결과 텍스트만 화면에 표시하고, 사진 인식을 쓰지 않으면 어떤 이미지도 외부로 나가지 않습니다.'],
        ['4. 보관 위치와 기간', '① 상담 이력은 이 기기의 IndexedDB에, 입력 중인 상담 1건은 localStorage에 보관되고 이용자가 삭제할 때까지 남습니다. ② 클라우드 동기화를 켜면 상담 스냅샷이 Supabase(서울 리전)에 저장되며, 이용자가 상담을 삭제하거나 계정을 정리할 때까지 보관합니다. ③ PDF·JSON 파일은 이용자 기기에서 만들어지고, 서비스가 따로 보관하지 않습니다.'],
        ['5. 제3자 제공·처리위탁', '개인정보를 제3자에게 판매·제공하지 않습니다. 다만 서비스 운영을 위해 Supabase(서울 리전 · 로그인·상담 동기화 데이터 저장)와 외부 AI API(Google Gemini 등 · 사진 인식 시에만 해당)에 처리를 위탁합니다. AI 공급자 측 이미지 보관은 해당 공급자의 API 정책(남용 감시 목적의 제한 기간 보관 포함)을 따릅니다. 법령에 따라 수사기관이 요구하는 경우는 예외로 합니다.'],
        ['6. 이용자의 권리', '이용자는 언제든지 ① 상담 이력 삭제(목록의 × 버튼), ② 클라우드 기록 삭제·로그아웃, ③ 브라우저 데이터 삭제로 기기 저장값을 지울 수 있습니다. 삭제한 자료는 복구되지 않습니다.'],
        ['7. 안전성 확보 조치', '① 모든 서버 통신은 HTTPS로 암호화합니다. ② 클라우드 데이터는 계정 단위 접근 제어(RLS)로 분리합니다. ③ 공식 배포처가 아닌 도메인에서 열린 복제본은 서버 호출을 차단하고, 보안 가드가 없거나 판정할 수 없는 실행 환경(파일로 직접 열기·호스트 없음·가드 미탑재)에서는 외부 요청을 0건으로 막는 fail-closed로 동작합니다. ④ 발급 PDF에는 발급 단위 식별 워터마크(ID-XXXX)가 들어가 유출 경로를 추적할 수 있습니다. ⑤ 스마트키 기기 잠금을 쓰면 상담 화면에 PIN·생체 잠금이 걸리고, 등록 기기(최대 2대)와 세션 정보만 서버에 저장됩니다(기기 개인키·사진은 서버에 저장하지 않음).'],
        ['8. 문의', '개인정보 관련 문의는 브랜드 설정에 입력한 담당 설계사 연락처로 받습니다.']
      ]
    }
  };
  let legalTab = 'terms';

  /* v6.2 — 개인정보처리방침 맨 위의 '데이터 흐름 1장 도식'
     실제 동작(로컬 계산 → 로그인 시 자체 서버 → 사진 인식 시 1회 외부 AI 전송)만 담고,
     단계별 저장·삭제·보관 주기를 함께 적습니다. 과장·보증 표현은 쓰지 않습니다. */
  const DATA_FLOW = [
    {
      no: '1',
      title: '브라우저 로컬 계산',
      where: '이 기기 · IndexedDB',
      items: [
        '담보 계산·점수·PDF 생성을 이 기기 안에서 처리',
        '상담 이력(IndexedDB) · 입력 중 상담 1건(localStorage)',
        '계산을 위해 서버로 보내지 않음'
      ],
      keep: '보관: 이용자가 삭제할 때까지 · 삭제: 목록 × / 브라우저 데이터 삭제'
    },
    {
      no: '2',
      title: '자체 서버 저장',
      where: 'Supabase · 서울 · 로그인 시',
      items: [
        '동기화를 켠 경우에만 상담 스냅샷 저장(이름·생년월일·연령대·성별·보험료·담보·계약·고지 체크)',
        'HTTPS 암호화 · 계정 단위 접근 제어(RLS)',
        '사진·기기 개인키는 저장하지 않음'
      ],
      keep: '보관: 상담 삭제·계정 정리 시까지'
    },
    {
      no: '3',
      title: '사진 AI 인식 (2단 전송)',
      where: '브라우저 → 자체 Edge Function → 외부 AI',
      items: [
        '사진을 AI로 읽을 때만: 브라우저 → Supabase Edge Function(parse-coverage-vision) → 외부 AI (OpenAI 경로 = 단일 모델 / Gemini 경로 = 최대 4개 모델 후보)',
        'Edge Function은 사진을 DB·스토리지에 저장하지 않고 메모리에서만 처리(응답 후 참조 해제)',
        'OpenAI 경로(단일 모델) · Gemini 경로(최대 4개 모델 후보, 오류 시 순차 재시도) — 공급자별 분리 표기 · 전송 이미지 보관은 공급자 API 정책을 따름'
      ],
      keep: '앱은 공급자 측 즉시 삭제를 보증하지 않음 · 사진 인식을 쓰지 않으면 전송 0건 · 판정 불가 환경(파일 실행·가드 없음)은 fail-closed로 차단'
    }
  ];

  function dataFlowHTML() {
    return `<section class="lg-flow" aria-label="데이터 흐름 1장 도식">
      <div class="lgf-head">
        <span class="eyebrow">DATA FLOW · 1장 요약</span>
        <b>고객 데이터가 거치는 세 지점</b>
        <span class="lgf-sub">아래 세 지점 중 실제로 쓰이는 곳만 거칩니다. 로그인하지 않으면 ②는 쓰이지 않고, 사진 AI 인식을 쓰지 않으면 ③도 쓰이지 않습니다.</span>
      </div>
      <div class="lgf-track">
        ${DATA_FLOW.map((n, i) => `${i ? '<span class="lgf-arrow" aria-hidden="true">→</span>' : ''}
        <div class="lgf-node">
          <div class="lgf-top"><span class="lgf-no" aria-hidden="true">${n.no}</span><b>${esc(n.title)}</b></div>
          <span class="lgf-where">${esc(n.where)}</span>
          <ul>${n.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          <span class="lgf-keep">${esc(n.keep)}</span>
        </div>`).join('')}
      </div>
      <p class="lgf-note">1·10·30장 PDF와 30장 슬라이드는 이 기기에서 만들어지며, 서비스가 파일을 따로 보관하지 않습니다.</p>
    </section>`;
  }

  function renderLegal(tab) {
    const key = LEGAL[tab] ? tab : 'terms';
    legalTab = key;
    const data = LEGAL[key];
    const title = $('#legal-title');
    if (title) title.textContent = data.title;
    const sub = $('#legal-sub');
    if (sub) sub.textContent = data.sub;
    const body = $('#legal-body');
    if (body) body.innerHTML = (key === 'privacy' ? dataFlowHTML() : '')
      + data.sections.map((s) => `<section class="lg-sec"><h4>${esc(s[0])}</h4><p>${esc(s[1])}</p></section>`).join('');
    $$('.legal-tab').forEach((b) => {
      const on = b.dataset.legalTab === key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  function openLegal(tab) {
    try { if (window.BojangBackend && window.BojangBackend.closeAccount) window.BojangBackend.closeAccount(); } catch (e) { /* noop */ }
    renderLegal(tab || legalTab);
    const el = $('#legal-modal');
    if (el) el.hidden = false;
    const inv = $('#tour-invite');
    if (inv) inv.hidden = true;
  }
  function closeLegal() {
    const el = $('#legal-modal');
    if (el) el.hidden = true;
  }

  /* v5.9 — 음수 금액 입력 차단 (모든 숫자 입력칸 공통)
     '-5' 처럼 입력하면 그 자리에서 0으로 되돌리고, 상한을 넘으면 상한으로 맞춥니다.
     입력칸에 보이는 값과 요약·점수가 항상 같아집니다. */
  function guardNumberInput(e) {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'number') return;
    if (el.value === '' || el.value === '-' || el.value === '.') return;
    const n = Number(el.value);
    const max = Number(el.getAttribute('max'));
    const cap = isFinite(max) && max > 0 ? max : 100000;
    if (!isFinite(n)) { el.value = '0'; return; }
    if (n < 0) { el.value = '0'; try { toast('음수는 입력할 수 없어 0으로 보정했습니다'); } catch (_) {} return; }
    if (n > cap) { el.value = String(cap); }
  }

  /* =========================================================
     v7.2 — 기기 저장 보안 설정 UI (더보기 메뉴)
     ========================================================= */
  function renderPrivacySettings() {
    const S = window.BojangSecure;
    const stateEl = $('#mmp-state');
    const sess = $('#opt-session-only');
    const del = $('#opt-delete-logout');
    const foot = $('#mmp-foot');
    if (!S) return;
    const ps = S.privacyState();
    if (sess) sess.checked = ps.mode === 'session';
    if (del) del.checked = !!ps.deleteOnLogout;
    if (stateEl) stateEl.textContent = ps.crypto ? 'AES-GCM 잠금' : '암호화 미지원(평문)';
    if (foot) foot.textContent = ps.mode === 'session'
      ? '세션 전용 — 입력 중 상담을 기기에 저장하지 않습니다. 화면을 닫으면 사라집니다.'
      : (ps.crypto ? '상담 이력은 기기 안에서 AES-GCM으로 암호화해 보관합니다.' : '이 브라우저는 WebCrypto를 지원하지 않아 평문으로 저장됩니다.');
  }
  function bindPrivacySettings() {
    const S = window.BojangSecure;
    if (!S) return;
    const sess = $('#opt-session-only');
    const del = $('#opt-delete-logout');
    const purge = $('#btn-purge-local');
    if (sess) sess.addEventListener('change', () => {
      S.setPrivacyMode(sess.checked ? 'session' : 'persist');
      if (sess.checked) { try { localStorage.removeItem(SKEY); } catch (e) { /* noop */ } toast('세션 전용 — 이제 입력 중 상담을 기기에 저장하지 않습니다'); }
      else { saveSession(); toast('기기 저장 — 상담을 AES-GCM으로 암호화해 보관합니다'); }
      renderPrivacySettings();
    });
    if (del) del.addEventListener('change', () => {
      S.setDeleteOnLogout(del.checked);
      toast(del.checked ? '로그아웃할 때 이 기기의 상담 기록도 지웁니다' : '로그아웃해도 상담 기록은 이 기기에 남습니다');
      renderPrivacySettings();
    });
    if (purge) purge.addEventListener('click', async () => {
      if (!window.confirm('이 기기에 저장된 상담 이력·입력값을 지웁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
      const removed = await S.purgeLocal();
      renderHistory();
      renderPrivacySettings();
      toast(removed.length ? `기기 저장 데이터 ${removed.length}건을 지웠습니다` : '지울 기기 저장 데이터가 없습니다');
    });
    renderPrivacySettings();
  }

  /* ================= 초기화 ================= */
  async function init() {
    state.view = lsGet(VKEY, 'advisor') === 'client' ? 'client' : 'advisor';
    /* v5.9 — 공식 도메인 잠금(복제 경고 배너·서버 호출 차단) */
    try { if (window.BojangGuard) window.BojangGuard.init(); } catch (e) { /* noop */ }
    /* v5.9 — 이전 버전 localStorage 상담 이력을 IndexedDB 로 옮깁니다 */
    try { if (window.BojangStore) await window.BojangStore.migrate(); } catch (e) { /* noop */ }
    await loadSession();
    /* v7.4 — 종별(1~5종) 칸·주요치료비 칸을 시작 상태에서도 항상 만들고 대표값을 맞춥니다 */
    try { BojangModel.normalizeState(state); } catch (e) { /* noop */ }

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
    await loadHistory();
    renderQuick();
    if (window.BojangPlan) window.BojangPlan.init();
    /* v5.4 — 계정·구독·서버 연결(실서버 모드 / 베타 오프라인 자동 판별) */
    if (window.BojangBackend) window.BojangBackend.init();
    bindPrivacySettings();
    renderHome();
    if (window.BojangTools) window.BojangTools.init();
    /* v7.0 — 사후관리 디데이 · 청구 서류 매칭 · 상담 메모 빠른 채움 */
    if (window.BojangAftercare) window.BojangAftercare.init();
    if (window.BojangClaimCheck) window.BojangClaimCheck.init();
    if (window.BojangPublicData) window.BojangPublicData.init();
    if (window.BojangMemoFill) window.BojangMemoFill.init();
    if (window.BojangInputHub) {
      window.BojangInputHub.init({
        state: state,
        toast: toast,
        applyImport: applyImport,
        startNewConsult: startNewConsult,
        openView: (name) => switchView(name)
      });
    }
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
      else if (k === 'aftercare') { switchView('toolkit'); setTimeout(() => { const el = $('#card-aftercare'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (window.BojangAftercare) window.BojangAftercare.run(); }, 80); }
      else if (k === 'claimcheck') { switchView('toolkit'); setTimeout(() => { const el = $('#card-claimcheck'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80); }
      else if (k === 'remodel') switchView('remodel');
      else if (k === 'brand') switchView('brand');
      else if (k === 'pdf') {
        if (!state.analyzed) analyze();
        switchView('analysis');
        setTimeout(() => { const el = $('#pdf-panel'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
      } else if (k === 'history') {
        switchView('home');
        openMoreMenu(true);
        setTimeout(() => { const el = $('#history-list'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80);
      }
    });
    /* v7.1 — '이 고객 다음 할 일' 띠 → 사후관리 카드로 이동 */
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-na-go]');
      if (!btn) return;
      switchView('toolkit');
      setTimeout(() => {
        const card = $('#card-aftercare');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.BojangAftercare) window.BojangAftercare.run();
      }, 90);
    });
    $('#btn-home').addEventListener('click', goHome);
    /* v7.0 — 상담 후 챙길 것 3칸 → 현장 툴킷의 해당 도구로 바로 이동 */
    document.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-pc-go]');
      if (!cell) return;
      const kind = cell.dataset.pcGo;
      const go = (id, after) => {
        switchView('toolkit');
        setTimeout(() => {
          const el = $('#' + id);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (after) after();
        }, 90);
      };
      if (kind === 'claimcheck') go('card-claimcheck');
      else if (kind === 'aftercare') { go('card-aftercare'); setTimeout(() => { if (window.BojangAftercare) window.BojangAftercare.run(); }, 140); }
      else if (kind === 'kakao') {
        go('card-aftercare', () => {
          const has = window.BojangAftercare && window.BojangAftercare.readInput().contract;
          toast(has ? '카톡 인사말 복사 버튼을 누르면 초안이 복사됩니다' : '계약일을 넣으면 카톡 안내 초안이 만들어집니다');
          const btn = $('#ac-results [data-ac-copy]');
          if (btn) { btn.classList.add('is-pulse'); setTimeout(() => btn.classList.remove('is-pulse'), 1600); }
        });
      }
    });
    /* v5.9 — 첫 화면 3버튼 · 더보기 메뉴 · 샘플 체험 */
    const moreBtn = $('#btn-more-menu');
    if (moreBtn) moreBtn.addEventListener('click', () => openMoreMenu());
    const sampleBtn = $('#btn-sample');
    if (sampleBtn) sampleBtn.addEventListener('click', () => loadSampleConsult());
    /* v6.2 — 로그인 없는 30장 샘플 체험 (가상 고객 · 완전 격리) */
    const sampleDemoBtn = $('#btn-sample-demo');
    if (sampleDemoBtn) sampleDemoBtn.addEventListener('click', () => openSampleDemo());
    const sampleExitBtn = $('#btn-sample-exit');
    if (sampleExitBtn) sampleExitBtn.addEventListener('click', () => exitSampleDemo());
    /* v6.2 — 샘플 체험 중에도 1·10·30장 PDF를 바로 열어 볼 수 있게 (체험 전용 메뉴) */
    const samplePdfBtn = $('#btn-sample-pdf');
    const samplePdfMenu = $('#sb-menu');
    const closeSamplePdf = () => {
      if (!samplePdfMenu) return;
      samplePdfMenu.hidden = true;
      if (samplePdfBtn) samplePdfBtn.setAttribute('aria-expanded', 'false');
    };
    if (samplePdfBtn && samplePdfMenu) {
      samplePdfBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = samplePdfMenu.hidden;
        samplePdfMenu.hidden = !next;
        samplePdfBtn.setAttribute('aria-expanded', String(next));
      });
      $$('[data-sample-pdf]', samplePdfMenu).forEach((b) => {
        b.addEventListener('click', () => {
          const kind = b.dataset.samplePdf;
          closeSamplePdf();
          toast(kind === 'advisor' ? '샘플 30장 플랜북 PDF를 만듭니다' : '샘플 PDF를 만듭니다');
          doPdf(kind);
        });
      });
      document.addEventListener('click', (e) => {
        if (samplePdfMenu.hidden) return;
        if (e.target.closest('#sb-menu') || e.target.closest('#btn-sample-pdf')) return;
        closeSamplePdf();
      });
    }
    $('#btn-home-load').addEventListener('click', () => {
      if (!state.history.length) { toast('저장된 상담이 없습니다 — 새 상담으로 시작해 보세요'); }
      const el = $('#recent-list');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    /* v5.9 — 이용약관 · 개인정보처리방침 */
    document.addEventListener('click', (e) => {
      const lg = e.target.closest('[data-legal]');
      if (lg) { e.preventDefault(); openLegal(lg.dataset.legal); return; }
      const tab = e.target.closest('[data-legal-tab]');
      if (tab) { renderLegal(tab.dataset.legalTab); }
    });
    const legalX = $('#legal-x'), legalClose = $('#legal-close'), legalModal = $('#legal-modal');
    if (legalX) legalX.addEventListener('click', closeLegal);
    if (legalClose) legalClose.addEventListener('click', closeLegal);
    if (legalModal) legalModal.addEventListener('click', (e) => { if (e.target.id === 'legal-modal') closeLegal(); });
    document.addEventListener('keydown', (e) => {
      const lm = $('#legal-modal');
      if (e.key === 'Escape' && lm && !lm.hidden) closeLegal();
    });
    /* 모든 숫자 입력칸 — 음수·상한 초과를 그 자리에서 막습니다 */
    document.addEventListener('input', guardNumberInput, true);

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

    $('#btn-kakao').addEventListener('click', (ev) => { copyKakaoSummary(ev && ev.currentTarget); });
    const kakaoCopy = $('#kakao-copy');
    if (kakaoCopy) kakaoCopy.addEventListener('click', () => { copy(kakaoSummary(), '카톡 요약을 복사했습니다 — 카톡에 붙여넣으세요', kakaoCopy); });
    const kakaoClose = $('#kakao-close');
    if (kakaoClose) kakaoClose.addEventListener('click', closeKakaoModal);
    const kakaoModal = $('#kakao-modal');
    if (kakaoModal) kakaoModal.addEventListener('click', (e) => { if (e.target.id === 'kakao-modal') closeKakaoModal(); });
    document.addEventListener('keydown', (e) => {
      const km = $('#kakao-modal');
      if (e.key === 'Escape' && km && !km.hidden) closeKakaoModal();
    });
    const cloudBtn = $('#btn-cloud-sync');
    if (cloudBtn) cloudBtn.addEventListener('click', () => syncHistoryFromCloud({ manual: true }));
    $$('[data-cloud-sync]').forEach((b) => {
      if (b.id === 'btn-cloud-sync') return;
      b.addEventListener('click', () => syncHistoryFromCloud({ manual: true }));
    });
    /* backend 는 window 로 이벤트를 쏩니다 — document 가 아니라 window 에서 받아야 합니다 */
    window.addEventListener('bojang:cloud', (e) => { ingestCloud(e.detail, { silent: true }); });
    if (cloudReady()) setTimeout(() => syncHistoryFromCloud({ silent: true }), 900);
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

    /* v5.7 — 퀵 가이드 투어 */
    const tourBtn = $('#btn-tour');
    if (tourBtn) tourBtn.addEventListener('click', tourStart);
    const tourHome = $('#btn-tour-home');
    if (tourHome) tourHome.addEventListener('click', tourStart);
    const tPrev = $('#tour-prev'), tNext = $('#tour-next'), tClose = $('#tour-close'), tSkip = $('#tour-skip');
    if (tPrev) tPrev.addEventListener('click', () => tourGo(tourIdx - 1));
    if (tNext) tNext.addEventListener('click', () => tourGo(tourIdx + 1));
    if (tClose) tClose.addEventListener('click', () => tourEnd(false));
    if (tSkip) tSkip.addEventListener('click', () => tourEnd(true));
    const invStart = $('#tour-invite-start'), invLater = $('#tour-invite-later');
    if (invStart) invStart.addEventListener('click', tourStart);
    if (invLater) invLater.addEventListener('click', () => { $('#tour-invite').hidden = true; tourSnooze(); });
    window.addEventListener('resize', () => { if ($('#tour') && !$('#tour').hidden) tourPlace(); });
    document.addEventListener('keydown', (e) => {
      const open = $('#tour') && !$('#tour').hidden;
      if (!open) return;
      if (e.key === 'Escape') tourEnd(false);
      else if (e.key === 'ArrowRight') tourGo(tourIdx + 1);
      else if (e.key === 'ArrowLeft') tourGo(tourIdx - 1);
    });
    if (!tourDone()) setTimeout(openInvite, 1100);

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
          if (exitSampleDemo()) return;
          state.view = 'advisor';
          lsSet(VKEY, 'advisor');
          applyView();
          toast('상담자 화면으로 돌아왔습니다');
        },
        onHome: () => {
          if (exitSampleDemo()) return;
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
