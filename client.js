/* 보장분석 상담 가이드 v4 — 고객 화면 30장 프레젠테이션 엔진
   · 입력 폼·내부 대본 없이, 고객과 함께 넘기는 시각화 슬라이드 30장(01/30~30/30)
   · 앱 안에서는 캔버스 없이 HTML/SVG로 즉시 렌더 (PDF는 버튼을 눌렀을 때만 생성)
   · 좌우 스와이프 · 영역 점프 칩 · '부족 항목만 보기' 필터 · 상담자 복귀 잠금 */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const TONE = { ok: '#0e9c86', need: '#d9821b', gap: '#d9382f', warn: '#d9821b', info: '#1264b0' };
  const LEVEL = { enough: '충분', check: '점검', short: '부족', none: '없음' };

  const GROUPS = [
    { key: 'all', label: '전체', from: 1 },
    { key: 'summary', label: '요약', from: 1, to: 6 },
    { key: 'cancer', label: '암', from: 7, to: 11 },
    { key: 'brain', label: '뇌', from: 12, to: 15 },
    { key: 'heart', label: '심장', from: 16, to: 19 },
    { key: 'surgery', label: '수술', from: 20, to: 22 },
    { key: 'care', label: '간병', from: 23, to: 25 },
    { key: 'steady', label: '실손·노후', from: 26, to: 27 },
    { key: 'road', label: '로드맵', from: 28, to: 30 }
  ];

  let S = null, H = null, slides = [], cur = 0, needOnly = false, built = false, lastSig = '';

  /* =========================================================
     작은 SVG 부품
     ========================================================= */
  function ringSVG(score, letter, size) {
    const s = size || 132, R = s / 2 - 11, C = 2 * Math.PI * R;
    const dash = C * (1 - clamp(score, 0, 100) / 100);
    return `<svg viewBox="0 0 ${s} ${s}" class="sl-ring" role="img" aria-label="종합 점수 ${score}점">
      <defs><linearGradient id="rg4" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8ff0dc"/><stop offset="100%" stop-color="#0fb093"/></linearGradient></defs>
      <circle cx="${s / 2}" cy="${s / 2}" r="${R}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="9"/>
      <circle cx="${s / 2}" cy="${s / 2}" r="${R}" fill="none" stroke="url(#rg4)" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${dash.toFixed(1)}" transform="rotate(-90 ${s / 2} ${s / 2})"/>
      <text x="${s / 2}" y="${s / 2 - 2}" text-anchor="middle" class="sl-ring-num">${score}</text>
      <text x="${s / 2}" y="${s / 2 + 16}" text-anchor="middle" class="sl-ring-sub">${esc(letter)}</text>
    </svg>`;
  }

  function donutSVG(segs, center, label) {
    const total = segs.reduce((a, s) => a + s.value, 0) || 1;
    const R = 52, C = 2 * Math.PI * R;
    let off = 0;
    const arcs = segs.map((sg) => {
      const len = (sg.value / total) * C;
      const a = `<circle cx="64" cy="64" r="${R}" fill="none" stroke="${sg.color}" stroke-width="16"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 64 64)"/>`;
      off += len;
      return sg.value > 0 ? a : '';
    }).join('');
    return `<svg viewBox="0 0 128 128" class="sl-donut" role="img" aria-label="보장 항목 분포">
      <circle cx="64" cy="64" r="${R}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="16"/>
      ${arcs}
      <text x="64" y="60" text-anchor="middle" class="sl-donut-num">${center}</text>
      <text x="64" y="78" text-anchor="middle" class="sl-donut-sub">${esc(label)}</text>
    </svg>`;
  }

  function radarSVG(axes, o) {
    o = o || {};
    const size = o.size || 220, cx = size / 2, cy = size / 2 + 4, R = size * 0.32;
    const n = axes.length;
    const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pt = (i, k) => [cx + Math.cos(ang(i)) * R * k, cy + Math.sin(ang(i)) * R * k];
    const ring = (k) => axes.map((_, i) => pt(i, k).map((v) => v.toFixed(1)).join(',')).join(' ');
    let out = `<svg viewBox="0 0 ${size} ${size}" class="sl-radar" role="img" aria-label="보장 밸런스 레이더">`;
    [0.25, 0.5, 0.75, 1].forEach((k) => { out += `<polygon points="${ring(k)}" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="1"/>`; });
    axes.forEach((_, i) => {
      const p = pt(i, 1);
      out += `<line x1="${cx}" y1="${cy}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="rgba(255,255,255,.12)" stroke-width="1"/>`;
    });
    const dp = axes.map((a, i) => pt(i, clamp(a.value, 0.04, 1)));
    out += `<polygon points="${dp.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="rgba(143,240,220,.22)" stroke="#8ff0dc" stroke-width="2" stroke-linejoin="round"/>`;
    dp.forEach((p) => { out += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4" fill="#8ff0dc"/>`; });
    axes.forEach((a, i) => {
      const p = pt(i, 1.25);
      const anchor = p[0] < cx - 4 ? 'end' : p[0] > cx + 4 ? 'start' : 'middle';
      out += `<text x="${p[0].toFixed(1)}" y="${(p[1] + 2).toFixed(1)}" text-anchor="${anchor}" class="sl-radar-label">${esc(a.label)}</text>`;
      out += `<text x="${p[0].toFixed(1)}" y="${(p[1] + 13).toFixed(1)}" text-anchor="${anchor}" class="sl-radar-value">${Math.round(a.value * 100)}%</text>`;
    });
    out += `</svg>`;
    return out;
  }

  function bar(value, tone, label) {
    const pct = Math.round(clamp(value, 0, 1) * 100);
    return `<div class="sl-bar${tone ? ' tone-' + tone : ''}"><i style="width:${pct === 0 ? 0 : Math.max(2, pct)}%"></i></div>`;
  }

  function statTile(label, value, sub, tone) {
    return `<div class="sl-tile${tone ? ' tone-' + tone : ''}">
      <span class="st-label">${esc(label)}</span>
      <b class="st-value">${value}</b>
      ${sub ? `<span class="st-sub">${esc(sub)}</span>` : ''}
    </div>`;
  }

  function noteBox(text, tone) {
    return `<div class="sl-note${tone ? ' tone-' + tone : ''}">${text}</div>`;
  }

  function src(text) { return `<p class="sl-src">출처 · ${esc(text)}</p>`; }

  /* =========================================================
     슬라이드 정의
     ========================================================= */
  function buildSlides(m) {
    const out = [];
    const P = PRIORITY;
    const add = (no, group, priority, inner, opts) => {
      const extra = opts || {};
      out.push(Object.assign({ no, group, priority, inner }, extra));
    };
    const needOf = (key) => {
      const row = m.rows.find((r) => r.item.key === key);
      return row ? row.level !== 'ok' : false;
    };
    const rowOf = (key) => m.rows.find((r) => r.item.key === key);

    /* ---------- 01 표지 ---------- */
    add(1, 'summary', null, `
      <div class="cover">
        <div class="cover-eyebrow">LIFE REPORT · BOJANG ANALYSIS</div>
        <h1 class="cover-title">${esc(m.client.name)}님의<br>보장분석 리포트</h1>
        <p class="cover-lead">과도한 보장은 줄이고, 부족한 보장은 채우는<br>5대 담보 · 30장 시각화 리포트</p>
        <div class="cover-grade">
          <span class="cg-label">종합 보장등급</span>
          <b class="cg-letter">${m.letter}</b>
          <span class="cg-score">${m.score}점 / 100 · ${esc(m.grade.label)}</span>
        </div>
        <dl class="cover-meta">
          <div><dt>고객</dt><dd>${esc(m.client.name)}${m.client.insuranceAge != null ? ` · 보험나이 ${m.client.insuranceAge}세` : ` · ${esc(m.state.age)}대`}</dd></div>
          <div><dt>상령일</dt><dd>${m.client.ageDay ? `${m.client.ageDay.label} (D-${m.client.ageDay.days})` : '생년월일 미입력'}</dd></div>
          <div><dt>상담일</dt><dd>${esc(m.dateLabel || '-')}</dd></div>
          <div><dt>담당</dt><dd>${esc(m.client.consultant)}</dd></div>
        </dl>
        <div class="cover-foot">이 리포트는 상담 참고용이며, 실제 지급 여부와 금액은 가입한 상품의 약관과 증권이 기준입니다.</div>
      </div>`, {});

    /* ---------- 02 종합 등급 ---------- */
    const dn = m.counts;
    add(2, 'summary', null, `
      <div class="sl-head"><span class="k">01 · 종합</span><h2>보장 등급과 항목 분포</h2>
        <p>세부 표보다 먼저, 지금 보장이 어느 정도 채워져 있는지 한 장으로 봅니다.</p></div>
      <div class="score-hero">
        ${ringSVG(m.score, m.letter)}
        <div class="score-copy">
          <span class="grade-pill tone-${m.grade.tone}">${esc(m.grade.label)} · ${m.letter}</span>
          <h3>${esc(m.grade.line)}</h3>
          <p>${esc(BojangModel.oneLine(m.state, m))}</p>
        </div>
      </div>
      <div class="dist-row">
        ${donutSVG([
          { value: dn.enough, color: '#0e9c86' },
          { value: dn.check, color: '#d9821b' },
          { value: dn.short, color: '#d9382f' },
          { value: dn.none, color: '#93a2b4' }
        ], dn.total, '개 항목')}
        <ul class="dist-legend">
          <li><i style="background:#0e9c86"></i>충분<b>${dn.enough}</b></li>
          <li><i style="background:#d9821b"></i>점검<b>${dn.check}</b></li>
          <li><i style="background:#d9382f"></i>부족<b>${dn.short}</b></li>
          <li><i style="background:#93a2b4"></i>없음<b>${dn.none}</b></li>
        </ul>
      </div>
      <div class="tile-grid three">
        ${statTile('주요 진단비 합계', `${won(m.totalSum)}<em>만원</em>`)}
        ${statTile('월 보험료', `${won(m.premium)}<em>만원</em>`, `연 ${won(m.annual)}만원`)}
        ${statTile('연 보험료 대비', m.ratio ? `${m.ratio.toFixed(1)}<em>배</em>` : '—', '12배 이상이면 균형', m.ratio && m.ratio < 12 ? 'warn' : 'ok')}
      </div>`, {});

    /* ---------- 03 5대 우선순위 ---------- */
    add(3, 'summary', null, `
      <div class="sl-head"><span class="k">02 · 우선순위</span><h2>5대 담보, 어디부터 채울까</h2>
        <p>점수가 낮은 순서가 아니라, 실제 지출과 위험이 큰 순서로 봅니다.</p></div>
      <div class="pri-list">
        ${m.rows.map((r) => `
          <div class="pri-row tone-${r.level}">
            <span class="pri-rank">${r.item.rank}</span>
            <div class="pri-body">
              <div class="pri-top"><strong>${esc(r.item.name)}</strong><span class="pri-sub">${esc(r.item.sub)}</span>
                <span class="pri-pct">${r.pct}%</span></div>
              ${bar(r.r.fill, r.level)}
              <div class="pri-sum">${esc(r.summary)}</div>
            </div>
            <span class="pri-badge tone-${r.level}">${esc(r.label)}</span>
          </div>`).join('')}
      </div>
      ${m.first
        ? `<div class="first-call"><span>먼저 채울 곳</span><b>${m.first.item.rank}순위 ${esc(m.first.item.name)}</b>
           <em>${m.first.pct}% · ${esc(m.first.label)}${m.first.gaps.length ? ` · ${won(m.first.gaps[0].need)}만원 부족` : ''}</em></div>`
        : noteBox('5대 담보가 기준선을 넘었습니다. 이제는 금액 조정과 갱신 대비가 남은 과제입니다.', 'ok')}`, {});

    /* ---------- 04 보유 계약 ---------- */
    const cs = m.contractStats;
    add(4, 'summary', null, `
      <div class="sl-head"><span class="k">03 · 포트폴리오</span><h2>보유 계약 ${cs.count ? `${cs.count}건` : ''}</h2>
        <p>월 보험료가 어느 계약에서 나가는지, 납입은 끝났는지, 만기는 언제인지 확인합니다.</p></div>
      ${cs.count ? `
        <div class="dk-ct-list">
          ${m.contracts.slice(0, 7).map((c) => `
            <div class="dk-ct-row">
              <div class="dk-ct-main">
                <div class="dk-ct-top"><strong>${esc(c.insurer || '보험사 미입력')}</strong>
                  <span class="dk-ct-renew ${c.renew ? 'is-renew' : ''}">${c.renew ? '갱신형' : '비갱신'}</span></div>
                <div class="dk-ct-prod">${esc(c.product || '상품명 미입력')}</div>
                <div class="dk-ct-meta"><span class="dk-ct-pay ${c.pay === '납입완료' ? 'is-done' : ''}">${esc(c.pay || '납입중')}</span>
                  <span>만기 ${esc(c.maturity || '미입력')}</span></div>
              </div>
              <b class="dk-ct-prem">${won(c.premium)}<em>만원</em></b>
            </div>`).join('')}
          ${cs.count > 7 ? `<p class="sl-src">외 ${cs.count - 7}건은 상담자 화면과 10장 상세 리포트에 있습니다.</p>` : ''}
        </div>
        <div class="tile-grid three">
          ${statTile('월 보험료 합계', `${won(cs.total)}<em>만원</em>`, `계약 ${cs.count}건`)}
          ${statTile('납입중', `${won(cs.activePremium)}<em>만원</em>`, `${cs.activeCount}건`)}
          ${statTile('납입완료', `${cs.paidUpCount}<em>건</em>`, cs.paidUpCount ? '보장만 유지 중' : '없음', 'ok')}
        </div>
        <div class="mini-note">
          <span>갱신형 비중 <b>${cs.renewShare}%</b></span>
          ${bar(cs.renewShare / 100, cs.renewShare >= 60 ? 'need' : 'ok')}
          ${cs.shortMaturityCount ? `<span class="warn-text">만기 80·90세 계약 ${cs.shortMaturityCount}건 — 노후에 보장이 먼저 끊깁니다</span>` : '<span class="ok-text">만기 100세·종신 중심이면 노후 유지에 유리합니다</span>'}
        </div>`
        : noteBox('계약을 입력하면 이 장이 포트폴리오 표로 채워집니다. 증권의 보험사·상품명·월 보험료·납입상태·만기를 함께 적습니다.', 'info')}`, {});

    /* ---------- 05 월 보험료 배분 ---------- */
    const alloc = [
      { label: '진단비', v: 45, color: '#0b2545' },
      { label: '치료·수술', v: 20, color: '#1264b0' },
      { label: '실손', v: 25, color: '#3b8fd4' },
      { label: '간병·기타', v: 10, color: '#0fb093' }
    ];
    add(5, 'summary', null, `
      <div class="sl-head"><span class="k">04 · 배분</span><h2>월 보험료 배분</h2>
        <p>같은 보험료라도 어디에 얼마가 들어가는지가 보장의 두께를 바꿉니다.</p></div>
      <div class="alloc-wrap">
        <div class="alloc-bar">
          ${alloc.map((a) => `<i style="width:${a.v}%;background:${a.color}">${a.v}%</i>`).join('')}
        </div>
        <ul class="alloc-legend">
          ${alloc.map((a) => `<li><i style="background:${a.color}"></i>${a.label}<b>${a.v}%</b></li>`).join('')}
        </ul>
      </div>
      <div class="tile-grid two">
        ${statTile('현재 월 보험료', `${won(m.premium)}<em>만원</em>`, `연 ${won(m.annual)}만원`)}
        ${statTile('계약 합계', cs.count ? `${won(cs.total)}<em>만원</em>` : '—', cs.count ? `계약 ${cs.count}건` : '계약 미입력')}
      </div>
      ${noteBox('위 배분은 상품·연령에 따라 달라지는 <b>권장 예시</b>입니다. 배분을 바꾸는 방법은 해지가 아니라 특약 정리(배서)이고, 아낀 보험료는 가장 비어 있는 칸으로 옮깁니다.', 'info')}`, {});

    /* ---------- 06 4축 레이더 ---------- */
    const axis = (key) => {
      const r = rowOf(key);
      return r ? r.r.fill : 0;
    };
    const axes4 = [
      { label: '진단비', value: (axis('cancer') + axis('brain') + axis('heart')) / 3 },
      { label: '치료·수술', value: (rowOf('surgery').r.fill + rowOf('brain').r.parts[1].fill + rowOf('heart').r.parts[1].fill + rowOf('cancer').r.parts[2].fill) / 4 },
      { label: '실손', value: m.state.silson === 'none' ? 0 : 1 },
      { label: '간병·요양', value: (axis('care') + (m.state.cov.care.ltc ? 1 : 0)) / 2 }
    ];
    add(6, 'summary', null, `
      <div class="sl-head"><span class="k">05 · 밸런스</span><h2>4축 보장 밸런스</h2>
        <p>한쪽만 두꺼우면 실제 지출 앞에서 빈틈이 생깁니다. 네 축을 함께 봅니다.</p></div>
      <div class="radar-wrap">${radarSVG(axes4, { size: 300 })}</div>
      <ul class="axis-list">
        ${axes4.map((a) => `<li><span>${a.label}</span>${bar(a.value, a.value >= 0.9 ? 'ok' : a.value >= 0.5 ? 'need' : 'gap')}<b>${Math.round(a.value * 100)}%</b></li>`).join('')}
      </ul>
      ${noteBox(`${axes4.slice().sort((a, b) => a.value - b.value)[0].label} 축이 가장 얇습니다. 이 축부터 한 칸 채우면 전체 균형이 가장 빠르게 좋아집니다.`, 'info')}`, {});

    /* ---------- 07 암 현재 vs 권장 ---------- */
    const cr = rowOf('cancer');
    add(7, 'cancer', 'cancer', `
      <div class="sl-head"><span class="k">1순위 · 암</span><h2>암 보장, 지금 vs 권장</h2>
        <p>진단비(목돈)와 치료비(장기)를 나눠서 봅니다. 네 칸이 모두 있어야 빈틈이 없습니다.</p></div>
      <div class="cmp-grid">
        ${[
          { label: '일반암 진단비', p: cr.r.parts[0] },
          { label: '유사암 진단비', p: cr.r.parts[1] },
          { label: '암 주요치료비', p: cr.r.parts[2] }
        ].map((c) => `
          <div class="cmp-card">
            <span class="cc-label">${c.label}</span>
            <div class="cc-values"><b${Number(c.p.val) > 0 ? '' : ' class="bool off"'}>${Number(c.p.val) > 0 ? `${won(c.p.val)}<em>만원</em>` : '없음'}</b><span>권장 ${won(c.p.rec)}만원</span></div>
            ${bar(c.p.fill, c.p.fill >= 0.99 ? 'ok' : c.p.fill > 0 ? 'need' : 'gap')}
            <span class="cc-pct">충족 ${Math.round(c.p.fill * 100)}%</span>
          </div>`).join('')}
        <div class="cmp-card">
          <span class="cc-label">재진단·전이 보장</span>
          <div class="cc-values"><b class="bool ${cr.r.parts[3].val ? 'on' : 'off'}">${cr.r.parts[3].val ? '보유' : '없음'}</b><span>두 번째 진단 대비</span></div>
          ${bar(cr.r.parts[3].val ? 1 : 0, cr.r.parts[3].val ? 'ok' : 'gap')}
          <span class="cc-pct">${cr.r.parts[3].val ? '준비됨' : '1회한이면 재발 시 지급 없음'}</span>
        </div>
      </div>
      ${cr.gaps.length ? noteBox(`부족분 — ${cr.gaps.map((g) => `${g.label} ${won(g.need)}만원`).join(' · ')}`, 'warn') : noteBox('주요 금액은 기준선을 넘었습니다. 다음은 재진단·지급 횟수 점검입니다.', 'ok')}`, { need: needOf('cancer') });

    /* ---------- 08 암 보장 구조 ---------- */
    add(8, 'cancer', 'cancer', `
      <div class="sl-head"><span class="k">1순위 · 암</span><h2>일반암 · 유사암 · 치료비 구조</h2>
        <p>같은 "암"이라도 담보가 다릅니다. 어디에 들어가는 암인지에 따라 지급액이 달라집니다.</p></div>
      <div class="struct">
        <div class="struct-box">
          <div class="sb-head"><b>일반암</b><span>C00~C97</span></div>
          <p>악성신생물 분류표 전체에서 유사암을 뺀 범위. 진단비 100% 기준입니다.</p>
          <div class="sb-inner">
            <div class="sb-inner-head">유사암 4종 · 별도 담보</div>
            <div class="code-chips">
              <span>C73 갑상선</span><span>C44 기타피부</span><span>D00~D09 제자리</span><span>D37~D48 경계성</span>
            </div>
            <p class="sb-note">일반암보다 낮은 금액. 담보가 없으면 지급액이 0원일 수 있습니다.</p>
          </div>
        </div>
        <div class="struct-side">
          <div class="side-card"><span>진단비</span><b>진단 순간 목돈</b><p>치료로 일을 쉬는 동안의 생활비·소득 공백을 메웁니다.</p></div>
          <div class="side-card"><span>주요치료비</span><b>치료 기간의 비용</b><p>표적·면역항암, 방사선, 비급여 치료는 진단비와 별도 축입니다.</p></div>
          <div class="side-card"><span>재진단</span><b>두 번째 진단</b><p>1회한 담보는 한 번 지급되면 끝입니다. 재발·전이는 별도 담보가 필요합니다.</p></div>
        </div>
      </div>`, { need: needOf('cancer') });

    /* ---------- 09 국가암등록통계 ---------- */
    add(9, 'cancer', 'cancer', `
      <div class="sl-head"><span class="k">1순위 · 암</span><h2>숫자로 보는 암</h2>
        <p>암은 "짧게 끝나는 병"이 아니라 진단 후 오래 관리하는 병입니다.</p></div>
      <div class="big-stat">
        <span class="bs-label">5년 상대생존율</span>
        <b class="bs-value">73.7<em>%</em></b>
        <p class="bs-desc">진단받은 사람 10명 중 7명 이상이 5년 뒤에도 생존합니다. 그래서 치료비와 소득 공백이 오래 이어집니다.</p>
      </div>
      <div class="tile-grid two">
        ${statTile('사망원인 1위', '24.8<em>%</em>', '암 — 통계청 2024')}
        ${statTile('3대 중증질환 합산', '41.1<em>%</em>', '암·심장·뇌혈관')}
      </div>
      <div class="pct-rows">
        <div class="pct-row"><span>남자 평생 발생 확률</span><div class="pr-track"><i style="width:44.6%"></i></div><b>44.6%</b></div>
        <div class="pct-row"><span>여자 평생 발생 확률</span><div class="pr-track"><i style="width:38.2%"></i></div><b>38.2%</b></div>
      </div>
      ${src('보건복지부·중앙암등록본부 2023 국가암등록통계 · 통계청 2024 사망원인통계')}`, { need: needOf('cancer') });

    /* ---------- 10 암 치료비·소득 공백 ---------- */
    add(10, 'cancer', 'cancer', `
      <div class="sl-head"><span class="k">1순위 · 암</span><h2>치료비와 소득 공백</h2>
        <p>병원비는 실손이 일부 막아줍니다. 하지만 일을 못 해서 생기는 돈은 실손이 메우지 못합니다.</p></div>
      <ol class="flow">
        <li><span>진단</span><b>치료 일정이 시작</b><p>수술·항암·방사선 일정이 잡히고, 그 기간 일을 쉬게 됩니다.</p></li>
        <li><span>치료</span><b>비급여가 커지는 구간</b><p>표적·면역항암, 비급여 주사·검사는 실손 한도와 자기부담이 따로 붙습니다.</p></li>
        <li><span>회복</span><b>5년 정기검진</b><p>치료가 끝나도 검진과 관리가 이어집니다. 소득은 천천히 돌아옵니다.</p></li>
      </ol>
      <div class="two-col">
        <div class="col-card ok"><b>실손이 메우는 것</b><p>입원·통원 의료비 중 급여와 한도 내 비급여. 쓴 만큼 돌려받는 구조입니다.</p></div>
        <div class="col-card gap"><b>실손이 못 메우는 것</b><p>일을 못 해 생기는 소득 공백, 한도 밖 비급여, 간병·생활비. 그래서 진단비가 필요합니다.</p></div>
      </div>
      ${noteBox('5세대 실손은 비중증 비급여가 연 1,000만원·자기부담 50%입니다. 치료가 길어지면 이 한도가 먼저 걸립니다.', 'info')}`, { need: needOf('cancer') });

    /* ---------- 11 암 보완 방향 ---------- */
    add(11, 'cancer', 'cancer', `
      <div class="sl-head"><span class="k">1순위 · 암</span><h2>암 보완 방향</h2>
        <p>한 번에 다 채우지 않습니다. 지금 비어 있는 칸부터 순서대로.</p></div>
      <ol class="steps-list">
        <li><b>① 유사암 칸</b><p>갑상선·제자리·경계성은 일반암에서 빠집니다. 별도 담보가 없으면 0원입니다.</p><em>${cr.r.parts[1].val ? `현재 ${won(cr.r.parts[1].val)}만원` : '현재 없음'} → 권장 ${won(cr.r.parts[1].rec)}만원</em></li>
        <li><b>② 치료비 칸</b><p>표적·면역항암 시대에는 진단비만으로 부족합니다. 비급여 치료를 별도 축으로 둡니다.</p><em>${cr.r.parts[2].val ? `현재 ${won(cr.r.parts[2].val)}만원` : '현재 없음'} → 권장 ${won(cr.r.parts[2].rec)}만원</em></li>
        <li><b>③ 재진단 칸</b><p>1회한 담보는 재발·전이 때 다시 나오지 않습니다. 두 번째 진단을 따로 준비합니다.</p><em>${cr.r.parts[3].val ? '보유' : '없음'} → 보유 권장</em></li>
      </ol>
      ${noteBox('가입 직후 90일은 보장이 시작되지 않고, 1년 안에 진단되면 절반만 지급되는 상품이 많습니다. 시작 시점을 함께 확인합니다.', 'warn')}
      ${src('권장 금액은 상담 보조용 예시이며, 실제 인수 조건과 보험료는 상품별로 다릅니다.')}`, { need: needOf('cancer') });

    /* ---------- 12 뇌 현재 vs 권장 ---------- */
    const br = rowOf('brain');
    const brainScope = br.r.parts[0].option || { label: '미보유' };
    add(12, 'brain', 'brain', `
      <div class="sl-head"><span class="k">2순위 · 뇌</span><h2>뇌 보장, 어디까지 담았나</h2>
        <p>이름이 비슷한 세 담보가 있습니다. 뒤로 갈수록 보장 범위가 넓습니다.</p></div>
      <div class="concentric-wrap">
        <svg viewBox="0 0 300 260" class="sl-concentric" role="img" aria-label="뇌혈관질환·뇌졸중·뇌출혈 포함관계">
          <circle cx="150" cy="130" r="118" fill="#123b66"/>
          <circle cx="150" cy="130" r="86" fill="#1b5a8a"/>
          <circle cx="150" cy="130" r="54" fill="#2f86b8"/>
          <text x="150" y="42" text-anchor="middle" class="cg-t">뇌혈관질환</text>
          <text x="150" y="56" text-anchor="middle" class="cg-s">I60~I69 · 후유증 포함</text>
          <text x="150" y="86" text-anchor="middle" class="cg-t">뇌졸중</text>
          <text x="150" y="99" text-anchor="middle" class="cg-s">I60~I64</text>
          <text x="150" y="126" text-anchor="middle" class="cg-t">뇌출혈</text>
          <text x="150" y="139" text-anchor="middle" class="cg-s">I60~I62</text>
          <text x="150" y="168" text-anchor="middle" class="cg-s2">뇌경색 I63은 뇌졸중·뇌혈관에만</text>
        </svg>
        <div class="conc-side">
          <div class="side-card"><span>현재 보장</span><b>${esc(brainScope.label)}</b><p>${esc(brainScope.hint || '')} ${br.r.parts[1].val ? '· 뇌혈관 수술·치료비 보유' : '· 수술·치료비 없음'}</p></div>
          <div class="side-card"><span>권장 범위</span><b>뇌혈관질환 I60~I69</b><p>가장 흔한 뇌경색과 후유증까지 담는 범위입니다.</p></div>
          <div class="side-card"><span>충족도</span><b>${br.pct}%</b>${bar(br.r.fill, br.level)}</div>
        </div>
      </div>`, { need: needOf('brain') });

    /* ---------- 13 뇌 코드 비교 ---------- */
    add(13, 'brain', 'brain', `
      <div class="sl-head"><span class="k">2순위 · 뇌</span><h2>질병코드로 비교하기</h2>
        <p>증권의 담보명 뒤에 붙은 코드를 보면 실제 지급 범위가 보입니다.</p></div>
      <div class="code-table">
        <div class="ct-head"><span>담보</span><span>코드</span><span>지급 대상</span></div>
        ${[
          { n: '뇌혈관질환', c: 'I60~I69', d: '뇌출혈·뇌경색·협착·후유증(I69)까지' },
          { n: '뇌졸중', c: 'I60~I64', d: '뇌출혈 + 뇌경색(I63) + 상세불명(I64)' },
          { n: '뇌출혈', c: 'I60~I62', d: '거미막하·뇌내·기타 두개내 출혈' },
          { n: '뇌경색', c: 'I63', d: '뇌졸중·뇌혈관 담보에만 포함' }
        ].map((r) => `<div class="ct-line"><b>${r.n}</b><code>${r.c}</code><span>${r.d}</span></div>`).join('')}
      </div>
      ${noteBox(`지금 담보는 <b>${esc(brainScope.label)}</b>입니다. ${br.pct >= 100 ? '범위가 가장 넓습니다. 유지가 원칙입니다.' : '가장 흔한 뇌경색이 빠지는 구조인지 확인이 필요합니다.'}`, br.pct >= 100 ? 'ok' : 'warn')}
      ${src('KCD 한국표준질병·사인분류 기준 · 상품별 담보명과 지급 조건은 약관 확인')}`, { need: needOf('brain') });

    /* ---------- 14 심뇌 통계 ---------- */
    add(14, 'brain', 'brain', `
      <div class="sl-head"><span class="k">2순위 · 뇌</span><h2>막히는 쪽이 더 많습니다</h2>
        <p>가장 흔한 뇌혈관 사고는 출혈이 아니라 혈관이 막히는 뇌경색입니다.</p></div>
      <div class="ratio-hero">
        <div class="ratio-bars">
          <div class="rb"><span>뇌경색 I63</span><div class="rb-track"><i style="width:100%"></i></div><b>528,440명</b></div>
          <div class="rb"><span>뇌내출혈 I60~I62</span><div class="rb-track"><i style="width:19.6%;background:#d9821b"></i></div><b>103,375명</b></div>
        </div>
        <b class="ratio-big">약 5.1배</b>
      </div>
      <div class="tile-grid three">
        ${statTile('뇌경색 평균 입원', '62.7<em>일</em>')}
        ${statTile('1인당 진료비', '2,562<em>만원</em>')}
        ${statTile('뇌혈관 사망원인', '4위', '6.9% · 통계청 2024')}
      </div>
      ${noteBox('입원이 길고 후유증이 남는 병입니다. 진단비 하나로는 회복 기간의 생활비를 감당하기 어렵습니다.', 'info')}
      ${src('중앙심뇌혈관질환센터·건강보험통계 2023')}`, { need: needOf('brain') });

    /* ---------- 15 뇌 보완 방향 ---------- */
    add(15, 'brain', 'brain', `
      <div class="sl-head"><span class="k">2순위 · 뇌</span><h2>뇌 보완 방향</h2>
        <p>금액보다 범위가 먼저입니다. 좁은 담보를 넓히는 것이 출발점입니다.</p></div>
      <ol class="steps-list">
        <li><b>① 범위 정렬</b><p>뇌출혈 → 뇌졸중 → 뇌혈관질환 순으로 넓힙니다. 같은 보험료에서 범위를 바꾸는 방법이 있습니다.</p><em>현재 ${esc(brainScope.label)} → 권장 뇌혈관질환 I60~I69</em></li>
        <li><b>② 치료비 축</b><p>혈전용해술·스텐트는 약관상 "수술"이 아니어서 수술비가 안 나올 수 있습니다. 별도 치료비 담보가 필요합니다.</p><em>${br.r.parts[1].val ? '보유' : '없음'} → 보유 권장</em></li>
        <li><b>③ 회복 구간</b><p>살아남아도 장해가 남으면 후유장해 담보로 지급률을 평가합니다. 재활·간병은 5순위와 연결됩니다.</p><em>후유장해·간병 담보 함께 확인</em></li>
      </ol>
      ${m.family.indexOf('brain') >= 0 ? noteBox('가족력에 뇌혈관이 있습니다. 생활 요인(혈압·혈당)과 함께 범위를 넓게 잡는 편이 안전합니다.', 'warn') : noteBox('가족력이 없어도 고혈압·당뇨·흡연으로 발생합니다. 지금 건강할 때 범위를 정리하는 것이 순서입니다.', 'info')}`, { need: needOf('brain') });

    /* ---------- 16 심장 현재 vs 권장 ---------- */
    const hr = rowOf('heart');
    const heartScope = hr.r.parts[0].option || { label: '미보유' };
    add(16, 'heart', 'heart', `
      <div class="sl-head"><span class="k">3순위 · 심장</span><h2>심장은 "막힌 혈관"이 기준</h2>
        <p>협심증과 급성심근경색은 같은 심장 질환이지만 보험에서는 다른 담보입니다.</p></div>
      <div class="concentric-wrap">
        <svg viewBox="0 0 300 260" class="sl-concentric" role="img" aria-label="심장질환·허혈성심장질환·급성심근경색 포함관계">
          <circle cx="150" cy="130" r="118" fill="#7a1f1a"/>
          <circle cx="150" cy="130" r="86" fill="#b04237"/>
          <circle cx="150" cy="130" r="54" fill="#e0705f"/>
          <text x="150" y="42" text-anchor="middle" class="cg-t">심장질환</text>
          <text x="150" y="56" text-anchor="middle" class="cg-s">부정맥·판막·심부전</text>
          <text x="150" y="86" text-anchor="middle" class="cg-t">허혈성심장</text>
          <text x="150" y="99" text-anchor="middle" class="cg-s">I20~I25</text>
          <text x="150" y="126" text-anchor="middle" class="cg-t">급성심근경색</text>
          <text x="150" y="139" text-anchor="middle" class="cg-s">I21~I22</text>
          <text x="150" y="168" text-anchor="middle" class="cg-s2">협심증 I20은 허혈성 담보에만</text>
        </svg>
        <div class="conc-side">
          <div class="side-card"><span>현재 보장</span><b>${esc(heartScope.label)}</b><p>${esc(heartScope.hint || '')} ${hr.r.parts[1].val ? '· 심혈관 수술비 보유' : '· 수술비 없음'}</p></div>
          <div class="side-card"><span>권장 범위</span><b>허혈성심장질환 I20~I25</b><p>스텐트 시술이 이뤄지는 협심증 단계까지 담습니다.</p></div>
          <div class="side-card"><span>충족도</span><b>${hr.pct}%</b>${bar(hr.r.fill, hr.level)}</div>
        </div>
      </div>`, { need: needOf('heart') });

    /* ---------- 17 심장 위험요인 ---------- */
    add(17, 'heart', 'heart', `
      <div class="sl-head"><span class="k">3순위 · 심장</span><h2>심장 위험요인</h2>
        <p>심장질환은 사망원인 2위(9.4%)입니다. 위험요인은 대부분 관리 가능한 것들입니다.</p></div>
      <div class="risk-grid">
        ${['고혈압', '당뇨', '이상지질혈증', '흡연', '가족력', '스트레스·수면'].map((r, i) => `
          <div class="risk-card${m.family.indexOf('heart') >= 0 && r === '가족력' ? ' is-on' : ''}">
            <span class="rk-no">${i + 1}</span><b>${r}</b>
          </div>`).join('')}
      </div>
      <div class="callout-line">
        <b>스텐트 시술은 대부분 협심증 단계에서 이뤄집니다.</b>
        <p>급성심근경색 담보만 있으면 그 시술이 보장 밖입니다. 그래서 범위를 허혈성심장질환까지 넓히는 것입니다.</p>
      </div>
      ${src('통계청 2024 사망원인통계 · KCD 질병분류')}`, { need: needOf('heart') });

    /* ---------- 18 심장 보완 방향 ---------- */
    add(18, 'heart', 'heart', `
      <div class="sl-head"><span class="k">3순위 · 심장</span><h2>심장 보완 방향</h2>
        <p>범위를 넓히는 것이 먼저, 금액은 그다음입니다.</p></div>
      <ol class="steps-list">
        <li><b>① 범위</b><p>급성심근경색 → 허혈성심장질환(I20~I25)으로 넓힙니다. 같은 보험료 안에서 조정되는 경우가 많습니다.</p><em>현재 ${esc(heartScope.label)} → 권장 허혈성 I20~I25</em></li>
        <li><b>② 수술비</b><p>스텐트·관상동맥우회술이 수술비 지급 대상인지 약관의 수술 분류표로 확인합니다.</p><em>${hr.r.parts[1].val ? '보유' : '없음'} → 보유 권장</em></li>
        <li><b>③ 약값·관리</b><p>한 번 막히면 항혈전제를 오래 복용합니다. 진단비·수술비·약값을 함께 봅니다.</p><em>부정맥·판막·심부전 담보도 확인</em></li>
      </ol>
      ${m.family.indexOf('heart') >= 0 ? noteBox('가족력에 심장 질환이 있습니다. 스텐트 시술 구간이 담보에 들어 있는지가 핵심입니다.', 'warn') : noteBox('지금은 괜찮더라도, 괜찮을 때 넣어야 조건이 좋습니다. 범위만 넓히고 금액은 낮게 시작할 수 있습니다.', 'info')}`, { need: needOf('heart') });

    /* ---------- 19 3대질병 종합 비교 ---------- */
    add(19, 'heart', 'heart', `
      <div class="sl-head"><span class="k">3순위 · 심장</span><h2>3대 질병 종합 비교</h2>
        <p>암·뇌·심장을 같은 기준으로 놓고, 지금 어디가 비었는지 봅니다.</p></div>
      <div class="cmp-table">
        <div class="ct-head"><span>구분</span><span>사망원인</span><span>핵심 범위</span><span>지금</span></div>
        ${[
          { n: '암', d: '24.8% · 1위', s: 'C00~C97 + 유사암', r: rowOf('cancer') },
          { n: '뇌', d: '6.9% · 4위', s: 'I60~I69', r: rowOf('brain') },
          { n: '심장', d: '9.4% · 2위', s: 'I20~I25', r: rowOf('heart') }
        ].map((r) => `<div class="ct-line"><b>${r.n}</b><span>${r.d}</span><span>${r.s}</span><em class="tone-${r.r.level}">${r.r.pct}%</em></div>`).join('')}
      </div>
      <div class="big-stat slim">
        <span class="bs-label">3대 중증질환 합산 사망원인 비중</span>
        <b class="bs-value">41.1<em>%</em></b>
        <p class="bs-desc">10명 중 4명 이상이 암·심장·뇌혈관으로 사망합니다. 이 세 축이 보장의 중심인 이유입니다.</p>
      </div>
      ${src('통계청 2024 사망원인통계')}`, { need: needOf('heart') });

    /* ---------- 20 수술비 현재 vs 권장 ---------- */
    const sr = rowOf('surgery');
    add(20, 'surgery', 'surgery', `
      <div class="sl-head"><span class="k">4순위 · 수술비</span><h2>수술비, 두 축을 함께</h2>
        <p>1~5종은 수술의 침습도로, N대는 질환별 한도로 지급됩니다. 서로 다른 계약입니다.</p></div>
      <div class="venn-wrap">
        <div class="venn">
          <div class="v-circle left"><b>1~5종</b><span>침습도 분류</span><em>1종 고액 ~ 5종 소액</em></div>
          <div class="v-circle right"><b>N대</b><span>질환별 한도</span><em>21·22·30대 등</em></div>
          <div class="v-overlap">중복<br>청구</div>
        </div>
        <p class="venn-note">같은 수술에 두 담보가 각각 반응합니다. 한쪽만 있으면 큰 수술에서 금액이 얇아집니다.</p>
      </div>
      <div class="tile-grid three">
        ${statTile('질병 1~5종', `${won(m.state.cov.surgery.disease)}<em>만원</em>`, `권장 ${won(sr.r.parts[0].rec)}만원`)}
        ${statTile('N대 수술비', m.state.cov.surgery.nDae ? '보유' : '없음', '질환별 별도 한도')}
        ${statTile('상해수술비', m.state.cov.surgery.injury ? '보유' : '없음', '사고 수술 별도')}
      </div>`, { need: needOf('surgery') });

    /* ---------- 21 수술 사례 ---------- */
    add(21, 'surgery', 'surgery', `
      <div class="sl-head"><span class="k">4순위 · 수술비</span><h2>현장에서 자주 보는 수술</h2>
        <p>금액은 상품마다 다르므로 유형만 봅니다. 어떤 이름으로 청구되는지가 핵심입니다.</p></div>
      <div class="claim-list">
        ${CLAIM_TYPES.map((c, i) => `<div class="claim-card"><span class="cl-no">${i + 1}</span><div><b>${esc(c.t)}</b><p>${esc(c.d)}</p></div></div>`).join('')}
      </div>
      ${noteBox('수술확인서의 수술명이 약관 분류표와 일치해야 인정됩니다. 병원에 수술명을 정확히 적어달라고 요청하는 것이 첫 단계입니다.', 'info')}`, { need: needOf('surgery') });

    /* ---------- 22 수술비 보완 방향 ---------- */
    add(22, 'surgery', 'surgery', `
      <div class="sl-head"><span class="k">4순위 · 수술비</span><h2>수술비 보완 방향</h2>
        <p>수술비는 보조입니다. 큰 그림은 진단비·치료비로 잡고, 수술비는 빈틈을 막습니다.</p></div>
      <ol class="steps-list">
        <li><b>① 빈 축 찾기</b><p>1~5종만 있으면 N대를, N대만 있으면 1~5종을 채웁니다.</p><em>${sr.gaps.length ? sr.gaps.map((g) => g.label + ' ' + won(g.need) + '만원 부족').join(' · ') : '두 축이 모두 있습니다'}</em></li>
        <li><b>② 상해 축</b><p>질병 수술비만 있으면 사고로 다쳐 수술해도 지급되지 않습니다.</p><em>${m.state.cov.surgery.injury ? '보유' : '없음'} → 보유 권장</em></li>
        <li><b>③ 청구 동행</b><p>수술 후 수술확인서·진단서를 받아 분류표와 맞는지 먼저 확인합니다.</p><em>청구 소멸시효 3년</em></li>
      </ol>`, { need: needOf('surgery') });

    /* ---------- 23 간병 3갈래 ---------- */
    const car = rowOf('care');
    add(23, 'care', 'care', `
      <div class="sl-head"><span class="k">5순위 · 간병</span><h2>간병비, 세 가지 준비</h2>
        <p>진단비는 한 번 나오는 돈, 간병비는 매일 나가는 돈입니다.</p></div>
      <div class="care-grid">
        ${[
          { t: '간병인 사용일당', when: '입원 중', v: `${won(m.state.cov.care.daily)}만원`, note: m.state.cov.care.mode === 'step' ? '체증형 — 입원이 길수록 증액' : '일반형 — 일당 고정', fill: car.r.parts[0].fill },
          { t: '간호간병통합', when: '입원 중', v: m.state.cov.care.nursing ? '보유' : '없음', note: '보호자 없는 병동 · 별도 특약', fill: car.r.parts[1].fill },
          { t: '장기요양등급', when: '퇴원 후·노후', v: m.state.cov.care.ltc ? '보유' : '없음', note: '1~5등급 · 인지지원', fill: car.r.parts[2].fill }
        ].map((c) => `<div class="care-card${c.v === '없음' ? ' is-empty' : ''}">
            <span class="cc-when">${c.when}</span><b>${c.t}</b>
            <strong>${c.v}</strong><span class="cc-note">${c.note}</span>
            ${bar(c.fill, c.fill >= 0.99 ? 'ok' : c.fill > 0 ? 'need' : 'gap')}
          </div>`).join('')}
      </div>
      <div class="cheung">
        <b>체증형 vs 일반형</b>
        <p><span>일반형</span> 입원일수와 무관하게 일당 고정 · 짧은 입원에 유리</p>
        <p><span>체증형</span> 입원일수가 길어질수록 일당이 올라감 · 장기 입원 위험에 대비</p>
      </div>`, { need: needOf('care') });

    /* ---------- 24 건보공단 통계 ---------- */
    add(24, 'care', 'care', `
      <div class="sl-head"><span class="k">5순위 · 간병</span><h2>장기요양 등급 분포</h2>
        <p>1~2등급만 준비하면 대부분의 구간이 비어 있습니다.</p></div>
      <div class="big-stat">
        <span class="bs-label">3~5등급 + 인지지원 합계</span>
        <b class="bs-value">87.4<em>%</em></b>
        <p class="bs-desc">장기요양 인정자의 대부분이 3~5등급·인지지원 구간입니다. 이 구간을 담아야 실제로 쓰입니다.</p>
      </div>
      <div class="stk-bar">
        ${STATS.find((s) => s.id === 'ltc').stacked.map((s, i) => `<i style="width:${s.value}%;background:${['#0b2545', '#1b4a78', '#2f6fa3', '#4e90c0', '#8fbada', '#c9ddec'][i]}"><b>${s.value >= 8 ? s.value + '%' : ''}</b></i>`).join('')}
      </div>
      <ul class="stk-legend">
        ${STATS.find((s) => s.id === 'ltc').stacked.map((s, i) => `<li><i style="background:${['#0b2545', '#1b4a78', '#2f6fa3', '#4e90c0', '#8fbada', '#c9ddec'][i]}"></i>${s.label} ${s.value}%</li>`).join('')}
      </ul>
      <div class="tile-grid two">
        ${statTile('인정자 수', '123만 5,045<em>명</em>')}
        ${statTile('월평균 급여비', '154<em>만원</em>')}
      </div>
      ${src('건강보험공단 2025 노인장기요양보험 통계연보')}`, { need: needOf('care') });

    /* ---------- 25 치매·간병 보완 ---------- */
    add(25, 'care', 'care', `
      <div class="sl-head"><span class="k">5순위 · 간병</span><h2>치매·간병 보완 방향</h2>
        <p>노후에 가장 오래 나가는 돈은 치료비가 아니라 돌봄 비용입니다.</p></div>
      <ol class="steps-list">
        <li><b>① 장기요양 등급</b><p>3~5등급·인지지원까지 담는지 확인합니다. 1~2등급만 담으면 87.4% 구간이 비어 있습니다.</p><em>${m.state.cov.care.ltc ? '보유 — 등급 범위 확인' : '없음 → 보유 권장'}</em></li>
        <li><b>② 간병 일당</b><p>하반신 마비 등 장기 입원이 예상되면 체증형이 유리합니다. 실제 고용 증빙이 필요합니다.</p><em>현재 ${won(m.state.cov.care.daily)}만원 · 권장 ${won(car.r.parts[0].rec)}만원</em></li>
        <li><b>③ 신청 시점</b><p>65세 미만도 노인성 질병이면 장기요양 신청이 가능합니다. 등급 판정이 전제입니다.</p><em>65세 전후로 미리 확인</em></li>
      </ol>
      ${m.family.indexOf('dementia') >= 0 ? noteBox('가족력에 치매가 있습니다. 장기요양과 간병 일당을 가장 우선해서 준비하는 편이 좋습니다.', 'warn') : noteBox('가입 연령 제한과 인수 조건이 있습니다. 나이가 들수록 선택지가 줄어듭니다.', 'info')}`, { need: needOf('care') });

    /* ---------- 26 실손 세대 ---------- */
    const sil = m.state.silson;
    add(26, 'steady', null, `
      <div class="sl-head"><span class="k">실손·노후</span><h2>실손 1~5세대 비교</h2>
        <p>실손은 쓴 만큼 돌려받는 기본 의료비 축입니다. 세대에 따라 보장 폭과 보험료가 다릅니다.</p></div>
      <div class="sil-now">
        <span>이 고객의 실손</span>
        <b>${sil === 'none' ? '없음' : `${sil}세대`}</b>
        <p>${sil === 'none' ? '입원·통원 기본부터 막혀 있습니다. 진단비보다 실손이 먼저입니다.' : sil === '1' || sil === '2' ? '2026년 11월 제도 대상일 가능성이 큽니다. 가입 시기와 재가입 조건을 확인합니다.' : '유지가 답인 경우가 많습니다. 구조와 한도를 확인합니다.'}</p>
      </div>
      <div class="sil-table">
        <div class="ct-head"><span>구분</span><span>1·2세대</span><span>3·4세대</span><span>5세대</span></div>
        ${[
          ['급여', '구분 없이 넓게', '80%', '입원 20%·통원 20% 내외'],
          ['비급여', '폭넓게 보장', '70%', '중증 5천만·비중증 1천만'],
          ['자기부담', '0~20%', '20~30%', '비중증 50%'],
          ['재가입', '없음(2013.3 이전)', '5~15년', '5년']
        ].map((r) => `<div class="ct-line"><b>${r[0]}</b><span>${r[1]}</span><span>${r[2]}</span><span>${r[3]}</span></div>`).join('')}
      </div>
      ${(sil === '1' || sil === '2') ? noteBox('1·2세대라면 두 갈래가 있습니다. <b>A 선택형 할인 특약</b>(기존 유지·전부 선택 시 약 30~40% 할인) / <b>B 5세대 전환</b>(3년간 50% 할인·6개월 한시). 전환은 "보험료를 아끼는 결정"이지 "보장이 좋아지는 결정"이 아닙니다.', 'warn') : noteBox('세대별로 비급여 한도와 자기부담이 다릅니다. 지금 쓰는 의료(도수·주사·MRI)를 기준으로 유지 여부를 판단합니다.', 'info')}
      ${src('금융위원회 보도자료(2026.5.6) · 2026년 11월 시행 안내 · 상품별 약관 우선')}`, {});

    /* ---------- 27 갱신형 vs 비갱신형 ---------- */
    add(27, 'steady', null, `
      <div class="sl-head"><span class="k">실손·노후</span><h2>갱신형 vs 비갱신형</h2>
        <p>지금의 보험료가 앞으로도 같지는 않습니다. 구조를 알면 노후가 보입니다.</p></div>
      <div class="grid2">
        <div class="col-card need"><b>갱신형</b><p>가입 시 저렴 · 갱신 때 인상 · 갱신 시 건강 상태 재심사 · 거절 위험</p></div>
        <div class="col-card ok"><b>비갱신형</b><p>가입 시 비쌈 · 보험료 일정 · 재심사 없음 · 만기 후 보장 공백</p></div>
      </div>
      ${cs.count ? `<div class="mini-note">
        <span>갱신형 비중 <b>${cs.renewShare}%</b></span>${bar(cs.renewShare / 100, cs.renewShare >= 60 ? 'need' : 'ok')}
        <span>만기 분포 ${Object.keys(cs.maturity).map((k) => `${k} ${cs.maturity[k]}건`).join(' · ')}</span>
      </div>` : ''}
      <div class="timeline">
        ${[
          { t: '현재', d: m.client.insuranceAge != null ? `보험나이 ${m.client.insuranceAge}세` : `${m.state.age}대` },
          { t: '상령일', d: m.client.ageDay ? `${m.client.ageDay.label}<br>D-${m.client.ageDay.days}` : '생년월일 입력 시' },
          { t: '갱신', d: '보험료 재산정<br>인수 심사' },
          { t: '65세', d: '장기요양<br>신청 가능' },
          { t: '만기', d: '보장 공백<br>재가입 제한' }
        ].map((x) => `<div class="tl-item"><b>${x.t}</b><span>${x.d}</span></div>`).join('')}
      </div>
      ${m.client.ageDay ? noteBox(`상령일 ${m.client.ageDay.label}까지 D-${m.client.ageDay.days}. 이 날이 지나면 보험나이가 ${m.client.ageDay.insuranceAgeAfter}세가 되어 같은 보장도 보험료가 달라질 수 있습니다.`, 'warn') : ''}
      ${src('갱신 시점·예상 보험료는 증권의 갱신 보험료 표로 확인합니다.')}`, {});

    /* ---------- 28 보조보장 ---------- */
    add(28, 'road', null, `
      <div class="sl-head"><span class="k">보조보장</span><h2>놓치기 쉬운 보조보장</h2>
        <p>큰 담보를 채운 뒤에 남는 빈틈입니다. 진단비 다음에 확인할 항목입니다.</p></div>
      <div class="aux-grid">
        ${[
          { t: '후유장해', d: '뇌졸중·사고 후 장해 지급률 평가', n: '진단비와 별도' },
          { t: '배상책임', d: '가족·반려동물 사고 배상', n: '생활배상 특약' },
          { t: '운전자', d: '교통사고 처리 지원금·벌금·변호사', n: '자동차와 별개' },
          { t: '골절·화상', d: '상해 계열 소액 보장', n: '상해수술비와 별개' },
          { t: '치아', d: '보철·임플란트', n: '실손과 별도' },
          { t: '입원일당', d: '입원 기간 매일 지급', n: '간병비와 구분' }
        ].map((a) => `<div class="aux-card"><b>${a.t}</b><p>${a.d}</p><span>${a.n}</span></div>`).join('')}
      </div>
      ${noteBox('보조보장은 보장의 두께를 만드는 마지막 한 겹입니다. 큰 담보를 채운 뒤 예산 안에서 한두 개만 골라도 체감이 달라집니다.', 'info')}`, {});

    /* ---------- 29 시뮬레이터 ---------- */
    add(29, 'road', null, `
      <div class="sl-head"><span class="k">시뮬레이터</span><h2>보완하면 점수가 어떻게 바뀔까</h2>
        <p>슬라이더를 움직이면 종합 점수와 충족률이 즉시 바뀝니다. 실제 가입 금액이 아니라 방향을 보는 도구입니다.</p></div>
      <div class="sim-hero">
        <div class="sim-score"><span>보완 후 점수</span><b id="sim-score">${m.score}</b><em id="sim-letter">${m.letter}</em></div>
        <div class="sim-delta"><span>지금 ${m.score}점</span><b id="sim-delta">+0</b></div>
      </div>
      <div class="sim-list">
        ${P.map((p) => `<label class="sim-row">
          <span class="sr-name">${p.rank}순위 ${p.name}</span>
          <input type="range" min="0" max="100" step="10" value="0" data-sim="${p.key}" aria-label="${p.name} 보완 정도">
          <b class="sr-val" data-simval="${p.key}">0%</b>
        </label>`).join('')}
      </div>
      <div class="sim-bars" id="sim-bars">
        ${m.rows.map((r) => `<div class="sim-bar" data-simbar="${r.item.key}"><span>${r.item.name}</span>${bar(r.r.fill, r.level)}<b>${r.pct}%</b></div>`).join('')}
      </div>
      ${noteBox('시뮬레이터는 상담 보조용입니다. 권장 기준을 100%로 두고, 예산 안에서 어느 칸부터 채울지 정하는 데 씁니다.', 'info')}`, {});

    /* ---------- 30 로드맵 + PDF ---------- */
    add(30, 'road', null, `
      <div class="sl-head"><span class="k">로드맵</span><h2>오늘부터의 3단계</h2>
        <p>한 번에 다 하지 않습니다. 유지 → 조정 → 보완 순서로 갑니다.</p></div>
      <ol class="road">
        ${m.steps.map((s, i) => `<li><span class="rd-no">${i + 1}</span><div><b>${esc(s.title.replace(/^[^ ]+ — /, ''))}</b><p>${esc(s.body)}</p></div></li>`).join('')}
      </ol>
      <div class="road-actions">
        <button type="button" class="ra-btn primary" data-deck-pdf="summary">
          <b>1장 요약 PDF</b><span>핵심만 압축한 한 장 · 저장/공유</span>
        </button>
        <button type="button" class="ra-btn" data-deck-pdf="detail">
          <b>10장 상세 PDF</b><span>세부 담보·갱신 구조까지 · 저장/공유</span>
        </button>
      </div>
      <div class="last-note">
        <b>${esc(m.client.name)}님 · ${m.letter} ${m.score}점</b>
        <p>${m.first ? `가장 먼저 채울 곳은 ${m.first.item.rank}순위 ${esc(m.first.item.name)}입니다.` : '5대 담보가 기준선을 넘었습니다. 금액 조정과 갱신 대비가 남은 과제입니다.'}</p>
        <span>${esc(m.client.consultant)} · ${esc(m.dateLabel || '')}</span>
      </div>
      <p class="sl-src">이 리포트의 점수·권장선은 상담 보조용 자체 산식입니다. 통계는 통계청 2024 · 중앙암등록본부 2023 · 중앙심뇌혈관질환센터 2023 · 건보공단 2025 공표 수치이며, 실제 지급 여부·금액은 약관과 증권이 기준입니다.</p>`, {});

    return out;
  }

  /* =========================================================
     렌더 · 내비게이션
     ========================================================= */
  function render(state) {
    S = state;
    const m = BojangModel.full(S);
    slides = buildSlides(m).sort((a, b) => a.no - b.no);
    const stage = $('#deck-stage');
    if (!stage) return;
    const titleOf = (sl) => {
      const mm = /<(?:h1|h2)[^>]*>([\s\S]*?)<\/(?:h1|h2)>/.exec(sl.inner);
      return mm ? mm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    };
    stage.innerHTML = slides.map((sl, i) => {
      const nx = slides[i + 1];
      const nextLine = (sl.no > 1 && nx)
        ? `<div class="sl-nextline"><span>다음</span><b>${String(nx.no).padStart(2, '0')} · ${esc(titleOf(nx))}</b><i>›</i></div>`
        : '';
      return `
      <section class="slide" id="slide-${sl.no}" data-no="${sl.no}" data-group="${sl.group}" data-need="${sl.need ? 1 : 0}" aria-label="${sl.no}번 슬라이드">
        <div class="sl-inner">${sl.inner}${nextLine}</div>
      </section>`;
    }).join('');
    $('#deck-total').textContent = slides.length;
    built = true;
    applyFilter(needOnly);
    bindSlideActions();
    goTo(needOnly ? (visible()[0] || { no: 1 }).no : 1, true);
  }

  const PRI_GROUPS = ['cancer', 'brain', 'heart', 'surgery', 'care'];
  function isSkipped(sl) {
    return needOnly && PRI_GROUPS.indexOf(sl.group) >= 0 && !sl.need;
  }
  function visible() {
    return slides.filter((s) => !isSkipped(s));
  }

  function goTo(no, silent) {
    const list = visible();
    if (!list.length) return;
    const target = list.find((s) => s.no === no) || list[0];
    cur = target.no;
    $$('.slide').forEach((el) => {
      const on = Number(el.dataset.no) === cur;
      el.classList.toggle('is-current', on);
      if (on) el.scrollTop = 0;
    });
    $$('.deck-chips button').forEach((b) => {
      const g = GROUPS.find((x) => x.key === b.dataset.chip);
      const active = g && (g.key === 'all' ? false : cur >= g.from && cur <= g.to);
      b.classList.toggle('is-on', !!active);
    });
    $('#deck-now').textContent = String(cur).padStart(2, '0');
    $('#deck-progress-fill').style.width = ((cur / slides.length) * 100) + '%';
    $('#deck-prev').disabled = list.indexOf(target) <= 0;
    $('#deck-next').disabled = list.indexOf(target) >= list.length - 1;
    if (!silent) stageFocus();
  }

  function stageFocus() {
    const stage = $('#deck-stage');
    if (stage) stage.setAttribute('data-at', String(cur));
  }

  function next() {
    const list = visible();
    const i = list.findIndex((s) => s.no === cur);
    if (i >= 0 && i < list.length - 1) goTo(list[i + 1].no);
  }
  function prev() {
    const list = visible();
    const i = list.findIndex((s) => s.no === cur);
    if (i > 0) goTo(list[i - 1].no);
  }

  function applyFilter(on) {
    needOnly = !!on;
    const btn = $('#deck-filter');
    btn.classList.toggle('is-on', needOnly);
    btn.setAttribute('aria-pressed', String(needOnly));
    $$('.slide').forEach((el) => {
      const grp = el.dataset.group;
      const hidden = needOnly && PRI_GROUPS.indexOf(grp) >= 0 && el.dataset.need !== '1';
      el.classList.toggle('is-skipped', hidden);
    });
    const list = visible();
    if (needOnly && cur < 7) {
      const firstNeed = list.find((s) => s.no >= 7 && s.no <= 29);
      if (firstNeed) { goTo(firstNeed.no); return; }
    }
    if (!list.some((s) => s.no === cur)) goTo(list.length ? list[0].no : 1);
    else goTo(cur, true);
  }

  /* =========================================================
     시뮬레이터 · PDF 버튼 · 잠금
     ========================================================= */
  function simulate(boosts) {
    const clone = JSON.parse(JSON.stringify({
      age: S.age, gender: S.gender, job: S.job, silson: S.silson, premium: S.premium,
      client: S.client, contracts: S.contracts, family: S.family, disc: S.disc,
      cov: S.cov, flags: S.flags
    }));
    PRIORITY.forEach((p) => {
      const b = boosts[p.key] || 0;
      if (!b) return;
      const c = clone.cov[p.key];
      p.parts.forEach((pt) => {
        const f = b / 100;
        if (pt.type === 'amount') {
          const rec = Math.round((p.rec[S.age] || 0) * pt.factor);
          c[pt.key] = Math.max(Number(c[pt.key] || 0), Math.round(rec * f));
        } else if (pt.type === 'bool') {
          if (b >= 60) c[pt.key] = true;
        } else if (pt.type === 'scale') {
          const opts = pt.options;
          const idx = Math.min(opts.length - 1, Math.round((opts.length - 1) * f));
          const cand = opts[idx];
          const now = opts.find((o) => o.v === c[pt.key]);
          if (!now || cand.score > now.score) c[pt.key] = cand.v;
        }
      });
    });
    return BojangModel.full(clone);
  }

  function bindSim() {
    const rows = $$('input[data-sim]');
    rows.forEach((inp) => {
      inp.addEventListener('input', () => {
        const boosts = {};
        rows.forEach((r) => { boosts[r.dataset.sim] = Number(r.value || 0); });
        rows.forEach((r) => {
          const v = $(`[data-simval="${r.dataset.sim}"]`);
          if (v) v.textContent = `${r.value}%`;
        });
        const m2 = simulate(boosts);
        const scoreEl = $('#sim-score');
        if (scoreEl) scoreEl.textContent = m2.score;
        const letterEl = $('#sim-letter');
        if (letterEl) letterEl.textContent = m2.letter;
        const dEl = $('#sim-delta');
        if (dEl) {
          const d = m2.score - BojangModel.full(S).score;
          dEl.textContent = (d >= 0 ? '+' : '') + d;
          dEl.className = d > 0 ? 'up' : d < 0 ? 'down' : '';
        }
        m2.rows.forEach((r) => {
          const host = $(`[data-simbar="${r.item.key}"]`);
          if (!host) return;
          const b = $('.sl-bar', host);
          if (b) b.innerHTML = `<i style="width:${Math.max(2, Math.round(r.r.fill * 100))}%"></i>`;
          const v = $('b', host);
          if (v) v.textContent = r.pct + '%';
        });
      });
    });
  }

  function bindSlideActions() {
    bindSim();
    $$('[data-deck-pdf]').forEach((b) => {
      b.addEventListener('click', () => {
        if (H && H.doPdf) H.doPdf(b.dataset.deckPdf);
      });
    });
  }

  function openLock() {
    $('#deck-lock').hidden = false;
  }

  /* =========================================================
     공개 API
     ========================================================= */
  function init(opts) {
    H = opts;
    const chips = $('#deck-chips');
    chips.innerHTML = GROUPS.map((g) => `<button type="button" data-chip="${g.key}"${g.key === 'all' ? ' class="is-on"' : ''}>${g.label}</button>`).join('');
    $$('button', chips).forEach((b) => {
      b.addEventListener('click', () => {
        const g = GROUPS.find((x) => x.key === b.dataset.chip);
        if (!g) return;
        if (g.key === 'all') { goTo(visible()[0].no); return; }
        const list = visible().filter((s) => s.no >= g.from && s.no <= g.to);
        if (list.length) goTo(list[0].no);
        else if (H && H.toast) H.toast(`${g.label} 영역은 지금 충족 상태라 '부족 항목만 보기'에서 숨겨졌습니다`);
      });
    });
    $('#deck-prev').addEventListener('click', prev);
    $('#deck-next').addEventListener('click', next);
    $('#deck-filter').addEventListener('click', () => applyFilter(!needOnly));

    const adv = $('#deck-advisor');
    let timer = null, longFired = false;
    const start = (e) => {
      longFired = false;
      timer = setTimeout(() => { longFired = true; openLock(); }, 800);
    };
    const end = () => {
      clearTimeout(timer);
      if (!longFired && H && H.toast) H.toast('상담자 화면은 이 버튼을 0.8초 길게 누르세요');
    };
    adv.addEventListener('pointerdown', start);
    adv.addEventListener('pointerup', end);
    adv.addEventListener('pointerleave', () => clearTimeout(timer));
    adv.addEventListener('contextmenu', (e) => e.preventDefault());
    $('#dl-cancel').addEventListener('click', () => { $('#deck-lock').hidden = true; });
    $('#dl-ok').addEventListener('click', () => {
      $('#deck-lock').hidden = true;
      if (H && H.onExit) H.onExit();
    });

    /* 스와이프 */
    const stage = $('#deck-stage');
    let sx = 0, sy = 0, tracking = false;
    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      if (e.target.closest('input, textarea, .deck-chips, .deck-bar')) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 46 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      if (dx < 0) next(); else prev();
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('is-client')) return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'Escape' && !$('#deck-lock').hidden) $('#deck-lock').hidden = true;
    });
  }

  function show(state) {
    const deck = $('#deck');
    if (!deck) return;
    deck.hidden = false;
    deck.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-client');
    const sig = signature(state);
    if (!built || sig !== lastSig) {
      lastSig = sig;
      render(state);
    }
    goTo(cur || 1, true);
  }

  function hide() {
    const deck = $('#deck');
    if (!deck) return;
    deck.hidden = true;
    deck.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-client');
  }

  function signature(state) {
    return JSON.stringify({
      c: state.client, cov: state.cov, age: state.age, gender: state.gender, job: state.job,
      sil: state.silson, p: state.premium, f: state.flags, fam: state.family, disc: state.disc,
      ct: state.contracts
    });
  }

  function refresh(state, opts) {
    if (!state) return;
    if (opts && opts.reset) { built = false; cur = 0; lastSig = ''; }
    if (state.view !== 'client' && !built) return;
    if (state.view === 'client') {
      const sig = signature(state);
      if (sig !== lastSig) { lastSig = sig; render(state); }
    } else if (built) {
      /* 상담자 화면에서 값을 바꾸면 다음 전환 때 다시 그립니다 */
      lastSig = '';
    }
  }

  root.BojangDeck = { init, show, hide, refresh, goTo, next, prev, simulate, total: 30 };
})(typeof window !== 'undefined' ? window : globalThis);
