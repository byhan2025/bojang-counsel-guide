/* 보장분석 상담 가이드 v7.2 — 직업급수표 (jobgrades.js)

   상해급수는 보험사·상품마다 분류표가 조금씩 다르고, 그 표 자체를 복제하면
   저작권 문제가 됩니다. 그래서 여기서는 공개된 일반 분류 원칙
   (사무·관리 / 현장·영업·운송 / 고위험·건설·배달·이륜차)을 3단계로 재구성하고,
   직업명 키워드로 어느 급수에 가까운지 안내만 합니다.

   · 확정 급수는 반드시 가입 상품의 직업급수표로 확인합니다(화면·문서에 항상 병기).
   · 2급·3급·이륜차는 상해 담보 가입 제한·할증·부담보 가능성이 커서 입력 즉시 알립니다.
   · 배달·퀵·오토바이·이륜차는 3급으로 보되, 실제로는 '이륜차 운전' 특약 가입 여부가
     더 중요하므로 twoWheel 플래그를 따로 세웁니다. */
(function (root) {
  'use strict';

  const GRADES = {
    '1': {
      key: '1', label: '1급 · 사무·관리', risk: 'low',
      short: '사무·관리',
      note: '실내 사무·관리·전문직. 상해 위험이 가장 낮아 상해 담보 가입 제한이 거의 없습니다.',
      check: []
    },
    '2': {
      key: '2', label: '2급 · 현장·영업·운송', risk: 'mid',
      short: '현장·영업·운송',
      note: '현장 작업·영업·운송·서비스직. 상해 담보는 가입되지만 할증·일부 부담보가 붙을 수 있습니다.',
      check: ['상해수술비·상해입원일당 가입 가능 여부', '직업 변경 시 통지 의무(보험사 고지)']
    },
    '3': {
      key: '3', label: '3급 · 고위험·건설·배달·이륜차', risk: 'high',
      short: '고위험·건설·배달',
      note: '건설·중장비·고소작업·배달·이륜차 운전. 상해 담보 가입 제한·할증·부담보가 흔합니다.',
      check: ['이륜차 운전 특약 가입 여부', '상해 담보 부담보·할증 조건', '직업급수 3급 상품 가입 한도']
    }
  };

  /* 직업 키워드 → 급수. 위에서부터 먼저 맞는 것을 씁니다(구체어 우선). */
  const OCCUPATIONS = [
    { re: /(배달|퀵|라이더|오토바이|이륜|이륜차|모터사이클|택배기사|대리운전)/, grade: '3', twoWheel: true, label: '배달·이륜차 운전' },
    { re: /(건설|철근|비계|용접|중장비|굴착|크레인|고소|전기공|설비공|광산|선박|어부|잠수)/, grade: '3', twoWheel: false, label: '건설·고위험 현장' },
    { re: /(경비|경호|소방|군인|경찰|해경|교도)/, grade: '3', twoWheel: false, label: '경비·치안' },
    { re: /(운전|기사|화물|버스|택시|트럭|지게차|운송)/, grade: '2', twoWheel: false, label: '운송·운전' },
    { re: /(영업|판매|서비스|미용|요리|주방|조리|간호|간병|요양|학원|강사|코치)/, grade: '2', twoWheel: false, label: '영업·서비스·현장' },
    { re: /(공장|생산|제조|조립|포장|물류|창고|정비|수리|미장|목공|도장)/, grade: '2', twoWheel: false, label: '생산·물류·정비' },
    { re: /(사무|관리|회계|세무|법무|교사|교수|공무원|은행|금융|보험|개발|프로그래|엔지니어|디자이너|기획|마케팅|연구|의사|약사|변호사|회사원|직장인|주부|학생)/, grade: '1', twoWheel: false, label: '사무·관리·전문' }
  ];

  function match(text) {
    const s = String(text == null ? '' : text);
    if (!s.trim()) return null;
    const hit = OCCUPATIONS.find((o) => o.re.test(s));
    if (!hit) return null;
    return {
      grade: hit.grade, label: hit.label, twoWheel: !!hit.twoWheel,
      gradeLabel: (GRADES[hit.grade] || {}).label || '',
      note: (GRADES[hit.grade] || {}).note || '',
      check: ((GRADES[hit.grade] || {}).check || []).slice(),
      matched: (s.match(hit.re) || [''])[0]
    };
  }

  function of(job) {
    const k = String(job == null ? '' : job);
    return GRADES[k] || GRADES['1'];
  }

  /* 화면·PDF에 붙는 한 줄 경고(2·3급·이륜차) — 1급이면 null */
  function alerts(grade, twoWheel) {
    const g = String(grade || '1');
    const out = [];
    if (twoWheel) {
      out.push({ level: 'gap', tone: 'danger', title: '이륜차·배달 운전', body: '이륜차(오토바이) 운전 중 사고는 직업급수 3급으로 보거나 이륜차 운전 특약 가입이 필요할 수 있습니다. 배달·퀵 종사라면 상해 담보 가입 가능 여부와 부담보 조건을 먼저 확인하세요.' });
    }
    if (g === '3') {
      out.push({ level: 'need', tone: 'warn', title: '직업급수 3급', body: '상해 담보 가입 제한·할증·부담보가 흔합니다. 상품별 직업급수표로 3급 가입 가능 여부와 한도를 확인하고, 직업 변경 시 통지 의무를 안내하세요.' });
    } else if (g === '2') {
      out.push({ level: 'check', tone: 'info', title: '직업급수 2급', body: '상해 담보는 가입되지만 할증·일부 부담보가 붙을 수 있습니다. 상해수술비·상해입원일당의 가입 조건을 증권으로 확인하세요.' });
    }
    return out.length ? out : null;
  }

  root.BojangJobGrades = { GRADES, OCCUPATIONS, match, of, alerts, grades: () => ['1', '2', '3'] };
})(typeof window !== 'undefined' ? window : globalThis);
