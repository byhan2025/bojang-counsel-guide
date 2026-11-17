/* 보장분석 라이프 리포트 v7.1 — 공공데이터 실무 연동 (publicdata.js)

   현장 툴킷의 'F · PUBLIC DATA' 카드가 씁니다. 세 가지를 100% 오프라인 내장 데이터로 즉시 계산합니다.
     ① 복용약 기반 고지 누락 체크 — 식약처·약학정보원 식 의약품 개념을 내장 사전(성분·대표 브랜드)으로 옮겨
        약 이름을 넣으면 질환군과 3개월·1년·5년 / 간편 3·2·5 문항 중 확인할 것을 바로 보여 줍니다.
     ② 고객 연령·성별·가족력 맞춤 공식 통계 + 약관 괴리 — 통계청 2024 사망원인, 중앙암등록본부 2023,
        중앙심뇌혈관질환센터·건보 2023, 건보공단 2025 노인장기요양을 조건에 맞춰 카드화하고,
        모든 카드에 '출처 · 기준연도 · 대상 범위'를 한 줄로 고정 표기합니다. 공공 진료통계(I65·I66·I20)와
        민영보험 약관 지급 기준(뇌졸중·급성심근경색)의 괴리를 따로 병기합니다.
     ③ 특일(공휴일) 반영 영업일·청구 마감일 보정 — 2026~2028 공휴일 내장 달력(2028은 잠정)으로
        마감일이 주말·공휴일과 겹치면 직전 영업일과 다음 영업일을 함께 안내합니다.

   · 기본 동작은 100% 이 기기 안. 외부 전송은 기본 OFF 이고, 대표가 프록시 주소를 직접 넣고
     '실시간 조회'를 누른 그 검색어(약 이름)만 나갑니다. 고객 이름·연락처·증권 값은 어떤 경로로도 나가지 않습니다.
   · 확정 판정이 아닙니다. 고지 의무는 청약서 문항, 지급은 상품 약관이 기준입니다 — 추정하지 않고 '확인 필요'로 남깁니다. */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = (m) => { if (root.__bojangToast) root.__bojangToast(m); };

  const DISCLAIMER = '본 결과는 상담 참고용이며 최종 지급 여부는 상품 약관 및 보험사 심사에 따릅니다.';

  /* =========================================================
     날짜 유틸 — aftercare.js · claimcheck.js 와 같은 UTC 규칙
     ========================================================= */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function parts(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
    return { y, m: mo, d };
  }
  function isoOf(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function toUTC(s) { const p = parts(s); return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : null; }
  function todayISO() { const n = new Date(); return n.getFullYear() + '-' + pad2(n.getMonth() + 1) + '-' + pad2(n.getDate()); }
  function addDays(s, n) {
    const d = toUTC(s);
    if (!d) return null;
    d.setUTCDate(d.getUTCDate() + Number(n || 0));
    return isoOf(d);
  }
  function addMonths(s, n) {
    const d = toUTC(s);
    if (!d) return null;
    const day = d.getUTCDate();
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Number(n || 0), 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return isoOf(t);
  }
  function diffDays(from, to) {
    const a = toUTC(from), b = toUTC(to);
    return (!a || !b) ? null : Math.round((b - a) / 86400000);
  }
  function koDate(s) { const p = parts(s); return p ? `${p.y}년 ${p.m}월 ${p.d}일` : ''; }
  function dday(days) { return days == null ? '' : days === 0 ? 'D-DAY' : (days > 0 ? 'D-' + days : 'D+' + Math.abs(days)); }
  function weekday(s) { const d = toUTC(s); return d ? ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()] : ''; }

  /* =========================================================
     ③ 특일(공휴일) 내장 달력 — 2026~2028
     출처: 「관공서의 공휴일에 관한 규정」(2026.4.30. 개정) · 우주항공청 월력요항
           · 한국천문연구원 특일 정보(2026·2027 확정, 2028은 월력요항 공고 전 잠정)
     ※ 임시공휴일과 보궐선거일은 그때 지정되므로 '임시공휴일 추가'로 직접 넣습니다.
     ========================================================= */
  const HOLIDAYS = {
    /* ── 2026 (확정) ── */
    '2026-01-01': '신정',
    '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
    '2026-03-01': '삼일절', '2026-03-02': '대체공휴일(삼일절)',
    '2026-05-01': '노동절', '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일(부처님오신날)',
    '2026-06-03': '전국동시지방선거일', '2026-06-06': '현충일',
    '2026-07-17': '제헌절',
    '2026-08-15': '광복절', '2026-08-17': '대체공휴일(광복절)',
    '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
    '2026-10-03': '개천절', '2026-10-05': '대체공휴일(개천절)',
    '2026-10-09': '한글날', '2026-12-25': '기독탄신일',
    /* ── 2027 (확정) ── */
    '2027-01-01': '신정',
    '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴', '2027-02-09': '대체공휴일(설날)',
    '2027-03-01': '삼일절',
    '2027-05-01': '노동절', '2027-05-03': '대체공휴일(노동절)', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날',
    '2027-06-06': '현충일',
    '2027-07-17': '제헌절', '2027-07-19': '대체공휴일(제헌절)',
    '2027-08-15': '광복절', '2027-08-16': '대체공휴일(광복절)',
    '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
    '2027-10-03': '개천절', '2027-10-04': '대체공휴일(개천절)',
    '2027-10-09': '한글날', '2027-10-11': '대체공휴일(한글날)',
    '2027-12-25': '기독탄신일', '2027-12-27': '대체공휴일(기독탄신일)',
    /* ── 2028 (잠정 — 월력요항 공고 전, 천문연구원 양음력 기준) ── */
    '2028-01-01': '신정',
    '2028-01-26': '설날 연휴', '2028-01-27': '설날', '2028-01-28': '설날 연휴',
    '2028-03-01': '삼일절', '2028-04-12': '국회의원선거일',
    '2028-05-01': '노동절', '2028-05-02': '부처님오신날', '2028-05-05': '어린이날',
    '2028-06-06': '현충일', '2028-07-17': '제헌절', '2028-08-15': '광복절',
    '2028-10-02': '추석 연휴', '2028-10-03': '추석·개천절', '2028-10-04': '추석 연휴',
    '2028-10-05': '대체공휴일(추석·개천절)', '2028-10-09': '한글날', '2028-12-25': '기독탄신일'
  };
  const PROVISIONAL_YEAR = 2028;

  const calendar = {
    holidays: HOLIDAYS,
    name(s) { return HOLIDAYS[s] || ''; },
    isWeekend(s) { const d = toUTC(s); return d ? (d.getUTCDay() === 0 || d.getUTCDay() === 6) : false; },
    isHoliday(s) { return !!HOLIDAYS[s]; },
    isBusinessDay(s) { return !!parts(s) && !this.isWeekend(s) && !this.isHoliday(s); },
    reason(s) {
      if (!parts(s)) return '';
      if (this.isHoliday(s)) return HOLIDAYS[s];
      if (this.isWeekend(s)) return weekday(s) + '요일';
      return '';
    },
    prev(s) { let c = addDays(s, -1); let n = 0; while (c && !this.isBusinessDay(c) && n < 30) { c = addDays(c, -1); n++; } return c; },
    next(s) { let c = addDays(s, 1); let n = 0; while (c && !this.isBusinessDay(c) && n < 30) { c = addDays(c, 1); n++; } return c; },
    /* 마감일 보정 — 겹치면 직전·다음 영업일을 함께. deadline 는 '직전 영업일'이 원칙(청약철회·청구). */
    correct(s) {
      const base = parts(s) ? s : null;
      if (!base) return null;
      const ok = this.isBusinessDay(base);
      return {
        date: base, ok,
        reason: ok ? '' : this.reason(base),
        prev: ok ? base : this.prev(base),
        next: ok ? base : this.next(base),
        provisional: Number(base.slice(0, 4)) >= PROVISIONAL_YEAR
      };
    },
    /* 두 날짜 사이 영업일 수(양끝 제외) */
    businessDays(a, b) {
      if (!parts(a) || !parts(b)) return null;
      const dir = diffDays(a, b) >= 0 ? 1 : -1;
      let c = a, n = 0, guard = 0;
      while (c !== b && guard < 400) {
        c = addDays(c, dir);
        if (c !== b && this.isBusinessDay(c)) n++;
        guard++;
      }
      return n;
    },
    upcoming(from, count) {
      const start = parts(from) ? from : todayISO();
      const list = [];
      let c = start;
      for (let i = 0; i < 400 && list.length < (count || 5); i++) {
        c = addDays(c, 1);
        if (this.isHoliday(c)) list.push({ date: c, name: HOLIDAYS[c], weekday: weekday(c), provisional: Number(c.slice(0, 4)) >= PROVISIONAL_YEAR });
      }
      return list;
    },
    /* 2026~2028 밖이면 안내용 플래그 */
    covered(s) { return !!parts(s) && Number(s.slice(0, 4)) >= 2026 && Number(s.slice(0, 4)) <= PROVISIONAL_YEAR; }
  };

  /* =========================================================
     ① 복용약 → 고지 문항 사전 (성분 + 대표 브랜드)
     문항 키는 content.js DISCLOSURE_ITEMS 와 같습니다.
       m3_med(3개월 투약) · m3_daily(3개월 상시 복용) · y5_med30(5년 30일 이상 투약) · y5_major(5년 10대 질병)
     ========================================================= */
  const GROUPS = {
    htn: { label: '고혈압', kcd: 'I10', major: '고혈압', note: '혈압강하제는 대개 기간을 정하지 않고 계속 복용합니다 — 3개월 문항의 "상시 복용"과 5년 10대 질병(고혈압)에 함께 걸립니다.' },
    dm: { label: '당뇨병', kcd: 'E10~E14', major: '당뇨병', note: '경구혈당강하제·인슐린은 상시 복용으로 봅니다. 합병증(신장·망막·신경) 진단이 있으면 인수 조건이 달라집니다.' },
    lipid: { label: '이상지질혈증(고지혈증)', kcd: 'E78', major: '', note: '스타틴은 10대 질병에는 없지만 상시 복용 문항에 해당할 수 있습니다. 30일 이상 투약이면 5년 투약 문항도 확인합니다.' },
    cad: { label: '관상동맥질환(협심증·심근경색)', kcd: 'I20~I25', major: '협심증·심근경색', note: '협심증·심근경색은 10대 질병입니다. 스텐트·혈관성형술은 약관에서 "수술"이 아닌 "처치"로 분류되는 상품이 많습니다.' },
    af: { label: '심방세동·항응고 치료', kcd: 'I48', major: '', note: '항응고제 복용은 출혈 위험으로 인수 심사에 영향을 줍니다. 3개월 투약 문항과 함께 부정맥 진단 시기를 확인하세요.' },
    hf: { label: '심부전·심장질환', kcd: 'I50', major: '', note: '심부전은 10대 질병 목록에는 없지만 인수 거절·할증이 흔합니다. 입원 이력은 5년 입원 문항 대상입니다.' },
    valve: { label: '심장판막질환', kcd: 'I05~I09·I34~I37', major: '심장판막증', note: '심장판막증은 10대 질병입니다. 수술(판막 치환) 이력은 5년 입원·수술 문항 대상입니다.' },
    thyroid: { label: '갑상선질환', kcd: 'E03·E05', major: '', note: '갑상선기능저하·항진은 10대 질병이 아니지만 상시 복용 문항에 해당할 수 있습니다. 갑상선암 이력은 별도(5년 10대 질병=암).' },
    depression: { label: '우울·불안·수면장애', kcd: 'F32~F41·G47', major: '', note: '항우울제·수면제는 상시 복용 문항의 대표 항목입니다. 정신과 진단·투약 이력은 실손(정신과) 보장에도 영향을 줍니다.' },
    asthma: { label: '천식·COPD', kcd: 'J44·J45', major: '', note: '흡입제는 처방 기록이 남습니다. 입원·응급 치료 이력은 5년 입원 문항으로 확인합니다.' },
    gi: { label: '위식도역류·소화성궤양', kcd: 'K21·K25', major: '', note: '위산분비억제제를 30일 이상 먹었다면 5년 투약 문항을 확인합니다. 제균 치료(헬리코박터)는 3개월 투약 문항입니다.' },
    gout: { label: '통풍·고요산혈증', kcd: 'M10', major: '', note: '요산강하제는 상시 복용으로 봅니다. 통풍은 10대 질병에는 포함되지 않습니다.' },
    osteo: { label: '골다공증', kcd: 'M81', major: '', note: '비스포스포네이트는 상시 복용 문항에 해당할 수 있습니다. 골절·수술 이력은 5년 입원·수술 문항입니다.' },
    bph: { label: '전립선비대·배뇨장애', kcd: 'N40', major: '', note: '전립선약은 상시 복용 항목입니다. 전립선 수술(절제) 이력은 5년 수술 문항 대상입니다.' },
    epilepsy: { label: '간질·신경통·편두통', kcd: 'G40·G43·G50', major: '', note: '항전간제·편두통 예방약은 장기 복용이 많아 5년 투약 문항까지 확인합니다. 운전·직업급수 판단에도 영향이 있습니다.' },
    cancer: { label: '항암·호르몬요법', kcd: 'C00~C97', major: '암', note: '항암제·호르몬제 복용은 5년 10대 질병(암) 문항과 직접 연결됩니다. 재발·전이 담보 가입 가능 여부도 함께 봅니다.' },
    immune: { label: '자가면역·면역억제', kcd: 'M05~M35', major: '', note: '면역억제제는 감염 위험으로 인수 심사에 영향을 줍니다. 3개월 투약과 5년 30일 투약 문항을 함께 확인하세요.' },
    steroid: { label: '경구 스테로이드', kcd: '—', major: '', note: '스테로이드 장기 복용은 상시 복용 문항 대상입니다. 어떤 질환 때문에 처방됐는지가 핵심입니다.' },
    dementia: { label: '치매', kcd: 'F00~F03·G30', major: '', note: '치매 치료제는 인수 제한이 큰 항목입니다. 진단비·간병·장기요양을 따로 확인합니다.' },
    none: { label: '고지 대상 아님(영양제·일반약)', kcd: '—', major: '', note: '처방 없는 영양제·일반의약품 구매는 고지 대상이 아닙니다. 처방전이 있는 약만 문항과 연결됩니다.' }
  };

  const DRUGS = [
    /* 고혈압 */
    { n: '암로디핀', a: '노바스크, 암로디핀정, 아모잘탄(복합), 로사르탄 복합', g: 'htn', it: ['m3_daily', 'm3_med', 'y5_major'], note: '칼슘채널차단제 — 대표적인 상시 복용 혈압약입니다.' },
    { n: '로사르탄', a: '코자르, 로자탄, 로사르탄칼륨, 아모잘탄, 로프레사', g: 'htn', it: ['m3_daily', 'm3_med', 'y5_major'], note: 'ARB 계열 혈압약. 칼륨 수치·신장 기능 확인 이력이 있으면 함께 봅니다.' },
    { n: '텔미사르탄', a: '미카르디스, 텔미원, 트윈스타(복합)', g: 'htn', it: ['m3_daily', 'm3_med', 'y5_major'], note: 'ARB 계열 혈압약.' },
    { n: '비소프롤롤', a: '콩코르, 비소카드, 아모잘탄플러스', g: 'htn', it: ['m3_daily', 'm3_med', 'y5_major'], note: '베타차단제 — 혈압·협심증·부정맥에 함께 쓰여 처방 사유를 확인해야 합니다.' },
    { n: '카르베딜롤', a: '딜라트렌', g: 'htn', it: ['m3_daily', 'm3_med', 'y5_major'], note: '베타차단제. 심부전에도 쓰여 진단명을 확인합니다.' },
    { n: '푸로세미드', a: '라식스, 푸로세미드정', g: 'htn', it: ['m3_daily', 'm3_med'], note: '이뇨제 — 심부전·부종이 원인이면 심장질환 문항으로 봅니다.' },
    { n: '히드로클로로티아지드', a: 'HCT, 다이크로짇', g: 'htn', it: ['m3_daily', 'm3_med', 'y5_major'], note: '이뇨제 계열 혈압약.' },
    { n: '베라파밀', a: '이솝틴, 베라파밀정', g: 'htn', it: ['m3_daily', 'm3_med', 'y5_major'], note: '칼슘채널차단제 — 부정맥에도 쓰입니다.' },
    /* 당뇨 */
    { n: '메트포르민', a: '다이아벡스, 글루코파지, 메트포르민염산염, 메트포르민서방정', g: 'dm', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: '2형 당뇨 1차 약. 5년 10대 질병(당뇨병) 문항에 직접 해당합니다.' },
    { n: '글리메피리드', a: '아마릴, 글리메피리드정', g: 'dm', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: '설폰요소제 경구혈당강하제.' },
    { n: '시타글립틴', a: '자누비아, 자누메트(복합)', g: 'dm', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: 'DPP-4 억제제.' },
    { n: '리나글립틴', a: '트라젠타, 트라젠타듀오(복합)', g: 'dm', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: 'DPP-4 억제제.' },
    { n: '다파글리플로진', a: '포시가, 포시가듀오(복합)', g: 'dm', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: 'SGLT-2 억제제 — 심부전·신장 보호 목적 처방도 늘었습니다.' },
    { n: '엠파글리플로진', a: '자디앙, 자디앙듀오(복합)', g: 'dm', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: 'SGLT-2 억제제.' },
    { n: '인슐린', a: '란투스, 노보래피드, 노보믹스, 트레시바, 휴마로그, 피아스프', g: 'dm', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: '인슐린 주사는 인수 심사에서 가장 무거운 항목 중 하나입니다. 처방 사유·합병증을 확인하세요.' },
    { n: '세마글루타이드', a: '오젬픽, 위고비, 트루리시티(둘라글루타이드)', g: 'dm', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: 'GLP-1 계열 — 당뇨 목적인지 체중감량 목적인지 처방 사유를 구분합니다.' },
    { n: '티르제파타이드', a: '마운자로, 젭바운드', g: 'dm', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: '당뇨·비만 치료제 — 처방 사유(당뇨병 여부)가 고지 문항을 가립니다.' },
    /* 이상지질혈증 */
    { n: '로수바스타틴', a: '크레스토, 로수젯, 로바젯, 로수로젯', g: 'lipid', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '스타틴 — 상시 복용 문항 대표 약입니다.' },
    { n: '아토르바스타틴', a: '리피토, 아토젯, 리피토정', g: 'lipid', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '스타틴 계열.' },
    { n: '피타바스타틴', a: '리바로, 리바로젯', g: 'lipid', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '스타틴 계열 — 근육통 부작용으로 약을 바꾼 이력도 확인합니다.' },
    { n: '에제티미브', a: '이제트롤, 아토젯, 로수젯(복합)', g: 'lipid', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '콜레스테롤 흡수 억제제.' },
    /* 관상동맥 */
    { n: '아스피린', a: '아스피린프로텍트, 아스피린장용정, 바이아스피린', g: 'cad', it: ['m3_daily', 'm3_med', 'y5_major'], note: '저용량 아스피린은 협심증·뇌졸중·스텐트 후 이차예방에 씁니다 — 처방 사유가 곧 고지 대상 질환입니다.' },
    { n: '클로피도그렐', a: '플라빅스, 클로피도그렐정', g: 'cad', it: ['m3_daily', 'm3_med', 'y5_major'], note: '스텐트 시술 후 항혈소판제 — 시술 이력은 5년 입원·수술 문항을 확인합니다.' },
    { n: '실로스타졸', a: '플레탈, 실로스타졸정', g: 'cad', it: ['m3_daily', 'm3_med', 'y5_major'], note: '항혈소판제 — 말초동맥·뇌혈관 질환에도 쓰입니다.' },
    { n: '니트로글리세린', a: '니트로글리세린설하정, 니트로링구알', g: 'cad', it: ['m3_daily', 'm3_med', 'y5_major'], note: '협심증 발작 시 설하정 — 처방 자체가 협심증 진단을 뜻하는 경우가 많습니다.' },
    { n: '이소소르비드', a: '니트로맥스, 이소켓, 이소소르비드질산염', g: 'cad', it: ['m3_daily', 'm3_med', 'y5_major'], note: '협심증 예방제.' },
    { n: '메토프롤롤', a: '베타록, 메토프롤롤타르타르산염', g: 'cad', it: ['m3_daily', 'm3_med', 'y5_major'], note: '베타차단제 — 협심증·심근경색 후 처방이 흔합니다.' },
    /* 심방세동 · 항응고 */
    { n: '와파린', a: '쿠마딘, 와파린나트륨', g: 'af', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '항응고제 — INR 검사 이력이 함께 남습니다. 출혈 위험으로 인수 조건이 달라집니다.' },
    { n: '리바록사반', a: '자렐토', g: 'af', it: ['m3_daily', 'm3_med', 'y5_med30'], note: 'NOAC 항응고제 — 심방세동·정맥혈전증에 씁니다.' },
    { n: '아픽사반', a: '엘리퀴스', g: 'af', it: ['m3_daily', 'm3_med', 'y5_med30'], note: 'NOAC 항응고제.' },
    { n: '다비가트란', a: '프라닥사', g: 'af', it: ['m3_daily', 'm3_med', 'y5_med30'], note: 'NOAC 항응고제.' },
    { n: '에독사반', a: '릭시아나', g: 'af', it: ['m3_daily', 'm3_med', 'y5_med30'], note: 'NOAC 항응고제.' },
    /* 심장 */
    { n: '스피로놀락톤', a: '알닥톤, 스피로놀락톤정', g: 'hf', it: ['m3_daily', 'm3_med'], note: '이뇨제 — 심부전·간경화 복수에 함께 씁니다. 처방 사유를 확인하세요.' },
    { n: '디곡신', a: '디기탈리스, 디곡신정', g: 'hf', it: ['m3_daily', 'm3_med'], note: '심부전·심방세동 치료제.' },
    /* 갑상선 */
    { n: '레보티록신', a: '씬지로이드, 레보티록신나트륨', g: 'thyroid', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '갑상선기능저하증 — 평생 복용이 흔해 상시 복용 문항 대상입니다.' },
    { n: '메티마졸', a: '안티로이드, 메티마졸정', g: 'thyroid', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '갑상선기능항진증 치료제.' },
    { n: '프로필티오우라실', a: 'PTU, 프로필티오우라실정', g: 'thyroid', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '항갑상선제.' },
    /* 정신과 */
    { n: '에스시탈로프람', a: '렉사프로, 에스시탈로프람정', g: 'depression', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '항우울제(SSRI) — 상시 복용 문항의 대표 항목입니다.' },
    { n: '세르트랄린', a: '졸로프트, 세르트랄린정', g: 'depression', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '항우울제(SSRI).' },
    { n: '플루옥세틴', a: '프로작, 플루옥세틴정', g: 'depression', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '항우울제.' },
    { n: '졸피뎀', a: '스틸녹스, 졸피뎀정', g: 'depression', it: ['m3_daily', 'm3_med'], note: '수면제 — 상시 복용·신경안정제 문항 항목입니다.' },
    { n: '알프라졸람', a: '자낙스, 알프라졸람정', g: 'depression', it: ['m3_daily', 'm3_med'], note: '신경안정제(벤조디아제핀) — 문항에 이름이 직접 나오는 약입니다.' },
    { n: '디아제팜', a: '바리움, 디아제팜정', g: 'depression', it: ['m3_daily', 'm3_med'], note: '신경안정제.' },
    { n: '쿠에티아핀', a: '쎄로켈, 쿠에티아핀정', g: 'depression', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '비정형 항정신병약 — 진단명(조현병·양극성·불면)을 확인합니다.' },
    /* 호흡기 */
    { n: '몬테루카스트', a: '싱귤레어, 몬테루카스트정', g: 'asthma', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '천식·알레르기 치료제.' },
    { n: '살메테롤', a: '세레타이드, 심비코트, 플루티폼', g: 'asthma', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '흡입제 복합 — 천식·COPD 처방 기록이 남습니다.' },
    { n: '티오트로피움', a: '스피리바, 스피리바레스피맷', g: 'asthma', it: ['m3_daily', 'm3_med', 'y5_med30'], note: 'COPD 흡입제 — 폐기능 검사 이력과 함께 봅니다.' },
    { n: '알부테롤', a: '벤토린, 벤토린에보할러', g: 'asthma', it: ['m3_daily', 'm3_med'], note: '속효성 기관지확장제.' },
    /* 소화기 */
    { n: '오메프라졸', a: '로섹, 오메프라졸정', g: 'gi', it: ['m3_med', 'y5_med30'], note: '위산분비억제제(PPI) — 30일 이상 복용이면 5년 투약 문항을 확인합니다.' },
    { n: '판토프라졸', a: '판토록, 판토프라졸정', g: 'gi', it: ['m3_med', 'y5_med30'], note: 'PPI 계열.' },
    { n: '에스오메프라졸', a: '넥시움, 에소메졸', g: 'gi', it: ['m3_med', 'y5_med30'], note: 'PPI 계열.' },
    { n: '레바미피드', a: '무코스타, 레바미피드정', g: 'gi', it: ['m3_med', 'y5_med30'], note: '위점막 보호제.' },
    /* 통풍 · 골다공증 · 비뇨 */
    { n: '알로푸리놀', a: '자이로릭, 알로푸리놀정', g: 'gout', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '요산강하제 — 통풍은 10대 질병에는 없습니다.' },
    { n: '페북소스타트', a: '페브릭', g: 'gout', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '요산강하제.' },
    { n: '콜히친', a: '콜히친정, 콜킨', g: 'gout', it: ['m3_med', 'y5_med30'], note: '통풍 발작 치료·예방제.' },
    { n: '알렌드로네이트', a: '포사맥스, 알렌드로네이트정', g: 'osteo', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '골다공증 비스포스포네이트.' },
    { n: '리세드로네이트', a: '악토넬', g: 'osteo', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '골다공증 치료제.' },
    { n: '탐스로신', a: '하루날디, 탐스로신정', g: 'bph', it: ['m3_daily', 'm3_med'], note: '전립선비대증 α차단제.' },
    { n: '두타스테리드', a: '아보다트, 두타스테리드정', g: 'bph', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '전립선비대증 치료제.' },
    /* 신경 */
    { n: '가바펜틴', a: '가바펜틴정, 뉴론틴', g: 'epilepsy', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '신경병증 통증·간질 치료제.' },
    { n: '프레가발린', a: '리리카', g: 'epilepsy', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '신경병증 통증 치료제.' },
    { n: '레베티라세탐', a: '케프라, 레베티라세탐정', g: 'epilepsy', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '항전간제.' },
    { n: '발프로산', a: '데파코트, 오르필', g: 'epilepsy', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '항전간제.' },
    { n: '토피라메이트', a: '토파맥스, 토피라메이트정', g: 'epilepsy', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '편두통 예방·간질 치료제.' },
    { n: '수마트립탄', a: '이미트렉스, 수마트립탄정', g: 'epilepsy', it: ['m3_med', 'y5_med30'], note: '편두통 발작 치료제(트립탄).' },
    /* 항암 · 면역 · 스테로이드 · 치매 */
    { n: '타목시펜', a: '노바덱스, 타목시펜정', g: 'cancer', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: '유방암 호르몬요법 — 5년 10대 질병(암) 문항 대상입니다.' },
    { n: '아나스트로졸', a: '아리미덱스', g: 'cancer', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: '유방암 호르몬요법.' },
    { n: '레트로졸', a: '페마라', g: 'cancer', it: ['m3_daily', 'm3_med', 'y5_major', 'y5_med30'], note: '유방암 호르몬요법.' },
    { n: '메토트렉세이트', a: '메토트렉세이트정, 리우마트렉스', g: 'immune', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '류마티스·건선 등 자가면역 질환에도 씁니다.' },
    { n: '아자티오프린', a: '이무란, 아자티오프린정', g: 'immune', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '면역억제제.' },
    { n: '타크롤리무스', a: '프로그라프, 아드바그라프', g: 'immune', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '이식 후 면역억제제 — 인수 심사 영향이 큽니다.' },
    { n: '프레드니솔론', a: '프레드니솔론정, 솔론, 엔테론', g: 'steroid', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '경구 스테로이드 — 장기 복용이면 상시 복용 문항입니다.' },
    { n: '메틸프레드니솔론', a: '메드롤', g: 'steroid', it: ['m3_med', 'y5_med30'], note: '스테로이드.' },
    { n: '도네페질', a: '아리셉트', g: 'dementia', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '치매 치료제 — 인수 제한이 큰 항목입니다.' },
    { n: '메만틴', a: '에빅사, 메만틴정', g: 'dementia', it: ['m3_daily', 'm3_med', 'y5_med30'], note: '중등도 이상 치매 치료제.' },
    /* 고지 대상 아님 — 오해 방지 */
    { n: '비타민', a: '종합비타민, 비타민D, 오메가3, 유산균, 홍삼', g: 'none', it: [], note: '처방 없는 건강기능식품·영양제는 고지 대상이 아닙니다.' },
    { n: '일반의약품', a: '타이레놀, 아세트아미노펜, 소화제, 감기약', g: 'none', it: [], note: '처방전 없이 산 일반약은 고지 대상이 아닙니다. 병원 처방 이력만 문항과 연결됩니다.' }
  ];

  const ITEM_FALLBACK = {
    m3_med: { period: '3개월', label: '투약 (처방 받은 경우)' },
    m3_daily: { period: '3개월', label: '상시 복용 — 혈압강하제·신경안정제·수면제·진통제 등' },
    y5_med30: { period: '5년', label: '계속 30일 이상 투약' },
    y5_major: { period: '5년', label: '10대 질병 진단·치료·입원·수술·투약' }
  };
  function itemMeta(key) {
    const list = (typeof DISCLOSURE_ITEMS !== 'undefined') ? DISCLOSURE_ITEMS : [];
    const hit = list.find((i) => i.key === key);
    if (hit) return { key, period: hit.period, label: hit.label, major: !!hit.major };
    return Object.assign({ key }, ITEM_FALLBACK[key] || { period: '', label: key });
  }

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s\-_()\[\]{}·.,/\\]/g, ''); }

  function haystack(d) { return norm(d.n + ' ' + (d.a || '') + ' ' + (GROUPS[d.g] ? GROUPS[d.g].label : '')); }

  function searchDrugs(q, limit) {
    const s = norm(q);
    if (!s) return DRUGS.filter((d) => d.g !== 'none').slice(0, 6);
    const exact = DRUGS.filter((d) => norm(d.n) === s || String(d.a || '').split(',').some((x) => norm(x) === s));
    const part = DRUGS.filter((d) => haystack(d).indexOf(s) >= 0 && exact.indexOf(d) < 0);
    return exact.concat(part).slice(0, limit || 8);
  }

  /* 복용약 → 질환군별 고지 체크 포인트
     period: '3m'(3개월 이내) | '1y'(1년 이내) | 'long'(1년 이상) | ''(모름) */
  function checkMeds(text, opts) {
    opts = opts || {};
    const period = opts.period || '';
    const tokens = String(text || '').split(/[,，\n;]+/).map((t) => t.trim()).filter(Boolean);
    const hits = [];
    tokens.forEach((tok) => {
      searchDrugs(tok, 4).forEach((d) => { if (hits.indexOf(d) < 0) hits.push(d); });
    });
    const byGroup = {};
    hits.forEach((d) => {
      const g = GROUPS[d.g];
      if (!g) return;
      const row = byGroup[d.g] || (byGroup[d.g] = { key: d.g, label: g.label, kcd: g.kcd, major: g.major || '', note: g.note, drugs: [], items: {} });
      row.drugs.push({ name: d.n, brand: d.a || '', note: d.note || '' });
      (d.it || []).forEach((k) => { row.items[k] = (row.items[k] || 0) + 1; });
    });

    const groups = Object.keys(byGroup).map((k) => {
      const row = byGroup[k];
      const items = Object.keys(row.items).map((key) => {
        const meta = itemMeta(key);
        let state = 'check';
        if (key === 'm3_med' || key === 'm3_daily') {
          state = period === '3m' ? 'now' : (period ? 'past' : 'check');
          if (period === '3m') state = 'now';
          else if (period === 'long' || period === '1y') state = 'past';
        } else if (key === 'y5_med30') {
          state = (period === 'long' || period === '1y' || !period) ? 'check' : 'later';
        } else if (key === 'y5_major') {
          state = 'check';
        }
        return { key, period: meta.period, label: meta.label, state };
      }).sort((a, b) => {
        const order = { now: 0, check: 1, past: 2, later: 3 };
        return (order[a.state] - order[b.state]) || a.period.localeCompare(b.period);
      });
      return Object.assign({}, row, { items });
    }).sort((a, b) => (b.items.filter((i) => i.state === 'now').length - a.items.filter((i) => i.state === 'now').length));

    const unknown = tokens.filter((t) => !searchDrugs(t, 1).length);
    return { input: String(text || ''), period, hits, groups, unknown, disclaimer: DISCLAIMER };
  }

  /* =========================================================
     ② 공식 통계 — 모든 카드에 출처·기준연도·대상 범위 1줄 고정
     ========================================================= */
  const STAT_CARDS = [
    {
      id: 'death', title: '사망원인 비중',
      head: '암이 1위, 심장·뇌혈관까지 3대 질환이 41.1%',
      rows: [{ label: '암', value: '24.8%', rank: '1위' }, { label: '심장질환', value: '9.4%', rank: '2위' }, { label: '뇌혈관질환', value: '6.9%', rank: '4위' }],
      takeaway: '3대 질환만으로도 사망 10명 중 4명입니다. 진단비·치료비를 한 축에 몰지 말고 나눠 담는 이유입니다.',
      line: '출처 통계청 2024 사망원인통계 · 기준연도 2024 · 대상 2024년 사망자 전체(연령·성별 전체)'
    },
    {
      id: 'cancer', title: '암 평생 발생확률 · 생존율',
      head: '남 2명 중 1명(44.6%) 가까이, 5년 생존율 73.7%',
      rows: [{ label: '남자 평생 발생 확률', value: '44.6%', key: 'male' }, { label: '여자 평생 발생 확률', value: '38.2%', key: 'female' }, { label: '5년 상대생존율', value: '73.7%' }],
      takeaway: '생존율이 높아졌다는 것은 치료 기간이 길어졌다는 뜻입니다 — 진단비 + 주요치료비를 함께 봐야 하는 이유입니다.',
      line: '출처 보건복지부·중앙암등록본부 2023 국가암등록통계 · 기준연도 2023 · 대상 전 국민 암 발생·생존(2019~2023 진단 코호트 5년 생존)'
    },
    {
      id: 'stroke', title: '뇌경색 vs 뇌출혈',
      head: '뇌경색이 뇌출혈의 약 5.1배',
      rows: [{ label: '뇌경색(I63)', value: '528,440명' }, { label: '뇌내출혈(I60~I62)', value: '103,375명' }, { label: '뇌경색 입원 평균', value: '62.7일' }],
      takeaway: '뇌혈관 질환은 진단비 한 번보다 입원·재활 기간이 깁니다 — 입원일당·간병·주요치료비가 실제로 쓰입니다.',
      line: '출처 중앙심뇌혈관질환센터·건강보험통계 2023 · 기준연도 2023 · 대상 2023년 뇌혈관질환(I60~I69) 입원 진료 환자'
    },
    {
      id: 'ltc', title: '노인장기요양 인정자',
      head: '3~5등급·인지지원이 87.4%',
      rows: [{ label: '인정자', value: '123만 5,045명' }, { label: '3~5등급·인지지원', value: '87.4%' }, { label: '1인당 월평균 급여', value: '154만 원' }],
      takeaway: '1~2등급만 담은 간병 담보는 인정자의 12.6%만 잡습니다 — 등급 범위와 요양병원 포함 여부를 확인하세요.',
      line: '출처 건강보험공단 2025 노인장기요양보험 통계연보 · 기준연도 2024년 말 · 대상 장기요양 인정자 전체(65세 이상 중심)'
    }
  ];

  /* 공공 진료통계 vs 민영보험 약관 지급 기준 — 반드시 병기 */
  const GAP_CARDS = [
    {
      id: 'stroke_code', title: '뇌졸중 — 통계는 I63, 약관은 I60~I63',
      pub: '공공 통계로는 뇌경색(I63)이 뇌혈관 입원의 대부분(뇌출혈의 5.1배)입니다.',
      clause: '약관 "뇌졸중"은 I60~I63이 기본이고, I64(뇌경색증으로 명시되지 않은 뇌혈관질환)·I67·G45는 제외하는 상품이 많습니다.',
      action: '진단서의 코드가 I64·I67·G45라면 뇌졸중 진단비가 아니라 뇌혈관질환 진단비(상품별)로만 확인됩니다.'
    },
    {
      id: 'carotid', title: 'I65·I66 — 협착은 뇌졸중이 아닙니다',
      pub: '경동맥·뇌혈관 협착(I65·I66)은 건강검진·초음파에서 자주 나오는 코드입니다.',
      clause: '뇌경색이 발생하지 않은 "협착"은 뇌졸중 담보에서 제외되는 상품이 대부분입니다.',
      action: '무증상 협착으로 스텐트를 넣었다면 뇌졸중 담보와 별개로 수술·처치 담보를 확인하세요.'
    },
    {
      id: 'mi', title: '급성심근경색 — I21~I22 vs 협심증 I20',
      pub: '심장 사망 비중 9.4%(2위)이고, 협심증으로 스텐트 시술을 받는 사례가 가장 흔합니다.',
      clause: '"급성심근경색" 진단비는 I21~I22 중심입니다. 협심증(I20)은 지급되지 않고 허혈성심장질환 진단비로만 확인됩니다.',
      action: 'I20.0(불안정협심증)·I20.1(혈전 없는 협심증)은 급성심근경색 담보에서 빠집니다. I23은 상품별로 갈립니다.'
    },
    {
      id: 'procedure', title: '스텐트·혈관성형은 "수술"이 아닙니다',
      pub: '심장·뇌혈관 치료는 스텐트 삽입(경피적 관상동맥중재술)이 대부분입니다.',
      clause: '약관의 "수술"은 절개를 전제로 정의되는 경우가 많아, 스텐트·색전술은 수술비가 아니라 처치·중재술로 분류됩니다.',
      action: '수술비 담보만 있으면 스텐트 시술은 0원일 수 있습니다 — 혈전용해제·중재술 치료비 담보를 따로 확인하세요.'
    },
    {
      id: 'travel', title: '뇌경색 평균 입원 62.7일',
      pub: '뇌경색 입원 평균 62.7일, 1인당 진료비 2,562만 원(2023).',
      clause: '입원일당은 180일 한도(상품별)가 흔하고, 90일 면책·감액이 겹치면 초기 입원이 보장되지 않습니다.',
      action: '진단비만 크게 담고 입원일당·간병을 비워 두면 장기 입원 구간에서 공백이 생깁니다.'
    }
  ];

  function ageBand(age) {
    const a = Number(age) || 40;
    if (a < 40) return '20·30대';
    if (a < 60) return '40·50대';
    return '60대 이상';
  }
  function statsFor(profile) {
    profile = profile || {};
    const gender = profile.gender === '여' ? '여' : '남';
    const age = Number(profile.age) || 40;
    const band = ageBand(age);
    const family = Array.isArray(profile.family) ? profile.family : [];
    const priority = band === '20·30대' ? { cancer: 'high', stroke: 'mid', death: 'mid', ltc: 'low' }
      : band === '40·50대' ? { cancer: 'high', stroke: 'high', death: 'high', ltc: 'mid' }
        : { cancer: 'high', stroke: 'high', death: 'high', ltc: 'high' };
    const famNote = {
      cancer: '가족력에 암이 있습니다 — 부모·형제·자녀의 암은 해당 암 조기검진 권고 대상입니다(국가암검진 기준).',
      brain: '가족력에 뇌질환이 있습니다 — 혈압·혈당·경동맥 초음파를 함께 확인하세요.',
      heart: '가족력에 심장질환이 있습니다 — 40대부터 심장 초음파·운동부하검사를 상담에 붙이면 설득이 빨라집니다.',
      dementia: '가족력에 치매가 있습니다 — 간병 담보와 장기요양 등급 범위를 먼저 확인하세요.'
    }[family[0]];
    const cards = STAT_CARDS.map((c) => {
      const relevance = priority[c.id] || 'mid';
      let own = '';
      if (c.id === 'cancer') own = gender === '남' ? '이 고객(남성) 기준 44.6%' : '이 고객(여성) 기준 38.2%';
      if (c.id === 'ltc' && band === '60대 이상') own = '이 고객 연령대에서 가장 먼저 확인할 통계';
      if (c.id === 'stroke' && band === '40·50대') own = '40·50대 남성 뇌혈관 위험이 올라가는 구간';
      const badge = (c.id === 'cancer' && family.indexOf('cancer') >= 0) || (c.id === 'stroke' && (family.indexOf('brain') >= 0 || family.indexOf('heart') >= 0)) || (c.id === 'ltc' && family.indexOf('dementia') >= 0)
        ? '가족력' : '';
      return Object.assign({}, c, { relevance, own, badge });
    });
    return {
      profile: { gender, age, band, family },
      label: `${band} ${gender}${family.length && family[0] !== 'none' ? ' · 가족력 있음' : ' · 가족력 없음'}`,
      cards, gaps: GAP_CARDS, famNote: famNote || '',
      basis: '카드의 강조·순서는 이 고객의 연령대·성별·가족력에 맞춘 상담 우선순위(자체 기준)이고, 수치는 위 출처의 공표값 그대로입니다.'
    };
  }

  /* =========================================================
     화면 — F · PUBLIC DATA
     ========================================================= */
  let medLast = null;
  let statLast = null;
  let calLast = null;

  function chip(state) {
    const map = { now: ['지금 확인', 'now'], check: ['확인 필요', 'check'], past: ['지난 기간', 'past'], later: ['해당 없음', 'later'] };
    const it = map[state] || map.check;
    return `<span class="pd-chip pd-${it[1]}">${it[0]}</span>`;
  }

  function medHTML(r) {
    if (!r || !r.hits.length) {
      return `<div class="pd-empty">
        <p><b>약 이름이나 성분을 넣어 보세요.</b> 대표 처방약 70여 개가 내장되어 있습니다.</p>
        <div class="pd-sug">${['아스피린', '메트포르민', '암로디핀', '리바로', '씬지로이드', '자렐토', '졸피뎀', '마운자로'].map((s) => `<button type="button" class="pd-sug-btn" data-pd-sug="${s}">${s}</button>`).join('')}</div>
        ${r && r.unknown.length ? `<p class="pd-note">사전에 없는 약: ${r.unknown.map(esc).join(', ')} — 성분명으로 다시 검색하거나 처방 사유(질환명)로 직접 확인하세요.</p>` : ''}
      </div>`;
    }
    const rows = r.groups.map((g) => `<div class="pd-group">
      <div class="pd-group-head"><b>${esc(g.label)}</b><span class="pd-kcd">${esc(g.kcd)}</span>${g.major ? `<span class="pd-major">10대 질병 · ${esc(g.major)}</span>` : ''}</div>
      <p class="pd-drugs">${g.drugs.map((d) => `<span class="pd-drug">${esc(d.name)}${d.brand ? `<em>${esc(d.brand)}</em>` : ''}</span>`).join('')}</p>
      <div class="pd-items">${g.items.map((i) => `<span class="pd-item">${esc(i.period)} ${esc(i.label)} ${chip(i.state)}</span>`).join('')}</div>
      <p class="pd-group-note">${esc(g.note)}</p>
    </div>`).join('');
    return `<div class="pd-result">
      ${rows}
      ${r.unknown.length ? `<p class="pd-note">사전에 없는 약: ${r.unknown.map(esc).join(', ')}</p>` : ''}
      <div class="pd-cau">
        <b>이 약만으로 고지 대상이 되지는 않습니다.</b>
        <p>고지 의무는 <b>처방 사유가 된 질환</b>과 <b>진단·투약 시기</b>, <b>복용 기간</b>으로 갈립니다. 청약서 문항(3개월·1년·5년, 간편 3·2·5)에 적히는 것은 "약 이름"이 아니라 그 약을 먹게 된 사실입니다. 영양제·처방 없는 일반약은 대상이 아닙니다.</p>
      </div>
      <p class="pd-disclaimer">※ ${esc(r.disclaimer)}</p>
    </div>`;
  }

  function statsHTML(s) {
    const cards = s.cards.map((c) => `<div class="pd-stat rel-${c.relevance}">
      <div class="pd-stat-head"><b>${esc(c.title)}</b>${c.badge ? `<span class="pd-badge">${esc(c.badge)}</span>` : ''}</div>
      <p class="pd-stat-head-line">${esc(c.head)}</p>
      <div class="pd-stat-rows">${c.rows.map((r) => `<div><span>${esc(r.label)}</span><b>${esc(r.value)}</b>${r.rank ? `<em>${esc(r.rank)}</em>` : ''}</div>`).join('')}</div>
      <p class="pd-stat-take">${esc(c.takeaway)}</p>
      ${c.own ? `<p class="pd-stat-own">${esc(c.own)}</p>` : ''}
      <p class="pd-stat-line">${esc(c.line)}</p>
    </div>`).join('');
    const gaps = s.gaps.map((g) => `<div class="pd-gap">
      <div class="pd-gap-head"><b>${esc(g.title)}</b></div>
      <dl>
        <div><dt>공공 통계</dt><dd>${esc(g.pub)}</dd></div>
        <div><dt>약관 기준</dt><dd>${esc(g.clause)}</dd></div>
        <div><dt>현장 확인</dt><dd>${esc(g.action)}</dd></div>
      </dl>
    </div>`).join('');
    return `<div class="pd-stats">
      <div class="pd-profile">
        <b>이 고객 기준</b>
        <span>${esc(s.label)}</span>
        <button type="button" class="btn-ghost sm pd-refresh" data-pd-refresh="1">고객 정보 다시 읽기</button>
      </div>
      ${s.famNote ? `<p class="pd-fam">${esc(s.famNote)}</p>` : ''}
      <div class="pd-stat-grid">${cards}</div>
      <p class="pd-basis">${esc(s.basis)}</p>
      <div class="subhead">공공 진료통계 ↔ 약관 지급 기준 — 반드시 함께 보세요</div>
      <div class="pd-gaps">${gaps}</div>
      <p class="pd-disclaimer">※ 통계는 공표값이며, 지급 여부·금액은 가입한 상품의 약관과 증권이 기준입니다. 본 결과는 상담 참고용입니다.</p>
    </div>`;
  }

  /* v7.1.1 — 공휴일 보정은 '운영상 참고일'입니다. 실제 보장개시일·효력일·상령일을 바꾸는 값이 아닙니다(4호 지적). */
  const HOLIDAY_REF_NOTE = '공휴일 보정은 운영상 연락·서류 접수 참고일입니다 — 실제 보장개시일·효력일·상령일은 보험사 약관 기준을 따릅니다.';

  const CAL_KINDS = [
    { key: 'withdraw', label: '청약 철회 (청약일 + 15일)', days: 15, dir: 'prev', note: '청약철회는 청약일부터 15일(상품에 따라 30일)입니다. 마감일이 휴일이면 직전 영업일까지 접수하는 것이 운영상 안전합니다.' },
    { key: 'claim3y', label: '보험금 청구 소멸시효 (사고일 + 3년)', years: 3, dir: 'prev', note: '상법 제662조 3년. 마감일이 휴일이면 직전 영업일 접수를 운영상 참고일로 안내합니다 — 시효 기산·완성은 법과 약관 기준입니다.' },
    { key: 'immune90', label: '90일 면책 해제일 (계약일 + 90일)', days: 90, dir: 'next', note: '해제일이 휴일이면 다음 영업일을 운영상 참고일로 함께 안내합니다 — 실제 보장개시일·효력일은 보험사 약관 기준을 따릅니다.' },
    { key: 'ageDay', label: '상령일 (생일 + 6개월)', months: 6, dir: 'next', note: '상령일이 휴일이면 청약·접수 시점을 영업일 기준으로 안내합니다 — 실제 상령일·보험나이 적용은 보험사 약관 기준을 따릅니다.' }
  ];

  function calHTML(r) {
    if (!r) return '<p class="cc-none">기준일과 유형을 고르면 영업일 보정 결과가 나옵니다.</p>';
    const c = r.correct;
    const kind = r.kind;
    if (!c) return '<p class="cc-none">날짜를 정확히 넣어 주세요.</p>';
    const rows = [];
    if (c.ok) {
      rows.push(`<p class="pd-cal-ok">${esc(koDate(c.date))}(${esc(weekday(c.date))})은 <b>영업일</b>입니다 — 보정이 필요 없습니다.</p>`);
    } else {
      rows.push(`<p class="pd-cal-warn">${esc(koDate(c.date))}(${esc(weekday(c.date))})은 <b>${esc(c.reason)}</b>입니다.</p>`);
      rows.push(`<div class="pd-cal-pair">
        <div><span>직전 영업일</span><b>${esc(koDate(c.prev))}</b><em>${esc(weekday(c.prev))}요일 · ${esc(dday(diffDays(todayISO(), c.prev)))}</em></div>
        <div><span>다음 영업일</span><b>${esc(koDate(c.next))}</b><em>${esc(weekday(c.next))}요일 · ${esc(dday(diffDays(todayISO(), c.next)))}</em></div>
      </div>`);
      rows.push(`<p class="pd-cal-which">${kind.dir === 'prev' ? '마감일이면 <b>직전 영업일</b>까지 접수하는 것이 운영상 안전합니다(참고일).' : '<b>다음 영업일</b>을 운영상 참고일로 안내합니다 — 실제 효력 발생일은 약관 기준입니다.'}</p>`);
    }
    rows.push(`<p class="pd-cal-note">${esc(kind.note)}</p>`);
    rows.push(`<p class="pd-cal-ref">${esc(HOLIDAY_REF_NOTE)}</p>`);
    if (!calLast.covered) rows.push(`<p class="pd-cal-warn">${esc(r.date)}는 내장 달력(2026~2028) 밖입니다 — 공휴일 확인이 안 되니 보험사·금융감독원 달력으로 확인하세요.</p>`);
    if (c.provisional) rows.push('<p class="pd-cal-warn">2028년은 월력요항 공고 전 잠정 달력입니다 — 임시공휴일이 추가될 수 있습니다.</p>');
    const up = r.upcoming.map((h) => `<span class="pd-hol">${esc(h.date.slice(5).replace('-', '/'))} ${esc(h.name)}${h.provisional ? ' (잠정)' : ''}</span>`).join('');
    return `<div class="pd-cal">
      ${rows.join('')}
      <div class="subhead">다가오는 공휴일</div>
      <div class="pd-hols">${up}</div>
      <p class="pd-stat-line">출처 「관공서의 공휴일에 관한 규정」(2026.4.30. 개정) · 우주항공청 월력요항 · 한국천문연구원 특일 정보 · 기준 2026~2028 · 대상 관공서 공휴일(임시공휴일·보궐선거일 제외)</p>
    </div>`;
  }

  /* =========================================================
     상태 · 렌더
     ========================================================= */
  const PROXY_KEY = 'bojang.pd.proxy.v1';

  /* v7.1 — 선택 기능(실시간 조회)의 개인정보·처리 경계. 화면과 테스트가 같은 문구를 씁니다. */
  const PROXY_NOTICE = '선택 기능입니다. 프록시 주소를 직접 넣고 [실시간 조회]를 누를 때, 내장 사전에서 확인된 표준 약 이름(성분명)만 제3자 API 프록시(k-skill 등)로 전송됩니다 — 사전에 없는 자유 입력은 외부 요청 0회로 차단합니다. 프록시 운영자와 중계(Cloudflare 등)의 처리 및 국외 이전이 있을 수 있고, 응답은 최대 5분 캐시될 수 있습니다. 고객 이름·연락처·증권 값·가족력·연령·성별은 전송하지 않으며, 기본값은 100% 기기 내 내장 사전(외부 요청 0회)입니다. 식약처·KOSIS·천문연 등 공공데이터는 일반 참고자료일 뿐, 개인 고지 누락 여부·보험금 지급 여부·보험사 상령일을 확정 판정하지 않습니다.';

  function proxyGet() {
    try { return String(root.localStorage.getItem(PROXY_KEY) || ''); } catch (e) { return ''; }
  }
  function proxySet(v) {
    try {
      if (v) root.localStorage.setItem(PROXY_KEY, String(v));
      else root.localStorage.removeItem(PROXY_KEY);
    } catch (e) { /* 저장 실패는 무시 — 기본은 오프라인 */ }
    const el = $('#pd-proxy');
    if (el) el.value = proxyGet();
    const st = $('#pd-proxy-state');
    if (st) st.textContent = proxyGet() ? '실시간 조회 가능(검색어만 전송)' : '오프라인 전용 — 외부 전송 없음';
    return proxyGet();
  }

  /* 실시간 조회 — 대표가 주소를 넣고 '실시간' 버튼을 누른 그 검색어만 나갑니다. 실패하면 내장 사전으로 되돌립니다.
     v7.1 — 판정 근거가 없으면(file: 실행·호스트 없음·가드 없음) 외부 요청 0회 */
  /* v7.1.1 — 프록시 전송 allowlist(4호 지적).
     자유 입력 앞 40자를 그대로 보내던 경로를 없앴습니다. 내장 사전에서 '정확히' 확인된
     표준 약 이름(성분명)만 프록시로 나가고, 그 밖의 입력은 외부 요청 0회로 끝납니다. */
  function proxyQuery(q) {
    const raw = String(q == null ? '' : q).trim();
    if (!raw || raw.length > 20) return null;                 /* 표준 약 이름·성분명은 20자 이내 */
    if (/[,，、;/\n]/.test(raw)) return null;                 /* 여러 개를 한 번에 넣으면 대조가 모호 — 차단 */
    const key = norm(raw);
    if (!key) return null;
    const hit = DRUGS.find((d) => norm(d.n) === key || String(d.a || '').split(',').some((x) => norm(x) === key));
    return hit ? hit.n : null;                                 /* 사전의 표준 이름으로만 전송 */
  }

  async function fetchDrugLive(q) {
    const g = root.bojangDomainGuard;
    if (!g || typeof g.allowed !== 'function' || !g.allowed()) return { ok: false, reason: 'blocked' };
    const base = proxyGet();
    if (!base) return { ok: false, reason: 'off' };
    const std = proxyQuery(q);
    if (!std) return { ok: false, reason: 'not-in-dictionary' };
    try {
      const url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'q=' + encodeURIComponent(std);
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!res.ok) return { ok: false, reason: 'http ' + res.status };
      const data = await res.json();
      return { ok: true, items: Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []) };
    } catch (e) {
      return { ok: false, reason: 'network' };
    }
  }

  function applyMeds() {
    const q = $('#pd-med-q');
    const text = q ? q.value : '';
    const period = ($('#pd-med-period') && $('#pd-med-period').value) || '';
    medLast = checkMeds(text, { period });
    const out = $('#pd-med-out');
    if (out) out.innerHTML = medHTML(medLast);
    return medLast;
  }

  function renderStats() {
    const S = root.BojangApp && root.BojangApp.state;
    const profile = S ? { age: S.age, gender: S.gender, family: S.family || [] } : { age: 40, gender: '남', family: [] };
    statLast = statsFor(profile);
    const out = $('#pd-stat-out');
    if (out) out.innerHTML = statsHTML(statLast);
    return statLast;
  }

  function applyCal() {
    const dateEl = $('#pd-cal-date');
    const kindEl = $('#pd-cal-kind');
    const date = dateEl ? dateEl.value : '';
    const kindKey = kindEl ? kindEl.value : 'withdraw';
    const kind = CAL_KINDS.find((k) => k.key === kindKey) || CAL_KINDS[0];
    let target = date;
    if (parts(date)) {
      if (kind.days) target = addDays(date, kind.days);
      else if (kind.months) target = addMonths(date, kind.months);
      else if (kind.years) target = addMonths(date, kind.years * 12);
    }
    calLast = {
      date, kind, target,
      correct: date ? calendar.correct(target) : null,
      covered: date ? calendar.covered(target) : true,
      upcoming: calendar.upcoming(todayISO(), 5)
    };
    const out = $('#pd-cal-out');
    if (out) out.innerHTML = calHTML(calLast);
    return calLast;
  }

  function init() {
    if (!$('#pd-med-out')) return;
    const q = $('#pd-med-q');
    if (q) {
      q.addEventListener('input', () => applyMeds());
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyMeds(); } });
    }
    const sb = $('#pd-med-search');
    if (sb) sb.addEventListener('click', () => { applyMeds(); toast('복용약 고지 체크를 계산했습니다'); });
    const per = $('#pd-med-period');
    if (per) per.addEventListener('change', applyMeds);
    const live = $('#pd-med-live');
    if (live) live.addEventListener('click', async () => {
      const text = q ? q.value : '';
      live.disabled = true;
      const r = await fetchDrugLive(text);
      live.disabled = false;
      if (r.ok) toast('실시간 조회 ' + (r.items.length ? r.items.length + '건' : '결과 없음') + ' — 내장 사전과 함께 확인하세요');
      else toast(r.reason === 'blocked' ? '지금 실행 환경에서는 외부 조회를 막았습니다 — 내장 사전 결과만 씁니다'
        : r.reason === 'off' ? '프록시 주소를 먼저 넣어 주세요 — 지금은 오프라인 사전으로 동작합니다'
          : r.reason === 'not-in-dictionary' ? '내장 사전에 없는 검색어입니다 — 외부로 보내지 않았습니다(요청 0회)'
            : '실시간 조회 실패 — 내장 사전 결과를 그대로 씁니다');
    });
    const proxy = $('#pd-proxy');
    if (proxy) proxy.addEventListener('change', () => proxySet(proxy.value.trim()));
    proxySet(proxyGet());

    const d = $('#pd-cal-date');
    if (d) d.value = todayISO();
    const kind = $('#pd-cal-kind');
    if (kind) {
      kind.innerHTML = CAL_KINDS.map((k) => `<option value="${esc(k.key)}">${esc(k.label)}</option>`).join('');
      kind.addEventListener('change', applyCal);
    }
    if (d) d.addEventListener('change', applyCal);
    const run = $('#pd-cal-run');
    if (run) run.addEventListener('click', () => { applyCal(); toast('영업일 보정을 계산했습니다'); });

    /* 위임 — 결과가 다시 그려져도 살아 있게 */
    const host = $('#pd-med-out');
    if (host) host.addEventListener('click', (e) => {
      const s = e.target.closest('[data-pd-sug]');
      if (!s) return;
      if (q) q.value = s.dataset.pdSug;
      applyMeds();
    });
    const stat = $('#pd-stat-out');
    if (stat) stat.addEventListener('click', (e) => {
      if (e.target.closest('[data-pd-refresh]')) { renderStats(); toast('고객 정보를 다시 읽었습니다'); }
    });

    applyMeds();
    renderStats();
    applyCal();
  }

  function refresh() {
    if (!$('#pd-stat-out')) return;
    renderStats();
  }

  root.BojangPublicData = {
    init, refresh, applyMeds, applyCal,
    PROXY_NOTICE, HOLIDAY_REF_NOTE,
    drugs: { list: DRUGS, groups: GROUPS, search: searchDrugs, check: checkMeds, itemMeta },
    stats: { cards: STAT_CARDS, gaps: GAP_CARDS, forClient: statsFor },
    calendar: {
      holidays: HOLIDAYS, isHoliday: calendar.isHoliday.bind(calendar), isBusinessDay: calendar.isBusinessDay.bind(calendar),
      prev: calendar.prev.bind(calendar), next: calendar.next.bind(calendar), correct: calendar.correct.bind(calendar),
      upcoming: calendar.upcoming.bind(calendar), covered: calendar.covered.bind(calendar), businessDays: calendar.businessDays.bind(calendar),
      refNote: HOLIDAY_REF_NOTE
    },
    kinds: CAL_KINDS,
    proxy: { get: proxyGet, set: proxySet, fetchDrug: fetchDrugLive, query: proxyQuery },
    date: { addDays, addMonths, diffDays, koDate, dday, todayISO, weekday },
    selected: () => ({ med: medLast, stats: statLast, cal: calLast }),
    DISCLAIMER
  };
})(typeof window !== 'undefined' ? window : globalThis);
