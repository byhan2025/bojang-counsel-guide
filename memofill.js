/* 보장분석 라이프 리포트 v7.0 — 상담 메모 → 6단계 빠른 채움 (memofill.js)

   상담 전 받은 메모(카톡·문자·수첩)를 붙여넣으면 이름·나이/생년월일·월 보험료·가족력·
   보유 담보·고지 이력 키워드를 뽑아 6단계 입력칸에 바로 넣습니다.

   · 기본값은 100% 브라우저 로컬 파싱입니다. 외부 AI 서버로 보내지 않고, 메모 원문은 저장하지 않습니다.
     v7.1 — 다만 뽑아낸 값(이름·보험료·담보 금액 등)은 상담 입력란에 반영되어 localStorage·IndexedDB에
     저장되고, 로그인 후 클라우드 동기화를 켜면 Supabase로 함께 동기화됩니다. 화면 안내에 이 경계를 나눠 적었습니다.
     (4호 지적: '메모 원문 미저장'과 '추출값 미저장'을 같은 말로 읽히게 두면 안 됩니다.)
   · 뽑아낸 값은 '무엇을 어디에 넣었는지' 목록으로 보여 주고, 한 번에 되돌릴 수 있습니다.
   · 확신할 수 없는 값(금액 단위가 모호한 경우 등)은 넣지 않고 '확인 필요'로 남깁니다. */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = (m) => { if (root.__bojangToast) root.__bojangToast(m); };

  const BADGE = '기기에서만 처리(로컬)';

  const EXAMPLE = '김서연 42세 여성, 월 보험료 18만원. 암 5000, 뇌 2000, 심장 1500, 수술 1~5종 300, 간병 10만원. 부모님 암 가족력. 고혈압 약 3년째 복용, 5년 전 담낭 수술. 실손 4세대.';

  /* =========================================================
     금액 파싱 — '5천만' '1억' '5000' 모두 만원 단위로
     ========================================================= */
  function toManwon(numStr, unit) {
    const n = Number(String(numStr || '').replace(/[,]/g, ''));
    if (!isFinite(n) || n <= 0) return null;
    const u = unit || '만';
    if (u === '억') return Math.round(n * 10000);
    if (u === '천만') return Math.round(n * 1000);
    return Math.round(n);
  }
  function manwonLabel(v) {
    const n = Number(v || 0);
    if (n >= 10000) return (n / 10000).toFixed(n % 10000 === 0 ? 0 : 1) + '억';
    return n.toLocaleString('ko-KR') + '만원';
  }

  /* 키워드 뒤 12자 안의 숫자(+단위)를 찾습니다. 없으면 null */
  function amountAfter(text, leadRegExp) {
    const re = new RegExp('(?:' + leadRegExp + ')[^0-9]{0,14}(\\d{1,5}(?:[.,]\\d+)?)\\s*(억|천만|만)?', 'i');
    const m = re.exec(text);
    if (!m) return null;
    const unit = m[2] || '만';
    const v = toManwon(m[1], unit);
    if (v == null || v < 1) return null;
    return v;
  }

  /* =========================================================
     파싱
     ========================================================= */
  const DISC_RULES = [
    { re: '(고혈압|혈압약|혈압강하제|혈압 조절)', keys: ['y5m_htn'], label: '고혈압', always: ['m3_daily'], why: '혈압약 상시 복용은 3개월 문항이기도 합니다' },
    { re: '(당뇨|인슐린|혈당약)', keys: ['y5m_dm'], label: '당뇨병', always: ['m3_daily'] },
    { re: '(협심증|스텐트|관상동맥)', keys: ['y5m_angina'], label: '협심증' },
    { re: '(심근경색)', keys: ['y5m_mi'], label: '심근경색' },
    { re: '(뇌졸중|뇌출혈|뇌경색)', keys: ['y5m_stroke'], label: '뇌졸중' },
    { re: '(간경화)', keys: ['y5m_cirr'], label: '간경화' },
    { re: '(위암|유방암|갑상선암|폐암|대장암|간암|자궁암|전립선암|암 진단|암진단|암 수술|암수술|암 병력)', keys: ['y5m_cancer'], label: '암' },
    { re: '(입원)', keys: ['y5_inop'], label: '입원', period: { '3개월': ['m3_in', 'y2_inop'], '1년': ['y2_inop'], '2년': ['y2_inop'] } },
    { re: '(수술)', keys: ['y5_inop'], label: '수술', period: { '3개월': ['m3_op', 'y2_inop'], '1년': ['y2_inop'], '2년': ['y2_inop'] } },
    { re: '(투약|복용|처방)', keys: ['m3_med'], label: '투약' }
  ];

  function periodBefore(text, idx) {
    const head = text.slice(Math.max(0, idx - 14), idx);
    if (/3\s*개월/.test(head)) return '3개월';
    if (/1\s*년/.test(head)) return '1년';
    if (/2\s*년/.test(head)) return '2년';
    if (/5\s*년/.test(head)) return '5년';
    return '';
  }

  function parseBirth(text) {
    let m = /(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})\s*일?/.exec(text);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      if (y >= 1900 && y <= 2026 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
      return null;   /* 42.3.5 처럼 연도가 2자리면 나이로 오해될 수 있어 넣지 않습니다 */
    }
    m = /(?:생년월일|주민번호 앞자리)\s*[:：]?\s*(\d{2}|\d{4})\s*[.\-\/]?\s*(\d{2})\s*[.\-\/]?\s*(\d{2})/.exec(text);
    if (m) {
      let y = Number(m[1]);
      if (y < 100) y = y > 26 ? 1900 + y : 2000 + y;
      const yy = y, mo = Number(m[2]), d = Number(m[3]);
      if (yy >= 1900 && yy <= 2026 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    return null;
  }

  function parseAge(text) {
    const m = /(?:만\s*)?(\d{2})\s*(?:세|살)/.exec(text);
    if (!m) return null;
    const a = Number(m[1]);
    return a >= 0 && a <= 100 ? a : null;
  }

  function parseName(text) {
    const NOT_NAME = /^(부모|아버지|어머니|아빠|엄마|배우자|아내|남편|자녀|아들|딸|형제|자매|동생|본인|가족|고객|상담|보험|실손|남성|여성)$/;
    const ok = (s) => !!s && /^[가-힣]{2,4}$/.test(s) && !NOT_NAME.test(s);
    const labeled = /(?:고객명|성함|이름)\s*[:：]?\s*([가-힣]{2,4})/.exec(text);
    if (labeled && ok(labeled[1])) return labeled[1];
    const withNim = /([가-힣]{2,4})\s*(?:고객)?님/.exec(text);
    if (withNim && withNim.index < 30 && ok(withNim[1])) return withNim[1];
    const head = /^\s*([가-힣]{2,4})(?=\s|,|\d)/.exec(text);
    if (head && ok(head[1])) return head[1];
    return '';
  }

  function parsePremium(text) {
    let m = /(?:월\s*)?보험료[^0-9]{0,10}(\d{1,3}(?:[.,]\d+)?)\s*(만)?\s*원?/.exec(text);
    if (m) { const v = toManwon(m[1], m[2] ? '만' : '만'); if (v && v <= 300) return v; }
    m = /(?:월|매달|한\s*달)\s*(\d{1,3})\s*만\s*원?/.exec(text);
    if (m) { const v = Number(m[1]); if (v > 0 && v <= 300) return v; }
    m = /(\d{1,3})\s*만\s*원\s*(?:정도|내외)?\s*(?:내고|납입|내요|냅니다)/.exec(text);
    if (m) { const v = Number(m[1]); if (v > 0 && v <= 300) return v; }
    return null;
  }

  function parseSilson(text) {
    const m = /실손[^0-9]{0,8}([1-5])\s*세대/.exec(text) || /([1-5])\s*세대\s*실손/.exec(text);
    if (m) return m[1];
    if (/실손\s*(없|미가입|0)/.test(text)) return 'none';
    return null;
  }

  function parse(text) {
    const t = String(text || '');
    const out = { name: '', birth: '', age: null, gender: '', premium: null, silson: null, family: [], cov: {}, disc: {}, hits: [], warnings: [] };
    if (!t.trim()) return out;

    out.name = parseName(t);
    out.birth = parseBirth(t) || '';
    out.age = parseAge(t);
    if (/여성|여자|여\s*고객|\(여\)|여성분/.test(t)) out.gender = '여';
    else if (/남성|남자|남\s*고객|\(남\)|남성분/.test(t)) out.gender = '남';
    out.premium = parsePremium(t);
    out.silson = parseSilson(t);

    /* 가족력 — '가족력' 근처에 있는 질병만 */
    if (/가족력\s*(없|없음|해당\s*없)/.test(t)) out.family = ['none'];
    else {
      const famIdx = t.search(/가족력|부모|아버지|어머니|아빠|엄마|형제|자매/);
      if (famIdx >= 0) {
        const near = t.slice(famIdx, famIdx + 60);
        if (/암/.test(near)) out.family.push('cancer');
        if (/뇌|뇌졸중|뇌출혈/.test(near)) out.family.push('brain');
        if (/심장|협심증|심근경색/.test(near)) out.family.push('heart');
        if (/치매/.test(near)) out.family.push('dementia');
        if (out.family.length) out.hits.push({ field: '가족력', value: out.family.map((k) => ({ cancer: '암', brain: '뇌혈관', heart: '심장', dementia: '치매' }[k])).join(' · ') });
      }
    }

    /* 보유 담보 */
    const cancer = amountAfter(t, '암(?!\\s*(?:수술|진단|보험료|가족|병력))');
    if (cancer) {
      out.cov.cancer = { general: cancer };
      out.hits.push({ field: '암 진단비', value: manwonLabel(cancer) });
    }
    const brainLead = /뇌출혈/.test(t) ? '뇌출혈' : /뇌졸중/.test(t) ? '뇌졸중' : '뇌';
    const brain = /뇌/.test(t) ? amountAfter(t, brainLead) : null;
    if (brain) {
      const part = /뇌졸중/.test(t) ? 'stroke' : /뇌출혈/.test(t) ? 'bleed' : 'vascular';
      out.cov.brain = { [part]: brain };
      out.hits.push({ field: '뇌 진단비', value: manwonLabel(brain) + (part === 'stroke' ? ' (뇌졸중)' : part === 'bleed' ? ' (뇌출혈)' : ' (뇌혈관)') });
    }
    const heartLead = /심근경색/.test(t) ? '심근경색' : /허혈/.test(t) ? '허혈성심장' : '심장';
    const heart = /심장|허혈|심근경색/.test(t) ? amountAfter(t, heartLead) : null;
    if (heart) {
      const part = /급성\s*심근경색|심근경색/.test(t) ? 'ami' : 'ischemic';
      out.cov.heart = { [part]: heart };
      out.hits.push({ field: '심장 진단비', value: manwonLabel(heart) + (part === 'ami' ? ' (급성심근경색)' : ' (허혈성)') });
    }
    const surgery = /수술/.test(t) ? amountAfter(t, '(?:수술비|수술\\s*1\\s*~\\s*5\\s*종|수술\\s*5종|수술비\\s*1~5종|수술)') : null;
    if (surgery) {
      out.cov.surgery = { disease15: surgery };
      out.hits.push({ field: '질병 1~5종 수술비', value: manwonLabel(surgery) });
    }
    const care = /간병/.test(t) ? amountAfter(t, '간병(?:비|일당)?') : null;
    if (care) {
      out.cov.care = { daily: care };
      out.hits.push({ field: '간병 일당', value: manwonLabel(care) });
    }

    /* 고지 이력 */
    DISC_RULES.forEach((r) => {
      const re = new RegExp(r.re, 'i');
      const m = re.exec(t);
      if (!m) return;
      const period = periodBefore(t, m.index);
      let keys = r.keys.slice();
      if (period && r.period && r.period[period]) keys = r.keys.concat(r.period[period]);
      (r.always || []).forEach((k) => { if (keys.indexOf(k) < 0) keys.push(k); });
      keys.forEach((k) => { out.disc[k] = true; });
      out.hits.push({ field: '고지 · ' + r.label, value: (period ? period + ' 이내 — ' : '') + '체크' });
    });
    /* 암 언급은 수술·진단 문맥일 때만 고지로 잡습니다(담보 금액 문맥 제외) */
    if (/암\s*(?:진단|수술|치료|병력)|(?:위암|유방암|갑상선암|폐암|대장암|간암)/.test(t) && !out.disc.y5m_cancer) {
      out.disc.y5m_cancer = true;
      out.hits.push({ field: '고지 · 암', value: '체크' });
    }

    if (!out.hits.length) out.warnings.push('메모에서 채울 값을 찾지 못했습니다. 이름·나이·보험료·담보 금액을 숫자로 적어 주세요.');
    return out;
  }

  /* =========================================================
     반영 / 되돌리기
     ========================================================= */
  let backup = null;

  /* v7.0 — 메모로 자동 입력한 필드는 노란 강조(검증·수정 유도).
     고객이 직접 고치면 그 칸의 강조는 사라집니다. 메모 원문은 저장하지 않습니다. */
  const MARKS = [];
  function clearMarks() {
    while (MARKS.length) { const el = MARKS.pop(); if (el) el.classList.remove('mf-filled'); }
  }
  function markEl(el) {
    if (!el || el.classList.contains('mf-filled')) return;
    el.classList.add('mf-filled');
    MARKS.push(el);
    const off = () => { el.classList.remove('mf-filled'); const i = MARKS.indexOf(el); if (i >= 0) MARKS.splice(i, 1); };
    el.addEventListener('input', off, { once: true });
    el.addEventListener('change', off, { once: true });
    el.addEventListener('click', off, { once: true });
  }
  function markFilled(parsed) {
    clearMarks();
    if (!parsed) return 0;
    const sels = [];
    if (parsed.name) sels.push('#client-name');
    if (parsed.birth) sels.push('#client-birth');
    if (parsed.premium != null) sels.push('#premium');
    if (parsed.age != null) sels.push('#seg-age .is-on');
    if (parsed.gender) sels.push('#seg-gender .is-on');
    if (parsed.silson) sels.push('#seg-silson .is-on');
    (parsed.family || []).forEach((k) => sels.push(`#family-chips [data-fam="${k}"]`));
    Object.keys(parsed.disc || {}).forEach((k) => sels.push(`#disclosure-checks [data-disc="${k}"]`));
    if (parsed.cov && parsed.cov.cancer) sels.push('input[data-item="cancer"][data-part="general"]');
    if (parsed.cov && parsed.cov.brain) Object.keys(parsed.cov.brain).forEach((k) => sels.push(`input[data-item="brain"][data-part="dx"][data-sub="${k}"]`));
    if (parsed.cov && parsed.cov.heart) Object.keys(parsed.cov.heart).forEach((k) => sels.push(`input[data-item="heart"][data-part="dx"][data-sub="${k}"]`));
    if (parsed.cov && parsed.cov.surgery) sels.push('input[data-item="surgery"][data-part="disease15"]');
    if (parsed.cov && parsed.cov.care) sels.push('input[data-item="care"][data-part="daily"]');
    let n = 0;
    sels.forEach((sel) => { const el = $(sel); if (el) { markEl(el); n++; } });
    return n;
  }

  function snapshot() {
    const S = root.BojangApp && root.BojangApp.state;
    if (!S) return null;
    return JSON.stringify({
      client: S.client, age: S.age, gender: S.gender, premium: S.premium, silson: S.silson,
      family: S.family, cov: S.cov, disc: S.disc
    });
  }

  function apply(parsed) {
    const S = root.BojangApp && root.BojangApp.state;
    if (!S || !parsed) return 0;
    backup = snapshot();
    let n = 0;

    if (parsed.name) { S.client.name = parsed.name; n++; }
    if (parsed.birth) { S.client.birth = parsed.birth; n++; }
    if (parsed.age != null) { S.age = String(Math.max(20, Math.min(70, Math.floor(parsed.age / 10) * 10))); n++; }
    if (parsed.gender) { S.gender = parsed.gender; n++; }
    if (parsed.premium != null) { S.premium = parsed.premium; n++; }
    if (parsed.silson) { S.silson = parsed.silson; n++; }
    if (parsed.family && parsed.family.length) { S.family = parsed.family.slice(); n++; }

    Object.keys(parsed.cov || {}).forEach((area) => {
      const patch = parsed.cov[area];
      if (!S.cov[area]) return;
      if (area === 'cancer' && patch.general != null) { S.cov.cancer.general = patch.general; n++; }
      if (area === 'brain') {
        Object.keys(patch).forEach((k) => { if (S.cov.brain.dx[k] != null) { S.cov.brain.dx[k] = patch[k]; n++; } });
      }
      if (area === 'heart') {
        Object.keys(patch).forEach((k) => { if (S.cov.heart.dx[k] != null) { S.cov.heart.dx[k] = patch[k]; n++; } });
      }
      if (area === 'surgery' && patch.disease15 != null) { S.cov.surgery.disease15 = patch.disease15; n++; }
      if (area === 'care' && patch.daily != null) { S.cov.care.daily = patch.daily; n++; }
    });

    Object.keys(parsed.disc || {}).forEach((k) => { S.disc[k] = true; n++; });

    if (root.BojangModel && root.BojangModel.normalizeState) { try { root.BojangModel.normalizeState(S); } catch (e) { /* noop */ } }
    if (root.BojangApp && root.BojangApp.renderAllInputs) root.BojangApp.renderAllInputs();
    if (root.BojangApp && root.BojangApp.discTouched) { try { root.BojangApp.discTouched(); } catch (e) { /* noop */ } }
    markFilled(parsed);
    return n;
  }

  function undo() {
    const S = root.BojangApp && root.BojangApp.state;
    if (!S || !backup) return false;
    const b = JSON.parse(backup);
    S.client = b.client; S.age = b.age; S.gender = b.gender; S.premium = b.premium; S.silson = b.silson;
    S.family = b.family; S.cov = b.cov; S.disc = b.disc;
    if (root.BojangApp && root.BojangApp.renderAllInputs) root.BojangApp.renderAllInputs();
    if (root.BojangApp && root.BojangApp.discTouched) { try { root.BojangApp.discTouched(); } catch (e) { /* noop */ } }
    backup = null;
    clearMarks();
    return true;
  }

  /* =========================================================
     화면
     ========================================================= */
  function outHTML(parsed, applied) {
    const hits = parsed.hits.map((h) => `<li><b>${esc(h.field)}</b><span>${esc(h.value)}</span></li>`).join('');
    const warns = (parsed.warnings || []).map((w) => `<li class="mf-warn">${esc(w)}</li>`).join('');
    return `<div class="mf-out-head">
        <b>${applied ? applied + '개 항목을 입력칸에 넣었습니다' : '메모에서 찾은 값'}</b>
        <span class="mf-local">🔒 ${esc(BADGE)} · 외부 전송 0건</span>
      </div>
      <ul class="mf-hits">${hits || '<li>채울 값을 찾지 못했습니다.</li>'}</ul>
      ${warns ? `<ul class="mf-hits">${warns}</ul>` : ''}
      ${applied ? '<p class="mf-next">노란 칸은 메모에서 읽어 넣은 값입니다 — 고객에게 확인하고 틀린 칸만 고치면 강조가 사라집니다. 1단계 기본 정보 → 2단계 암 보장 순서로 확인하세요.</p>' : ''}`;
  }

  function run() {
    const ta = $('#mf-text');
    const out = $('#mf-out');
    if (!ta || !out) return null;
    const parsed = parse(ta.value);
    const applied = apply(parsed);
    out.innerHTML = outHTML(parsed, applied);
    const undoBtn = $('#mf-undo');
    if (undoBtn) undoBtn.hidden = !applied;
    if (applied) toast('메모에서 ' + applied + '개 항목을 채웠습니다 · 기기에서만 처리');
    return { parsed, applied };
  }

  function toggle(open) {
    const body = $('#mf-body');
    const btn = $('#mf-toggle');
    if (!body || !btn) return;
    const next = open == null ? body.hidden : !!open;
    body.hidden = !next;
    btn.setAttribute('aria-expanded', String(next));
    $('#memo-fill').classList.toggle('is-open', next);
    if (next) setTimeout(() => { const ta = $('#mf-text'); if (ta) ta.focus({ preventScroll: true }); }, 60);
  }

  function init() {
    if (!$('#memo-fill')) return;
    const btn = $('#mf-toggle');
    if (btn) btn.addEventListener('click', () => toggle());
    const runBtn = $('#mf-parse');
    if (runBtn) runBtn.addEventListener('click', run);
    const undoBtn = $('#mf-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => {
      if (undo()) { toast('메모 반영 전 상태로 되돌렸습니다'); const out = $('#mf-out'); if (out) out.innerHTML = ''; undoBtn.hidden = true; }
    });
    const exBtn = $('#mf-example');
    if (exBtn) exBtn.addEventListener('click', () => { const ta = $('#mf-text'); if (ta) { ta.value = EXAMPLE; ta.focus(); } });
  }

  /* v7.0 — 새 상담·초기화 시 메모 원문과 강조를 비웁니다. 메모는 어디에도 저장하지 않습니다. */
  function reset() {
    const ta = $('#mf-text'); if (ta) ta.value = '';
    const out = $('#mf-out'); if (out) out.innerHTML = '';
    const u = $('#mf-undo'); if (u) u.hidden = true;
    clearMarks();
    backup = null;
  }

  root.BojangMemoFill = { init, parse, apply, undo, run, toggle, reset, EXAMPLE, BADGE, toManwon, manwonLabel };
})(typeof window !== 'undefined' ? window : globalThis);
