/* 보장분석 라이프 리포트 v7.0 — 사후관리 디데이 5종 + 리터치 카톡 문구 (aftercare.js)

   현장 툴킷의 '사후관리 디데이' 카드가 씁니다. 계약일·생년월일·치료일 몇 개만 넣으면
   고객에게 다시 연락할 날짜가 다섯 개 나오고, 항목마다 1탭으로 카톡 인사말 초안을 복사할 수 있습니다.

   · 계산은 100% 이 기기 안에서 합니다(UTC 날짜 연산 · 서버 전송 없음).
   · 가림 모드(BojangSmartKey.privacy)가 켜져 있으면 화면·복사 문구의 고객명을 함께 가립니다.
   · 날짜 기준이 상품 약관과 다를 수 있는 지점은 계산 결과 옆에 그대로 적어 둡니다(추정 금지). */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const copy = (t, m) => {
    if (root.__bojangCopy) root.__bojangCopy(t, m);
    else if (root.navigator && navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {});
  };
  const toast = (m) => { if (root.__bojangToast) root.__bojangToast(m); };

  /* =========================================================
     날짜 유틸 — 전부 UTC 자정 기준(서머타임·시간대 영향 없음)
     ========================================================= */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function parts(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1) return null;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (d > last) return null;
    return { y, m: mo, d };
  }
  function iso(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function toUTC(s) {
    const p = parts(s);
    return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : null;
  }
  function todayISO(ref) {
    const n = ref ? new Date(ref) : new Date();
    if (isNaN(n.getTime())) return null;
    return n.getFullYear() + '-' + pad2(n.getMonth() + 1) + '-' + pad2(n.getDate());
  }
  function addDays(s, n) {
    const d = toUTC(s);
    if (!d) return null;
    d.setUTCDate(d.getUTCDate() + Number(n || 0));
    return iso(d);
  }
  /* 말일 보정 — 1/31 + 1개월 = 2/28(또는 2/29), 2/29 + 1년 = 2/28 */
  function addMonths(s, n) {
    const d = toUTC(s);
    if (!d) return null;
    const day = d.getUTCDate();
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Number(n || 0), 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    return iso(target);
  }
  function addYears(s, n) { return addMonths(s, 12 * Number(n || 0)); }
  function diffDays(fromISO, toISO) {
    const a = toUTC(fromISO), b = toUTC(toISO);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }
  function ddayText(days) {
    if (days == null) return '';
    if (days === 0) return 'D-DAY';
    return days > 0 ? 'D-' + days : 'D+' + Math.abs(days);
  }
  function state(days) {
    if (days == null) return 'none';
    if (days < 0) return 'past';
    if (days <= 30) return 'soon';
    return 'ok';
  }
  function koDate(s) {
    const p = parts(s);
    return p ? `${p.y}년 ${p.m}월 ${p.d}일` : '';
  }

  /* 상령일 = 생일 + 6개월(보험나이가 한 살 올라가는 날).
     v7.0 — 2/29생은 그 해에 2/29 가 없으면 2/28 로 당겨 계산합니다(model.js nextAgeDay 와 같은 규칙). */
  function nextAgeDayISO(birth, today) {
    const p = parts(birth);
    const t = parts(today || todayISO());
    if (!p || !t) return null;
    const build = (year) => {
      const total = (p.m - 1) + 6;
      const yy = year + Math.floor(total / 12);
      const mm = ((total % 12) + 12) % 12;
      const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
      return iso(new Date(Date.UTC(yy, mm, Math.min(p.d, last))));
    };
    let cand = build(t.y);
    if (cand < (today || todayISO())) cand = build(t.y + 1);
    return cand;
  }

  /* =========================================================
     가림 모드
     ========================================================= */
  function privacyOn() {
    try { return !!(root.BojangSmartKey && root.BojangSmartKey.privacy && root.BojangSmartKey.privacy.enabled()); }
    catch (e) { return false; }
  }
  function maskName(name) {
    const s = String(name == null ? '' : name).trim();
    if (!s) return '';
    if (!privacyOn()) return s;
    try {
      if (root.BojangSmartKey && root.BojangSmartKey.privacy && root.BojangSmartKey.privacy.maskName) {
        return root.BojangSmartKey.privacy.maskName(s);
      }
    } catch (e) { /* 기본 규칙 */ }
    if (s.length === 1) return '*';
    if (s.length === 2) return s[0] + '*';
    return s[0] + '*'.repeat(Math.max(1, s.length - 2)) + s[s.length - 1];
  }
  function callName(name) { return maskName(name) || '고객'; }

  /* =========================================================
     5종 계산
     input: { name, contract, birth, treatment, cure, switchDate, claimed, reductionYears }
     ========================================================= */
  const ITEM_META = [
    { key: 'imunity', no: 1, title: '90일 면책 해제일', tag: '보장개시' },
    { key: 'reduction', no: 2, title: '감액 해제일', tag: '감액' },
    { key: 'disclosure', no: 3, title: '고지의무 경과일', tag: '재가입·전환' },
    { key: 'silson', no: 4, title: '실손 전환 철회 기한', tag: '전환' },
    { key: 'ageday', no: 5, title: '상령일 디데이', tag: '보험나이' }
  ];

  function calc(input, today) {
    input = input || {};
    const now = today || todayISO();
    const name = String(input.name || '').trim();
    const contract = parts(input.contract) ? input.contract : '';
    const birth = parts(input.birth) ? input.birth : '';
    const treatment = parts(input.treatment) ? input.treatment : '';
    const cure = parts(input.cure) ? input.cure : '';
    const sw = parts(input.switchDate) ? input.switchDate : '';
    const claimed = !!input.claimed;
    const years = String(input.reductionYears) === '2' ? 2 : 1;

    const items = [];
    const push = (meta, body) => items.push(Object.assign({}, meta, body));

    /* ① 90일 면책 해제일 — 계약일을 1일째로 세어 91일째 0시(= 계약일 + 90일) */
    if (contract) {
      const date = addDays(contract, 90);
      const days = diffDays(now, date);
      push(ITEM_META[0], {
        available: true, date, days, state: state(days),
        headline: `${koDate(date)} 0시(${ddayText(days)})부터 일반암 보장이 개시됩니다`,
        lines: [
          '계약일을 1일째로 세어 91일째 0시 — 계산식은 계약일 + 90일입니다.',
          '일반암만 해당합니다. 유사암(갑상선암·제자리암·경계성종양)·뇌·심장은 대개 보장개시일부터 즉시 보장되고, 대장점막내암은 상품별로 다릅니다.',
          days > 0 ? '이 날짜 전에 진단이 확정되면 일반암 진단비는 지급되지 않습니다.' : '면책 기간은 이미 지났습니다 — 지금은 일반암도 보장됩니다.'
        ],
        warn: days >= 0 && days <= 30 ? '면책 해제가 ' + days + '일 남았습니다 — 이 시기의 진단은 지급되지 않으니 고객에게 먼저 알려 주세요' : '',
        copy: `${callName(name)}님, 안녕하세요. ${koDate(date)}부터 가입하신 암보장의 90일 면책 기간이 끝나 일반암 진단비가 온전히 보장됩니다. 그 전에 진단이 확정되면 일반암 진단비는 지급되지 않으니 그 점만 미리 기억해 주세요. 유사암·뇌·심장은 해당되지 않는 경우가 많습니다. 궁금하신 점 있으면 편하게 연락 주세요.`
      });
    } else {
      push(ITEM_META[0], { available: false, hint: '계약일을 넣으면 계산됩니다' });
    }

    /* ② 감액 해제일 — 계약일 + 1년(또는 2년 특약) */
    if (contract) {
      const date = addYears(contract, years);
      const days = diffDays(now, date);
      push(ITEM_META[1], {
        available: true, date, days, state: state(days),
        headline: `${koDate(date)} 0시(${ddayText(days)})부터 ${years}년 감액이 해제됩니다`,
        lines: [
          `계약 후 ${years}년 이내에 진단·수술을 받으면 약정 금액의 50%(상품에 따라 50~90%)만 지급되는 감액 기간입니다.`,
          '해제일 0시부터 100% 지급됩니다. 감액률·기간은 특약마다 다르니 증권으로 확인하세요.',
          years === 2 ? '2년 감액 특약을 선택했습니다 — 1년 특약 상품이면 1년 시점에 이미 해제됩니다.' : '2년 감액 특약에 가입했다면 1년이 아니라 2년 시점에 해제됩니다.'
        ],
        warn: days >= 0 && days <= 30 ? '감액 해제가 ' + days + '일 남았습니다 — 지금 진단·수술이 필요하면 해제 뒤로 미룰 수 있는지 상담하세요' : '',
        copy: `${callName(name)}님, ${years}년 감액 기간이 ${koDate(date)}에 끝납니다. 그 전에 진단이나 수술을 받으면 약정 금액의 50%만 지급되는 경우가 많으니, 그 안에 진단받을 일이 생기면 먼저 연락 주세요. 해제일 이후에는 100% 지급됩니다.`
      });
    } else {
      push(ITEM_META[1], { available: false, hint: '계약일을 넣으면 계산됩니다' });
    }

    /* ③ 고지의무 경과일 — 최종 치료일 + 2년(3·2·5), 완치 종결일 + 5년(표준체) */
    const twoYear = treatment ? addYears(treatment, 2) : null;
    const fiveYear = cure ? addYears(cure, 5) : null;
    if (twoYear || fiveYear) {
      const primary = twoYear || fiveYear;
      const days = diffDays(now, primary);
      const extra = [];
      if (twoYear) extra.push({ label: '최종 치료일 + 2년 · 간편심사(3·2·5) 전환 검토', date: twoYear, days: diffDays(now, twoYear) });
      if (fiveYear) extra.push({ label: '완치 종결일 + 5년 · 표준체 심사 가능 시점', date: fiveYear, days: diffDays(now, fiveYear) });
      push(ITEM_META[2], {
        available: true, date: primary, days, state: state(days), extra,
        headline: twoYear
          ? `${koDate(twoYear)}(${ddayText(diffDays(now, twoYear))})부터 간편심사 3·2·5 문항의 2년 조회가 비워집니다`
          : `${koDate(fiveYear)}(${ddayText(diffDays(now, fiveYear))})부터 표준체 심사가 가능해집니다`,
        lines: [
          '최종 치료일 + 2년 — 간편심사(3·2·5)의 2년 입원·수술 문항이 지나 재가입·전환을 검토할 수 있는 시점입니다.',
          '완치 종결일 + 5년 — 표준체(일반심사) 전환을 검토할 수 있는 시점입니다.',
          '기산일은 마지막 치료일(입원·수술·투약 포함)과 완치 종결일 중 무엇으로 보는지 상품·인수 기준마다 다릅니다. 고지서·진단서 날짜로 확인하세요.',
          '3·5·5 상품은 5년 문항이 남아 있으니 3·2·5 와 함께 비교하세요.'
        ],
        warn: days >= 0 && days <= 90 ? '고지의무 경과가 ' + days + '일 남았습니다 — 그 뒤 가입이 유리한지 미리 계산해 두세요' : '',
        copy: twoYear
          ? `${callName(name)}님, ${koDate(twoYear)}이 지나면 간편심사(3·2·5)로 다시 보험을 알아볼 수 있는 시점이 됩니다${fiveYear ? ' (표준체 심사는 ' + koDate(fiveYear) + '부터)' : ''}. 그때 건강 상태에 맞춰 더 나은 조건으로 정리할 수 있으니 달력에 표시해 두세요.`
          : `${callName(name)}님, ${koDate(fiveYear)}이 지나면 표준체(일반심사)로 다시 보험을 알아볼 수 있습니다. 그때까지는 간편심사 상품으로 준비해 두는 편이 좋습니다.`
      });
    } else {
      push(ITEM_META[2], { available: false, hint: '최종 치료일 또는 완치 종결일을 넣으면 계산됩니다' });
    }

    /* ④ 실손 전환 철회 기한 — 승낙일 + 6개월 (3개월 안은 지급사유가 있어도 복귀 가능) */
    if (sw) {
      const date = addMonths(sw, 6);
      const threeMonth = addMonths(sw, 3);
      const days = diffDays(now, date);
      const days3 = diffDays(now, threeMonth);
      const beyond3 = days3 != null && days3 < 0;
      const blocked = claimed && beyond3;
      push(ITEM_META[3], {
        available: true, date, days, state: blocked ? 'past' : state(days),
        headline: blocked
          ? `철회 불가 — 전환 후 3개월(${koDate(threeMonth)})이 지나고 보험금 수령 이력이 있어 되돌릴 수 없습니다`
          : (claimed
            ? `${koDate(threeMonth)}(${ddayText(days3)})까지만 되돌릴 수 있습니다 — 보험금 수령 이력이 있어 3개월 뒤에는 철회가 막힙니다`
            : `${koDate(date)}(${ddayText(days)})까지 이전 실손으로 되돌릴 수 있습니다`),
        lines: [
          '전환 후 6개월 이내이고 보험금 지급사유가 없으면 철회(원상복구)할 수 있습니다. 철회는 계약자별 1회만 가능합니다.',
          claimed ? '보험금 수령 이력이 있으면 실제 철회 마감일은 6개월이 아니라 3개월입니다.' : '보험금을 받지 않았다면 마감은 6개월입니다.',
          `전환 후 3개월 이내(${koDate(threeMonth)}까지)는 보험금 지급사유가 발생해도 복귀할 수 있고, 그때는 보험료 차액을 정산하며 전환 이후 사고는 기존 계약으로 보장합니다.`,
          claimed
            ? '전환 후 보험금을 수령(지급사유 발생)했다면 3개월이 지난 뒤부터는 철회가 불가합니다 — 1원이라도 받은 이력이 있으면 이 예외에 해당합니다.'
            : '전환 후 보험금을 아직 받지 않았다면 6개월 안에 철회할 수 있습니다.',
          '철회하면 다시 5세대로 전환할 때 별도 심사를 거쳐야 합니다.'
        ],
        warn: blocked
          ? '철회 불가 — 지급사유 발생 + 3개월 경과. 보험사에 예외 여부를 확인하세요'
          : (claimed ? '보험금 수령 이력이 있습니다 — 3개월 경과 시점부터 철회 불가' : (days >= 0 && days <= 30 ? '철회 기한이 ' + days + '일 남았습니다' : '')),
        copy: claimed
          ? `${callName(name)}님, 5세대 실손으로 전환한 뒤 보험금을 받으셨다면 3개월이 지난 뒤부터는 이전 실손으로 되돌릴 수 없습니다. 철회는 1회만 가능하니 남은 기한(${koDate(date)}까지)과 조건을 함께 확인해 드리겠습니다.`
          : `${callName(name)}님, 5세대 실손으로 전환한 뒤 ${koDate(date)}까지는 이전 실손으로 되돌릴 수 있습니다. 다만 그 전에 보험금을 받으면 3개월이 지나는 순간부터는 되돌릴 수 없으니, 다시 생각할 일이 있으면 3개월 안에 알려 주세요. 철회는 1회만 가능합니다.`
      });
    } else {
      push(ITEM_META[3], { available: false, hint: '실손 전환 승낙일을 넣으면 계산됩니다' });
    }

    /* ⑤ 상령일 디데이 — 생일 + 6개월 */
    if (birth) {
      const date = nextAgeDayISO(birth, now);
      const days = diffDays(now, date);
      push(ITEM_META[4], {
        available: true, date, days, state: state(days),
        headline: `${koDate(date)}(${ddayText(days)})에 보험나이가 한 살 올라갑니다`,
        lines: [
          '상령일 = 생일 + 6개월. 이날 0시부터 보험나이가 한 살 올라가 새 계약의 보험료가 인상됩니다.',
          '2월 29일생은 그 해에 2월 29일이 없으면 2월 말일로 당겨 계산합니다.',
          days >= 0 && days <= 30 ? '보완 가입이 필요하면 상령일 전에 청약하는 편이 보험료에 유리합니다.' : '보완 가입 시점을 정할 때 이 날짜를 기준으로 잡으세요.'
        ],
        warn: days >= 0 && days <= 30 ? '상령일이 ' + days + '일 남았습니다 — 이번 달 청약 여부를 정해야 합니다' : '',
        copy: `${callName(name)}님, ${koDate(date)}에 보험나이가 한 살 올라갑니다(상령일). 그날 이후 새로 가입하면 같은 보장도 보험료가 올라가니, 보완이 필요하면 그 전에 정리하는 편이 좋습니다. 필요한 부분만 골라서 안내해 드릴게요.`
      });
    } else {
      push(ITEM_META[4], { available: false, hint: '생년월일을 넣으면 계산됩니다' });
    }

    /* 다음 점검 예정일 — 가장 가까운 항목 날짜로 재방문 약속을 문구에 남깁니다 */
    const upcoming = items.filter((i) => i.available && i.days != null && i.days >= 0).sort((a, b) => a.days - b.days);
    const nextItem = upcoming[0] || null;
    const nextDate = nextItem ? nextItem.date : addMonths(now, 6);
    const nextLine = `\n\n다음 점검 예정일: ${koDate(nextDate)}${nextItem ? ' (' + nextItem.title + ' 기준)' : ''}`;
    items.forEach((it) => { if (it.copy) it.copy += nextLine; });

    return { today: now, name, items, nextCheck: { date: nextDate, title: nextItem ? nextItem.title : '기본 6개월', days: diffDays(now, nextDate) } };
  }

  /* =========================================================
     화면
     ========================================================= */
  let last = null;

  function readInput() {
    const val = (id) => { const el = $('#' + id); return el ? String(el.value || '').trim() : ''; };
    const chk = (id) => { const el = $('#' + id); return !!(el && el.checked); };
    return {
      name: val('ac-name'), contract: val('ac-contract'), birth: val('ac-birth'),
      treatment: val('ac-treatment'), cure: val('ac-cure'), switchDate: val('ac-switch'),
      claimed: chk('ac-claimed'), reductionYears: val('ac-reduction') || '1'
    };
  }

  function fillCurrentClient() {
    const S = root.BojangApp && root.BojangApp.state;
    if (!S) return;
    const nameEl = $('#ac-name'), birthEl = $('#ac-birth');
    if (nameEl && S.client && S.client.name && S.client.name !== '홍길동') nameEl.value = S.client.name;
    if (birthEl && S.client && S.client.birth) birthEl.value = S.client.birth;
    run();
    toast('현재 상담 고객의 이름·생년월일을 넣었습니다');
  }

  function itemHTML(it) {
    if (!it.available) {
      return `<article class="ac-item is-empty" data-ac-item="${it.key}">
        <div class="ac-head"><span class="ac-no">${it.no}</span><b>${esc(it.title)}</b><span class="ac-tag">${esc(it.tag)}</span></div>
        <p class="ac-hint">${esc(it.hint)}</p>
      </article>`;
    }
    const extra = (it.extra || []).map((e) => `<li><b>${esc(e.label)}</b> · <span class="ac-extra-date">${esc(koDate(e.date))}</span> <em class="ac-extra-dday tone-${state(e.days)}">${esc(ddayText(e.days))}</em></li>`).join('');
    return `<article class="ac-item tone-${it.state}" data-ac-item="${it.key}">
      <div class="ac-head">
        <span class="ac-no">${it.no}</span><b>${esc(it.title)}</b><span class="ac-tag">${esc(it.tag)}</span>
        <span class="ac-date">${esc(koDate(it.date))}</span>
        <span class="ac-dday tone-${it.state}">${esc(ddayText(it.days))}</span>
      </div>
      <p class="ac-main">${esc(it.headline)}</p>
      <ul class="ac-lines">${it.lines.map((l) => `<li>${esc(l)}</li>`).join('')}${extra}</ul>
      ${it.warn ? `<p class="ac-warn">⚠ ${esc(it.warn)}</p>` : ''}
      <button type="button" class="btn-ghost sm ac-copy" data-ac-copy="${it.key}">💬 카톡 인사말 복사</button>
    </article>`;
  }

  function render() {
    const host = $('#ac-results');
    if (!host || !last) return;
    host.innerHTML = last.items.map(itemHTML).join('') +
      `<p class="ac-next">다음 점검 예정일 <b>${esc(koDate(last.nextCheck.date))}</b> <span>${esc(ddayText(last.nextCheck.days))}</span> — 카톡 초안 끝에 이 날짜가 자동으로 들어갑니다.</p>` +
      `<p class="ac-foot">계산은 이 기기에서만 이루어집니다 · 기준일 ${esc(last.today)} · 날짜 기준은 상품 약관과 인수 기준에 따라 달라질 수 있습니다.</p>`;
    $$('[data-ac-copy]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const it = last.items.find((x) => x.key === b.dataset.acCopy);
        if (!it || !it.copy) return;
        copy(it.copy, '카톡 인사말을 복사했습니다 — 붙여넣기만 하세요');
      });
    });
  }

  function run() {
    last = calc(readInput());
    render();
    return last;
  }

  function reset() {
    ['ac-name', 'ac-contract', 'ac-birth', 'ac-treatment', 'ac-cure', 'ac-switch'].forEach((id) => { const el = $('#' + id); if (el) el.value = ''; });
    const c = $('#ac-claimed'); if (c) c.checked = false;
    const r = $('#ac-reduction'); if (r) r.value = '1';
    run();
  }

  function init() {
    if (!$('#ac-results')) return;
    ['ac-contract', 'ac-birth', 'ac-treatment', 'ac-cure', 'ac-switch', 'ac-reduction'].forEach((id) => {
      const el = $('#' + id);
      if (el) el.addEventListener('change', run);
    });
    const claimed = $('#ac-claimed');
    if (claimed) claimed.addEventListener('change', run);
    const btn = $('#ac-calc'); if (btn) btn.addEventListener('click', () => { run(); toast('디데이 5종을 계산했습니다'); });
    const rb = $('#ac-reset'); if (rb) rb.addEventListener('click', reset);
    const lb = $('#ac-load'); if (lb) lb.addEventListener('click', fillCurrentClient);
    const pr = $('#sk-privacy-chip');
    if (pr) pr.addEventListener('click', () => setTimeout(run, 60));
    /* 날짜는 비워 둡니다 — 기본값(오늘)이 들어가면 다른 고객의 계약일로 오해될 수 있습니다 */
    run();
  }

  root.BojangAftercare = {
    calc, render, init, run, readInput, copyTextFor: (key) => (last ? (last.items.find((i) => i.key === key) || {}).copy || '' : ''),
    ITEM_META, maskName,
    date: { parts, addDays, addMonths, addYears, diffDays, todayISO, nextAgeDayISO, ddayText, state, koDate }
  };
})(typeof window !== 'undefined' ? window : globalThis);
