/* 보장분석 상담 가이드 v7.2 — 담보명 동의어 사전 (dambo-dictionary.js)

   보험사마다 같은 담보를 다른 이름으로 팝니다(예: '표적항암약물허가치료비' /
   '표적항암제치료비' / '항암약물치료비'). v7.1까지는 model.js 안의 정규식 15개로
   세부 칸을 찾았기 때문에, 사전에 없는 이름은 '미매칭'으로 남고 사용자가 직접
   어느 축인지 판단해야 했습니다.

   v7.2는 이 파일 하나를 담보명 단일 사전으로 씁니다.
     · SYNONYMS — 보험사별 특약명·변형어 110개 이상을 {담보축, 세부칸, 종류}로 매핑
     · match(name) — 이름에서 공백·괄호·'특약/담보/보험금' 같은 꼬리를 떼고 가장 긴
       일치어부터 찾습니다(짧은 말이 긴 말을 가로채지 않게).
     · 자동 매칭되지 않은 특약은 앱에서 1탭으로 축을 연결합니다(모델의 linkAxis/linkSub).
   판정·점수 산식은 model.js 그대로이고, 이 사전은 '어디에 넣을지'만 정합니다. */
(function (root) {
  'use strict';

  const AXES = {
    cancer: { key: 'cancer', label: '암', order: 1 },
    brain: { key: 'brain', label: '뇌', order: 2 },
    heart: { key: 'heart', label: '심장', order: 3 },
    surgery: { key: 'surgery', label: '수술비', order: 4 },
    care: { key: 'care', label: '간병비', order: 5 },
    living: { key: 'living', label: '생활·실손', order: 6, reference: true }
  };
  const AXIS_CHOICES = ['cancer', 'brain', 'heart', 'surgery', 'care', 'living'];

  /* ---------------------------------------------------------
     동의어 사전 — t: 증권에 찍히는 이름 조각, axis: 담보 축,
     sub: model.js 세부 칸(없으면 null), kind: dx(진단비) · treat(치료비) · amount(정액) · ref(참고)
     같은 말이 여러 보험사에서 다르게 쓰이는 순서대로 넣었습니다.
     --------------------------------------------------------- */
  const SYNONYMS = [
    /* ── 암 ── */
    { t: '일반암진단비', axis: 'cancer', sub: 'general', kind: 'dx' },
    { t: '일반암진단보험금', axis: 'cancer', sub: 'general', kind: 'dx' },
    { t: '암진단비', axis: 'cancer', sub: 'general', kind: 'dx' },
    { t: '암진단보험금', axis: 'cancer', sub: 'general', kind: 'dx' },
    { t: '고액암진단비', axis: 'cancer', sub: 'general', kind: 'dx' },
    { t: '소액암진단비', axis: 'cancer', sub: 'similar', kind: 'dx' },
    { t: '유사암진단비', axis: 'cancer', sub: 'similar', kind: 'dx' },
    { t: '유사암진단보험금', axis: 'cancer', sub: 'similar', kind: 'dx' },
    { t: '갑상선암진단비', axis: 'cancer', sub: 'similar', kind: 'dx' },
    { t: '기타피부암진단비', axis: 'cancer', sub: 'similar', kind: 'dx' },
    { t: '제자리암진단비', axis: 'cancer', sub: 'similar', kind: 'dx' },
    { t: '경계성종양진단비', axis: 'cancer', sub: 'similar', kind: 'dx' },
    { t: '재진단암진단비', axis: 'cancer', sub: 'recur', kind: 'bool' },
    { t: '재진단암', axis: 'cancer', sub: 'recur', kind: 'bool' },
    { t: '전이암진단비', axis: 'cancer', sub: 'recur', kind: 'bool' },
    { t: '이차성암진단비', axis: 'cancer', sub: 'recur', kind: 'bool' },
    { t: '항암약물치료비', axis: 'cancer', sub: 'drug', kind: 'treat' },
    { t: '항암제치료비', axis: 'cancer', sub: 'drug', kind: 'treat' },
    { t: '표적항암약물허가치료비', axis: 'cancer', sub: 'drug', kind: 'treat' },
    { t: '표적항암제치료비', axis: 'cancer', sub: 'drug', kind: 'treat' },
    { t: '면역항암제치료비', axis: 'cancer', sub: 'drug', kind: 'treat' },
    { t: '면역항암요법치료비', axis: 'cancer', sub: 'drug', kind: 'treat' },
    { t: '호르몬항암치료비', axis: 'cancer', sub: 'drug', kind: 'treat' },
    { t: '항암방사선치료비', axis: 'cancer', sub: 'radio', kind: 'treat' },
    { t: '방사선치료비', axis: 'cancer', sub: 'radio', kind: 'treat' },
    { t: '세기조절방사선치료비', axis: 'cancer', sub: 'radio', kind: 'treat' },
    { t: '암수술비', axis: 'cancer', sub: 'surgery', kind: 'treat' },
    { t: '암수술보험금', axis: 'cancer', sub: 'surgery', kind: 'treat' },
    { t: '다빈치로봇암수술비', axis: 'cancer', sub: 'surgery', kind: 'treat' },
    { t: '로봇암수술비', axis: 'cancer', sub: 'surgery', kind: 'treat' },
    { t: '암수술후재활치료비', axis: 'cancer', sub: 'surgery', kind: 'treat' },
    { t: '암중환자실입원일당', axis: 'cancer', sub: 'icu', kind: 'treat' },
    { t: '암중환자실', axis: 'cancer', sub: 'icu', kind: 'treat' },
    { t: '비급여암치료비', axis: 'cancer', sub: 'extra', kind: 'treat' },
    { t: '암비급여주사치료비', axis: 'cancer', sub: 'extra', kind: 'treat' },
    { t: '암주요치료비', axis: 'cancer', sub: null, kind: 'treat' },

    /* ── 뇌 ── */
    { t: '뇌혈관질환진단비', axis: 'brain', sub: 'vascular', kind: 'dx' },
    { t: '뇌혈관질환진단보험금', axis: 'brain', sub: 'vascular', kind: 'dx' },
    { t: '뇌졸중진단비', axis: 'brain', sub: 'stroke', kind: 'dx' },
    { t: '뇌경색진단비', axis: 'brain', sub: 'stroke', kind: 'dx' },
    { t: '뇌출혈진단비', axis: 'brain', sub: 'bleed', kind: 'dx' },
    { t: '거미막하출혈진단비', axis: 'brain', sub: 'bleed', kind: 'dx' },
    { t: '뇌동맥류진단비', axis: 'brain', sub: 'bleed', kind: 'dx' },
    { t: '뇌혈관수술비', axis: 'brain', sub: 'surgery', kind: 'treat' },
    { t: '뇌혈관개두술비', axis: 'brain', sub: 'surgery', kind: 'treat' },
    { t: '뇌동맥류코일색전술', axis: 'brain', sub: 'surgery', kind: 'treat' },
    { t: '뇌동맥류결찰술', axis: 'brain', sub: 'surgery', kind: 'treat' },
    { t: '뇌혈관스텐트삽입술', axis: 'brain', sub: 'surgery', kind: 'treat' },
    { t: '뇌혈관우회로술', axis: 'brain', sub: 'surgery', kind: 'treat' },
    { t: '혈전용해치료비', axis: 'brain', sub: 'lysis', kind: 'treat' },
    { t: '혈전제거술', axis: 'brain', sub: 'lysis', kind: 'treat' },
    { t: '뇌중환자실입원일당', axis: 'brain', sub: 'icu', kind: 'treat' },
    { t: '뇌혈관질환주요치료비', axis: 'brain', sub: 'main', kind: 'treat' },

    /* ── 심장 ── */
    { t: '허혈성심장질환진단비', axis: 'heart', sub: 'ischemic', kind: 'dx' },
    { t: '허혈성심장질환진단보험금', axis: 'heart', sub: 'ischemic', kind: 'dx' },
    { t: '협심증진단비', axis: 'heart', sub: 'ischemic', kind: 'dx' },
    { t: '급성심근경색진단비', axis: 'heart', sub: 'ami', kind: 'dx' },
    { t: '심근경색진단비', axis: 'heart', sub: 'ami', kind: 'dx' },
    { t: '관상동맥우회술비', axis: 'heart', sub: 'surgery', kind: 'treat' },
    { t: '관상동맥성형술', axis: 'heart', sub: 'surgery', kind: 'treat' },
    { t: '관상동맥스텐트삽입술', axis: 'heart', sub: 'surgery', kind: 'treat' },
    { t: '심장판막수술비', axis: 'heart', sub: 'surgery', kind: 'treat' },
    { t: '심장혈관수술비', axis: 'heart', sub: 'surgery', kind: 'treat' },
    { t: '심장중환자실입원일당', axis: 'heart', sub: 'icu', kind: 'treat' },
    { t: '심혈관질환주요치료비', axis: 'heart', sub: 'main', kind: 'treat' },
    { t: '부정맥치료비', axis: 'heart', sub: 'surgery', kind: 'treat' },

    /* 뇌·심장 공유(특정순환계) — 입력한 축의 치료비로 100% 반영하고 반대 축에도 보여 줍니다 */
    { t: '특정순환계질환주요치료비', axis: 'brain', sub: 'main', kind: 'treat', shared: true },
    { t: '특정순환계질환3~5종주요치료비', axis: 'brain', sub: 'main', kind: 'treat', shared: true },
    { t: '특정순환계질환3종주요치료비', axis: 'brain', sub: 'main', kind: 'treat', shared: true },
    { t: '특정순환계질환5종주요치료비', axis: 'brain', sub: 'main', kind: 'treat', shared: true },
    { t: '순환계주요치료비', axis: 'brain', sub: 'main', kind: 'treat', shared: true },

    /* ── 수술비 ── */
    { t: '질병수술비', axis: 'surgery', sub: 'disease', kind: 'amount' },
    { t: '질병입원수술비', axis: 'surgery', sub: 'disease', kind: 'amount' },
    { t: '질병수술보험금', axis: 'surgery', sub: 'disease', kind: 'amount' },
    { t: '질병1~5종수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '질병1-5종수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '질병5종수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '질병1종수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '질병N대수술비', axis: 'surgery', sub: 'diseaseNdae', kind: 'amount' },
    { t: '질병21대수술비', axis: 'surgery', sub: 'diseaseNdae', kind: 'amount' },
    { t: '질병30대수술비', axis: 'surgery', sub: 'diseaseNdae', kind: 'amount' },
    { t: '질병33대수술비', axis: 'surgery', sub: 'diseaseNdae', kind: 'amount' },
    { t: '비급여질병수술비', axis: 'surgery', sub: 'diseaseNonPay', kind: 'amount' },
    { t: '비급여1~5종수술비', axis: 'surgery', sub: 'diseaseNonPay', kind: 'amount' },
    { t: '비급여N대수술비', axis: 'surgery', sub: 'diseaseNonPay', kind: 'amount' },
    { t: '일반상해수술비', axis: 'surgery', sub: 'injury', kind: 'amount' },
    { t: '상해수술비', axis: 'surgery', sub: 'injury', kind: 'amount' },
    { t: '상해1~5종수술비', axis: 'surgery', sub: 'injury15', kind: 'amount' },
    { t: '상해5종수술비', axis: 'surgery', sub: 'injury15', kind: 'amount' },
    { t: '관절수술비', axis: 'surgery', sub: 'diseaseNdae', kind: 'amount' },
    { t: '척추수술비', axis: 'surgery', sub: 'diseaseNdae', kind: 'amount' },
    { t: '골절수술비', axis: 'surgery', sub: 'injury', kind: 'amount' },
    { t: '화상수술비', axis: 'surgery', sub: 'injury', kind: 'amount' },
    { t: '백내장수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '제왕절개수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '자연분만수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '맹장수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '탈장수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '치질수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },
    { t: '성대결절수술비', axis: 'surgery', sub: 'disease15', kind: 'amount' },

    /* ── 간병비 ── */
    { t: '간병인사용일당', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '일반병원간병인사용일당', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '질병간병일당', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '상해간병일당', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '간병일당', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '간병비', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '요양병원간병인사용일당', axis: 'care', sub: 'nDaily', kind: 'amount' },
    { t: '요양병원간병일당', axis: 'care', sub: 'nDaily', kind: 'amount' },
    { t: '중증치매간병비', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '치매간병일당', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '노인성질환간병비', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '장기요양간병비', axis: 'care', sub: 'nDaily', kind: 'amount' },
    { t: '간호간병통합서비스일당', axis: 'care', sub: 'nursing', kind: 'bool' },
    { t: '재가간병비', axis: 'care', sub: 'daily', kind: 'amount' },
    { t: '가족간병비', axis: 'care', sub: 'daily', kind: 'amount' },

    /* ── 생활·실손 (참고 축 — 색 판정에 쓰지 않습니다) ── */
    { t: '일반상해사망', axis: 'living', sub: 'deathInjury', kind: 'ref' },
    { t: '상해사망', axis: 'living', sub: 'deathInjury', kind: 'ref' },
    { t: '질병사망', axis: 'living', sub: 'deathDisease', kind: 'ref' },
    { t: '상해후유장해', axis: 'living', sub: 'disabilityInjury', kind: 'ref' },
    { t: '질병후유장해', axis: 'living', sub: 'disabilityDisease', kind: 'ref' },
    { t: '3~100%후유장해', axis: 'living', sub: 'disabilityInjury', kind: 'ref' },
    { t: '후유장해', axis: 'living', sub: 'disabilityInjury', kind: 'ref' },
    { t: '운전자벌금', axis: 'living', sub: 'driverFine', kind: 'ref' },
    { t: '운전자교통사고벌금', axis: 'living', sub: 'driverFine', kind: 'ref' },
    { t: '운전자변호사선임비용', axis: 'living', sub: 'driverLawyer', kind: 'ref' },
    { t: '변호사선임비용', axis: 'living', sub: 'driverLawyer', kind: 'ref' },
    { t: '자동차사고처리지원금', axis: 'living', sub: 'driverSupport', kind: 'ref' },
    { t: '운전자자동차사고처리지원금', axis: 'living', sub: 'driverSupport', kind: 'ref' },
    { t: '자동차사고부상치료비', axis: 'living', sub: 'driverInjury', kind: 'ref' },
    { t: '가족일상생활배상책임', axis: 'living', sub: 'liability', kind: 'ref' },
    { t: '일상생활배상책임', axis: 'living', sub: 'liability', kind: 'ref' },
    { t: '화재재산손해', axis: 'living', sub: 'fire', kind: 'ref' },
    { t: '골절진단비', axis: 'living', sub: 'fracture', kind: 'ref' },
    { t: '화상진단비', axis: 'living', sub: 'burn', kind: 'ref' },
    { t: '응급실내원비', axis: 'living', sub: 'er', kind: 'ref' },
    { t: '상해입원일당', axis: 'living', sub: 'inpatientInjury', kind: 'ref' },
    { t: '질병입원일당', axis: 'living', sub: 'inpatientDisease', kind: 'ref' },
    { t: '실손의료비', axis: 'living', sub: 'silson', kind: 'ref' },
    { t: '실손', axis: 'living', sub: 'silson', kind: 'ref' },
    { t: '실손자기부담금', axis: 'living', sub: 'silsonDeduct', kind: 'ref' },
    { t: '비급여특약', axis: 'living', sub: 'silsonNonPay', kind: 'ref' },
    { t: '도수치료특약', axis: 'living', sub: 'silsonManual', kind: 'ref' },
    { t: '주사치료특약', axis: 'living', sub: 'silsonInjection', kind: 'ref' },
    { t: '치아보존치료', axis: 'living', sub: 'toothCare', kind: 'ref' },
    { t: '충치치료', axis: 'living', sub: 'toothCare', kind: 'ref' },
    { t: '치아보철치료', axis: 'living', sub: 'toothProsthetic', kind: 'ref' },
    { t: '임플란트', axis: 'living', sub: 'toothProsthetic', kind: 'ref' },
    { t: '치조골이식', axis: 'living', sub: 'toothProsthetic', kind: 'ref' }
  ];

  /* ---------------------------------------------------------
     이름 정규화 — 공백·가운뎃점·괄호 안 수식어·꼬리말 제거
     예) '무배당 표적항암약물허가치료비(갱신형) 특약' → '표적항암약물허가치료비'
     --------------------------------------------------------- */
  const NOISE = /(무배당|갱신형|비갱신형|특약|담보|보험금|가입금액|한도|종합|기본형|표준형|세만기|만기환급형)/g;
  function norm(name) {
    let s = String(name == null ? '' : name).toLowerCase();
    s = s.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
    s = s.replace(/[\s·・\.\-_/]/g, '');
    s = s.replace(NOISE, '');
    return s;
  }

  /* 사전을 정규화한 뒤 긴 이름부터 — '뇌혈관질환진단비'가 '진단비'에 먹히지 않게 */
  const INDEX = SYNONYMS.map((x) => ({ ...x, n: norm(x.t) })).filter((x) => x.n)
    .sort((a, b) => b.n.length - a.n.length);

  function match(name) {
    const n = norm(name);
    if (!n) return null;
    const hit = INDEX.find((x) => n.indexOf(x.n) >= 0);
    if (!hit) return null;
    return {
      axis: hit.axis, sub: hit.sub, kind: hit.kind, term: hit.t,
      shared: !!hit.shared,
      label: (AXES[hit.axis] || {}).label || hit.axis,
      confidence: hit.n === n ? 1 : Math.round((hit.n.length / n.length) * 100) / 100
    };
  }

  /* 사전에 없는 이름 → 사용자가 1탭으로 연결할 축 후보 */
  function choices() {
    return AXIS_CHOICES.map((k) => ({ key: k, label: AXES[k].label, reference: !!AXES[k].reference }));
  }
  function axisLabel(k) { return (AXES[k] || {}).label || ''; }
  function count() { return INDEX.length; }
  function byAxis(axis) { return INDEX.filter((x) => x.axis === axis).map((x) => ({ term: x.t, sub: x.sub, kind: x.kind })); }

  root.BojangDambo = { AXES, AXIS_CHOICES, SYNONYMS, match, norm, choices, axisLabel, count, byAxis };
})(typeof window !== 'undefined' ? window : globalThis);
