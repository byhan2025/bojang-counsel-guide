/* 보장분석 라이프 리포트 — 설계사(FC) 실무 도우미 4종
   ① 질병코드·약관 사전  ② 실손 세대 비교 & 5세대 체크
   ③ 고지사항 판정 + 청구 서류 1탭 복사  ④ 소득 대비 적정 보험료·리모델링 비교기
   데이터는 content.js(FC_CODES · CLAIM_DOCS · SILSON_FIVE · PREMIUM_GUIDE)를 씁니다. */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const state = () => root.__bojangState || { premium: 0, silson: '4', age: '40' };
  const toast = (m) => { if (root.__bojangToast) root.__bojangToast(m); };
  const copy = (t, m) => { if (root.__bojangCopy) root.__bojangCopy(t, m); };
  /* v5.2 베타 — 전 기능 무료(잠금 판정은 BojangPlan.unlocked) */
  const unlocked = () => !!(root.BojangPlan && root.BojangPlan.unlocked && root.BojangPlan.unlocked());
  const guard = (feature) => {
    if (unlocked()) return true;
    if (root.BojangPlan) root.BojangPlan.openPaywall(feature);
    return false;
  };

  /* =========================================================
     ① 질병코드 · 약관 사전
     ========================================================= */
  const CODE_GROUPS = ['전체', '암', '유사암', '뇌', '심장', '수술', '기타'];
  let codeGroup = '전체';
  const GROUP_TONE = { '암': 'gap', '유사암': 'need', '뇌': 'violet', '심장': 'rose', '수술': 'info', '기타': 'mute' };

  function codeMatch(c, q) {
    if (!q) return true;
    const hay = [c.code, c.name, c.group, c.tags, c.pays, c.check, c.note].join(' ').toLowerCase();
    return q.split(/\s+/).filter(Boolean).every((w) => hay.indexOf(w) >= 0);
  }

  function renderCodes() {
    const host = $('#code-list');
    if (!host) return;
    const q = ($('#code-q').value || '').trim().toLowerCase();
    $('#code-chips').innerHTML = CODE_GROUPS.map((g) => `<button type="button" class="fc-chip${codeGroup === g ? ' is-on' : ''}" data-codegroup="${g}">${g}</button>`).join('');
    $$('#code-chips [data-codegroup]').forEach((b) => b.addEventListener('click', () => { codeGroup = b.dataset.codegroup; renderCodes(); }));
    const list = FC_CODES.filter((c) => (codeGroup === '전체' || c.group === codeGroup) && codeMatch(c, q));
    const cnt = $('#code-count');
    if (cnt) cnt.textContent = q || codeGroup !== '전체' ? `${list.length}건` : `전체 ${FC_CODES.length}건`;
    if (!list.length) {
      host.innerHTML = `<p class="fc-empty">검색 결과가 없습니다. 코드(C73) 또는 이름(갑상선암)·증상(디스크)으로 다시 찾아보세요.</p>`;
      return;
    }
    host.innerHTML = list.map((c, idx) => {
      /* 무료 체험은 상위 3개 코드의 요약까지 — 이후는 약관·판례와 복사가 잠깁니다 */
      const lk = !unlocked() && idx >= 3;
      return `
      <article class="code-card${lk ? ' is-locked' : ''}">
        <div class="cc-head">
          <code class="cc-code">${esc(c.code)}</code>
          <b class="cc-name">${esc(c.name)}</b>
          <span class="fc-tag tone-${GROUP_TONE[c.group] || 'mute'}">${esc(c.group)}</span>
        </div>
        <dl class="cc-rows">
          <div><dt>지급 담보</dt><dd class="pays">${esc(c.pays)}</dd></div>
          <div><dt>확인 포인트</dt><dd>${esc(c.check)}</dd></div>
          <div class="cc-note"><dt>약관·판례</dt><dd>${lk ? '<span class="fc-lock" data-code-lock>🔒 Pro에서 약관·판례 열기</span>' : esc(c.note)}</dd></div>
        </dl>
        <button type="button" class="cc-copy${lk ? ' is-locked' : ''}" data-code-copy="${esc(c.code)}">${lk ? '🔒 코드 복사 (Pro)' : '이 코드 복사'}</button>
      </article>`;
    }).join('');
    $$('[data-code-lock]', host).forEach((b) => b.addEventListener('click', () => guard('codeDetail')));
    $$('[data-code-copy]', host).forEach((b) => {
      b.addEventListener('click', () => {
        if (!guard('codeDetail')) return;
        const c = FC_CODES.find((x) => x.code === b.dataset.codeCopy);
        if (!c) return;
        copy(`${c.code} ${c.name}\n· 지급: ${c.pays}\n· 확인: ${c.check}\n· 약관·판례: ${c.note}`, '코드 요약을 복사했습니다');
      });
    });
  }

  /* =========================================================
     ② 실손 세대별 비교 & 5세대 체크
     ========================================================= */
  const SIL_ROWS = ['급여', '비급여', '자기부담', '재가입', '특징'];
  let silPick = null;

  function renderSilson() {
    const host = $('#sil-tool');
    if (!host) return;
    const cur = state().silson || '4';
    const pick = silPick || cur;
    const g = SILSON_GENERATIONS.find((x) => x.gen === (pick === 'none' ? '5세대' : pick + '세대')) || SILSON_GENERATIONS[3];
    const cards = SILSON_GENERATIONS.map((sg) => {
      const num = sg.gen.replace('세대', '');
      const on = String(num) === String(pick);
      return `<button type="button" class="sil-pick${on ? ' is-on' : ''}${sg.gen === '5세대' ? ' is-new' : ''}" data-silpick="${num}">
        <b>${sg.gen}</b><span>${sg.period}</span>
      </button>`;
    }).join('');
    host.innerHTML = `
      <div class="sil-picks">${cards}</div>
      <div class="sil-current">
        <span class="sc-label">선택한 세대</span>
        <b>${esc(g.gen)}</b><span class="sc-period">${esc(g.period)}</span>
        ${cur === 'none' ? '<em class="sc-warn">이 고객은 실손 없음 — 진단비보다 실손이 먼저입니다</em>' : String(cur) === String(pick) ? '<em class="sc-ok">이 고객의 현재 세대</em>' : `<em>이 고객은 ${cur === 'none' ? '실손 없음' : cur + '세대'}</em>`}
      </div>
      <div class="sil-grid">
        ${SIL_ROWS.map((k) => `<div class="sil-cell"><dt>${k}</dt><dd>${esc(g.rows[k])}</dd></div>`).join('')}
      </div>
      <div class="fc-block">
        <h4>고객이 전환을 고민할 때 — 판단 5기준</h4>
        <ol class="fc-steps">
          ${SILSON_FIVE.checks.map((c, i) => `<li><b>${i + 1}. ${esc(c.q)}</b><p>${esc(c.why)}</p></li>`).join('')}
        </ol>
      </div>
      <div class="fc-block">
        <h4>두 갈래 — 같은 표에 놓고 보여줍니다</h4>
        <div class="sil-opts">
          ${SILSON_FIVE.options.map((o) => `
            <div class="sil-opt">
              <div class="so-head"><span>${o.key}</span><b>${esc(o.title)}</b></div>
              <dl>
                <div><dt>계약</dt><dd>${esc(o.keep)}</dd></div>
                <div><dt>보험료</dt><dd>${esc(o.cut)}</dd></div>
                <div><dt>보장 변화</dt><dd>${esc(o.cost)}</dd></div>
                <div><dt>되돌림</dt><dd>${esc(o.back)}</dd></div>
                <div><dt>주의</dt><dd>${esc(o.watch)}</dd></div>
              </dl>
              <button type="button" class="btn-ghost sm" data-silcopy="${o.key}">이 안내 복사</button>
            </div>`).join('')}
        </div>
      </div>
      <div class="fc-block">
        <h4>5세대 실손 — 가입 전·후 확인 5가지</h4>
        <ul class="fc-checks">${SILSON_FIVE.fiveGen.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>
      <p class="fc-src">근거 · 금융위원회 보도자료(2026.5.6) · 2026년 11월 시행 안내(선택형 할인 특약·계약전환 할인) · 5세대는 2026.5.6부터 판매. 할인은 한시 제도이므로 시행 조건 변동을 확인하고, 최종 판단은 상품별 약관이 기준입니다.</p>
    `;
    $$('[data-silpick]', host).forEach((b) => b.addEventListener('click', () => { silPick = b.dataset.silpick; renderSilson(); }));
    $$('[data-silcopy]', host).forEach((b) => b.addEventListener('click', () => {
      const o = SILSON_FIVE.options.find((x) => x.key === b.dataset.silcopy);
      if (!o) return;
      copy(`[실손 ${o.title}]\n· 계약: ${o.keep}\n· 보험료: ${o.cut}\n· 보장 변화: ${o.cost}\n· 되돌림: ${o.back}\n· 주의: ${o.watch}`, '실손 안내를 복사했습니다');
    }));
  }

  /* =========================================================
     ③ 고지사항(알릴의무) 판정 + 청구 서류 1탭 복사
     ========================================================= */
  /* v5.8 — 고지의무 인터랙티브 체크 (일반 3·1·5 / 간편 3·2·5)
     · 청약서 문항을 기간 탭(3개월·1년·2년·5년)으로 나눠 탭 한 번으로 체크합니다.
     · 체크 즉시 ① 일반심사 고지 필요 여부 ② 간편심사 3·2·5 통과 가능 여부
       ③ 가입 전 준비 서류 ④ 유병자 간편심사 전환 가이드를 다시 그립니다.
     · 3개월 항목은 2·5년 문항에도 함께 걸리므로 자동으로 함께 켭니다(끄면 함께 꺼짐). */
  const DISC_ITEMS = [
    { key: 'm3dx', label: '진단(또는 의심 소견)을 받음', period: '3개월', q: '3개월 진단' },
    { key: 'm3adm', label: '입원', period: '3개월', q: '3개월 입원' },
    { key: 'm3op', label: '수술', period: '3개월', q: '3개월 수술' },
    { key: 'y1', label: '추가검사(재검사) 필요 소견', period: '1년', q: '1년 재검사' },
    { key: 'y2adm', label: '입원', period: '2년', q: '2년 입원' },
    { key: 'y2op', label: '수술', period: '2년', q: '2년 수술' },
    { key: 'y3', label: '3년 이내 입원·수술', period: '5년', q: '3년 입원·수술' },
    { key: 'y5adm', label: '입원', period: '5년', q: '5년 입원' },
    { key: 'y5op', label: '수술', period: '5년', q: '5년 수술' },
    { key: 'y5tx', label: '7일 이상 통원치료', period: '5년', q: '5년 통원 7일' },
    { key: 'major', label: '중대질병 — 암·간경화·투석 중 만성신장질환·파킨슨·루게릭', period: '5년', q: '5년 중대질병' }
  ];
  const DISC_PERIODS = ['3개월', '1년', '2년', '5년'];
  const DISC_PERIOD_NOTE = {
    '3개월': '최근 3개월 이내 — 일반·간편 모두 첫 문항',
    '1년': '최근 1년 이내 — 일반심사에만 있는 문항',
    '2년': '최근 2년 이내 — 간편심사 3·2·5의 가운데 문항',
    '5년': '최근 5년 이내 — 일반 5년 문항 · 간편은 중대질병만'
  };
  const disc = {};
  let discPeriod = '3개월';

  const on = (k) => !!disc[k];
  const anyOn = (keys) => keys.some((k) => disc[k]);
  const M3 = ['m3dx', 'm3adm', 'm3op'];
  const Y2 = ['y2adm', 'y2op'];
  const Y5 = ['y3', 'y5adm', 'y5op', 'y5tx'];

  /* 일반심사(3·1·5) 고지 여부 */
  function generalJudge() {
    const hit = [];
    if (anyOn(M3)) hit.push('3개월 진단·입원·수술');
    if (on('y1')) hit.push('1년 재검사 소견');
    if (anyOn(Y2)) hit.push('2년 이내 입원·수술');
    if (anyOn(Y5)) hit.push('5년 이내 입원·수술·통원');
    if (on('major')) hit.push('5년 이내 중대질병');
    return { need: hit.length > 0, hits: hit };
  }
  /* 간편심사(3·2·5) — 3개월 진단·입원·수술 / 2년 입원·수술 / 5년 중대질병 */
  function simpleJudge() {
    const hit = [];
    if (anyOn(M3)) hit.push('3개월 진단·입원·수술');
    if (anyOn(Y2)) hit.push('2년 이내 입원·수술');
    if (on('major')) hit.push('5년 이내 중대질병');
    return { need: hit.length > 0, hits: hit };
  }
  /* 간편심사 3·5·5 참고 */
  function simple355Judge() {
    const hit = [];
    if (anyOn(M3)) hit.push('3개월');
    if (anyOn(Y5)) hit.push('5년 이내 입원·수술');
    if (on('major')) hit.push('5년 중대질병');
    return { need: hit.length > 0, hits: hit };
  }

  /* 가입 전 준비 서류 — 체크된 항목에서 역산 */
  function discDocs() {
    const docs = [];
    const add = (s) => { if (!docs.some((d) => d.title === s)) docs.push(s); };
    if (on('m3dx')) add('진단서 또는 진료확인서 (질병명·진단일 기재)');
    if (on('m3adm') || anyOn(Y2) || on('y5adm')) add('입·퇴원확인서 (입원일·퇴원일·병명)');
    if (on('m3op') || anyOn(Y2) || on('y5op') || on('y3')) add('수술확인서 (수술명·수술일·수술방법)');
    if (on('y1')) add('검사 결과지·판독지 (재검사 소견 문구 확인)');
    if (on('y5tx')) add('통원 진료확인서·진료비 영수증 (7일 이상 여부)');
    if (on('major')) add('진단서·조직검사(병리) 결과지, 투석·복약 기록');
    if (docs.length) {
      add('청약서 문항과 대조할 날짜 정리표 (마지막 입원·수술일)');
      add('최근 1년 처방전·복약내역 (약물치료 문항 대비)');
    }
    return docs;
  }

  /* 권장 심사 판정 */
  function judgeDisclosure() {
    const g = generalJudge(), s = simpleJudge(), s355 = simple355Judge();
    if (anyOn(M3)) {
      return {
        code: 'hold', label: '3개월 경과 후 재검토', tone: 'warn', g, s, s355,
        head: '간편심사도 3개월 문항은 똑같이 묻습니다',
        body: '치료·검사가 끝난 날부터 3개월이 지난 뒤가 가장 넓은 선택지입니다. 그 전에는 인수 조건이 제한되거나 거절될 수 있어 청약 일정을 조정합니다.'
      };
    }
    if (!g.need) {
      return {
        code: 'standard', label: '표준체 권장 — 고지 대상 없음', tone: 'ok', g, s, s355,
        head: '일반심사(3·1·5)에서 고지할 항목이 없습니다',
        body: '간편심사는 보험료가 1.2~2배 수준으로 높고 보장이 제한될 수 있습니다. 표준체를 먼저 심사하는 것이 순서입니다.'
      };
    }
    if (!s.need) {
      return {
        code: 'simple325', label: '유병자 간편심사 3·2·5 전환 검토', tone: 'need', g, s, s355,
        head: '일반심사에서는 고지 대상이지만 3·2·5 문항은 피해 갑니다',
        body: '2년을 넘긴 입원·수술(또는 1년 재검사 소견)은 일반심사 5년·1년 문항에만 걸립니다. 간편심사 3·2·5는 3개월·2년·5년 중대질병만 묻기 때문에 통과 가능성이 있습니다. 다만 보험료가 1.2~2배, 가입 금액·특약 제한이 따릅니다.'
      };
    }
    if (!s355.need) {
      return {
        code: 'simple355', label: '간편심사 3·5·5 · 초간편 검토', tone: 'need', g, s, s355,
        head: '3·2·5는 어렵고 3·5·5까지 내려가야 합니다',
        body: '2년 이내 입원·수술은 3·2·5의 가운데 문항에 걸립니다. 3·5·5(5년 문항) 또는 초간편심사 상품을 함께 놓고, 일반심사 할증 인수와 보험료를 비교합니다.'
      };
    }
    if (on('major')) {
      return {
        code: 'review', label: '인수 심사 필요 — 중대질병 이력', tone: 'gap', g, s, s355,
        head: '5년 이내 중대질병은 모든 간편심사에서 고지 대상입니다',
        body: '3·2·5와 3·5·5 모두 5년 문항에 들어갑니다. 일반심사 할증 인수나 상품별 인수 기준을 먼저 확인하고, 고지 후 부담보·할증 조건을 고객에게 서면으로 설명합니다.'
      };
    }
    return {
      code: 's355c', label: '간편심사도 어려움 — 초간편·할증 인수 검토', tone: 'gap', g, s, s355,
      head: '3·2·5와 3·5·5 문항에 모두 걸립니다',
      body: '초간편심사 상품이나 일반심사 할증 인수를 함께 놓고 판단합니다. 고지 후 부담보·할증 조건은 서면으로 설명하고 고객 확인을 받습니다.'
    };
  }

  function disclosureText() {
    const j = judgeDisclosure();
    const L = [];
    L.push('[고지의무 체크 결과]');
    L.push(`· 체크된 항목: ${DISC_ITEMS.filter((d) => disc[d.key]).map((d) => `${d.period} ${d.label}`).join(' / ') || '없음'}`);
    L.push(`· 일반심사(3·1·5): ${j.g.need ? '고지 필요 — ' + j.g.hits.join(', ') : '고지 대상 없음'}`);
    L.push(`· 간편심사(3·2·5): ${j.s.need ? '고지 필요 — ' + j.s.hits.join(', ') : '통과 가능'}`);
    L.push(`· 권장: ${j.label}`);
    L.push(`· ${j.head}`);
    const docs = discDocs();
    if (docs.length) {
      L.push('· 준비 서류');
      docs.forEach((d, i) => L.push(`  ${i + 1}) ${d}`));
    }
    L.push('※ 최종 판단은 상품별 청약서 문항과 인수 심사가 기준입니다.');
    return L.join('\n');
  }

  function renderDisclosureTool() {
    const host = $('#disc-tool');
    if (!host) return;
    const j = judgeDisclosure();
    const items = DISC_ITEMS.filter((d) => d.period === discPeriod);
    const docs = discDocs();
    const badge = (p) => {
      const n = DISC_ITEMS.filter((d) => d.period === p && disc[d.key]).length;
      return `<em>${n}</em>`;
    };
    host.innerHTML = `
      <div class="disc-tabs" role="tablist" aria-label="고지 문항 기간">
        ${DISC_PERIODS.map((p) => `<button type="button" role="tab" aria-selected="${p === discPeriod}"
            class="disc-tab${p === discPeriod ? ' is-on' : ''}${DISC_ITEMS.some((d) => d.period === p && disc[d.key]) ? ' has-on' : ''}"
            data-disc-period="${p}">${p}${badge(p)}</button>`).join('')}
      </div>
      <div class="disc-panel">
        <div class="dp-head">${discPeriod} 이내 항목<span>${DISC_PERIOD_NOTE[discPeriod]}</span></div>
        ${items.map((d) => `<button type="button" class="dc-tick${disc[d.key] ? ' is-on' : ''}" data-disc="${d.key}" aria-pressed="${!!disc[d.key]}">
          <span class="dc-box" aria-hidden="true"></span><span>${esc(d.label)}</span></button>`).join('')}
      </div>
      <div class="disc-judge">
        <div class="disc-verdict tone-${j.g.need ? 'gap' : 'ok'}">
          <span class="dv-label">일반심사 3·1·5</span>
          <b>${j.g.need ? '고지 필요' : '고지 대상 없음'}</b>
          <p class="dv-head">${j.g.need ? esc(j.g.hits.join(' · ')) : '3개월·1년·5년 문항 모두 해당 없음'}</p>
          <p class="dv-body">${j.g.need ? '청약서 문항에 사실대로 적어야 합니다. 말로만 알린 것은 고지로 인정되지 않습니다.' : '표준체 심사를 먼저 진행합니다.'}</p>
        </div>
        <div class="disc-verdict tone-${j.s.need ? 'need' : 'ok'}">
          <span class="dv-label">간편심사 3·2·5</span>
          <b>${j.s.need ? '고지 필요' : '통과 가능'}</b>
          <p class="dv-head">${j.s.need ? esc(j.s.hits.join(' · ')) : '3개월·2년·5년 중대질병 문항 해당 없음'}</p>
          <p class="dv-body">${j.s.need ? '3·5·5(5년 문항) 또는 초간편심사로 내려가야 합니다.' : '유병자 간편심사로 전환하면 보험료는 1.2~2배, 가입 금액·특약은 제한됩니다.'}</p>
        </div>
      </div>
      <div class="disc-verdict tone-${j.tone}" id="disc-verdict-main">
        <span class="dv-label">권장 심사</span>
        <b>${esc(j.label)}</b>
        <p class="dv-head">${esc(j.head)}</p>
        <p class="dv-body">${esc(j.body)}</p>
      </div>
      <div class="disc-docs">
        <div class="dd-head">가입 전 준비 서류 ${docs.length ? `(${docs.length}건)` : '— 체크하면 자동으로 정리됩니다'}</div>
        ${docs.length
          ? `<ul>${docs.map((d) => `<li><span>${esc(d)}</span></li>`).join('')}</ul>`
          : '<p class="empty">3개월·1년·2년·5년 항목을 탭해 체크하면 필요한 서류가 여기에 바로 나옵니다.</p>'}
      </div>
      <div class="disc-actions">
        <button type="button" class="da-copy" id="disc-copy">결과·서류 카톡 복사</button>
        <button type="button" id="disc-reset">체크 비우기</button>
      </div>
      <p class="fc-src">근거 · 보험업감독업무시행세칙 별표14 · 금융감독원 「주요 분쟁사례로 알아본 소비자 유의사항 — 간편보험편」(2024.6.13) · 상법 제651조(해지권: 안 날부터 1개월, 계약일부터 3년). 최종 판단은 상품별 청약서 문항과 인수 심사가 기준입니다.</p>
    `;
    $$('[data-disc-period]', host).forEach((b) => b.addEventListener('click', () => {
      discPeriod = b.dataset.discPeriod;
      renderDisclosureTool();
    }));
    $$('[data-disc]', host).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.disc;
      const nextVal = !disc[k];
      disc[k] = nextVal;
      /* 3개월 이력은 2년·5년 문항에도 함께 걸립니다 */
      if (M3.indexOf(k) >= 0) {
        ['y2adm', 'y2op', 'y3', 'y5adm', 'y5op'].forEach((x) => { disc[x] = nextVal; });
      }
      if (['y2adm', 'y2op'].indexOf(k) >= 0 && nextVal) { disc.y3 = true; }
      renderDisclosureTool();
    }));
    const cp = $('#disc-copy', host);
    if (cp) cp.addEventListener('click', () => copy(disclosureText(), '고지 체크 결과를 복사했습니다'));
    const rs = $('#disc-reset', host);
    if (rs) rs.addEventListener('click', () => {
      Object.keys(disc).forEach((k) => { delete disc[k]; });
      renderDisclosureTool();
      toast('체크를 비웠습니다');
    });
  }

  let claimTab = 'cancer';
  const CLAIM_ORDER = ['cancer', 'brain', 'heart', 'surgery', 'care', 'silson'];

  function claimText(key) {
    const c = CLAIM_DOCS[key];
    if (!c) return '';
    const L = [];
    L.push(`[${c.title} 청구 서류 안내]`);
    L.push('');
    L.push('■ 꼭 필요한 서류');
    c.must.forEach((x, i) => L.push(`${i + 1}) ${x}`));
    L.push('');
    L.push('■ 있으면 좋은 서류');
    c.extra.forEach((x) => L.push(`· ${x}`));
    L.push('');
    L.push('■ 꼭 확인하세요');
    c.tips.forEach((x) => L.push(`· ${x}`));
    L.push('');
    L.push('※ 실제 지급 여부와 금액은 가입하신 상품의 약관과 증권이 기준입니다. 서류는 병원 원무과에서 발급받아 사진으로 보내주시면 제가 먼저 확인하겠습니다.');
    return L.join('\n');
  }

  function renderClaimDocs() {
    const host = $('#claim-tool');
    if (!host) return;
    const c = CLAIM_DOCS[claimTab];
    host.innerHTML = `
      <div class="claim-tabs">
        ${CLAIM_ORDER.map((k) => `<button type="button" class="ct-tab${claimTab === k ? ' is-on' : ''}" data-claimtab="${k}">${CLAIM_DOCS[k].title}</button>`).join('')}
      </div>
      <div class="claim-sheet">
        <div class="cs-head"><b>${esc(c.title)}</b><span>고객에게 그대로 보내는 문장입니다</span></div>
        <div class="cs-sec"><h5>꼭 필요한 서류</h5><ol>${c.must.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
        <div class="cs-sec"><h5>있으면 좋은 서류</h5><ul>${c.extra.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div class="cs-sec"><h5>꼭 확인하세요</h5><ul class="cs-tips">${c.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </div>
      <div class="claim-actions">
        <button type="button" class="btn-primary sm" id="claim-copy">${unlocked() ? '카톡 복사' : '🔒 Pro에서 카톡 복사'} (${esc(c.title)})</button>
        <button type="button" class="btn-ghost sm" id="claim-copy-all">${unlocked() ? '5대 담보 전체 복사' : '🔒 전체 복사 (Pro)'}</button>
      </div>
    `;
    $$('[data-claimtab]', host).forEach((b) => b.addEventListener('click', () => { claimTab = b.dataset.claimtab; renderClaimDocs(); }));
    $('#claim-copy').addEventListener('click', () => { if (guard('claimCopy')) copy(claimText(claimTab), `${CLAIM_DOCS[claimTab].title} 청구 서류를 복사했습니다`); });
    $('#claim-copy-all').addEventListener('click', () => {
      if (!guard('claimCopy')) return;
      const text = CLAIM_ORDER.map((k) => claimText(k)).join('\n\n──────────\n\n');
      copy(text, '5대 담보 청구 서류를 모두 복사했습니다');
    });
  }

  /* =========================================================
     ④ 소득 대비 적정 보험료 · 리모델링 비교기
     ========================================================= */
  function pct(n) { return Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, '') : '—'; }

  function renderPremiumTool() {
    const host = $('#premium-tool');
    if (!host) return;
    const s = state();
    const income = Math.max(0, Number(($('#income-input') || {}).value || 0));
    const cur = Number(s.premium || 0);
    const low = Math.round(income * PREMIUM_GUIDE.minPct / 100);
    const rec = Math.round(income * PREMIUM_GUIDE.recPct / 100);
    const high = Math.round(income * PREMIUM_GUIDE.maxPct / 100);
    const ratio = income > 0 ? (cur / income) * 100 : 0;
    let tone = 'mute', verdict = '소득을 입력하면 진단이 나옵니다', detail = '세후 월 소득 기준 · 보장성 보험료만 계산합니다.';
    if (income > 0) {
      if (cur <= 0) { tone = 'gap'; verdict = '보장성 보험료 없음'; detail = '보장 공백이 크면 진단비부터 최소선으로 시작합니다.'; }
      else if (ratio < PREMIUM_GUIDE.minPct) { tone = 'info'; verdict = '여유 구간 — 보장 점검 우선'; detail = `기준선(${PREMIUM_GUIDE.minPct}%)보다 ${pct(PREMIUM_GUIDE.minPct - ratio)}%p 낮습니다. 빈 칸이 있으면 이 범위 안에서 채웁니다.`; }
      else if (ratio <= PREMIUM_GUIDE.recPct) { tone = 'ok'; verdict = '적정 구간'; detail = `${PREMIUM_GUIDE.minPct}~${PREMIUM_GUIDE.recPct}% 안에 들어옵니다. 금액보다 배분을 점검하는 단계입니다.`; }
      else if (ratio <= PREMIUM_GUIDE.maxPct) { tone = 'warn'; verdict = '다소 높은 구간'; detail = `권장 상한(${PREMIUM_GUIDE.recPct}%)을 넘었습니다. 적립·중복 특약을 먼저 확인합니다.`; }
      else { tone = 'gap'; verdict = '정리 필요 구간'; detail = `소득의 ${PREMIUM_GUIDE.maxPct}%를 넘었습니다. 해지가 아니라 배서(특약 정리)로 배분을 바꿉니다.`; }
    }

    /* 리모델링 전후 — 같은 보험료 재배치 / 소득 기준 권장까지 보완 */
    let before = null, samePrem = null, upPrem = null;
    try {
      const m0 = BojangModel.full(s);
      before = m0;
      const need = m0.needList.map((x) => x.item.key);
      const b1 = {}; if (need[0]) b1[need[0]] = 100;
      const b2 = {}; need.slice(0, 2).forEach((k) => { b2[k] = 100; });
      samePrem = BojangModel.simulate(s, b1);
      upPrem = BojangModel.simulate(s, b2);
    } catch (e) { before = null; }

    host.innerHTML = `
      <div class="pm-input">
        <label for="income-input">세후 월 소득</label>
        <div class="input-row">
          <input id="income-input" type="number" inputmode="numeric" min="0" max="100000" step="10" value="${income || ''}" placeholder="예: 450">
          <span class="unit">만원</span>
        </div>
        <div class="pm-sync">
          <span>현재 보장성 보험료 <b>${won(cur)}만원</b> <em>상담자 입력값</em></span>
          <span class="pm-src">소득 대비 <b>${income > 0 ? pct(ratio) + '%' : '—'}</b></span>
        </div>
      </div>
      <div class="pm-gauge">
        <div class="pmg-head"><span>보험료 / 소득</span><b class="tone-${tone}">${income > 0 ? pct(ratio) + '%' : '—'}</b></div>
        <div class="pmg-track">
          <i class="pmg-fill tone-${tone}" style="width:${income > 0 ? Math.min(100, (ratio / (PREMIUM_GUIDE.maxPct * 1.4)) * 100) : 0}%"></i>
          <span class="pmg-mark" style="left:${(PREMIUM_GUIDE.minPct / (PREMIUM_GUIDE.maxPct * 1.4)) * 100}%"><em>${PREMIUM_GUIDE.minPct}%</em></span>
          <span class="pmg-mark" style="left:${(PREMIUM_GUIDE.recPct / (PREMIUM_GUIDE.maxPct * 1.4)) * 100}%"><em>${PREMIUM_GUIDE.recPct}%</em></span>
          <span class="pmg-mark end" style="left:${100}%"><em>${PREMIUM_GUIDE.maxPct}%+</em></span>
        </div>
        <div class="pmg-verdict tone-${tone}"><b>${esc(verdict)}</b><span>${esc(detail)}</span></div>
        <div class="pmg-nums">
          <span>소득의 ${PREMIUM_GUIDE.minPct}% <b>${income > 0 ? won(low) : '—'}만원</b></span>
          <span>권장 ${PREMIUM_GUIDE.recPct}% <b>${income > 0 ? won(rec) : '—'}만원</b></span>
          <span>상한 ${PREMIUM_GUIDE.maxPct}% <b>${income > 0 ? won(high) : '—'}만원</b></span>
        </div>
      </div>
      ${before ? `
      <div class="rm-cards">
        <div class="rm-card">
          <span class="rm-tag">A · 현재</span>
          <b class="rm-score">${before.letter} <em>${before.score}점</em></b>
          <p class="rm-prem">월 ${won(cur)}만원</p>
          <p class="rm-note">보완 필요 ${before.needList.length}개 · ${before.first ? `1순위 ${esc(before.first.item.name)} ${before.first.pct}%` : '전 항목 기준선 이상'}</p>
        </div>
        <div class="rm-card is-best">
          <span class="rm-tag">B · 같은 보험료 재배치</span>
          <b class="rm-score">${samePrem.letter} <em>${samePrem.score}점</em>${samePrem.score > before.score ? `<i class="rm-up">+${samePrem.score - before.score}</i>` : ''}</b>
          <p class="rm-prem">월 ${won(cur)}만원 <span>변동 없음</span></p>
          <p class="rm-note">${before.first ? `${esc(before.first.item.name)} 한 칸을 권장까지 채운다고 가정` : '이미 기준선 이상'} · 적립·중복 특약 정리로 예산을 마련하는 전제</p>
        </div>
        <div class="rm-card">
          <span class="rm-tag">C · 소득 기준 권장까지</span>
          <b class="rm-score">${upPrem.letter} <em>${upPrem.score}점</em>${upPrem.score > before.score ? `<i class="rm-up">+${upPrem.score - before.score}</i>` : ''}</b>
          <p class="rm-prem">월 ${income > 0 ? won(Math.max(cur, rec)) : won(cur)}만원 ${income > 0 && Math.max(cur, rec) > cur ? `<span class="is-up">+${won(Math.max(cur, rec) - cur)}</span>` : ''}</p>
          <p class="rm-note">${income > 0 ? `소득의 ${PREMIUM_GUIDE.recPct}% 선 · ` : '소득 미입력 · '}1·2순위 두 칸을 채운다고 가정</p>
        </div>
      </div>` : ''}
      <div class="fc-block">
        <h4>가이드</h4>
        <ul class="fc-checks">${PREMIUM_GUIDE.lines.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>
      <div class="fc-block">
        <h4>리모델링 원칙</h4>
        <ul class="fc-checks">${PREMIUM_GUIDE.remodel.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>
      <p class="fc-src">B·C 카드는 권장 기준을 100%로 두고 계산한 상담 보조 시뮬레이션입니다. 실제 인수 조건·보험료는 상품과 나이에 따라 다르며, 추가 지출 여부는 고객이 결정합니다.</p>
    `;
    const inp = $('#income-input');
    if (inp) {
      let t = null;
      inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderPremiumTool, 220); });
    }
  }

  /* =========================================================
     초기화
     ========================================================= */
  function init() {
    renderCodes();
    renderSilson();
    renderDisclosureTool();
    renderClaimDocs();
    renderPremiumTool();
    const q = $('#code-q');
    if (q) q.addEventListener('input', renderCodes);
  }

  root.BojangTools = { init, renderCodes, renderSilson, renderDisclosureTool, renderClaimDocs, renderPremiumTool, disclosureText, judgeDisclosure };
})(typeof window !== 'undefined' ? window : globalThis);
