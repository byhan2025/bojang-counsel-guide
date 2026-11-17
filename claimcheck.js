/* 보장분석 라이프 리포트 v7.0 — 진료·보험 서류 청구 담보 매칭 + 소멸시효 (claimcheck.js)

   현장 툴킷의 '청구 서류·담보 체크' 카드. KCD 코드/질환을 고르고 실제 가진 서류만 체크하면
   ① 확인할 후보 담보 ② 추가로 필요한 서류(1순위부터) ③ 상법 제662조 3년 소멸시효 D-day 를 보여 줍니다.
   확정 판정이 아니므로 '후보 담보'·'추가로 필요한 서류'라는 말을 씁니다.

   · 입력·계산 100% 브라우저 로컬 — 어떤 값도 외부로 보내지 않습니다.
   · 지급 여부·종수는 상품 약관이 기준입니다. 확정할 수 없는 값은 '확인 필요'로 남깁니다(추정 금지). */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = (m) => { if (root.__bojangToast) root.__bojangToast(m); };

  const DISCLAIMER = '본 결과는 상담 참고용이며 최종 지급 여부는 상품 약관 및 보험사 심사에 따릅니다.';

  /* 날짜(UTC) — aftercare.js 와 같은 규칙 */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function parts(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
    return { y, m: mo, d };
  }
  function iso(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function toUTC(s) { const p = parts(s); return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : null; }
  function todayISO() { const n = new Date(); return n.getFullYear() + '-' + pad2(n.getMonth() + 1) + '-' + pad2(n.getDate()); }
  function addMonths(s, n) {
    const d = toUTC(s);
    if (!d) return null;
    const day = d.getUTCDate();
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Number(n || 0), 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return iso(t);
  }
  function diffDays(fromISO, toISO) {
    const a = toUTC(fromISO), b = toUTC(toISO);
    return (!a || !b) ? null : Math.round((b - a) / 86400000);
  }
  function ddayText(days) { return days == null ? '' : days === 0 ? 'D-DAY' : (days > 0 ? 'D-' + days : 'D+' + Math.abs(days)); }
  function koDate(s) { const p = parts(s); return p ? `${p.y}년 ${p.m}월 ${p.d}일` : ''; }

  /* =========================================================
     서류
     ========================================================= */
  const DOCS = [
    { key: 'dx', label: '진단서', note: '병명·코드·진단확정일' },
    { key: 'detail', label: '진료비 세부내역서', note: '급여/비급여 구분' },
    { key: 'surgery', label: '수술확인서', note: '수술명·수술일·방법' },
    { key: 'path', label: '병리조직결과지', note: '원발/전이·악성 여부' },
    { key: 'admit', label: '입·퇴원확인서', note: '입원일수·간병 기간' },
    { key: 'receipt', label: '진료비 영수증', note: '실손 청구 기본' }
  ];
  const DOC_LABEL = DOCS.reduce((a, d) => (a[d.key] = d.label, a), {});

  /* =========================================================
     코드 분류 — FC_CODES(group) + 코드별 예외
     ========================================================= */
  const CODE_RULES = {
    /* 유사암 — 일반암 진단비에서는 지급 없음 */
    C73: { group: '유사암' }, C44: { group: '유사암' },
    'D00~D09': { group: '유사암' }, 'D37~D48': { group: '유사암' },
    /* 뇌 */
    I63: { group: '뇌', dx: ['뇌졸중 진단비', '뇌혈관질환 진단비'], caveat: ['뇌출혈 진단비는 지급되지 않습니다(담보 범위 밖).'] },
    I60: { group: '뇌', dx: ['뇌출혈 진단비', '뇌졸중 진단비', '뇌혈관질환 진단비'] },
    I61: { group: '뇌', dx: ['뇌출혈 진단비', '뇌졸중 진단비', '뇌혈관질환 진단비'] },
    I62: { group: '뇌', dx: ['뇌출혈 진단비', '뇌졸중 진단비', '뇌혈관질환 진단비'], caveat: ['외상성 출혈(S06)이면 질병이 아니라 상해 담보 영역입니다.'] },
    I64: { group: '뇌', dx: ['뇌혈관질환 진단비'], caveat: ['표준 뇌졸중 분류표(I60~I63·I65~I66)에서 I64가 빠져 뇌졸중 진단비는 지급되지 않는 상품이 많습니다.'] },
    'I65~I66': { group: '뇌', dx: ['뇌혈관질환 진단비'], caveat: ['뇌경색이 발생하지 않은 협착은 뇌졸중 담보에서 제외되는 경우가 많습니다.'] },
    I67: { group: '뇌', dx: ['뇌혈관질환 진단비'], caveat: ['뇌졸중 담보에서는 제외되는 코드입니다.'] },
    I69: { group: '뇌', dx: ['뇌혈관질환 진단비'] },
    G45: { group: '뇌', dx: ['뇌혈관질환 진단비'], caveat: ['뇌졸중 담보에서는 대체로 제외됩니다.'] },
    /* 심장 */
    I20: { group: '심장', dx: ['허혈성심장질환 진단비'], caveat: ['급성심근경색 진단비는 지급되지 않습니다. 스텐트·혈관성형술은 수술이 아닌 처치로 분류될 수 있습니다.'] },
    'I20.1': { group: '심장', dx: ['허혈성심장질환 진단비(I20~I25)'], caveat: ['급성심근경색 담보에서는 지급 없음.'] },
    I21: { group: '심장', dx: ['급성심근경색 진단비', '허혈성심장질환 진단비'] },
    I22: { group: '심장', dx: ['급성심근경색 진단비(1회한 여부 확인)', '허혈성심장질환 진단비'], caveat: ['1회한 담보는 첫 지급 뒤 재지급이 없습니다 — 재진단 담보 필요.'] },
    I23: { group: '심장', dx: ['급성심근경색 진단비'], caveat: ['상품에 따라 I21~I22만 담아 I23이 빠질 수 있습니다.'] },
    I25: { group: '심장', dx: ['허혈성심장질환 진단비'], caveat: ['급성심근경색 진단비는 지급되지 않습니다.'] },
    I48: { group: '심장', dx: ['심장질환 담보(상품별)'], caveat: ['허혈성심장질환 담보 범위에는 포함되지 않습니다. 부정맥은 별도 담보가 없으면 미보장.'] },
    I50: { group: '심장', dx: ['심장질환 담보(상품별)'], caveat: ['허혈성심장질환 담보로는 지급되지 않습니다.'] },
    /* 수술 */
    M51: { group: '수술', op: ['질병 1~5종 수술비', '질병수술비(N대)'] },
    M50: { group: '수술', op: ['질병 1~5종 수술비', '질병수술비(N대)'] },
    M48: { group: '수술', op: ['질병 1~5종 수술비', '질병수술비(N대)', '비급여 수술비(가입 시)'] },
    'K63.5': { group: '수술', op: ['질병수술비(제외되는 상품이 많음)'], caveat: ['내시경 용종 절제는 시술로 보아 수술비를 지급하지 않는 상품이 많습니다.'] },
    D12: { group: '수술', op: ['질병 1~5종 수술비'] },
    K35: { group: '수술', op: ['질병 1~5종 수술비', '질병수술비(N대)'] },
    K80: { group: '수술', op: ['질병 1~5종 수술비', '질병수술비(N대)'] },
    N20: { group: '수술', op: ['질병수술비(체외충격파 제외 확인)'], caveat: ['체외충격파 쇄석술은 시술로 제외되는 상품이 많습니다.'] },
    H25: { group: '수술', op: ['질병 1~5종 수술비', '비급여 수술비(가입 시)'], caveat: ['다초점·난시교정 렌즈는 비급여 — 5세대 실손 비중증 한도로는 부족할 수 있습니다.'] },
    M17: { group: '수술', op: ['질병 1~5종 수술비', '비급여 수술비(가입 시)'] },
    /* 상해 */
    S72: { group: '상해', op: ['상해수술비', '상해 1~5종 수술비'], caveat: ['질병수술비로는 지급되지 않습니다 — 상해 축으로 청구하세요.'] },
    S82: { group: '상해', op: ['상해수술비', '상해 1~5종 수술비'], caveat: ['질병수술비로는 지급되지 않습니다.'] },
    /* 기타 */
    J18: { group: '기타', dx: ['입원일당(입원일수 기준)'], caveat: ['질병수술비는 수술을 받은 경우에만 해당됩니다.'] },
    I10: { group: '기타', caveat: ['진단비 지급 대상이 아닙니다 — 고지·인수 판단 항목입니다.'] },
    N18: { group: '기타', caveat: ['중대질병 고지 항목 — 진단비 지급 대상이 아닙니다.'] },
    K74: { group: '기타', caveat: ['중대질병 고지 항목 — 진단비 지급 대상이 아닙니다.'] },
    F00: { group: '기타', dx: ['치매 진단비(상품별)', '장기요양·간병(등급 전제)'] },
    U22: { group: '기타', dx: ['치매 진단비(상품별)', '장기요양·간병(등급 전제)'] }
  };

  const OP_HINT = {
    K35: '복강경 충수절제술은 3종 안팎, 개복 전환 시 5종 — 회사 분류표가 기준입니다.',
    M17: '인공관절 치환술은 5종(대수술) 고액 구간인 경우가 많습니다.',
    M48: '척추 유합술은 5종 구간 — 비급여 나사·케이지 사용 시 비급여 수술비 담보도 확인하세요.',
    M51: '관혈적 유합술만 수술비 대상이고, 내시경 감압술의 종수는 회사마다 다릅니다.',
    M50: '목 디스크는 절개(관혈) 여부·분류표에 따라 종수가 갈립니다.',
    K80: '복강경 담낭절제술의 종수를 분류표에서 확인하세요. 내시경 결석 제거는 시술입니다.',
    N20: '체외충격파 쇄석술은 시술로 제외되는 상품이 많습니다.',
    H25: '백내장 수술의 종수를 분류표에서 확인하고, 다초점 렌즈는 비급여로 따로 보세요.',
    'K63.5': '건강검진 중 용종 제거는 수술비보다 고지의무(5년 문항)가 문제되는 대표 사례입니다.',
    C16: '조기 위암 내시경 절제(ESD)는 4~5종 또는 시술 제외 여부가 회사별로 갈립니다.',
    C67: '경요도 절제(TURB)는 시술 분류로 수술비에서 제외될 수 있습니다.'
  };

  function findCode(q) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return null;
    const list = (typeof FC_CODES !== 'undefined' ? FC_CODES : []);
    return list.find((c) => String(c.code).toLowerCase() === s) ||
      list.find((c) => (String(c.code) + ' ' + c.name + ' ' + (c.tags || '')).toLowerCase().indexOf(s) >= 0) || null;
  }
  function searchCodes(q) {
    const s = String(q || '').trim().toLowerCase();
    const list = (typeof FC_CODES !== 'undefined' ? FC_CODES : []);
    if (!s) return list.slice(0, 6);
    return list.filter((c) => (String(c.code) + ' ' + c.name + ' ' + (c.tags || '') + ' ' + (c.group || '')).toLowerCase().indexOf(s) >= 0).slice(0, 8);
  }

  /* =========================================================
     매칭 — 담보 목록 + 필요한 서류 + 누락 + 시효
     ========================================================= */
  const GROUP_BASE = {
    '암': { dx: ['일반암 진단비'], op: ['암수술비'], tx: ['항암약물치료비', '항암방사선치료비', '중환자실 입원비'], silson: '암 치료는 5세대 실손에서 중증(특약1) 비급여로 청구합니다(연 5,000만·자기부담 30%).' },
    '유사암': { dx: ['유사암 진단비'], op: ['암수술비(상품별)'], tx: [], silson: '유사암 치료도 실손 청구는 가능하지만 진단비는 유사암 담보에서만 나옵니다.' },
    '뇌': { dx: ['뇌혈관질환 진단비'], tx: ['뇌혈관 수술비', '혈전용해제 치료비', '중환자실 입원비'], silson: '뇌혈관 치료는 중증 비급여(특약1) 영역입니다.' },
    '심장': { dx: ['허혈성심장질환 진단비'], tx: ['심장 수술비', '혈전용해제 치료비', '중환자실 입원비'], silson: '심장 치료는 중증 비급여(특약1) 영역입니다.' },
    '수술': { op: ['질병 1~5종 수술비', '질병수술비(N대)'], silson: '입원·통원 실손은 세부내역서 기준으로 청구합니다.' },
    '상해': { op: ['상해수술비', '상해 1~5종 수술비'], silson: '상해는 질병 담보가 아니라 상해 담보 축입니다.' },
    '기타': { silson: '진단비 담보가 없는 항목은 실손·입원일당 중심으로 확인하세요.' }
  };

  function classify(code) {
    if (!code) return null;
    const rule = CODE_RULES[code.code] || {};
    const group = rule.group || code.group || '기타';
    const base = GROUP_BASE[group] || GROUP_BASE['기타'];
    const dx = rule.dx || base.dx || [];
    const op = rule.op || base.op || [];
    const tx = rule.tx || base.tx || [];
    const caveat = (rule.caveat || []).slice();
    return { group, dx, op, tx, caveat, silson: base.silson || '' };
  }

  function requiredDocs(cls, input) {
    const list = [];
    const has = (k, rank, why) => { if (!list.some((x) => x.key === k)) list.push({ key: k, rank, why }); };
    if (cls.group === '암' || cls.group === '유사암') {
      has('dx', 1, '진단확정일·병명·KCD 코드가 적힌 진단서가 진단비 청구의 기본입니다.');
      has('path', 1, '원발/전이, 일반암/유사암 판정이 병리조직결과지로 갈립니다.');
      if (cls.op.length) has('surgery', 1, '수술명·수술일·수술방법이 있어야 수술비 종수를 판정합니다.');
    } else if (cls.group === '뇌' || cls.group === '심장') {
      has('dx', 1, '진단서에 질환명과 코드가 있어야 담보 범위를 가릅니다.');
      has('admit', 2, '입원일당·중환자실 담보는 입·퇴원 확인서가 필요합니다.');
      if (cls.tx.length) has('surgery', 2, '수술·시술 담보는 수술확인서(또는 시술 기록)로 확인합니다.');
    } else if (cls.group === '수술' || cls.group === '상해') {
      has('surgery', 1, '수술확인서가 없으면 수술 종수를 판정할 수 없습니다.');
      has('dx', 2, '질병·상해 구분과 진단명 확인용입니다.');
    } else if (cls.group === '기타') {
      has('dx', 2, '지급 대상 담보가 있는지 진단서로 먼저 확인하세요.');
    }
    if (input.silson5 || input.receipt || input.detail) {
      has('detail', 2, '실손은 급여/비급여 구분이 있는 세부내역서가 있어야 계산됩니다.');
      has('receipt', 3, '실손 청구의 기본 첨부 서류입니다.');
    }
    if (input.care) has('admit', 2, '간병일당은 입원일수·간병 기간을 확인할 수 있는 서류가 필요합니다.');
    return list.sort((a, b) => a.rank - b.rank);
  }

  function match(input) {
    const code = input.code || null;
    const cls = classify(code);
    if (!cls) return { empty: true };
    const docSet = {};
    DOCS.forEach((d) => { docSet[d.key] = !!input.docs[d.key]; });

    const rows = [];
    cls.dx.forEach((d) => rows.push({ dambo: d, kind: '진단비', need: ['dx'], ok: docSet.dx, why: code.pays }));
    if (input.surgery) {
      cls.op.forEach((d) => rows.push({
        dambo: d, kind: '수술비', need: ['surgery', 'path'], ok: docSet.surgery,
        why: (cls.group === '암' || cls.group === '유사암')
          ? (OP_HINT[code.code] || code.check) + ' 병리 결과지가 없으면 일반암/유사암 구분이 어렵습니다.'
          : (OP_HINT[code.code] || code.check)
      }));
    } else if (cls.op.length) {
      rows.push({ dambo: '수술 1~5종 특약', kind: '수술비', need: ['surgery'], ok: false, locked: true, why: '가입 특약에 수술비를 체크하면 종수 기준으로 매칭합니다.' });
    }
    cls.tx.forEach((d) => rows.push({ dambo: d, kind: '치료비', need: ['detail'], ok: docSet.detail, why: code.check }));
    if (input.care && (cls.group === '뇌' || cls.group === '심장' || cls.group === '수술' || cls.group === '암')) {
      rows.push({ dambo: '간병일당(8만원 기준)', kind: '간병', need: ['admit'], ok: docSet.admit, why: input.careBasis === '6' ? '6시간제 상품 — 1일 6시간 이상 간병인 사용 확인서가 기준입니다.' : '8시간제 상품 — 1일 8시간 이상 간병인 사용 확인서가 기준입니다.' });
    }
    if (input.silson5) {
      rows.push({ dambo: '5세대 실손(비중증 특약2)', kind: '실손', need: ['detail', 'receipt'], ok: docSet.detail && docSet.receipt, why: '연 1,000만원 한도·자기부담 50%. 도수·체외충격파·비급여 주사·미등재 신의료기술은 보장 제외(0원)입니다.' });
    }

    const required = requiredDocs(cls, input);
    const missing = required.filter((r) => !docSet[r.key]);
    const checkedCount = DOCS.filter((d) => docSet[d.key]).length;
    const soleReceipt = checkedCount > 0 && !docSet.dx && !docSet.surgery && !docSet.path;

    const notes = [];
    if (soleReceipt) notes.push('영수증만으로는 수술 종수·원발/전이암 판정이 불가능합니다. 수술확인서와 병리조직결과지가 1순위로 필요한 서류입니다.');
    if (cls.silson) notes.push(cls.silson);
    if (input.silson5) notes.push('5세대 비중증 제외 4항목(도수·체외충격파·비급여 주사·미등재 신의료기술)은 자기부담 50%가 아니라 0원입니다.');
    if (input.care) notes.push('간병일당은 요양병원 제외/포함, 지급 기준(8시간제·6시간제), 가족 간병 인정 여부를 증권에서 확인하세요.');
    (cls.caveat || []).forEach((c) => notes.push(c));
    if (code.group === '암' && docSet.path && !docSet.dx) notes.push('병리 결과지만으로는 진단확정일을 증명하기 어렵습니다 — 진단서를 함께 받으세요.');

    const expiry = input.accident ? expiryOf(input.accident) : null;
    return { code, cls, rows, missing, notes, soleReceipt, expiry, disclaimer: DISCLAIMER };
  }

  function expiryOf(accident) {
    const date = addMonths(accident, 36);
    const days = diffDays(todayISO(), date);
    return {
      date, days,
      tone: days < 0 ? 'danger' : days <= 90 ? 'danger' : days <= 180 ? 'warn' : 'ok',
      label: days < 0 ? '시효 완성 — 청구권 소멸 위험' : days <= 90 ? '긴급 — 90일 이내' : days <= 180 ? '주의 — 6개월 이내' : '여유',
      note: '계속 입원·통원으로 청구가 나뉘면 시효 기산일이 달라질 수 있습니다(입원 종료일·최종 진료일 기준). 보험사에 기산일을 확인하세요.'
    };
  }

  /* =========================================================
     화면
     ========================================================= */
  let picked = null;      /* 선택된 FC_CODES 항목 */
  let lastResult = null;

  function readInput() {
    const docs = {};
    $$('#cc-docs [data-cc-doc]').forEach((b) => { docs[b.dataset.ccDoc] = b.classList.contains('is-on'); });
    const chk = (id) => !!($('#' + id) && $('#' + id).checked);
    const val = (id) => { const el = $('#' + id); return el ? String(el.value || '').trim() : ''; };
    return {
      code: picked, docs,
      accident: val('cc-date'),
      surgery: chk('cc-rider-surgery'), care: chk('cc-rider-care'), careBasis: val('cc-care-basis'),
      silson5: chk('cc-rider-silson'),
      detail: !!docs.detail, receipt: !!docs.receipt
    };
  }

  function paintCodes(list) {
    const host = $('#cm-codes');
    if (!host) return;
    if (!list.length) { host.innerHTML = '<p class="cc-none">검색 결과가 없습니다. 코드(C73) 또는 이름(갑상선암)으로 다시 찾아보세요.</p>'; return; }
    host.innerHTML = list.map((c) => `<button type="button" class="cm-code${picked && picked.code === c.code ? ' is-on' : ''}" data-cm-code="${esc(c.code)}">
      <code>${esc(c.code)}</code><b>${esc(c.name)}</b><span>${esc(c.group)}</span></button>`).join('');
    $$('[data-cm-code]', host).forEach((b) => {
      b.addEventListener('click', () => {
        picked = (typeof FC_CODES !== 'undefined' ? FC_CODES : []).find((c) => c.code === b.dataset.ccCode) || null;
        paintCodes(list);
        paintPicked();
        run();
      });
    });
  }

  function paintPicked() {
    const host = $('#cc-picked');
    if (!host) return;
    if (!picked) { host.innerHTML = '<p class="cc-none">질환·코드를 고르면 확인할 후보 담보를 계산합니다.</p>'; return; }
    host.innerHTML = `<div class="cc-pick">
      <span class="cc-pick-code">${esc(picked.code)}</span>
      <b>${esc(picked.name)}</b>
      <span class="cc-pick-group">${esc(picked.group)}</span>
      <p><b>지급 담보</b> ${esc(picked.pays)}</p>
      <p><b>확인 포인트</b> ${esc(picked.check)}</p>
    </div>`;
  }

  function paintDocs() {
    const host = $('#cc-docs');
    if (!host) return;
    if (host.dataset.bound === '1') return;
    host.dataset.bound = '1';
    host.innerHTML = DOCS.map((d) => `<button type="button" class="cc-doc" data-cc-doc="${d.key}" aria-pressed="false">
      <span class="cc-box" aria-hidden="true"></span><b>${esc(d.label)}</b><em>${esc(d.note)}</em></button>`).join('');
    $$('[data-cc-doc]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const on = !b.classList.contains('is-on');
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
        run();
      });
    });
  }

  function resultHTML(r) {
    if (!r || r.empty) return '<p class="cc-none">먼저 질환·코드를 골라 주세요.</p>';
    const rows = r.rows.map((row) => `<div class="cm-row ${row.ok ? 'is-ok' : (row.locked ? 'is-locked' : 'is-miss')}">
        <div class="cm-row-head"><b>${esc(row.dambo)}</b><span class="cc-kind">${esc(row.kind)}</span><span class="cc-verdict">${row.locked ? '특약 미선택' : (row.ok ? '서류 준비됨' : '서류 더 필요')}</span></div>
        <p>${esc(row.why || '')}</p>
      </div>`).join('');
    const miss = r.missing.length ? `<div class="cc-block cc-miss">
        <div class="cc-block-title">추가로 필요한 서류 — 1순위부터</div>
        <ul class="cc-miss-list">${r.missing.map((m) => `<li><span class="cc-rank">${m.rank}순위</span><b>${esc(DOC_LABEL[m.key] || m.key)}</b><span>${esc(m.why)}</span></li>`).join('')}</ul>
      </div>` : `<div class="cc-block cc-ok"><div class="cc-block-title">추가로 필요한 서류 없음</div><p>핵심 서류가 모두 체크되어 있습니다. 사본·원본 요구 여부만 보험사에 확인하세요.</p></div>`;
    const ex = r.expiry ? `<div class="cc-block cc-expiry tone-${r.expiry.tone}">
        <div class="cc-block-title">상법 제662조 소멸시효 — 사고일 + 3년</div>
        <p class="cc-exp-date">${esc(koDate(r.expiry.date))} <b class="tone-${r.expiry.tone}">${esc(ddayText(r.expiry.days))}</b> <span>${esc(r.expiry.label)}</span></p>
        <p class="cc-exp-note">${esc(r.expiry.note)}</p>
      </div>` : '<div class="cc-block"><div class="cc-block-title">소멸시효</div><p>사고일(진단확정·수술·퇴원일)을 넣으면 3년 만료일과 D-day가 나옵니다.</p></div>';
    return `<div class="cc-block">
        <div class="cc-block-title">확인할 후보 담보</div>
        <div class="cm-rows">${rows || '<p class="cc-none">이 코드에 바로 연결되는 후보 담보가 없습니다. 고지·인수 판단 항목입니다.</p>'}</div>
      </div>
      ${miss}
      ${ex}
      ${r.notes.length ? `<div class="cc-block"><div class="cc-block-title">상담 메모</div><ul class="cc-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
      <p class="cc-disclaimer">※ ${esc(r.disclaimer)}</p>`;
  }

  function run() {
    const input = readInput();
    lastResult = match(input);
    const out = $('#cc-out');
    if (out) out.innerHTML = resultHTML(lastResult);
    return lastResult;
  }

  function init() {
    if (!$('#cc-out')) return;
    paintDocs();
    paintCodes(searchCodes(''));
    paintPicked();
    const q = $('#cc-q');
    const search = () => paintCodes(searchCodes(q ? q.value : ''));
    if (q) {
      q.addEventListener('input', search);
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    }
    const sb = $('#cc-search'); if (sb) sb.addEventListener('click', search);
    const runBtn = $('#cc-run'); if (runBtn) runBtn.addEventListener('click', () => { run(); toast('청구 서류와 담보를 매칭했습니다'); });
    const dateEl = $('#cc-date'); if (dateEl) dateEl.addEventListener('change', run);
    ['cc-rider-surgery', 'cc-rider-care', 'cc-rider-silson', 'cc-care-basis'].forEach((id) => {
      const el = $('#' + id); if (el) el.addEventListener('change', run);
    });
    run();
  }

  root.BojangClaimCheck = {
    init, run, match, classify, searchCodes, findCode, expiryOf, DOCS, DISCLAIMER,
    pick: (codeStr) => {
      picked = (typeof FC_CODES !== 'undefined' ? FC_CODES : []).find((c) => c.code === codeStr) || null;
      paintCodes(searchCodes(codeStr)); paintPicked(); return run();
    },
    selected: () => picked,
    date: { addMonths, diffDays, ddayText, koDate, todayISO }
  };
})(typeof window !== 'undefined' ? window : globalThis);
