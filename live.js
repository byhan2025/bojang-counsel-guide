/* 보장분석 상담 가이드 v3 — 라이브 상담 모드
   1. 오프닝 → 2. 진단 설명 → 3. 우선순위 플랜 → 4. 반론 돌파 → 5. 클로징
   PDF를 뽑기 전에도 화면을 넘기며 상담이 끊기지 않게 하는 현장용 뷰. */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');

  const STAGES = [
    { key: 'open', label: '오프닝', title: '오프닝 — 첫 3분', desc: '인사 · 목적 · 시간 약속 · 허락. 팔지 않는다는 신호를 먼저 줍니다.' },
    { key: 'read', label: '진단 설명', title: '진단 설명 — 숫자 하나부터', desc: '점수 → 도넛 → 5대 판정 순서. 세부 표는 나중에 펼칩니다.' },
    { key: 'plan', label: '먼저 확인할 항목', title: '먼저 확인할 항목 — 이 고객 순서', desc: '비용 근거 → 코드 → 사례 → 3안. 한 칸씩만 다룹니다.' },
    { key: 'objection', label: '반론 카드', title: '반론 카드 15 — 한 줄 대응', desc: '대응 1문장 + 붙일 근거. 판정이 아니라 확인 후보입니다.' },
    { key: 'close', label: '클로징', title: '클로징 — 요약 · 결정 · 약속', desc: '7분 안에 끝냅니다. 더 설명하지 않습니다.' }
  ];

  let S = null, H = null, stage = 0, dirty = true, startedAt = 0, ticker = null, openPri = 0, openObj = 0;

  function model() { return root.BojangModel.full(S); }

  function init(state, helpers) {
    S = state; H = helpers;
    $('#live-prev').addEventListener('click', () => go(stage - 1));
    $('#live-next').addEventListener('click', () => go(stage + 1));
    document.addEventListener('keydown', (e) => {
      if (S.tab !== 'live') return;
      if (e.key === 'ArrowRight') go(stage + 1);
      if (e.key === 'ArrowLeft') go(stage - 1);
    });
    renderProgress();
    renderClock();
  }

  function markDirty() { dirty = true; if (S && S.tab === 'live') render(); }

  function go(n) {
    stage = Math.max(0, Math.min(4, n));
    startedAt = Date.now();
    render();
    $('#view-live').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderProgress() {
    const host = $('#live-progress');
    if (!host) return;
    host.innerHTML = STAGES.map((s, i) => `<i class="${i < stage ? 'is-done' : i === stage ? 'is-on' : ''}"></i>`).join('');
    $('#live-stage-label').textContent = STAGES[stage].label;
    $('#live-count').textContent = `${stage + 1} / 5`;
    $('#live-prev').disabled = stage === 0;
    $('#live-next').textContent = stage === 4 ? '처음으로 ↺' : '다음 단계 ›';
  }

  function renderClock() {
    clearInterval(ticker);
    startedAt = startedAt || Date.now();
    const paint = () => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      const b = $('#live-clock');
      if (b) b.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    };
    paint();
    ticker = setInterval(paint, 1000);
  }

  function scriptBox(text, o) {
    o = o || {};
    return `<div class="live-script ${o.kind || ''}">
      ${o.tag ? `<div class="ls-tag">${o.tag}</div>` : ''}
      <p>${text}</p>
      <button type="button" class="ls-copy" data-copy="${encodeURIComponent(stripTags(text))}">복사</button>
    </div>`;
  }
  function stripTags(s) { return String(s).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }

  function checklist(items) {
    return `<div class="live-list">${items.map((t) => `<div class="live-check"><i></i><span>${t}</span></div>`).join('')}</div>`;
  }

  /* =========================================================
     단계별 렌더
     ========================================================= */
  function planOf(m) {
    try { return root.BojangPriority ? root.BojangPriority.allocation(m) : null; } catch (e) { return null; }
  }

  function render() {
    const host = $('#live-body');
    if (!host) return;
    const m = model();
    const S0 = STAGES[stage];
    let html = `<div class="live-hero">
      <div class="lh-eyebrow">LIVE ${stage + 1} / 5</div>
      <h2>${S0.title}</h2>
      <p>${S0.desc}</p>
    </div>`;

    if (stage === 0) html += stageOpen(m);
    else if (stage === 1) html += stageRead(m);
    else if (stage === 2) html += stagePlan(m);
    else if (stage === 3) html += stageObjection(m);
    else html += stageClose(m);

    host.innerHTML = html;
    bindHost(host);
    renderProgress();
    renderClock();
  }

  /* ---------- 1. 오프닝 ---------- */
  function stageOpen(m) {
    const name = m.client.name;
    let h = `<div class="live-stage">`;
    h += `<div class="live-card hl"><h3>인사 · 목적 · 시간 · 허락</h3>
      <p>${name}님, 오늘은 보험을 더 드리는 자리가 아니라 <b>지금 보장이 어디가 비었는지</b> 한 장으로 보여드리는 자리입니다.</p></div>`;
    PLAN_OPEN.greeting.forEach((g, i) => {
      h += `<div class="live-card"><h3><span class="num">${i + 1}</span>${g.title}</h3>
        ${scriptBox(g.text.replace(/\{name\}/g, name))}</div>`;
    });
    h += `<div class="live-card"><h3>아이스브레이킹 — 하나만</h3>
      ${PLAN_OPEN.icebreakers.map((ic) => `<div class="live-script live-ask"><div class="ls-tag">${ic.title}</div><p>${ic.text}</p></div>`).join('')}</div>`;
    h += `<div class="live-card"><h3>첫 3분 체크</h3>${checklist([
      '고객 이름을 두 번 이상 불렀다',
      '"오늘 결정 안 하셔도 된다"를 내가 먼저 말했다',
      '개인정보가 기기 안에서만 계산된다고 설명했다',
      '고객이 오늘 목적을 자기 말로 말했다'
    ])}</div>`;
    h += `<div class="live-note">고객이 <b>"그냥 괜찮아요"</b>라고 하면 밀지 않습니다. <b>"그럼 오늘은 지금 보장이 어디까지 되어 있는지만 확인하고 끝내겠습니다"</b>로 낮춰 잡으면 대화가 이어집니다.</div>`;
    h += `</div>`;
    return h;
  }

  /* ---------- 2. 진단 설명 ---------- */
  function stageRead(m) {
    const dn = m.counts;
    const plan = planOf(m);
    const f = plan && plan.first;
    let h = `<div class="live-stage">`;
    h += `<div class="live-kpis">
      <div class="live-kpi"><span>종합 등급</span><strong>${m.letter}</strong><em>${m.score}점 · ${m.grade.label}</em></div>
      <div class="live-kpi"><span>충분 / 점검</span><strong>${dn.enough} · ${dn.check}</strong><em>항목 ${dn.total}개 중</em></div>
      <div class="live-kpi"><span>보완 후보 / 없음</span><strong>${dn.short} · ${dn.none}</strong><em>먼저 확인할 곳</em></div>
      <div class="live-kpi"><span>월 보험료</span><strong>${won(m.premium)}</strong><em>만원 · 연 ${won(m.annual)}만원</em></div>
    </div>`;
    h += `<div class="live-card hl"><h3>3초 결론</h3>
      <p>${name0(m)}은(는) 지금 <b>${m.letter} 등급(${m.score}점)</b>이고, 먼저 확인할 항목은 <b>${f ? `${f.name}(${f.pct}%)` : '없음 — 유지 점검'}</b>입니다. 나머지는 그대로 두고 이 한 칸부터 봅니다.</p>
      ${scriptBox(f ? `${m.client.name}님은 ${m.letter} 등급(${m.score}점)이고, 먼저 확인할 항목은 ${f.name} ${f.pct}%입니다. 나머지는 그대로 두고 이 한 칸부터 채우면 됩니다.` : `${m.client.name}님은 5대 담보가 모두 기준선을 넘었습니다. 오늘은 금액을 올리지 않고 지급 조건만 확인하겠습니다.`)}</div>`;
    h += `<div class="live-sub">먼저 확인할 3카드</div>`;
    h += `<div class="live-card"><div class="live-list">
      <div class="live-li"><i></i><span><b>① 한 칸</b> — ${f && f.gaps[0] ? `${f.gaps[0].label} ${won(f.gaps[0].need)}만원 부족` : '금액은 기준선 이상'}</span></div>
      <div class="live-li"><i></i><span><b>② 범위·코드</b> — ${rangeLine(m)}</span></div>
      <div class="live-li"><i></i><span><b>③ 재원·제도</b> — ${(S.flags || {}).savings ? '적립·중복 특약 재배치부터' : `실손 ${S.silson === 'none' ? '없음' : S.silson + '세대'} · 산정특례·상한제 확인`}</span></div>
    </div></div>`;
    h += `<div class="live-sub">5대 판정 — 이 고객 순서</div>`;
    (plan ? plan.order : m.rows.map((r) => ({ key: r.item.key, name: r.item.name, pct: r.pct, hold: false, row: r, order: r.item.rank }))).forEach((e) => {
      const row = e.row || m.rows.find((r) => r.item.key === e.key);
      h += `<button type="button" class="live-pri" data-pri="${e.key}">
        <span class="lp-rank">${e.hold ? 'H' : e.order}</span>
        <span class="lp-main"><span class="lp-name">${e.name}</span><span class="lp-sum">${row.summary}</span></span>
        <span class="lp-pct">${e.pct}%</span>
        <span class="lp-badge ${row.level}">${e.hold ? '유지·조건' : row.label}</span>
      </button>`;
    });
    h += `<div class="live-note">이 순서는 앱의 <b>기본 상담 순서</b>입니다. 고객이 먼저 꺼낸 걱정·청구 질문과 실제 증권 공백에 따라 설계사가 조정합니다. 보장·지급 여부를 판정하지 않습니다.</div>`;
    h += `</div>`;
    return h;
  }
  function rangeLine(m) {
    const out = [];
    try {
      if (root.BojangPriority && root.BojangPriority.rangeGap(m, 'heart')) out.push('심장 범위 공백');
      if (root.BojangPriority && root.BojangPriority.rangeGap(m, 'brain')) out.push('뇌혈관 범위 공백');
    } catch (e) { /* 무시 */ }
    if (!out.length) out.push(`실손 ${S.silson === 'none' ? '없음' : S.silson + '세대'}`);
    return out.join(' · ') + ' — 코드 카드에서 확인';
  }
  function name0(m) { return m.client.name + '님'; }

  /* ---------- 3. 먼저 확인할 항목 ---------- */
  function stagePlan(m) {
    const plan = planOf(m);
    const list = plan ? plan.order : m.rows.map((r) => ({ key: r.item.key, name: r.item.name, order: r.item.rank, pct: r.pct, hold: false, row: r, gaps: r.gaps, touch: { code: '확인형' } }));
    let h = `<div class="live-stage">`;
    h += `<div class="live-note">이 고객 순서대로 엽니다. <b>한 번에 두 개를 설명하지 않습니다.</b> 결정은 한 칸씩 받습니다.</div>`;
    list.forEach((e, i) => {
      const open = i === openPri;
      const row = e.row || m.rows.find((r) => r.item.key === e.key);
      h += `<button type="button" class="live-pri ${open ? 'is-open' : ''}" data-open-pri="${i}">
        <span class="lp-rank">${e.hold ? 'H' : e.order}</span>
        <span class="lp-main"><span class="lp-name">${e.name}</span><span class="lp-sum">${row.summary}</span></span>
        <span class="lp-pct">${e.pct}%</span>
        <span class="lp-badge ${row.level}">${e.hold ? '유지·조건' : (e.touch ? e.touch.code : row.label)}</span>
      </button>`;
      if (open) h += `<div class="live-pri-body">${e.hold ? holdBody(m, row) : planBody(m, row, e)}</div>`;
    });
    h += `</div>`;
    return h;
  }

  function costBlock(key) {
    const E = root.BojangEvidence;
    if (!E || !E.COSTS[key]) return '';
    const c = E.COSTS[key];
    const r0 = c.rows[0];
    if (!r0) return '';
    return `<div class="live-list">
      <div class="live-li"><i></i><span><b>${r0.label} ${r0.code}</b> — 1인당 ${won(r0.value)}만원${r0.days ? ` · 평균 ${r0.days}일` : ''}</span></div>
      ${(c.extra || []).slice(0, 1).map((x) => `<div class="live-li"><i></i><span>${x.label}: <b>${x.value}</b></span></div>`).join('')}
      <div class="live-li"><i></i><span style="font-size:12.5px;color:#5b7a74;">출처 ${c.src}</span></div>
    </div>`;
  }

  function planBody(m, row, e) {
    const E = root.BojangEvidence;
    const name = m.client.name;
    let h = '';
    h += `<div class="live-card hl"><h3>① 지금 상태</h3>
      <p>${row.summary}</p>
      ${row.gaps.length ? `<div class="live-list">${row.gaps.slice(0, 3).map((g) => `<div class="live-li"><i></i><span>${g.label}: <b>${won(g.val)}만원</b> → 기준 ${won(g.rec)}만원 <b>(${won(g.need)}만원 부족)</b></span></div>`).join('')}</div>` : '<p>금액은 기준선을 넘었습니다. 세부 조건(코드・지급 횟수)을 확인합니다.</p>'}
      ${scriptBox(judgeLike(m, row, e))}</div>`;
    h += `<div class="live-card"><h3>② 비용 근거 — 왜 이 금액인가</h3>${costBlock(e.key)}</div>`;
    if (E && E.BANDS[e.key]) {
      h += `<div class="live-card"><h3>③ 코드·구조에서 갈리는 지점</h3>
        <div class="live-list">${E.BANDS[e.key].points.map((p) => `<div class="live-li"><i></i><span>${p}</span></div>`).join('')}</div>
        <p style="font-size:12.5px;color:#5b7a74;margin-top:6px;">코드 해석은 약관 분류표 기준이며 지급 판정이 아닙니다.</p></div>`;
    }
    const cs = E ? E.byArea(e.key)[0] : null;
    if (cs) {
      h += `<div class="live-card"><h3>④ 사례 — ${cs.type}</h3>
        <p><b>${cs.title}</b></p>
        <div class="live-list">
          <div class="live-li"><i></i><span>상황 ${cs.fact}</span></div>
          <div class="live-li"><i></i><span>결과 ${cs.result}</span></div>
          <div class="live-li"><i></i><span><b>갈린 이유</b> ${cs.reason}</span></div>
          <div class="live-li"><i></i><span style="font-size:12.5px;color:#5b7a74;">출처 ${cs.source}</span></div>
        </div></div>`;
    }
    h += `<div class="live-card"><h3>⑤ 3안 — 금액은 고객이</h3>${designTable(m, row)}</div>`;
    if (E) {
      const objs = (e.objections || []).map((id) => E.objection(id)).filter(Boolean);
      if (objs.length) {
        h += `<div class="live-card"><h3>⑥ 예상 반론</h3>
          <div class="live-list">${objs.map((o) => `<div class="live-li"><i></i><span><b>${o.q}</b> — ${o.a} <span style="color:#5b7a74;">(${o.ev})</span></span></div>`).join('')}</div></div>`;
      }
    }
    h += `<div class="live-note">다음 단계로 넘어가기 전 확인 — <b>${name}님이 "${row.item.name}이 비어 있다"는 것을 자기 말로 확인했는가.</b></div>`;
    return h;
  }

  function holdBody(m, row) {
    return `<div class="live-card hl"><h3>유지 · 조건 확인</h3>
      <p><b>${row.pct}%</b> — 금액은 기준선을 넘었습니다. 추가 가입은 과보장이 될 수 있어 권하지 않고, 지급 조건·중복·갱신만 확인합니다.</p>
      <div class="live-list">
        <div class="live-li"><i></i><span>담보명의 코드 범위를 증권에서 확인</span></div>
        <div class="live-li"><i></i><span>같은 이름 특약 2개 이상인지(중복) 확인</span></div>
        <div class="live-li"><i></i><span>갱신 시점·만기(80·90세) 확인</span></div>
      </div></div>`;
  }

  function judgeLike(m, row, e) {
    const g = row.gaps[0];
    const base = `${m.client.name}님 ${row.item.name}은 지금 기준의 ${row.pct}%입니다.`;
    return g ? `${base} 먼저 확인할 한 칸은 ${g.label} ${won(g.need)}만원입니다.` : `${base} 금액은 기준선 위이니 지급 조건(코드·횟수)을 확인하겠습니다.`;
  }

  function designTable(m, row) {
    const k = row.item.key;
    const PK = (key) => row.r.parts.find((p) => p.key === key) || { val: 0, rec: 0, subs: [], option: null };
    const subHave = (p) => (p.subs || []).filter((s) => s.val > 0).length;
    const rows = [];
    if (k === 'cancer') {
      rows.push(['일반암 진단비', `${won(m.state.cov.cancer.general)}만원`, `${won(PK('general').rec)}만원 (최소 3,000·충분 1억)`]);
      rows.push(['유사암 진단비', m.state.cov.cancer.similar ? `${won(m.state.cov.cancer.similar)}만원` : '없음', `${won(PK('similar').rec)}만원`]);
      rows.push(['주요치료비 5종', `${won(PK('treatment').val)}만원 (${subHave(PK('treatment'))}/5종)`, `${won(PK('treatment').rec)}만원`]);
      (PK('treatment').subs || []).forEach((s) => rows.push([`　${s.label}`, s.val ? `${won(s.val)}만원` : '없음', `${won(s.rec)}만원`]));
      rows.push(['재진단·전이', m.state.cov.cancer.recur ? '보유' : '없음', '보유 권장']);
    } else if (k === 'brain' || k === 'heart') {
      const dxp = PK('dx');
      const d = dxp.dx || {};
      const core = d.core || { val: 0, label: '핵심 범위' };
      rows.push([core.label, core.val ? `${won(core.val)}만원` : '없음', `권장 ${won(dxp.rec)}만원`]);
      (dxp.subs || []).filter((x) => !x.isCore).forEach((x) => rows.push([`　${x.label}`, x.val ? `${won(x.val)}만원` : '없음', `${won(x.rec)}만원`]));
      rows.push(['진단 시 합산', (d.scenarios || []).map((sc) => `${sc.label} ${won(sc.sum)}`).join(' · '), '포함관계 확인']);
      rows.push(['주요치료비 3종', `${subHave(PK('treat'))}/3종 · ${won(PK('treat').val)}만원`, `${won(PK('treat').rec)}만원`]);
      (PK('treat').subs || []).forEach((s) => rows.push([`　${s.label}`, s.val ? `${won(s.val)}만원` : '없음', `${won(s.rec)}만원`]));
      if (root.BojangModel && root.BojangModel.mainOf(m.state, k) > 0) {
        rows.push(['주요치료비(통합형)', `${won(BojangModel.mainOf(m.state, k))}만원${BojangModel.mainSharedOf(m.state, k) ? ' (뇌·심장 공통)' : ''}`, '단독 치료비와 별도 확인']);
      }
    } else if (k === 'surgery') {
      const sg = m.state.cov.surgery;
      rows.push(['질병수술비(일반)', `${won(sg.disease)}만원`, `권장 ${won(PK('disease').rec)}만원`]);
      rows.push(['질병 1~5종', `${won(sg.disease15)}만원${BojangModel.tier5Range(m.state, 'disease15') ? ` (${BojangModel.tier5Range(m.state, 'disease15')})` : ''}`, `권장 ${won(PK('disease15').rec)}만원`]);
      rows.push(['질병 N대', sg.diseaseNdae ? `${won(sg.diseaseNdae)}만원` : '없음', `권장 ${won(PK('diseaseNdae').rec)}만원`]);
      rows.push(['비급여 질병 수술', sg.diseaseNonPay ? `${won(sg.diseaseNonPay)}만원` : '없음', `권장 ${won(PK('diseaseNonPay').rec)}만원`]);
      rows.push(['일반 상해수술', `${won(sg.injury)}만원`, `권장 ${won(PK('injury').rec)}만원`]);
      rows.push(['상해 1~5종', `${won(sg.injury15)}만원${BojangModel.tier5Range(m.state, 'injury15') ? ` (${BojangModel.tier5Range(m.state, 'injury15')})` : ''}`, `권장 ${won(PK('injury15').rec)}만원`]);
    } else {
      const cg = m.state.cov.care;
      rows.push(['일반병원 간병일당', `${won(cg.daily)}만원`, `권장 ${won(PK('daily').rec)}만원 (5~20만원)`]);
      rows.push(['요양병원 간병일당', cg.nDaily ? `${won(cg.nDaily)}만원` : '없음', `권장 ${won(PK('nDaily').rec)}만원`]);
      rows.push(['지급 기준', { time: '시간 기준(8시간)', money: '금액 기준(7~8만원)', unknown: '미확인' }[cg.basis], cg.basis === 'time' ? '유지' : '증권 확인']);
      rows.push(['가족 간병', { yes: '인정', conditional: '업체등록·결제 필요', no: '불인정' }[cg.family], cg.family === 'yes' ? '유지' : '청구 조건 확인']);
      rows.push(['간호간병통합', cg.nursing ? '보유' : '없음', '보유 권장']);
      rows.push(['장기요양', cg.ltc ? '보유' : '없음', '3~5등급·인지지원']);
    }
    return `<div class="live-list">${rows.map((r) => `<div class="live-li"><i></i><span>${r[0]}: <b>${r[1]}</b> → ${r[2]}</span></div>`).join('')}</div>`;
  }

  /* ---------- 4. 반론 카드 ---------- */
  function stageObjection(m) {
    const E = root.BojangEvidence;
    const plan = planOf(m);
    const f = plan && plan.first;
    const list = E ? E.OBJECTIONS : [];
    let h = `<div class="live-stage">`;
    h += `<div class="live-note">고객이 말하기 전에 <b>내가 먼저 꺼내도 됩니다.</b> 대응 1문장 + 붙일 근거만 봅니다. 판정이 아니라 확인 후보입니다.</div>`;
    list.forEach((o, i) => {
      const open = i === openObj;
      h += `<div class="live-obj">
        <button type="button" class="live-obj-head" data-open-obj="${i}">
          <strong>${o.q}</strong><span class="caret">${open ? '−' : '+'}</span>
        </button>
        ${open ? `<div class="live-obj-body">
          <div class="live-step"><span class="st o">대응</span><p>${o.a}</p></div>
          <div class="live-step"><span class="st e">근거</span><p>${o.ev}</p></div>
          <div class="live-step"><span class="st a">이 고객</span><p>${f ? `${f.name} ${f.pct}% · 먼저 확인할 항목` : '5대 기준선 이상'}</p></div>
        </div>` : ''}
      </div>`;
    });
    h += `<div class="live-note">근거 출처 — 통계청 2024 사망원인통계 / 심평원 뇌혈관질환 진료현황(2023) / 건보공단 2025 주요수술·노인장기요양 통계연보(2026) / 산정특례 리플릿 / 금융위 5세대 실손 안내(2026.5.6). 반론이 <b>세 번 반복되면 오늘은 멈춥니다.</b></div>`;
    h += `</div>`;
    return h;
  }

  /* ---------- 5. 클로징 ---------- */
  function stageClose(m) {
    const name = m.client.name;
    let h = `<div class="live-stage">`;
    PLAN_CLOSE.stages.forEach((st) => {
      h += `<div class="live-card"><h3><span class="num">${st.n.replace('0', '')}</span>${st.t}</h3>
        ${scriptBox(st.text.replace(/\{name\}/g, name).replace(/\{grade\}/g, m.letter + ' 등급').replace(/\{first\}/g, m.first ? m.first.item.name + ' 한 칸' : '금액 조정').replace(/\{date\}/g, '다음 주'))}
        ${checklist(st.check)}</div>`;
    });
    h += `<div class="live-card"><h3>오늘 남길 것</h3>
      <div class="live-list">
        <div class="live-li"><i></i><span>결정한 것: <b>${m.first ? m.first.item.name + ' 보완 여부' : '금액 조정'}</b></span></div>
        <div class="live-li"><i></i><span>보낼 것: <b>고객용 ${m.needList.length > 2 ? '10장 상세' : '1장 요약'} PDF</b></span></div>
        <div class="live-li"><i></i><span>다음 연락: <b>날짜·시간 고객 입으로 확인</b></span></div>
      </div>
      <div style="display:grid;gap:7px;margin-top:10px;">
        <button type="button" class="live-next" style="max-width:none;" data-pdf-live="summary">📄 1장 요약 PDF 저장·공유</button>
        <button type="button" class="live-next" style="max-width:none;background:#1b4a78;border-color:#1b4a78;" data-pdf-live="detail">📚 10장 상세 PDF 저장·공유</button>
        <button type="button" class="live-next" style="max-width:none;background:#0f8a6f;border-color:#0f8a6f;" data-pdf-live="advisor">📘 30장 플랜북 PDF</button>
      </div>
    </div>`;
    h += `<div class="live-card"><h3>사후관리</h3>
      ${PLAN_CLOSE.aftercare.map((a) => `<div class="live-li"><i></i><span><b>${a.when}</b> — ${a.what}</span></div>`).join('')}
    </div>`;
    h += `<div class="live-card"><h3>소개 요청</h3>${scriptBox(PLAN_CLOSE.referral.text.replace(/\{name\}/g, name))}${checklist(PLAN_CLOSE.referral.check)}</div>`;
    h += `</div>`;
    return h;
  }

  /* ---------- 이벤트 ---------- */
  function bindHost(host) {
    $$('[data-copy]', host).forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = decodeURIComponent(b.dataset.copy);
        if (H && H.copy) H.copy(t, '문장을 복사했습니다');
      });
    });
    $$('[data-open-pri]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.openPri);
        openPri = openPri === i ? -1 : i;
        render();
      });
    });
    $$('[data-open-obj]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.openObj);
        openObj = openObj === i ? -1 : i;
        render();
      });
    });
    $$('[data-pri]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const idx = Array.from(PRIORITY).findIndex((p) => p.key === b.dataset.pri);
        openPri = idx;
        go(2);
      });
    });
    $$('[data-pdf-live]', host).forEach((b) => {
      b.addEventListener('click', () => {
        if (root.BojangApp && root.BojangApp.doPdf) root.BojangApp.doPdf(b.dataset.pdfLive);
      });
    });
  }

  root.BojangLive = { init, render, markDirty };
})(typeof window !== 'undefined' ? window : globalThis);
