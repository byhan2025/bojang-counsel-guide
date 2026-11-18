/* 보장분석 상담 가이드 v7.5 — 증거 팩 (content-evidence.js)

   원칙
   · 수치마다 **출처 · 기준연도 · 대상범위 · 한계**를 한 줄에 붙입니다. 추정 금지.
   · 1차 자료(공식 통계·보도자료)와 2차 정리를 구분해 표기합니다.
   · 사례는 [실사례] / [각색] / [가상] 3종으로 표기하고, 금액은 '갈린 이유'를 설명하는 보조로만 씁니다.
   · 금소법 안전선: 판정이 아니라 "확인 후보 정리". 특정 상품·회사 추천·비방 없음.

   검증 메모(2026-11-18 이 회차에서 원문 확인)
   · 통계청 「2024년 사망원인통계」(2025.9.25): 암 24.8% · 심장 9.4% · 뇌혈관 6.9% · 사망자 358,569명
   · 중앙암등록본부 「2023년 국가암등록통계」(2026.1.20): 5년 상대생존율 73.7% · 남 44.6% · 여 38.2%
   · 심평원 「암질환 상병별 현황」 2025년 심사분(입원·한방·약국 제외): 암종별 1인당 진료비 10종
   · 건보공단 「2025 주요수술 통계연보」(2026.8.31): PCI 1건 1,404만 · 71,482건 · 4.9일
   · 건보공단 「2025 노인장기요양보험 통계연보」(2026.6.30): 인정자 123만 5,045명 · 월평균 154만 280원
   · 건보공단 중증질환 산정특례 리플릿: 암 5%·5년, 뇌혈관·심장 5%·최대 30일
   · 건보공단 2026년 본인부담상한액(2026.1.6 공고): 90만~843만원
   ========================================================= */
(function (root) {
  'use strict';

  const SRC = {
    death: '통계청 「2024년 사망원인통계」(2025.9.25, 2024년 사망자 기준)',
    cancerReg: '보건복지부·중앙암등록본부 「2023년 국가암등록통계」(2026.1.20)',
    hiraCancer: '심평원 「암질환 상병별 현황」 2025년 심사분 · 입원 · 한방·약국 제외',
    surgery: '건보공단 「2025 주요수술 통계연보」(2026.8.31, 2025년 진료분·비급여 제외)',
    ltc: '건보공단 「2025 노인장기요양보험 통계연보」(2026.6.30)',
    special: '건보공단 중증질환 산정특례 리플릿(2026.6)',
    cap: '건보공단 2026년 본인부담상한액 공고(2026.1.6, 진료일 2026.1.1~12.31)',
    hiraBrain: '심평원 「뇌혈관질환 진료 현황」(2023.9 발표, 2018~2022년 진료분)',
    silson: '금융위원회 보도자료(2026.5.6) · 5세대 실손 판매·전환 안내'
  };

  /* ---------- 1. 공식 통계 대장 (수치 1개 = 출처 1줄) ---------- */
  const STATS = [
    /* 사망원인 (통계청 2024) */
    { id: 'd1', area: '공통', label: '사망원인 1위 암', value: '24.8%', src: SRC.death, scope: '전체 사망자 구성비', limit: '사망자 기준(유병 아님)' },
    { id: 'd2', area: '공통', label: '사망원인 2위 심장질환', value: '9.4%', src: SRC.death, scope: '전체 사망자 구성비', limit: '' },
    { id: 'd3', area: '공통', label: '사망원인 4위 뇌혈관질환', value: '6.9%', src: SRC.death, scope: '전체 사망자 구성비', limit: '' },
    { id: 'd4', area: '공통', label: '2024년 사망자 수', value: '358,569명', src: SRC.death, scope: '국내 신고 기준', limit: '' },
    { id: 'd5', area: '공통', label: '3대 사인(암·심장·폐렴) 구성비', value: '42.6%', src: SRC.death, scope: '전체 사망', limit: '' },
    /* 암 발생·생존 (중앙암등록 2023) */
    { id: 'c1', area: '암', label: '5년 상대생존율(2019~2023 진단)', value: '73.7%', src: SRC.cancerReg, scope: '전 암종', limit: '상대생존율(일반인 대비)' },
    { id: 'c2', area: '암', label: '남자 평생 암 발생 확률', value: '44.6%', src: SRC.cancerReg, scope: '현 발생률 유지 가정', limit: '추정치' },
    { id: 'c3', area: '암', label: '여자 평생 암 발생 확률', value: '38.2%', src: SRC.cancerReg, scope: '현 발생률 유지 가정', limit: '추정치' },
    { id: 'c4', area: '암', label: '2023년 신규 암환자', value: '288,613명', src: SRC.cancerReg, scope: '남 151,126 · 여 137,487', limit: '' },
    { id: 'c5', area: '암', label: '갑상선암 5년 생존율', value: '100.2%', src: SRC.cancerReg, scope: '2019~2023 진단', limit: '100% 초과 가능(상대생존율)' },
    { id: 'c6', area: '암', label: '폐암 5년 생존율', value: '42.5%', src: SRC.cancerReg, scope: '2019~2023 진단', limit: '' },
    { id: 'c7', area: '암', label: '췌장암 5년 생존율', value: '17.0%', src: SRC.cancerReg, scope: '2019~2023 진단', limit: '' },
    { id: 'c8', area: '암', label: '국한 암 5년 생존율', value: '92.7%', src: SRC.cancerReg, scope: '요약병기 국한', limit: '조기 진단 가정' },
    { id: 'c9', area: '암', label: '원격전이 암 5년 생존율', value: '27.8%', src: SRC.cancerReg, scope: '요약병기 원격전이', limit: '' },
    /* 암종별 1인당 입원 진료비 (심평원 2025 심사분) */
    { id: 'm1', area: '암', label: '유방암 1인당 입원 진료비', value: '1,152만원', src: SRC.hiraCancer, scope: 'C50 · 입원', limit: '비급여 제외 · 1인당' },
    { id: 'm2', area: '암', label: '폐암 1인당 입원 진료비', value: '1,342만원', src: SRC.hiraCancer, scope: 'C34 · 입원', limit: '비급여 제외' },
    { id: 'm3', area: '암', label: '갑상선암 1인당 입원 진료비', value: '491만원', src: SRC.hiraCancer, scope: 'C73 · 입원', limit: '비급여 제외' },
    { id: 'm4', area: '암', label: '위암 1인당 입원 진료비', value: '1,127만원', src: SRC.hiraCancer, scope: 'C16 · 입원', limit: '비급여 제외' },
    { id: 'm5', area: '암', label: '간암 1인당 입원 진료비', value: '1,443만원', src: SRC.hiraCancer, scope: 'C22 · 입원', limit: '비급여 제외' },
    { id: 'm6', area: '암', label: '전립선암 1인당 입원 진료비', value: '564만원', src: SRC.hiraCancer, scope: 'C61 · 입원', limit: '비급여 제외' },
    { id: 'm7', area: '암', label: '결장암 1인당 입원 진료비', value: '1,477만원', src: SRC.hiraCancer, scope: 'C18 · 입원', limit: '비급여 제외' },
    { id: 'm8', area: '암', label: '췌장암 1인당 입원 진료비', value: '1,819만원', src: SRC.hiraCancer, scope: 'C25 · 입원', limit: '비급여 제외' },
    { id: 'm9', area: '암', label: '직장암 1인당 입원 진료비', value: '1,192만원', src: SRC.hiraCancer, scope: 'C20 · 입원', limit: '비급여 제외' },
    { id: 'm10', area: '암', label: '방광암 1인당 입원 진료비', value: '798만원', src: SRC.hiraCancer, scope: 'C67 · 입원', limit: '비급여 제외' },
    { id: 'm11', area: '암', label: '유방암 1인당 입원일수', value: '30.1일', src: SRC.hiraCancer, scope: 'C50 · 입원', limit: '' },
    { id: 'm12', area: '암', label: '위암 1인당 입원일수', value: '23.3일', src: SRC.hiraCancer, scope: 'C16 · 입원', limit: '' },
    { id: 'm13', area: '암', label: '췌장암 1인당 입원일수', value: '38.9일', src: SRC.hiraCancer, scope: 'C25 · 입원', limit: '' },
    { id: 'm14', area: '암', label: '간암 1인당 입원일수', value: '22.7일', src: SRC.hiraCancer, scope: 'C22 · 입원', limit: '' },
    /* 심장 (2025 주요수술 통계연보) */
    { id: 'h1', area: '심장', label: '스텐트 삽입술 1건당 진료비', value: '1,404만원', src: SRC.surgery, scope: '경피적 관상동맥중재술 · 입원', limit: '비급여 제외' },
    { id: 'h2', area: '심장', label: '스텐트 삽입술 연간 건수', value: '71,482건', src: SRC.surgery, scope: '2025년 진료분', limit: '' },
    { id: 'h3', area: '심장', label: '스텐트 삽입술 평균 입원일수', value: '4.9일', src: SRC.surgery, scope: '2025년 진료분', limit: '' },
    { id: 'h4', area: '심장', label: '스텐트 삽입술 환자 수', value: '67,628명', src: SRC.surgery, scope: '2025년 진료분', limit: '' },
    { id: 'h5', area: '심장', label: '스텐트 시술 평균 법정 본인부담', value: '61.9만원', src: SRC.surgery, scope: '건강보험 가입자', limit: '상한제 환급 전' },
    { id: 'h6', area: '심장', label: '심장수술 1건당 진료비', value: '4,808만원', src: SRC.surgery, scope: '35개 주요수술', limit: '' },
    { id: 'h7', area: '심장', label: '관상동맥우회술 1건당', value: '4,329만원', src: SRC.surgery, scope: '35개 주요수술', limit: '' },
    { id: 'h8', area: '심장', label: '35개 주요수술 건당 평균', value: '496만원', src: SRC.surgery, scope: '전체 평균', limit: '2025년 9.5% 상승' },
    { id: 'h9', area: '심장', label: '허혈성 심장질환 사망자', value: '14,262명', src: SRC.death, scope: '2024년 · 전체 사망의 4.0%', limit: '' },
    /* 뇌 (심평원 뇌혈관질환 진료현황) */
    { id: 'b1', area: '뇌', label: '뇌혈관질환 입원 1인당 진료비', value: '1,312만원', src: SRC.hiraBrain, scope: 'I60~I69 · 입원 · 2022년', limit: '비급여 제외' },
    { id: 'b2', area: '뇌', label: '뇌혈관질환 1인당 입원일수', value: '54.0일', src: SRC.hiraBrain, scope: 'I60~I69 · 2022년', limit: '' },
    { id: 'b3', area: '뇌', label: '뇌졸중 입원 1인당 진료비', value: '1,593만원', src: SRC.hiraBrain, scope: 'I60~I64 · 입원 · 2022년', limit: '' },
    { id: 'b4', area: '뇌', label: '뇌졸중 1인당 입원일수', value: '70.5일', src: SRC.hiraBrain, scope: 'I60~I64 · 2022년', limit: '' },
    { id: 'b5', area: '뇌', label: '뇌경색 환자 수', value: '52만 895명', src: SRC.hiraBrain, scope: 'I63 · 2022년', limit: '주상병 기준' },
    { id: 'b6', area: '뇌', label: '뇌출혈 환자 수', value: '10만 2,127명', src: SRC.hiraBrain, scope: 'I60~I62 · 2022년', limit: '주상병 기준' },
    { id: 'b7', area: '뇌', label: '뇌경색이 뇌출혈의 몇 배', value: '5.1배', src: SRC.hiraBrain, scope: '환자 수 비(2022)', limit: '' },
    { id: 'b8', area: '뇌', label: '뇌혈관질환 환자 수', value: '117만 1,534명', src: SRC.hiraBrain, scope: 'I60~I69 · 2022년', limit: '' },
    { id: 'b9', area: '뇌', label: '뇌졸중 환자 수', value: '63만 4,177명', src: SRC.hiraBrain, scope: 'I60~I64 · 2022년', limit: '' },
    /* 간병·장기요양 (2025 통계연보) */
    { id: 'k1', area: '간병', label: '장기요양 인정자', value: '123만 5,045명', src: SRC.ltc, scope: '2025년 말 기준', limit: '신청자 155만 961명' },
    { id: 'k2', area: '간병', label: '등급판정자 중 인정률', value: '90.1%', src: SRC.ltc, scope: '판정 137만 798명', limit: '' },
    { id: 'k3', area: '간병', label: '4등급 비중', value: '46.8%', src: SRC.ltc, scope: '인정자 57만 7,572명', limit: '' },
    { id: 'k4', area: '간병', label: '3등급 비중', value: '26.4%', src: SRC.ltc, scope: '32만 5,661명', limit: '' },
    { id: 'k5', area: '간병', label: '5등급 비중', value: '11.8%', src: SRC.ltc, scope: '14만 6,088명', limit: '' },
    { id: 'k6', area: '간병', label: '인지지원등급', value: '3만 39명', src: SRC.ltc, scope: '2025년', limit: '' },
    { id: 'k7', area: '간병', label: '수급자 1인당 월평균 급여비', value: '154만 280원', src: SRC.ltc, scope: '급여이용 수급자', limit: '공단부담 140만 7,693원' },
    { id: 'k8', area: '간병', label: '연간 급여비', value: '17조 6,840억원', src: SRC.ltc, scope: '2025년', limit: '' },
    { id: 'k9', area: '간병', label: '공단 부담률', value: '91.4%', src: SRC.ltc, scope: '급여비 대비', limit: '나머지는 본인부담·감경' },
    { id: 'k10', area: '간병', label: '요양보호사 1인당 월 급여', value: '154만원', src: SRC.ltc, scope: '수급자 기준', limit: '지역·등급별 차이' },
    /* 제도 */
    { id: 's1', area: '제도', label: '암 산정특례 본인부담률', value: '5%', src: SRC.special, scope: '등록일부터 5년', limit: '급여 항목만' },
    { id: 's2', area: '제도', label: '뇌혈관·심장 산정특례', value: '5%', src: SRC.special, scope: '입원 수술 최대 30일', limit: '등록 불필요·기간 제한' },
    { id: 's3', area: '제도', label: '희귀·중증난치 산정특례', value: '10%', src: SRC.special, scope: '5년', limit: '' },
    { id: 's4', area: '제도', label: '중증치매 산정특례', value: '10%', src: SRC.special, scope: '5년(연 60일)', limit: '' },
    { id: 's5', area: '제도', label: '본인부담상한액 1분위', value: '90만원', src: SRC.cap, scope: '2026년 · 요양병원 120일 이하', limit: '비급여 제외' },
    { id: 's6', area: '제도', label: '본인부담상한액 4~5분위', value: '173만원', src: SRC.cap, scope: '2026년', limit: '' },
    { id: 's7', area: '제도', label: '본인부담상한액 10분위', value: '843만원', src: SRC.cap, scope: '2026년 · 최고 상한', limit: '' },
    { id: 's8', area: '제도', label: '요양병원 120일 초과 상한', value: '143만~1,096만원', src: SRC.cap, scope: '2026년', limit: '분위별' },
    { id: 's9', area: '제도', label: '5세대 실손 비중증 비급여 한도', value: '연 1,000만원', src: SRC.silson, scope: '자기부담 50%', limit: '항목별 세부 한도' },
    { id: 's10', area: '제도', label: '5세대 전환 할인', value: '3년 50%', src: SRC.silson, scope: '한시(6개월) 운영', limit: '시행 조건 변동 가능' }
  ];

  /* ---------- 2. 비용 근거 (챕터 ①페이지) ---------- */
  const COSTS = {
    cancer: {
      title: '암종별 1인당 입원 진료비',
      note: '입원 1회 기준 평균 · 비급여 제외 · 심사결정분',
      unit: '만원',
      rows: [
        { label: '췌장', code: 'C25', value: 1819, days: 38.9 },
        { label: '결장', code: 'C18', value: 1477, days: 30.5 },
        { label: '간', code: 'C22', value: 1443, days: 22.7 },
        { label: '폐', code: 'C34', value: 1342, days: 26.8 },
        { label: '유방', code: 'C50', value: 1152, days: 30.1 },
        { label: '위', code: 'C16', value: 1127, days: 23.3 },
        { label: '직장', code: 'C20', value: 1192, days: 26.4 },
        { label: '갑상선', code: 'C73', value: 491, days: 9.3 }
      ],
      src: SRC.hiraCancer
    },
    brain: {
      title: '뇌질환 입원 1인당 진료비·입원일수',
      note: '2022년 진료분 · 비급여 제외',
      unit: '만원',
      rows: [
        { label: '뇌졸중 입원', code: 'I60~I64', value: 1593, days: 70.5 },
        { label: '뇌혈관 입원', code: 'I60~I69', value: 1312, days: 54.0 }
      ],
      extra: [
        { label: '뇌경색 환자', value: '52만 895명', code: 'I63' },
        { label: '뇌출혈 환자', value: '10만 2,127명', code: 'I60~I62' }
      ],
      src: SRC.hiraBrain
    },
    heart: {
      title: '심장 시술·수술 1건당 진료비',
      note: '입원 · 비급여 제외',
      unit: '만원',
      rows: [
        { label: '심장수술', code: '개심술', value: 4808, days: null },
        { label: '관상동맥우회', code: 'CABG', value: 4329, days: null },
        { label: '스텐트 삽입', code: 'PCI', value: 1404, days: 4.9 }
      ],
      extra: [
        { label: '연간 스텐트 건수', value: '71,482건', code: '2025' },
        { label: '평균 본인부담', value: '61.9만원', code: 'PCI' }
      ],
      src: SRC.surgery
    },
    surgery: {
      title: '수술 1건당 진료비 — 규모 감각',
      note: '35개 주요수술 · 2025년 진료분',
      unit: '만원',
      rows: [
        { label: '심장수술', code: '개심술', value: 4808, days: null },
        { label: '관상동맥우회', code: 'CABG', value: 4329, days: null },
        { label: '줄기세포이식', code: '조혈모', value: 2732, days: null },
        { label: '35개 평균', code: '전체', value: 496, days: null }
      ],
      extra: [
        { label: '35개 수술 총 진료비', value: '10조 6,738억', code: '2025' },
        { label: '전년 대비', value: '+14.7%', code: '진료비' }
      ],
      src: SRC.surgery
    },
    care: {
      title: '장기요양 — 매달 나가는 돈',
      note: '2025년 급여이용 수급자 기준',
      unit: '만원',
      rows: [
        { label: '월평균 급여비', code: '전체', value: 154, days: null },
        { label: '공단부담', code: '91.4%', value: 141, days: null }
      ],
      extra: [
        { label: '인정자', value: '123만 5,045명', code: '2025' },
        { label: '4등급 비중', value: '46.8%', code: '3~5등급 81.5%' }
      ],
      src: SRC.ltc
    }
  };

  /* ---------- 3. 코드 밴드 ---------- */
  const BANDS = {
    brain: {
      axis: 'I60 — I69',
      slots: ['I60', 'I61', 'I62', 'I63', 'I64', 'I65~66', 'I67', 'I69', 'G45'],
      labels: { I60: '거미막하', I61: '뇌내출혈', I62: '기타출혈', I63: '뇌경색', I64: '상세불명', 'I65~66': '폐색·협착', I67: '기타', I69: '후유증', G45: 'TIA' },
      levels: [
        { key: 'vascular', label: '뇌혈관질환 진단비', cover: { I60: 1, I61: 1, I62: 1, I63: 1, I64: 1, 'I65~66': 1, I67: 1, I69: 1 } },
        { key: 'stroke', label: '뇌졸중 진단비', cover: { I60: 1, I61: 1, I62: 1, I63: 1, 'I65~66': 1 } },
        { key: 'bleed', label: '뇌출혈 진단비', cover: { I60: 1, I61: 1, I62: 1 } }
      ],
      points: ['가장 흔한 I63(뇌경색)이 빠지는 담보가 현장의 최대 공백', 'I64(상세불명)는 뇌졸중 분류표에서 빠지는 상품이 있어 진단서 코드 확인 필요', 'I69 후유증은 뇌혈관질환 담보만 반응']
    },
    heart: {
      axis: 'I20 — I25 (허혈성)',
      slots: ['I20', 'I21', 'I22', 'I23', 'I25', 'I44~49', 'I34~37', 'I50'],
      labels: { I20: '협심증', I21: '급성심근경색', I22: '재발성', I23: '합병증', I25: '만성허혈', 'I44~49': '부정맥', 'I34~37': '판막', I50: '심부전' },
      levels: [
        { key: 'ischemic', label: '허혈성심장질환 진단비', cover: { I20: 1, I21: 1, I22: 1, I23: 1, I25: 1 } },
        { key: 'ami', label: '급성심근경색 진단비', cover: { I21: 1, I22: 1 } }
      ],
      extra: ['I44~49 부정맥', 'I34~37 판막', 'I50 심부전'],
      points: ['스텐트는 대부분 I20(협심증) 단계 — 급성심근경색 담보만 있으면 보장 밖', 'I44~49·I34~37·I50은 별도 심장질환 담보가 있어야 지급', 'I23 합병증은 I21~I22만 담는 상품에서 빠질 수 있음']
    },
    cancer: {
      axis: 'C00 — C97 + 유사암',
      slots: ['C00~C97', 'C73', 'C44', 'D00~D09', 'D37~D48', 'CIN'],
      labels: { 'C00~C97': '일반암', C73: '갑상선', C44: '피부', 'D00~D09': '제자리', 'D37~D48': '경계성', CIN: '이형성' },
      levels: [
        { key: 'general', label: '일반암 진단비', cover: { 'C00~C97': 1 } },
        { key: 'similar', label: '유사암 진단비', cover: { C73: 1, C44: 1, 'D00~D09': 1, 'D37~D48': 1 } }
      ],
      points: ['일반암 담보는 유사암(C73·C44·D00~D09·D37~D48)을 제외하는 문구가 표준', '제자리암(D00~D09)과 침윤암(C50 등)은 코드가 다르고 지급액도 다름', '원발부위 기준 조항은 설명 여부가 다투어진 판례가 있음(대법원 2025.3.13. 선고 2023다250746)']
    },
    surgery: {
      axis: '수술 분류표',
      slots: ['1종', '2종', '3종', '4종', '5종', '시술'],
      labels: { '1종': '경미', '2종': '보통', '3종': '중간', '4종': '중증', '5종': '최중증', 시술: '처치·시술' },
      levels: [
        { key: 'disease15', label: '질병 1~5종 수술비', cover: { '1종': 1, '2종': 1, '3종': 1, '4종': 1, '5종': 1 } },
        { key: 'diseaseNdae', label: '질병 N대 수술비', cover: { '3종': 1, '4종': 1, '5종': 1 } }
      ],
      points: ['수술명이 분류표 문구와 맞아야 인정 — 병원에 분류표상 명칭으로 요청', '내시경 절제·스텐트·색전술은 "시술"로 분류되어 제외되는 상품이 있음', 'N대 수술비는 질환 묶음별 한도라 1~5종과 중복 청구 구조']
    },
    care: {
      axis: '간병 3갈래',
      slots: ['간병인', '간호간병', '요양병원', '장기요양', '가족간병'],
      labels: { 간병인: '사용일당', 간호간병: '통합병동', 요양병원: '요양일당', 장기요양: '1~5등급', 가족간병: '가족' },
      levels: [
        { key: 'daily', label: '일반병원 간병일당', cover: { 간병인: 1 } },
        { key: 'nDaily', label: '요양병원 간병일당', cover: { 요양병원: 1 } },
        { key: 'ltc', label: '장기요양 담보', cover: { 장기요양: 1 } }
      ],
      points: ['가족 간병은 업체 등록·결제 증빙이 없으면 불인정인 상품이 많음', '지급 기준이 "일 8시간"인지 "일 7~8만원"인지에 따라 실효가 갈림', '장기요양은 등급 판정이 전제 — 3~5등급·인지지원이 인정자의 87%']
    }
  };

  /* ---------- 4. 사례 카드 (3칸: 확인된 사실 / 갈린 이유 / 이 고객과의 차이) ----------
     회의실 한대리 명세 15건을 골격으로 하고, 챕터마다 카드가 비지 않도록 5건을 보강했습니다.
     · 판례·금감원 결정례 번호가 확인된 건만 [실사례]로 표기하고, 나머지는 [각색]/[가상]입니다.
     · 금액은 '갈린 이유'를 설명하는 보조이며, 같은 사고라도 약관·가입시기로 결과가 달라집니다. */
  const CASES = [
    /* 암 */
    { id: 'CA1', area: 'cancer', type: '실사례', title: '갑상선암 림프절 전이 — 원발부위 기준', fact: '대법원 2025.3.13. 선고 2023다250746', event: '갑상선암 진단 후 림프절 전이 — 원발부위 기준 조항의 적용이 문제된 사건', result: '조항의 설명 여부가 쟁점', reason: '원발부위·유사암 문구 하나로 "같은 암"의 지급이 갈린다', check: 'origin', source: '대법원 판례(사건번호 공개분)' },
    { id: 'CA2', area: 'cancer', type: '각색', title: '경계성·제자리암은 일반암이 아니다', fact: '50대 여성 · 일반암 5,000만 · 유사암 1,000만', event: '유방 제자리암(D05) 진단·수술', result: '일반암 0원 · 유사암 1,000만', reason: 'D00~D09·D37~D48은 유사암 코드 — 일반암 담보에서 제외', check: 'similar', source: '약관 코드 범위 기반 각색' },
    { id: 'CA3', area: 'cancer', type: '각색', title: '비급여 표적항암, 실손 한도부터 소진', fact: '60대 남성 · 4세대 실손 · 항암약물치료비 연 1회한', event: '비급여 표적항암 월 1,000만원 투여', result: '실손 비급여 한도 소진 후 전액 자부담', reason: '실손은 급여·비급여 한도가 따로, 정액 담보는 연 1회한', check: 'drug', source: '약관·실손 구조 기반 각색' },
    { id: 'CA4', area: 'cancer', type: '가상', title: '항암방사선은 "연 1회한"이 먼저', fact: '50대 여성 · 항암방사선치료비 연 1회한 600만', event: '2년차 방사선 치료 재개', result: '2년차 0원', reason: '연 1회한과 총 1회한의 차이 — 증권 문구 확인', check: 'radio', source: '교육용 가상(금액 예시)' },
    { id: 'CA5', area: 'cancer', type: '각색', title: '투약 3개월 고지 — 325/355', fact: '60대 남성 · 간편심사 가입 검토', event: '최근 3개월 325·355 처방 이력', result: '고지 누락 시 해지·부지급 위험', reason: '3개월 투약·상시복용 문항 — 말이 아니라 청약서 서면', check: 'disc', source: '고지 문항 기반 각색' },
    /* 뇌 */
    { id: 'BR1', area: 'brain', type: '각색', title: '뇌출혈 담보인데 뇌경색 I63', fact: '60대 남성 · 뇌출혈 2,000만 · 뇌혈관 없음', event: '뇌경색(I63) 진단·입원', result: '뇌출혈 담보 0원', reason: 'I63은 I60~I62 범위 밖 — 가장 흔한 형태가 빠진다', check: 'vascular', source: '약관 코드 범위 기반 각색' },
    { id: 'BR2', area: 'brain', type: '각색', title: 'I65 협착과 I64 상세불명', fact: '70대 여성 · 뇌졸중 2,000만', event: '경동맥 협착(I65) · 상세불명 뇌졸중(I64) 청구', result: '지급 보류·추가 서류 요구', reason: '표준 뇌졸중 분류표에서 I64가 빠지는 상품이 있음', check: 'stroke', source: '분쟁 반복 유형 각색' },
    { id: 'BR3', area: 'brain', type: '각색', title: 'tPA·스텐트는 "수술"인가', fact: '60대 남성 · 뇌 단독 치료비 3종 보유', event: 'tPA 혈전용해술 · 혈전제거 스텐트', result: '혈전용해제 담보만 반응, 수술비 0원', reason: '약관상 "수술"이 관혈수술 기준이면 스텐트는 처치로 분류', check: 'surgery', source: '수술 정의 조항 기반 각색' },
    /* 심장 */
    { id: 'HT1', area: 'heart', type: '각색', title: '협심증 I20 스텐트, 급성심근경색 담보에서 0원', fact: '50대 남성 · 급성심근경색 2,000만 · 허혈성 없음', event: '협심증(I20) 진단·스텐트 삽입', result: '진단비 0원', reason: 'I20은 급성심근경색(I21~I22) 범위 밖', check: 'ischemic', source: '약관 코드 범위 기반 각색' },
    { id: 'HT2', area: 'heart', type: '각색', title: 'I23 후발 합병증이 빠지는 상품', fact: '60대 남성 · 급성심근경색 2,000만', event: '심근경색 후 합병증(I23) 진단', result: 'I21~I22만 담은 상품에서 0원', reason: '담보명 뒤 코드 범위(I21~I23)를 확인해야 함', check: 'ischemic', source: '약관 코드 범위 기반 각색' },
    { id: 'HT3', area: 'heart', type: '각색', title: '부정맥 I48은 별도 담보', fact: '70대 여성 · 허혈성심장 2,000만', event: '심방세동(I48) 진단·고주파 절제', result: '허혈성 담보 0원', reason: 'I44~I49·I34~I37·I50은 별도 심장질환 담보 영역', check: 'ischemic', source: '담보 구조 기반 각색' },
    /* 수술 */
    { id: 'SG1', area: 'surgery', type: '가상', title: '1~5종을 같은 금액으로 착각', fact: '40대 여성 · 1~5종 1종 30만 · 5종 30만', event: '담낭 개복 4종 수술', result: '1종 금액만 지급', reason: '종별 금액이 따로 — 5종까지 같은 금액으로 설계된 증권', check: 'tier5', source: '교육용 가상(종별 금액 예시)' },
    { id: 'SG2', area: 'surgery', type: '각색', title: '가입 전 진단, 가입 후 수술', fact: '50대 남성 · 신규 가입 2개월', event: '가입 전 진단된 질환으로 수술', result: '90일 면책으로 0원', reason: '계약일부터 90일 면책·1년 감액 — 진단일이 기준', check: 'wait', source: '면책·감액 조항 기반 각색' },
    { id: 'SG3', area: 'surgery', type: '각색', title: '직업급수 미통지, 비례보상', fact: '30대 남성 · 상해 담보 · 사무직 가입', event: '현장직 전환 후 사고', result: '보험금 비례 삭감', reason: '직업급수 변경을 회사에 알리지 않으면 비례보상', check: 'injury', source: '상해 담보 구조 기반 각색' },
    /* 간병 */
    { id: 'CR1', area: 'care', type: '각색', title: '간병 8시간·증빙 누락', fact: '70대 여성 · 간병일당 10만(일 8시간 기준)', event: '가족이 20일 간병', result: '간병비 0원', reason: '8시간 이상 간병인 + 이용확인서·결제 증빙 필요', check: 'daily', source: '지급 요건 기반 각색' },
    { id: 'CR2', area: 'care', type: '각색', title: '요양병원은 별도 일당이다', fact: '60대 남성 · 일반병원 간병일당만 보유', event: '요양병원 3개월 입원', result: '일반병원 일당만 지급', reason: '요양병원 일당은 별도 담보·별도 금액', check: 'ndaily', source: '담보 구조 기반 각색' },
    { id: 'CR3', area: 'care', type: '각색', title: '하루 15만원 썼는데 8만원만', fact: '70대 남성 · 지급 기준 "1일 7~8만원"', event: '간병인 1일 15만원 · 30일', result: '실지출 450만 · 지급 240만', reason: '"금액 기준" 담보는 실제 지출과 무관하게 정액', check: 'basis', source: '지급 기준 구조 기반 각색' },
    { id: 'CR4', area: 'care', type: '가상', title: '장기요양 3등급, 월 한도가 먼저', fact: '80대 여성 · 장기요양 담보 월 50만', event: '3등급 판정 · 재가급여 이용', result: '본인부담 15% + 한도 초과분 자부담', reason: '등급·급여 종류별 한도, 본인부담률', check: 'ltc', source: '제도 구조 기반 가상' },
    /* 실손·제도 (decision 페이지 공용) */
    { id: 'SY1', area: 'system', type: '각색', title: '5세대 전환, 4종은 0원', fact: '40대 여성 · 4세대 → 5세대 전환 검토', event: '도수·체외충격파·비급여 주사·미등재 신기술', result: '4종 보장 제외 0원 · MRI만 연 1,000만', reason: '비중증 4종은 "자기부담 50%"가 아니라 보장 제외', check: 'silson', source: '5세대 특약 구조 기반 각색' },
    { id: 'SY2', area: 'system', type: '각색', title: '실손 철회 3개월·1원 예외', fact: '50대 남성 · 5세대 전환 4개월 차', event: '전환 철회 시도', result: '3~6개월 구간은 무사고여야 복귀', reason: '보험금이 1원이라도 발생하면 예외 — 6개월·1회 한정', check: 'silson', source: '전환 철회 조건 기반 각색' },
    { id: 'SY3', area: 'system', type: '각색', title: '상법 662조 — 3년이 지나면', fact: '50대 여성 · 3년 2개월 전 수술', event: '뒤늦게 수술비 청구', result: '시효 도과로 지급 불가', reason: '청구권을 행사할 수 있게 된 때부터 3년', check: 'timebar', source: '상법 제662조 기반 각색' }
  ];

  /* ---------- 5. 반론 훅 15 (회의실 한대리 명세: 암 3 · 뇌심 4 · 수술·간병·상해 4 · 실손·고지·시효 4) ---------- */
  const OBJECTIONS = [
    { id: 'cancer-have', dambo: '암', q: '암보험 있는데요', a: '일반암인지 유사암인지, 1회한인지 재진단인지가 금액을 가릅니다.', ev: '일반암 vs 유사암 · 1회한 vs 재진단' },
    { id: 'thyroid', dambo: '암', q: '갑상선암도 암이잖아요', a: '코드는 암이지만 담보는 유사암으로 따로 설계됩니다. 유사암 칸이 비면 0원입니다.', ev: 'C73 유사암 · 생존율 100.2%' },
    { id: 'metastasis', dambo: '암', q: '전이되면 또 받나요?', a: '1회한 담보는 첫 지급 후 재지급이 없습니다. 재진단·전이암 조항을 증권에서 봐야 합니다.', ev: '1회한 vs 재진단 · 대법원 2023다250746' },
    { id: 'stroke-name', dambo: '뇌', q: '중풍은 뇌출혈이라 들었어요', a: '중풍의 5배는 막히는 뇌경색입니다. 뇌출혈 담보로는 지급되지 않습니다.', ev: 'I63 52만 vs I60~62 10만 (5.1배)' },
    { id: 'brain-survive', dambo: '뇌', q: '뇌는 살아남아도 힘들다던데', a: '그래서 진단비 다음에 후유장해·간병을 봐야 합니다. 순서를 오늘 정하시죠.', ev: '뇌졸중 입원 70.5일 · 1,593만' },
    { id: 'heart-sudden', dambo: '심장', q: '심장은 갑자기 가지 않나요', a: '막히기 전에 좁아지는 단계가 오래 이어집니다. 그 구간이 I20입니다.', ev: '허혈성 사망 14,262명 · PCI 4.9일' },
    { id: 'stent', dambo: '심장', q: '스텐트는 수술비로 나오죠?', a: '상품에 따라 처치로 분류됩니다. 어느 담보에서 나오는지가 먼저입니다.', ev: 'I20 스텐트 1,404만 · 연 71,482건' },
    { id: 'surgery-silson', dambo: '수술', q: '수술비는 실비에서 나오죠?', a: '실비는 실제 쓴 급여비를 돌려주고, 수술비는 횟수마다 정액입니다.', ev: '질병 4축·상해 2축 · 분류표 1~5종' },
    { id: 'surgery-count', dambo: '수술', q: '수술은 자주 안 하니까요', a: '한 번에 4~5종이면 1종의 몇 배가 됩니다. 빈도보다 등급이 중요합니다.', ev: '수술 건당 496만 · 심장수술 4,808만' },
    { id: 'family-care', dambo: '간병', q: '자식이 돌보면 되죠', a: '가족 간병은 불인정인 상품이 많습니다. 인정 여부를 증권에서 먼저 확인합니다.', ev: '8시간·이용확인서·결제 증빙' },
    { id: 'job-class', dambo: '상해', q: '직업이 바뀌었는데 상관없죠?', a: '직업급수가 바뀌면 회사에 알려야 합니다. 안 알리면 비례보상으로 깎입니다.', ev: '상해 담보 직업급수 · 비례보상 조항' },
    { id: 'silson', dambo: '실손', q: '실비 있으면 되죠', a: '실비는 급여 본인부담을 돌려주는 구조입니다. 비급여·소득 공백은 정액담보 몫입니다.', ev: '산정특례 5% · 상한제 90만~843만' },
    { id: 'switch5', dambo: '실손', q: '5세대로 바꾸면 싸다던데', a: '보험료는 줄지만 비중증 4종은 "50%"가 아니라 0원입니다. 두 표를 같이 봐야 합니다.', ev: '5세대 4종 제외 · 연 1,000만 한도' },
    { id: 'disclose', dambo: '고지', q: '예전에 병원 다닌 적 있는데 괜찮죠?', a: '3개월·1년·5년 문항에 걸리는지 날짜로 봐야 합니다. 말이 아니라 청약서에 적어야 합니다.', ev: '3개월/1년/5년 · 서면 기재' },
    { id: 'timebar', dambo: '시효', q: '몇 년 지나면 못 받나요?', a: '청구권을 행사할 수 있게 된 때부터 3년입니다. 수술일·진단일이 기준입니다.', ev: '상법 제662조 3년' }
  ];

  /* ---------- 6. 제도 팩 ---------- */
  const SYSTEM = [
    {
      key: 'special', title: '중증질환 산정특례', rate: '5%', when: '암 5년 · 뇌혈관·심장 입원 수술 최대 30일',
      body: '급여 치료비 본인부담이 20% → 5%로 줄어듭니다. 등록은 의사가 하고, 진단 후 30일 안에 신청하면 확진일부터 적용됩니다.',
      limit: '급여 항목만 — 비급여·선별급여·전액본인부담은 제외',
      src: SRC.special
    },
    {
      key: 'cap', title: '본인부담상한제', rate: '90만~843만', when: '2026년 · 소득분위별',
      body: '연간 급여 본인부담이 상한을 넘으면 초과분을 공단이 부담합니다(사후환급은 다음 해 8월경).',
      limit: '비급여·선별급여는 빠짐 — 여기가 정액담보의 자리',
      src: SRC.cap
    },
    {
      key: 'ltc', title: '노인장기요양보험', rate: '월 154만', when: '1~5등급·인지지원 판정',
      body: '인정자 123만 5,045명. 재가급여 본인부담 15%, 시설급여 20%로 나머지를 제도가 부담합니다.',
      limit: '등급 판정이 전제 — 3~5등급·인지지원이 인정자의 87%',
      src: SRC.ltc
    },
    {
      key: 'disaster', title: '재난적의료비 지원', rate: '가구 단위', when: '소득 대비 의료비 과부담',
      body: '가구 소득·재산 기준을 함께 보는 마지막 안전망입니다. 신청은 퇴원 후 직접, 심사는 가구 단위.',
      limit: '사전 계획이 아니라 사후 구제 — 금액·한도는 매년 고시',
      src: '보건복지부 재난적의료비 지원사업 안내(연간 고시)'
    }
  ];

  /* ---------- 7. 스택 바 — 같은 1,000만원은 누구 몫인가 ---------- */
  const STACK = [
    { label: '급여 (산정특례 5%)', value: 50, color: 'mint', note: '1,000만 × 5% = 50만' },
    { label: '비급여 (전액 자부담)', value: 500, color: 'red', note: '표적·면역항암 등' },
    { label: '실손 (급여 본인부담)', value: 0, color: 'blue', note: '이미 5%로 경감된 구간' },
    { label: '정액담보', value: 450, color: 'navy', note: '진단비·치료비가 메우는 칸' }
  ];

  root.BojangEvidence = {
    SRC, STATS, COSTS, BANDS, CASES, OBJECTIONS, SYSTEM, STACK,
    byArea: (area) => CASES.filter((c) => c.area === area),
    statOf: (area) => STATS.filter((s) => s.area === area),
    objection: (id) => OBJECTIONS.find((o) => o.id === id) || null
  };
})(typeof window !== 'undefined' ? window : globalThis);
