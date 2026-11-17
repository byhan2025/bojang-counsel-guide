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
     v6.1 — content.js DISCLOSURE_ITEMS 단일 스키마 + BojangModel.disclosureJudge 단일 엔진.
     6단계 입력과 같은 저장소(state.disc)를 쓰므로 새로고침·PDF·요약에 그대로 반영됩니다.
     ========================================================= */
  const DISC_PERIODS = ['\u0033\uac1c\uc6d4', '1\ub144', '2\ub144', '5\ub144'];
  const DISC_PERIOD_NOTE = {
    '\u0033\uac1c\uc6d4': '\ucd5c\uadfc 3\uac1c\uc6d4 \uc774\ub0b4 \u2014 \ubaa8\ub4e0 \uc2ec\uc0ac \uacf5\ud1b5 \ubb38\ud56d',
    '1\ub144': '\ucd5c\uadfc 1\ub144 \uc774\ub0b4 \u2014 \uc77c\ubc18\uc2ec\uc0ac\uc5d0\ub9cc \uc788\ub294 \ubb38\ud56d',
    '2\ub144': '\ucd5c\uadfc 2\ub144 \uc774\ub0b4 \u2014 \uac04\ud3b8 3\u00b72\u00b75 \uac00\uc6b4\ub370 \ubb38\ud56d',
    '5\ub144': '\ucd5c\uadfc 5\ub144 \uc774\ub0b4 \u2014 \uc77c\ubc18 5\ub144 \ubb38\ud56d \u00b7 \uac04\ud3b8\uc740 \uc911\ub300\uc9c8\ubcc0'
  };
  let discPeriod = '\u0033\uac1c\uc6d4';

  function discBox() {
    const S = root.__bojangState || {};
    if (!S.disc || typeof S.disc !== 'object') S.disc = {};
    return S.disc;
  }
  const on = (k) => !!discBox()[k];
  function toggleDisc(k) {
    const d = discBox();
    d[k] = !d[k];
    if (root.BojangApp && root.BojangApp.discTouched) root.BojangApp.discTouched();
  }
  function judgeDisclosure() {
    const S = root.__bojangState || { disc: {} };
    if (root.BojangModel && root.BojangModel.disclosureJudge) return root.BojangModel.disclosureJudge(S);
    return { code: 'standard', label: '\ud310\uc815 \ubd88\uac00', tone: 'info', headline: '', advice: '', reasons: [], matrix: {}, checked: 0 };
  }
  /* v6.1 — 예전 이름 호환(도구 탭·테스트). 판정은 model의 단일 엔진을 그대로 쓴다. */
  function generalJudge() {
    const j = judgeDisclosure();
    return { need: !!(j.matrix && j.matrix.general), hits: (j.reasons || []) };
  }
  function simpleJudge() {
    const j = judgeDisclosure();
    return { need: !!(j.matrix && j.matrix.sim325), hits: [] };
  }

  /* 가입 전 준비 서류 — 체크된 항목에서 역산 */
  function discDocs() {
    const docs = [];
    const add = (s) => { if (!docs.some((d) => d.title === s)) docs.push({ title: s }); };
    if (on('m3_dx')) add('\uc9c4\ub2e8\uc11c \ub610\ub294 \uc9c4\ub8cc\ud655\uc778\uc11c (\uc9c8\ubcc0\uba85\u00b7\uc9c4\ub2e8\uc77c \uae30\uc7ac)');
    if (on('m3_in') || on('y2_inop') || on('y5_inop')) add('\uc785\u00b7\ud1f4\uc6d0\ud655\uc778\uc11c (\uc785\uc6d0\uc77c\u00b7\ud1f4\uc6d0\uc77c\u00b7\ubcc0\uba85)');
    if (on('m3_op') || on('y2_inop') || on('y5_inop')) add('\uc218\uc220\ud655\uc778\uc11c (\uc218\uc220\uba85\u00b7\uc218\uc220\uc77c\u00b7\uc218\uc220\ubc29\ubc95)');
    if (on('m3_med') || on('m3_daily') || on('y5_med30')) add('\ucc98\ubc29\uc804\u00b7\ubcf5\uc57d\ub0b4\uc5ed (\uc57d\ud488\uba85\u00b7\ubcf5\uc6a9\uae30\uac04)');
    if (on('y1_test')) add('\uac80\uc0ac \uacb0\uacfc\uc9c0\u00b7\ud310\ub3c5\uc9c0 (\uc7ac\uac80\uc0ac \uc18c\uacac \ubb38\uad6c \ud655\uc778)');
    if (on('y5_care7')) add('\ud1b5\uc6d0 \uc9c4\ub8cc\ud655\uc778\uc11c\u00b7\uc9c4\ub8cc\ube44 \uc601\uc218\uc99d (7\uc77c \uc774\uc0c1 \uc5ec\ubd80)');
    if (on('y5_major') || ['y5m_cancer', 'y5m_leuk', 'y5m_htn', 'y5m_angina', 'y5m_mi', 'y5m_valve', 'y5m_cirr', 'y5m_stroke', 'y5m_dm', 'y5m_aids', 'y5m_ckd', 'y5m_park', 'y5m_als'].some(on)) add('\uc9c4\ub2e8\uc11c\u00b7\uc870\uc9c1\uac80\uc0ac(\ubcc0\ub9ac) \uacb0\uacfc\uc9c0, \ud22c\uc11d\u00b7\ubcf5\uc57d \uae30\ub85d');
    if (docs.length) {
      add('\uccad\uc57d\uc11c \ubb38\ud56d\uacfc \ub300\uc870\ud560 \ub0a0\uc9dc \uc815\ub9ac\ud45c (\ub9c8\uc9c0\ub9c9 \uc785\uc6d0\u00b7\uc218\uc220\uc77c)');
      add('\uc9c4\ub2e8\uc11c\uc0c1 \ucf54\ub4dc \ud655\uc778 (I64\u00b7I69 \ub4f1 \ubc94\uc704 \ubd84\ub9ac)');
    }
    return docs;
  }

  function disclosureText() {
    const j = judgeDisclosure();
    const d = discBox();
    const items = (typeof DISCLOSURE_ITEMS !== 'undefined' ? DISCLOSURE_ITEMS : []);
    const picked = items.filter((x) => d[x.key]).map((x) => `${x.period} ${x.label.split(' (')[0]}`);
    const L = [];
    L.push('[\uace0\uc9c0\uc758\ubb34 \uccb4\ud06c \uacb0\uacfc]');
    L.push(`\u00b7 \uccb4\ud06c\ub41c \ud56d\ubaa9: ${picked.join(' / ') || '\uc5c6\uc74c'}`);
    L.push(`\u00b7 \uc77c\ubc18\uc2ec\uc0ac(3\u00b71\u00b75): ${j.matrix && j.matrix.general ? '\uace0\uc9c0 \ud544\uc694' : '\uace0\uc9c0 \ub300\uc0c1 \uc5c6\uc74c'}`);
    L.push(`\u00b7 \uac04\ud3b8\uc2ec\uc0ac(3\u00b72\u00b75): ${j.matrix && j.matrix.sim325 ? '\uace0\uc9c0 \ud544\uc694' : '\ud1b5\uacfc \uac00\ub2a5'}`);
    L.push(`\u00b7 \uac04\ud3b8\uc2ec\uc0ac(3\u00b75\u00b75): ${j.matrix && j.matrix.sim355 ? '\uace0\uc9c0 \ud544\uc694' : '\ud1b5\uacfc \uac00\ub2a5'}`);
    L.push(`\u00b7 \ucd08\uac04\ud3b8: ${j.matrix && j.matrix.ultra ? '\uace0\uc9c0 \ud544\uc694' : '\ud1b5\uacfc \uac00\ub2a5'}`);
    L.push(`\u00b7 \uad8c\uc7a5: ${j.label}`);
    L.push(`\u00b7 ${j.headline}`);
    const docs = discDocs();
    if (docs.length) {
      L.push('\u00b7 \uc900\ube44 \uc11c\ub958');
      docs.forEach((x, i) => L.push(`  ${i + 1}) ${x.title}`));
    }
    L.push('\u203b \ucd5c\uc885 \ud310\ub2e8\uc740 \uc0c1\ud488\ubcc4 \uccad\uc57d\uc11c \ubb38\ud56d\uacfc \uc778\uc218 \uc2ec\uc0ac\uac00 \uae30\uc900\uc785\ub2c8\ub2e4.');
    return L.join('\n');
  }

  function verdictCard(label, ok, hits, passLabel) {
    return `<div class="disc-verdict tone-${ok ? 'gap' : 'ok'}">
      <span class="dv-label">${label}</span>
      <b>${ok ? '\uace0\uc9c0 \ud544\uc694' : (passLabel || '\ud1b5\uacfc \uac00\ub2a5')}</b>
      <p class="dv-head">${ok ? '\ubb38\ud56d\uc5d0 \uac78\ub9bd\ub2c8\ub2e4' : '\uc774 \uc0c1\ud488\uc758 \ubb38\ud56d\uc740 \ud53c\ud574\uac11\ub2c8\ub2e4'}</p>
      <p class="dv-body">${esc(hits || '')}</p>
    </div>`;
  }

  function renderDisclosureTool() {
    const host = $('#disc-tool');
    if (!host) return;
    const j = judgeDisclosure();
    const d = discBox();
    const items = (typeof DISCLOSURE_ITEMS !== 'undefined' ? DISCLOSURE_ITEMS : []).filter((x) => x.period === discPeriod);
    const majors = (typeof DISCLOSURE_MAJOR10 !== 'undefined' ? DISCLOSURE_MAJOR10 : []).concat(typeof DISCLOSURE_MAJOR5 !== 'undefined' ? DISCLOSURE_MAJOR5.filter((m) => !DISCLOSURE_MAJOR10.some((x) => x.key === m.key)) : []);
    const docs = discDocs();
    const badge = (p) => {
      const n = (typeof DISCLOSURE_ITEMS !== 'undefined' ? DISCLOSURE_ITEMS : []).filter((x) => x.period === p && d[x.key]).length;
      return `<em>${n}</em>`;
    };
    host.innerHTML = `
      <div class="disc-tabs" role="tablist" aria-label="\uace0\uc9c0 \ubb38\ud56d \uae30\uac04">
        ${DISC_PERIODS.map((p) => `<button type="button" role="tab" aria-selected="${p === discPeriod}"
            class="disc-tab${p === discPeriod ? ' is-on' : ''}${(typeof DISCLOSURE_ITEMS !== 'undefined' ? DISCLOSURE_ITEMS : []).some((x) => x.period === p && d[x.key]) ? ' has-on' : ''}"
            data-disc-period="${p}">${p}${badge(p)}</button>`).join('')}
      </div>
      <div class="disc-panel">
        <div class="dp-head">${discPeriod} \uc774\ub0b4 \ud56d\ubaa9<span>${DISC_PERIOD_NOTE[discPeriod]}</span></div>
        ${items.map((x) => `<button type="button" class="dc-tick${d[x.key] ? ' is-on' : ''}" data-disc="${x.key}" aria-pressed="${!!d[x.key]}" title="${esc(x.hint || '')}">
          <span class="dc-box" aria-hidden="true"></span><span>${esc(x.label)}${x.hint ? `<em>${esc(x.hint)}</em>` : ''}</span></button>`).join('')}
        ${discPeriod === '5년' ? `<div class="disc-major">
          <div class="dm-head">10\ub300 \uc9c8\ubcc0 \u00b7 \uac04\ud3b8 \uc911\ub300\uc9c8\ubcc0 \u2014 \ud574\ub2f9 \uc9c8\ubcc0\ub9c8\ub2e4 \uace0\uc9c0</div>
          <div class="dm-chips">${majors.map((m2) => `<button type="button" class="dm-chip${d[m2.key] ? ' is-on' : ''}" data-disc="${m2.key}">${esc(m2.label)}</button>`).join('')}</div>
        </div>` : ''}
      </div>
      <div class="disc-judge">
        ${verdictCard('\uc77c\ubc18\uc2ec\uc0ac 3\u00b71\u00b75', !!(j.matrix && j.matrix.general), j.matrix && j.matrix.general ? (j.reasons || []).join(' \u00b7 ') : '3\uac1c\uc6d4\u00b71\ub144\u00b75\ub144 \ubb38\ud56d \ubaa8\ub450 \ud574\ub2f9 \uc5c6\uc74c', '\uace0\uc9c0 \ub300\uc0c1 \uc5c6\uc74c')}
        ${verdictCard('\uac04\ud3b8\uc0ac 3\u00b72\u00b75', !!(j.matrix && j.matrix.sim325), j.matrix && j.matrix.sim325 ? '3\uac1c\uc6d4\u00b72\ub144\u00b75\ub144 \uc911\ub300\uc9c8\ubcc0 \ubb38\ud56d \ud574\ub2f9' : '3\u00b72\u00b75 \ubb38\ud56d\uc740 \ud53c\ud574\uac10')}
        ${verdictCard('\uac04\ud3b8\uc0ac 3\u00b75\u00b75', !!(j.matrix && j.matrix.sim355), j.matrix && j.matrix.sim355 ? '5\ub144 \uc785\uc6d0\u00b7\uc218\uc220 \ub610\ub294 \uc911\ub300\uc9c8\ubcc0 \ubb38\ud56d \ud574\ub2f9' : '3\u00b75\u00b75 \ubb38\ud56d\uc740 \ud53c\ud574\uac10')}
        ${verdictCard('\ucd08\uac04\ud3b8(3\uac1c\uc6d4\u00b75\ub144 \uc554)', !!(j.matrix && j.matrix.ultra), j.matrix && j.matrix.ultra ? '3\uac1c\uc6d4 \uc785\uc6d0\u00b7\uc218\uc220 \ub610\ub294 5\ub144 \uc554' : '\ucd08\uac04\ud3b8 \ubb38\ud56d\ub3c4 \ud53c\ud574\uac10')}
      </div>
      <div class="disc-verdict tone-${j.tone}" id="disc-verdict-main">
        <span class="dv-label">\uad8c\uc7a5 \uc2ec\uc0ac</span>
        <b>${esc(j.label)}</b>
        <p class="dv-head">${esc(j.headline)}</p>
        <p class="dv-body">${esc(j.advice)}</p>
      </div>
      <div class="disc-docs">
        <div class="dd-head">\uac00\uc785 \uc804 \uc900\ube44 \uc11c\ub958 ${docs.length ? `(${docs.length}\uac74)` : '\u2014 \uccb4\ud06c\ud558\uba74 \uc790\ub3d9\uc73c\ub85c \uc815\ub9ac\ub429\ub2c8\ub2e4'}</div>
        ${docs.length
          ? `<ul>${docs.map((x) => `<li><span>${esc(x.title)}</span></li>`).join('')}</ul>`
          : '<p class="empty">3\uac1c\uc6d4\u00b71\ub144\u00b72\ub144\u00b75\ub144 \ud56d\ubaa9\uc744 \ud0ed\ud574 \uccb4\ud06c\ud558\uba74 \ud544\uc694\ud55c \uc11c\ub958\uac00 \uc5ec\uae30\uc5d0 \ubc14\ub85c \ub098\uc635\ub2c8\ub2e4.</p>'}
      </div>
      <div class="disc-actions">
        <button type="button" class="da-copy" id="disc-copy">\uacb0\uacfc\u00b7\uc11c\ub958 \uce74\ud1a1 \ubcf5\uc0ac</button>
        <button type="button" id="disc-reset">\uccb4\ud06c \ube44\uc6b0\uae30</button>
      </div>
      <p class="fc-src">\uadfc\uac70 \u00b7 \ubcf4\ud5d8\uc5c5\uac10\ub3c5\uc5c5\ubb34\uc2dc\ud589\uc138\uce59 \ubcc4\ud45c14 \u00b7 \uae08\uc735\uac10\ub3c5\uc6d0 \u300c\uc8fc\uc694 \ubd84\uc7c1\uc0ac\ub840\ub85c \uc54c\uc544\ubcf8 \uc18c\ube44\uc790 \uc720\uc758\uc0ac\ud56d \u2014 \uac04\ud3b8\ubcf4\ud5d8\ud3b8\u300d(2024.7.2) \u00b7 \uc0c1\ubc95 \uc81c651\uc870(\ud574\uc9c0\uad8c: \uc548 \ub0a0\ubd80\ud130 1\uac1c\uc6d4, \uacc4\uc57d\uc77c\ubd80\ud130 3\ub144). \ucd5c\uc885 \ud310\ub2e8\uc740 \uc0c1\ud488\ubcc4 \uccad\uc57d\uc11c \ubb38\ud56d\uacfc \uc778\uc218 \uc2ec\uc0ac\uac00 \uae30\uc900\uc785\ub2c8\ub2e4.</p>
    `;
    $$('[data-disc-period]', host).forEach((b) => b.addEventListener('click', () => {
      discPeriod = b.dataset.discPeriod;
      renderDisclosureTool();
    }));
    $$('[data-disc]', host).forEach((b) => b.addEventListener('click', () => {
      toggleDisc(b.dataset.disc);
      renderDisclosureTool();
    }));
    const cp = $('#disc-copy', host);
    if (cp) cp.addEventListener('click', () => copy(disclosureText(), '\uace0\uc9c0 \uccb4\ud06c \uacb0\uacfc\ub97c \ubcf5\uc0ac\ud588\uc2b5\ub2c8\ub2e4'));
    const rs = $('#disc-reset', host);
    if (rs) rs.addEventListener('click', () => {
      const d2 = discBox();
      Object.keys(d2).forEach((k) => { delete d2[k]; });
      if (root.BojangApp && root.BojangApp.discTouched) root.BojangApp.discTouched();
      renderDisclosureTool();
      toast('\uccb4\ud06c\ub97c \ube44\uc6e0\uc2b5\ub2c8\ub2e4');
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
