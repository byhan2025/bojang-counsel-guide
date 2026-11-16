/* 보장분석 라이프 리포트 v5.5 — 베타 테스트 공개판
   · 베타 기간에는 Pro 전 기능(30장 전체 · 1/10/30장 PDF · 고객 30명 · 리모델링 · 화이트라벨)을 잠금 없이 무료 제공
   · v5.4: 계정/구독(backend.js) 연동 — 실서버 구독 상태를 hydrate() 로 반영
   · 정식 출시 예정 요금: 월 5,000원 / 연 50,000원 · 베타 피드백 Google Form + 추첨 사은품 안내
   · 중립 기본 브랜드(Classic Navy) + 화이트라벨(상호·슬로건·설계사 정보·로고 이미지·테마 4종)
   · 리모델링: 보유 계약 유지/감액/정리 + 담보별 보강 금액·추가 보험료 → 보험료·점수·5대 담보 Before/After
   실제 결제 백엔드는 docs/backend-architecture.md 설계를 따릅니다. */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const planState = () => root.__bojangState || null;
  const toast = (m) => { if (root.__bojangToast) root.__bojangToast(m); };

  const PLAN_KEY = 'bojang.plan.v1';
  const BRAND_KEY = 'bojang.brand.v1';
  const REMODEL_KEY = 'bojang.remodel.v1';
  const FREE_SLIDES = 6;
  const FREE_CLIENTS = 1;
  const PRO_CLIENTS = 30;

  /* 베타 테스트 기간 — 정식 출시 전에는 모든 Pro 기능을 잠금 없이 무료로 엽니다. */
  const BETA = true;
  const FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc2euPXcpWELiGYsBMod8tdC6cWWhPP_I3WgwIfc8zp6aRXUg/viewform';
  const GIFT_NOTE = '피드백 참여 시 추첨을 통해 1년 무료 이용권 1매 · 1개월 무료 이용권 10매를 드립니다';
  const BETA_NOTE = '정식 출시 전 베타 테스트 기간으로 Pro 전 기능을 무료로 제공하고 있습니다';

  const PRICE = {
    month: { key: 'month', label: '월 구독', amount: 5000, price: '월 5,000원', note: '매월 자동결제 · 언제든 해지' },
    year: { key: 'year', label: '연 구독', amount: 50000, price: '연 50,000원', note: '2개월 무료 · 월 4,167원' }
  };

  function lsGet(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* =========================================================
     요금제
     ========================================================= */
  let plan = localStorage.getItem(PLAN_KEY) === 'pro' ? 'pro' : 'free';
  let billing = 'month';

  function isPro() { return plan === 'pro'; }
  /* 잠금 판정은 전부 이 함수를 씁니다. 베타 기간에는 항상 true. */
  function unlocked() { return BETA || plan === 'pro'; }
  function currentPlan() { return plan; }
  function setPlan(next, opts) {
    plan = next === 'pro' ? 'pro' : 'free';
    lsSet(PLAN_KEY, plan);
    document.documentElement.dataset.plan = plan;
    if (document.body) document.body.dataset.plan = plan;
    renderPlanUI();
    if (root.BojangDeck && root.__bojangState) root.BojangDeck.refresh(root.__bojangState, { reset: true });
    if (root.BojangTools) { root.BojangTools.renderCodes(); root.BojangTools.renderClaimDocs(); }
    if (root.__bojangState && root.__bojangState.tab === 'remodel') renderRemodel();
    if (!(opts && opts.silent)) toast(plan === 'pro' ? 'Pro 멤버십 데모를 켰습니다 — 잠금이 모두 열렸습니다' : '무료 체험 모드로 돌아왔습니다');
  }

  const PLAN_ROWS = [
    ['5대 담보 진단 · 입력', '기본', '전체'],
    ['고객 저장', '1명', '30명 (클라우드 무제한 예정)'],
    ['고객 30장 프레젠테이션', '1~6번 요약', '30장 전체'],
    ['PDF 리포트', '1장 · 워터마크', '1·10·30장 무워터마크'],
    ['리모델링 Before/After', '미리보기', '전체 사용'],
    ['화이트라벨 내 브랜드', '미리보기', '저장 · 로고 · PDF 반영'],
    ['질병코드 상세 · 청구 복사', '맛보기', '전체']
  ];

  /* 베타 기간 안내표 — 지금은 전 항목 무료, 괄호는 정식 출시 후 기준 */
  const BETA_ROWS = [
    ['5대 담보 진단 · 입력', '무료 · 전체', '기본 제공'],
    ['고객 저장', '무료 · 30명', 'Free 1명 / Pro 30명'],
    ['고객 30장 프레젠테이션', '무료 · 30장 전체', 'Free 1~6번 / Pro 30장'],
    ['PDF 리포트', '무료 · 1·10·30장', 'Free 1장 / Pro 3종'],
    ['리모델링 Before/After', '무료 · 전체 사용', 'Pro'],
    ['화이트라벨 · 로고', '무료 · 저장·PDF 반영', 'Pro'],
    ['질병코드 상세 · 청구 복사', '무료 · 전체', 'Pro']
  ];

  function planTableHTML() {
    return `<table class="pw-table"><thead><tr><th>기능</th><th>Free</th><th class="pro-col">Pro</th></tr></thead><tbody>
      ${PLAN_ROWS.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="pro-col"><b>${esc(r[2])}</b></td></tr>`).join('')}
    </tbody></table>`;
  }

  /* =========================================================
     화이트라벨 브랜드
     ========================================================= */
  const THEMES = {
    navy: {
      key: 'navy', label: 'Classic Navy · 네이비', chip: '#2F5D8A',
      accent: '#3A6EA5', deep: '#2B5580', blush: '#EAF1F8', wine: '#16293E',
      bg: '#F5F8FB', titleAccent: '#9CC3E6', mark: '#C4D8EA', glow: 'rgba(58,110,165,.34)',
      header: 'linear-gradient(160deg,#0C1B2C 0%,#16293E 56%,#24476B 100%)',
      hero: 'linear-gradient(155deg,#0C1B2C 0%,#182F48 58%,#2A5079 100%)'
    },
    emerald: {
      key: 'emerald', label: '에메랄드', chip: '#0F8A6E',
      accent: '#119C7C', deep: '#0B7560', blush: '#E8F6F1', wine: '#14322C',
      bg: '#F4FAF8', titleAccent: '#8FE0C9', mark: '#B9E6D8', glow: 'rgba(17,156,124,.30)',
      header: 'linear-gradient(160deg,#0A211C 0%,#14322C 56%,#1D5147 100%)',
      hero: 'linear-gradient(155deg,#0A211C 0%,#16362F 58%,#20604F 100%)'
    },
    rose: {
      key: 'rose', label: '로즈', chip: '#D96B70',
      accent: '#D96B70', deep: '#C85A60', blush: '#FDF0F0', wine: '#3A2628',
      bg: '#FAF4F3', titleAccent: '#F09A97', mark: '#F6C9C4', glow: 'rgba(217,107,112,.34)',
      header: 'linear-gradient(160deg,#2C1B1D 0%,#3A2628 56%,#5C3438 100%)',
      hero: 'linear-gradient(155deg,#2C1B1D 0%,#4A2E30 58%,#6B3A40 100%)'
    },
    charcoal: {
      key: 'charcoal', label: '차콜', chip: '#55525A',
      accent: '#5B5862', deep: '#403E46', blush: '#F0EFEE', wine: '#26252A',
      bg: '#F7F6F5', titleAccent: '#C9C5CE', mark: '#D6D2D9', glow: 'rgba(120,120,135,.30)',
      header: 'linear-gradient(160deg,#1B1A1E 0%,#26252A 56%,#45434B 100%)',
      hero: 'linear-gradient(155deg,#1B1A1E 0%,#2A292F 58%,#49474F 100%)'
    }
  };

  /* v5.2 중립 기본값 — 특정 브랜드·소속을 기본 노출하지 않습니다. */
  const DEFAULT_BRAND = {
    name: '보장분석 라이프 리포트',
    slogan: '고객 맞춤형 보장 점검 · 리모델링 상담 가이드',
    consultant: '', title: '', phone: '', kakao: '',
    theme: 'navy', logo: ''
  };

  const BRAND_PRESETS = [
    { key: 'neutral', label: '기본 중립', name: DEFAULT_BRAND.name, slogan: DEFAULT_BRAND.slogan, theme: 'navy' },
    { key: 'rose', label: '로즈 리포트', name: '로즈 라이프 리포트', slogan: '고객의 하루를 지키는 보장 점검 · 리모델링 상담', theme: 'rose' },
    { key: 'emerald', label: '에메랄드 리포트', name: '에메랄드 라이프 리포트', slogan: '균형 잡힌 보장 · 함께 만드는 내일', theme: 'emerald' },
    { key: 'charcoal', label: '차콜 리포트', name: '차콜 라이프 리포트', slogan: '담백하고 정확한 보장 점검', theme: 'charcoal' }
  ];

  let savedBrand = normalizeBrand(lsGet(BRAND_KEY, null));

  function cleanLogo(v) {
    const s = String(v == null ? '' : v);
    return /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= 950000 ? s : '';
  }

  function normalizeBrand(b) {
    const src = b && typeof b === 'object' ? Object.assign({}, b) : {};
    /* v5.1 기본값(‘보험에 반하다’ 로즈)은 v5.2 중립 기본값으로 자동 이전 */
    if (src.name === '보험에 반하다' && !src.logo && (!src.slogan || src.slogan === '당신의 삶에 꼭 맞는 보험, 현명한 선택')) {
      src.name = DEFAULT_BRAND.name;
      src.slogan = DEFAULT_BRAND.slogan;
      src.theme = 'navy';
      delete src.consultant; delete src.title; delete src.phone; delete src.kakao;
    }
    const out = Object.assign({}, DEFAULT_BRAND, src);
    if (!THEMES[out.theme]) out.theme = 'navy';
    out.name = String(out.name || '').trim().slice(0, 24) || DEFAULT_BRAND.name;
    out.slogan = String(out.slogan || '').trim().slice(0, 60) || DEFAULT_BRAND.slogan;
    ['consultant', 'title', 'phone', 'kakao'].forEach((k) => { out[k] = String(out[k] || '').trim(); });
    out.logo = cleanLogo(out.logo);
    return out;
  }

  function brand() { return savedBrand; }
  function themeOf(b) { return THEMES[(b || savedBrand).theme] || THEMES.navy; }
  function brandParts(name) {
    const parts = String(name || DEFAULT_BRAND.name).trim().split(/\s+/);
    if (parts.length <= 1) return { head: '', tail: parts[0] || DEFAULT_BRAND.name };
    return { head: parts.slice(0, -1).join(' ') + ' ', tail: parts[parts.length - 1] };
  }
  function brandNameHTML(name) {
    const p = brandParts(name);
    return (p.head ? esc(p.head) : '') + `<em>${esc(p.tail)}</em>`;
  }
  function contactLine(b) {
    const bits = [];
    if (b.consultant) bits.push(b.consultant + (b.title ? ` ${b.title}` : ''));
    if (b.phone) bits.push(b.phone);
    if (b.kakao) bits.push(b.kakao);
    return bits.join(' · ');
  }

  function applyTheme(b) {
    b = b || savedBrand;
    const t = themeOf(b);
    const r = document.documentElement.style;
    r.setProperty('--rose', t.accent);
    r.setProperty('--rose-deep', t.deep);
    r.setProperty('--point', t.accent);
    r.setProperty('--point-soft', t.blush);
    r.setProperty('--blush', t.blush);
    r.setProperty('--wine', t.wine);
    r.setProperty('--navy-800', t.wine);
    r.setProperty('--navy-700', t.wine);
    r.setProperty('--bg', t.bg);
    r.setProperty('--cream', t.bg);
    r.setProperty('--hdr-grad', t.header);
    r.setProperty('--hero-grad', t.hero);
    r.setProperty('--brand-title-accent', t.titleAccent);
    r.setProperty('--brand-mark', t.mark);
    r.setProperty('--brand-glow', t.glow);
    document.documentElement.dataset.brandTheme = b.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.bg);
  }

  function paintLogo(el, b) {
    if (!el) return;
    if (!el.dataset.base) el.dataset.base = el.innerHTML;
    if (b.logo) el.innerHTML = `<img class="brand-logo" src="${b.logo}" alt="${esc(b.name)} 로고">`;
    else el.innerHTML = el.dataset.base;
  }

  /* PDF 표지·머리말의 로고 이미지 — PDFKit이 실제 픽셀로 그립니다 */
  function loadPdfLogo(src) {
    if (!src) { root.__brandLogoImg = null; return; }
    const img = new Image();
    img.onload = () => { root.__brandLogoImg = img; };
    img.onerror = () => { root.__brandLogoImg = null; };
    img.src = src;
    if (img.complete && img.naturalWidth) root.__brandLogoImg = img;
  }

  function applyBrand() {
    const b = savedBrand;
    applyTheme(b);
    $$('.brand-text h1').forEach((el) => { el.innerHTML = brandNameHTML(b.name); });
    $$('.brand-text p').forEach((el) => { el.textContent = b.slogan; });
    const hh = $('#home-brand-name');
    if (hh) hh.innerHTML = brandNameHTML(b.name);
    const hs = $('#home-brand-slogan');
    if (hs) hs.textContent = b.slogan;
    paintLogo($('.brand-mark'), b);
    paintLogo($('.hh-heart'), b);
    const mark = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (mark) mark.setAttribute('content', b.name);
    const title = $('#brand-title');
    if (title) title.textContent = b.name;
    document.title = `${b.name} v5.5 · 고객 맞춤형 보장 점검 · 리모델링 상담 가이드`;
    loadPdfLogo(b.logo);
    /* 상담자 화면의 고객 표지도 새 브랜드로 다시 그립니다 */
    if (root.BojangDeck && root.__bojangState) root.BojangDeck.refresh(root.__bojangState, { reset: true });
  }

  function saveBrand(next, opts) {
    const normalized = normalizeBrand(next);
    if (!lsSet(BRAND_KEY, normalized)) { toast('저장 공간이 부족합니다 — 로고 이미지를 줄여 주세요'); return false; }
    savedBrand = normalized;
    applyBrand();
    /* v5.4 — 실서버 로그인 상태면 brand_settings 로 올립니다(베타 오프라인에서는 즉시 반환) */
    if (root.BojangBackend && root.BojangBackend.pushBrandSettings) {
      try { root.BojangBackend.pushBrandSettings(normalized); } catch (e) { /* 오프라인 */ }
    }
    if (!(opts && opts.silent)) toast('브랜드를 저장했습니다 — 헤더·메인·표지·PDF에 반영됩니다');
    return true;
  }

  /* =========================================================
     페이월 · 요금제 모달
     ========================================================= */
  const FEATURES = {
    deck: {
      title: '고객 30장 전체는 Pro에서 열립니다',
      desc: '무료 체험은 1~6번 요약 슬라이드까지입니다. 7번 암 상세부터 30번 로드맵까지 24장이 잠겨 있습니다.',
      bullets: ['암·뇌·심장·수술·간병 24장 상세', '부족 항목만 보기 · 보완 시뮬레이터', '상담 중 바로 PDF 저장']
    },
    pdf10: {
      title: '10장 상세 리포트는 Pro 전용입니다',
      desc: '무료 체험은 1장 요약 PDF만 저장할 수 있습니다. 10장 상세는 표지·포트폴리오·정밀 분석 10장을 담습니다.',
      bullets: ['10장 상세 · 무워터마크', '가족력·고지 판정·계약 표', '카톡·문자 공유']
    },
    pdf30: {
      title: '30장 설계사 플랜북은 Pro 전용입니다',
      desc: '상담 진행용 30장 플랜북은 Pro에서 저장·공유할 수 있습니다. 고객 배포용이 아닌 설계사용 대본입니다.',
      bullets: ['30장 상담 플랜북', '페이지별 판독·질문·함정·반론', '상담 메모란 포함']
    },
    save2: {
      title: '고객 저장은 1명까지입니다',
      desc: '무료 체험은 고객 1명을 저장합니다. Pro는 이 기기에 30명까지 저장하고, 정식 출시 후 클라우드로 무제한 동기화됩니다.',
      bullets: ['고객 30명 로컬 저장', '상담 이력 불러오기', 'JSON 내보내기·가져오기']
    },
    remodel: {
      title: '리모델링 Before/After는 Pro 전용입니다',
      desc: '무료 체험은 Before(현재)까지만 보입니다. Pro는 계약 정리안과 보강 후 점수·보험료·5대 담보 비교표를 모두 보여줍니다.',
      bullets: ['계약 유지·감액·정리 시뮬레이션', '보강 후 점수·보험료 실시간 계산', '리모델링 1장 비교 PDF']
    },
    remodelPdf: {
      title: '리모델링 비교 PDF는 Pro 전용입니다',
      desc: 'Before/After 비교 1장을 PDF로 저장해 고객에게 바로 보낼 수 있습니다.',
      bullets: ['보험료·점수 변화 1장 요약', '5대 담보 비교표', '설계사 한 줄 제안 포함']
    },
    brandSave: {
      title: '내 브랜드 저장은 Pro 전용입니다',
      desc: '무료 체험은 미리보기만 됩니다. Pro에서 저장하면 헤더·메인·고객 30장 표지·1/10/30장 PDF 표지와 꼬리말에 바로 반영됩니다.',
      bullets: ['상호·슬로건·설계사 정보', '포인트 테마 4종', '표지·꼬리말 브랜딩']
    },
    codeDetail: {
      title: '질병코드 상세·복사는 Pro 전용입니다',
      desc: '무료 체험은 상위 3개 코드의 요약까지입니다. Pro는 52개 코드 전체의 약관·판례 주의와 코드 복사를 엽니다.',
      bullets: ['52개 KCD 코드 전체', '약관·판례 주의', '코드 요약 복사']
    },
    claimCopy: {
      title: '청구 서류 복사는 Pro 전용입니다',
      desc: '무료 체험은 서류 목록 열람까지입니다. Pro는 5대 담보+실손 청구 서류를 카톡 문장으로 바로 복사합니다.',
      bullets: ['5대 담보 청구 서류', '실손 청구 서류', '카톡 복사']
    },
    plan: {
      title: 'Pro 멤버십 안내',
      desc: '보장분석 상담의 모든 잠금을 열고, 내 브랜드로 고객에게 전달하세요.',
      bullets: ['30장 전체 · PDF 3종', '리모델링 비교기 · 화이트라벨', '고객 30명 저장']
    }
  };

  let pwFeature = 'plan';

  function ensurePaywall() {
    if ($('#paywall')) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal paywall';
    wrap.id = 'paywall';
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="modal-card pw-card" role="dialog" aria-modal="true" aria-labelledby="pw-title">
        <button type="button" class="pw-x" id="pw-x" aria-label="닫기">×</button>
        <span class="pw-eyebrow">PRO MEMBERSHIP</span>
        <strong id="pw-title">Pro 멤버십 안내</strong>
        <p id="pw-desc"></p>
        <div class="pw-feature" id="pw-feature"></div>
        ${planTableHTML()}
        <div class="pw-plans" role="radiogroup" aria-label="구독 플랜">
          <button type="button" class="pw-plan is-on" data-pwplan="month" aria-pressed="true">
            <span class="pw-plan-top"><b>${PRICE.month.label}</b><i>${PRICE.month.price}</i></span>
            <span class="pw-plan-note">${PRICE.month.note}</span>
          </button>
          <button type="button" class="pw-plan" data-pwplan="year" aria-pressed="false">
            <span class="pw-plan-top"><b>${PRICE.year.label}</b><i>${PRICE.year.price}</i></span>
            <span class="pw-plan-note">${PRICE.year.note}</span>
          </button>
        </div>
        <button type="button" class="pw-cta" id="pw-cta">Pro 체험 켜기 (데모)</button>
        <button type="button" class="pw-free" id="pw-free" hidden>무료 체험으로 돌아가기</button>
        <button type="button" class="pw-later" id="pw-later">나중에</button>
        <p class="pw-note">데모 모드입니다 — 실제 결제 없이 Pro 화면을 확인합니다. 정식 출시 시 토스페이먼츠·포트원 빌링키 정기결제로 연결됩니다.</p>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closePaywall(); });
    $('#pw-x').addEventListener('click', closePaywall);
    $('#pw-later').addEventListener('click', closePaywall);
    $('#pw-cta').addEventListener('click', () => {
      setPlan('pro');
      closePaywall();
      if (root.BojangPlan && root.BojangPlan.afterUnlock) root.BojangPlan.afterUnlock(pwFeature);
    });
    $('#pw-free').addEventListener('click', () => { setPlan('free'); closePaywall(); });
    $$('[data-pwplan]', wrap).forEach((b) => {
      b.addEventListener('click', () => {
        billing = b.dataset.pwplan;
        $$('[data-pwplan]', wrap).forEach((x) => {
          const on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', String(on));
        });
        const cta = $('#pw-cta');
        if (cta && !cta.disabled) cta.textContent = `Pro 체험 켜기 (데모) · ${billing === 'year' ? PRICE.year.price + '/년' : PRICE.month.price + '/월'}`;
      });
    });
  }

  function openPaywall(feature) {
    /* 베타 기간에는 잠금 화면 대신 베타 안내 모달을 엽니다 */
    if (unlocked()) { openBetaModal(feature); return; }
    ensurePaywall();
    pwFeature = FEATURES[feature] ? feature : 'plan';
    const f = FEATURES[pwFeature];
    $('#pw-title').textContent = f.title;
    $('#pw-desc').textContent = f.desc;
    $('#pw-feature').innerHTML = f.bullets.map((b) => `<span>✓ ${esc(b)}</span>`).join('');
    const cta = $('#pw-cta');
    const free = $('#pw-free');
    if (isPro()) {
      cta.textContent = 'Pro 사용 중 (데모)';
      cta.disabled = true;
      free.hidden = false;
    } else {
      cta.textContent = `Pro 체험 켜기 (데모) · ${billing === 'year' ? PRICE.year.price + '/년' : PRICE.month.price + '/월'}`;
      cta.disabled = false;
      free.hidden = true;
    }
    $('#paywall').hidden = false;
  }
  function closePaywall() { const el = $('#paywall'); if (el) el.hidden = true; }

  /* =========================================================
     베타 안내 모달 · 피드백(Google Form) · 추첨 사은품
     ========================================================= */
  let bmFeature = 'plan';

  function ensureBetaModal() {
    if ($('#beta-modal')) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal beta-modal';
    wrap.id = 'beta-modal';
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="modal-card bm-card" role="dialog" aria-modal="true" aria-labelledby="bm-title">
        <button type="button" class="pw-x" id="bm-x" aria-label="닫기">×</button>
        <span class="bm-eyebrow">BETA TEST · V5.5</span>
        <strong id="bm-title">베타 기간 · Pro 전 기능 무료</strong>
        <p class="bm-lead">${BETA_NOTE}. 리모델링 비교기 · 10장·30장 PDF · 화이트라벨(로고) 설정까지 지금 바로 사용할 수 있습니다.</p>
        <div class="bm-feature" id="bm-feature"></div>
        <div class="bm-plans">
          <div class="bm-plan"><span>월 구독</span><b>${PRICE.month.price}</b><em>정식 출시 예정 · 매월 자동결제</em></div>
          <div class="bm-plan is-best"><span>연 구독</span><b>${PRICE.year.price}</b><em>정식 출시 예정 · 2개월 무료</em></div>
        </div>
        <div class="bm-table-wrap">
          <table class="pw-table bm-table"><thead><tr><th>기능</th><th class="pro-col">베타 기간</th><th>정식 출시 후</th></tr></thead><tbody>
            ${BETA_ROWS.map((r) => `<tr><td>${esc(r[0])}</td><td class="pro-col"><b>${esc(r[1])}</b></td><td>${esc(r[2])}</td></tr>`).join('')}
          </tbody></table>
        </div>
        <a class="bm-feedback" data-feedback href="${FEEDBACK_URL}" target="_blank" rel="noopener noreferrer">🎁 베타 피드백 남기기</a>
        <p class="bm-gift">${esc(GIFT_NOTE)}</p>
        <p class="bm-note">베타 기간에는 결제가 필요 없습니다. 정식 출시 후 위 요금제로 전환되며, 베타 참여자 혜택은 피드백 추첨으로 안내합니다.</p>
        <button type="button" class="pw-later" id="bm-close">닫기</button>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeBetaModal(); });
    $('#bm-x').addEventListener('click', closeBetaModal);
    $('#bm-close').addEventListener('click', closeBetaModal);
  }

  function openBetaModal(feature) {
    ensureBetaModal();
    bmFeature = FEATURES[feature] ? feature : 'plan';
    const chips = ['리모델링 Before/After', '10장 · 30장 PDF', '화이트라벨 · 로고 업로드', '고객 30명 저장'];
    $('#bm-feature').innerHTML = chips.map((c) => `<span>✓ ${esc(c)} 무료</span>`).join('');
    $('#beta-modal').hidden = false;
  }
  function closeBetaModal() { const el = $('#beta-modal'); if (el) el.hidden = true; }

  function setupFeedbackLinks() {
    $$('[data-feedback]').forEach((a) => {
      a.setAttribute('href', FEEDBACK_URL);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
  }

  /* 잠금 해제 직후 같은 동작을 이어서 할 수 있게 하는 후처리 */
  function afterUnlock(feature) {
    if (feature === 'deck' && root.__bojangState && root.__bojangState.view === 'client' && root.BojangDeck) {
      root.BojangDeck.refresh(root.__bojangState, { reset: true });
      root.BojangDeck.show(root.__bojangState);
      if (root.__deckLockNo) root.BojangDeck.goTo(root.__deckLockNo);
    }
    if (feature === 'remodel' || feature === 'remodelPdf') renderRemodel();
  }

  function openPlanModal() {
    /* v5.4 — 실서버 모드에서는 계정/구독 모달이 단일 창구입니다 */
    if (root.BojangBackend && root.BojangBackend.isLive && root.BojangBackend.isLive()) {
      root.BojangBackend.openAccount();
      return;
    }
    if (unlocked()) { openBetaModal('plan'); return; }
    openPaywall('plan');
  }

  let serverSub = null;   /* 서버 subscriptions 스냅샷 (실서버 모드에서만 존재) */

  /* v5.4 — 실서버 구독 상태를 반영합니다(backend.js 가 호출).
     null 또는 만료 → free. 베타 기간에는 잠금 UI 를 그대로 열어 두고 배지·상태만 바뀝니다. */
  function hydrate(ent) {
    if (!ent || !ent.plan) {
      serverSub = null;
      plan = 'free';
    } else {
      const live = ['trialing', 'active', 'past_due'].indexOf(String(ent.status || '')) >= 0;
      serverSub = {
        plan: ent.plan, status: ent.status || '', billing_cycle: ent.billing_cycle || null,
        current_period_end: ent.current_period_end || null
      };
      plan = ent.plan === 'pro' && live ? 'pro' : 'free';
    }
    lsSet(PLAN_KEY, plan);
    document.documentElement.dataset.plan = plan;
    if (document.body) document.body.dataset.plan = plan;
    renderPlanUI();
    return plan;
  }
  function serverPlan() { return serverSub; }

  /* =========================================================
     요금제 UI (헤더 배지 · 메인 배너)
     ========================================================= */
  function renderPlanUI() {
    const beta = BETA;
    const open = unlocked();
    const badge = $('#plan-badge');
    if (badge) {
      badge.classList.toggle('is-pro', !beta && isPro());
      badge.classList.toggle('is-beta', beta);
      const label = $('#plan-badge-label');
      if (label) label.textContent = beta ? '베타 무료' : (isPro() ? 'PRO' : '무료 체험');
      badge.setAttribute('aria-label', beta ? '베타 테스트 기간 · 전 기능 무료 · 안내 보기' : isPro() ? 'Pro 멤버십 · 요금제 보기' : '무료 체험 · Pro로 전환');
    }
    const host = $('#home-plan-banner');
    if (host) {
      host.innerHTML = beta
        ? `<div class="plan-banner is-beta" id="beta-banner-card">
            <div class="pb-main"><span class="pb-eyebrow">BETA TEST · V5.5</span><b>베타 기간 · Pro 전 기능 무료 <i>FREE</i></b>
              <p>${BETA_NOTE}. 리모델링 · 10/30장 PDF · 화이트라벨을 지금 그대로 쓰세요.</p></div>
            <button type="button" class="pb-btn primary" data-beta-open>베타 안내</button>
          </div>`
        : isPro()
        ? `<div class="plan-banner is-pro">
            <div class="pb-main"><span class="pb-eyebrow">MY PLAN</span><b>Pro 멤버십 <i>데모</i></b>
              <p>30장 전체 · PDF 3종 · 리모델링 · 화이트랙벨이 모두 열려 있습니다.</p></div>
            <button type="button" class="pb-btn" data-plan-open>요금제 보기</button>
          </div>`
        : `<div class="plan-banner">
            <div class="pb-main"><span class="pb-eyebrow">FREE PLAN</span><b>무료 체험 (Free)</b>
              <p>30장 중 1~6번 · 1장 PDF(워터마크) · 고객 1명까지. Pro로 전환하면 30장 전체와 리모델링·화이트랙벨이 열립니다.</p></div>
            <button type="button" class="pb-btn primary" data-plan-open>Pro로 전환</button>
          </div>`;
    }
    const loadSub = $('#home-load-sub');
    if (loadSub) loadSub.textContent = open ? '베타 · 고객 30명 저장' : '무료 체험 · 고객 1명';
    ['#home-hist-sub', '#result-hist-sub'].forEach((sel) => {
      const el = $(sel);
      if (el) el.textContent = open ? '이 기기에만 저장 · 최대 30건' : '이 기기에만 저장 · 무료 1명 (Pro 30명)';
    });
    /* 베타 기간에는 PDF 버튼 잠금 표시가 없습니다 */
    $$('.pdf-btn').forEach((b) => {
      const label = $('.pb-label', b);
      if (!label) return;
      if (!label.dataset.text) label.dataset.text = label.textContent;
      const locked = !open && b.dataset.pdf !== 'summary';
      b.classList.toggle('is-locked', locked);
      label.textContent = (locked ? '🔒 ' : '') + label.dataset.text;
    });
    setupFeedbackLinks();
    if (root.__bojangState && root.__bojangState.tab === 'brand') renderBrand();
  }

  /* =========================================================
     리모델링 Before / After
     ========================================================= */
  const AXES = [
    { key: 'cancer', name: '암', unit: '일반암 진단비', part: 'general', max: 10000, step: 500,
      get: (s) => Number(s.cov.cancer.general || 0), set: (s, v) => { s.cov.cancer.general = v; } },
    { key: 'brain', name: '뇌', unit: '뇌혈관질환 진단비', part: 'dx', max: 5000, step: 500,
      get: (s) => Number((s.cov.brain.dx || {}).vascular || 0), set: (s, v) => { s.cov.brain.dx.vascular = v; } },
    { key: 'heart', name: '심장', unit: '허혈성심장질환 진단비', part: 'dx', max: 5000, step: 500,
      get: (s) => Number((s.cov.heart.dx || {}).ischemic || 0), set: (s, v) => { s.cov.heart.dx.ischemic = v; } },
    { key: 'surgery', name: '수술', unit: '질병수술비(일반)', part: 'disease', max: 300, step: 10,
      get: (s) => Number(s.cov.surgery.disease || 0), set: (s, v) => { s.cov.surgery.disease = v; } },
    { key: 'care', name: '간병', unit: '일반병원 간병 일당', part: 'daily', max: 30, step: 1,
      get: (s) => Number(s.cov.care.daily || 0), set: (s, v) => { s.cov.care.daily = v; } }
  ];

  function emptyRemodel() {
    return { acts: {}, cuts: {}, boosts: {}, extra: {}, comment: '' };
  }
  let remodel = Object.assign(emptyRemodel(), lsGet(REMODEL_KEY, {}));
  function saveRemodel() { lsSet(REMODEL_KEY, remodel); }

  function contractAct(id) { return remodel.acts[id] || 'keep'; }
  function recommendedOf(m, axis) {
    const row = m.rows.find((r) => r.item.key === axis.key);
    if (!row) return 0;
    const p = row.r.parts.find((x) => x.key === axis.part);
    if (!p) return 0;
    if (p.type === 'dxset' && p.dx && p.dx.core) return p.dx.core.rec || p.rec || 0;
    return p.rec || 0;
  }

  function calcRemodel() {
    const s = planState();
    if (!s || !root.BojangModel) return null;
    const before = root.BojangModel.full(s);
    const clone = JSON.parse(JSON.stringify({
      age: s.age, gender: s.gender, job: s.job, silson: s.silson, premium: s.premium,
      client: s.client, contracts: s.contracts, family: s.family, disc: s.disc, cov: s.cov, flags: s.flags
    }));
    let contractDelta = 0;
    const contractRows = (s.contracts || []).map((c) => {
      const act = contractAct(c.id);
      const now = Number(c.premium || 0);
      let next = now;
      if (act === 'close') next = 0;
      else if (act === 'reduce') next = clamp(Number(remodel.cuts[c.id] != null ? remodel.cuts[c.id] : Math.round(now * 0.6)), 0, now);
      contractDelta += next - now;
      return { contract: c, act, now, next };
    });
    let extraTotal = 0;
    const axes = AXES.map((a) => {
      const beforeVal = a.get(s);
      const target = Math.max(beforeVal, Number(remodel.boosts[a.key] || 0));
      if (target > beforeVal) a.set(clone, target);
      const extra = Number(remodel.extra[a.key] || 0);
      extraTotal += extra;
      return { axis: a, beforeVal, target, extra, changed: target > beforeVal, rec: recommendedOf(before, a) };
    });
    const beforePrem = Number(s.premium || 0);
    const afterPrem = Math.max(0, beforePrem + contractDelta + extraTotal);
    clone.premium = afterPrem;
    /* 보유 계약이 줄면 10장 PDF의 계약 표도 그대로 보여 주도록 정리안을 반영합니다 */
    clone.contracts = (s.contracts || []).map((c) => {
      const act = contractAct(c.id);
      if (act === 'close') return Object.assign({}, c, { premium: 0, action: 'close', pay: '정리' });
      if (act === 'reduce') {
        const next = clamp(Number(remodel.cuts[c.id] != null ? remodel.cuts[c.id] : Math.round(Number(c.premium || 0) * 0.6)), 0, Number(c.premium || 0));
        return Object.assign({}, c, { premium: next, action: 'reduce' });
      }
      return Object.assign({}, c, { action: 'keep' });
    });
    const after = root.BojangModel.full(clone);
    return {
      before, after, beforePrem, afterPrem, contractDelta, extraTotal, contractRows, axes,
      premDelta: afterPrem - beforePrem, scoreDelta: after.score - before.score,
      rows: before.rows.map((br) => {
        const ar = after.rows.find((x) => x.item.key === br.item.key);
        return { key: br.item.key, item: br.item, beforePct: br.pct, afterPct: ar ? ar.pct : br.pct, before, after: ar };
      })
    };
  }

  function autoComment(c) {
    if (!c) return '';
    const bits = [];
    const cuts = c.contractRows.filter((r) => r.act !== 'keep');
    if (cuts.length) {
      const closed = cuts.filter((r) => r.act === 'close').length;
      const reduced = cuts.filter((r) => r.act === 'reduce').length;
      const bits2 = [];
      if (closed) bits2.push(`계약 ${closed}건 정리`);
      if (reduced) bits2.push(`감액 ${reduced}건`);
      bits.push(`${bits2.join(', ')}으로 월 ${won(Math.abs(c.contractDelta))}만원을 마련하고`);
    }
    const boosted = c.axes.filter((a) => a.changed);
    if (boosted.length) bits.push(`${boosted.map((a) => a.axis.name).join('·')}을(를) 권장선까지 보강하면`);
    const p = c.axes.filter((a) => a.changed && a.extra > 0).reduce((n, a) => n + a.extra, 0);
    bits.push(`월 ${won(c.beforePrem)}만원 → ${won(c.afterPrem)}만원(${c.premDelta >= 0 ? '+' : '-'}${won(Math.abs(c.premDelta))}), 종합점수 ${c.before.score} → ${c.after.score}점(${c.scoreDelta >= 0 ? '+' : ''}${c.scoreDelta})이 됩니다`);
    if (p) bits.push(`(추가 보험료 ${won(p)}만원 포함)`);
    return bits.join(' ') + '. 지금은 보장을 늘리는 단계가 아니라 배분을 바꾸는 단계입니다.';
  }

  function axisCell(c, a, key) {
    if (!unlocked()) return '<span class="rm-mask">🔒 Pro</span>';
    const row = c.rows.find((r) => r.key === a.key);
    const v = key === 'before' ? row.beforePct : row.afterPct;
    return `<b>${v}%</b>`;
  }

  function renderRemodel() {
    const host = $('#remodel-body');
    if (!host) return;
    const s = planState();
    const c = calcRemodel();
    if (!s || !c) { host.innerHTML = '<p class="fc-empty">고객 입력값을 먼저 불러와 주세요.</p>'; return; }
    const pro = unlocked();
    const d = c.premDelta;
    const axisRows = c.axes.map((a) => {
      const row = c.rows.find((r) => r.key === a.axis.key);
      return `<div class="rm-axis" data-axis="${a.axis.key}">
        <div class="rma-head">
          <b>${esc(a.axis.name)}</b><span>${esc(a.axis.unit)}</span>
          <em class="${row.beforePct >= 100 ? 'tone-ok' : 'tone-need'}">현재 ${row.beforePct}%</em>
        </div>
        <div class="rma-now">현재 <b>${won(a.beforeVal)}만원</b> · 권장 <b>${won(a.rec)}만원</b>${a.beforeVal >= a.rec && a.rec > 0 ? ' <em class="rma-done">이미 권장선 이상</em>' : ''}</div>
        <div class="rma-inputs">
          <label class="rma-f"><span>보강 후 금액</span><input type="number" inputmode="numeric" min="0" max="${a.axis.max}" step="${a.axis.step}" value="${a.target || ''}" placeholder="${won(a.rec)}" data-boost="${a.axis.key}" aria-label="${esc(a.axis.name)} 보강 후 금액"></label>
          <label class="rma-f"><span>추가 보험료</span><input type="number" inputmode="numeric" min="0" max="50" step="1" value="${a.extra || ''}" placeholder="0" data-extra="${a.axis.key}" aria-label="${esc(a.axis.name)} 추가 보험료"></label>
          <span class="rma-unit">만원</span>
        </div>
        <div class="rma-bars">
          <div class="rma-bar"><span>Before</span><i class="rm-before" style="width:${Math.max(2, row.beforePct)}%"></i><b>${row.beforePct}%</b></div>
          <div class="rma-bar"><span>After</span><i class="rm-after" style="width:${pro ? Math.max(2, row.afterPct) : 4}%"></i><b>${pro ? row.afterPct + '%' : '🔒'}</b></div>
        </div>
      </div>`;
    }).join('');

    const contractBlock = c.contractRows.length ? `
      <div class="rm-block">
        <div class="rm-block-head"><b>보유 계약 정리안</b><span>유지 · 감액 · 정리(해지) 중 하나를 고르세요</span></div>
        ${c.contractRows.map((r) => `
          <div class="rm-contract" data-ct="${esc(r.contract.id)}">
            <div class="rmc-main"><b>${esc(r.contract.insurer || '보험사')}</b><span>${esc(r.contract.product || '상품명')}</span><em>월 ${won(r.now)}만원</em></div>
            <div class="rmc-acts" role="group" aria-label="계약 정리안">
              <button type="button" data-act="keep" class="${r.act === 'keep' ? 'is-on' : ''}">유지</button>
              <button type="button" data-act="reduce" class="${r.act === 'reduce' ? 'is-on' : ''}">감액</button>
              <button type="button" data-act="close" class="${r.act === 'close' ? 'is-on tone-close' : ''}">정리</button>
            </div>
            ${r.act === 'reduce' ? `<label class="rmc-cut"><span>감액 후 월 보험료</span><input type="number" inputmode="numeric" min="0" max="${r.now}" step="1" value="${r.next}" data-cut="${esc(r.contract.id)}"><em>만원</em></label>` : ''}
          </div>`).join('')}
      </div>` : `<div class="rm-block rm-empty"><b>보유 계약이 입력되지 않았습니다</b><span>상담자 상세 입력 → 계약·보험료에서 계약을 추가하면 계약별 정리안까지 계산합니다.</span></div>`;

    host.innerHTML = `
      <div class="rm-hero-grid">
        <div class="rm-kpi">
          <span>월 보험료</span>
          <div class="rm-kpi-num"><b>${won(c.beforePrem)}</b><i>→</i><strong>${won(c.afterPrem)}</strong><em>만원</em></div>
          <p class="rm-delta ${d > 0 ? 'is-up' : d < 0 ? 'is-down' : ''}">${d === 0 ? '변동 없음' : `${d > 0 ? '+' : '-'}${won(Math.abs(d))}만원 ${d > 0 ? '보강' : '절감'}`}</p>
        </div>
        <div class="rm-kpi">
          <span>종합 보장 점수</span>
          <div class="rm-kpi-num"><b>${c.before.score}</b><i>→</i><strong>${pro ? c.after.score : '🔒'}</strong><em>점</em></div>
          <p class="rm-delta ${c.scoreDelta > 0 ? 'is-up' : ''}">${pro ? (c.scoreDelta === 0 ? '변동 없음' : `${c.scoreDelta > 0 ? '+' : ''}${c.scoreDelta}점 ${c.scoreDelta > 0 ? '상승' : '하락'}`) : 'Pro에서 확인'}</p>
        </div>
      </div>
      ${pro ? '' : `<button type="button" class="rm-unlock" data-rm-upgrade>🔒 Pro 멤버십으로 After 전체 열기 — 계약 정리안 · 점수 · 비교표</button>`}
      ${BETA ? '<p class="rm-beta-line">✓ 베타 기간에는 After 전체(계약 정리안 · 점수 · 비교표)가 무료로 열려 있습니다.</p>' : ''}
      ${contractBlock}
      <div class="rm-block">
        <div class="rm-block-head"><b>담보별 보강 설계</b><span>보강 후 금액과 예상 추가 보험료를 입력하면 즉시 다시 계산합니다</span></div>
        ${axisRows}
      </div>
      <div class="rm-block">
        <div class="rm-block-head"><b>5대 담보 Before / After</b><span>권장선 100% 기준</span></div>
        <div class="rm-table-wrap">
          <table class="rm-table">
            <thead><tr><th>담보</th><th>Before</th><th>After</th><th>변화</th></tr></thead>
            <tbody>
              ${c.rows.map((r) => `<tr><td><b>${esc(r.item.name)}</b></td><td>${r.beforePct}%</td><td>${pro ? r.afterPct + '%' : '<span class="rm-mask">🔒</span>'}</td><td>${pro ? (r.afterPct - r.beforePct > 0 ? `<em class="up">+${r.afterPct - r.beforePct}%p</em>` : r.afterPct - r.beforePct < 0 ? `<em class="down">${r.afterPct - r.beforePct}%p</em>` : '—') : '<span class="rm-mask">Pro</span>'}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="rm-block">
        <div class="rm-block-head"><b>설계사 한 줄 제안</b><span>고객에게 그대로 말하는 문장</span>
          <button type="button" class="rm-auto" id="rm-auto">자동 작성</button></div>
        <textarea id="rm-comment" class="rm-comment" rows="4" maxlength="320" placeholder="예: 지금은 보장을 늘리는 단계가 아니라 배분을 바꾸는 단계입니다.">${esc(remodel.comment || '')}</textarea>
      </div>
      <div class="rm-actions">
        <button type="button" class="btn-primary sm" id="rm-pdf">${pro ? '리모델링 1장 비교 PDF' : '🔒 리모델링 PDF (Pro)'}</button>
        <button type="button" class="btn-ghost sm" id="rm-copy">${pro ? '카톡 요약 복사' : '🔒 카톡 요약 복사 (Pro)'}</button>
      </div>
      <p class="fc-src">계약 감액·정리 금액과 추가 보험료는 입력값 기준의 상담 보조 시뮬레이션입니다. 실제 인수·보험료·해지환급금은 상품과 나이, 납입 기간에 따라 달라지며, 계약 정리는 고객의 결정입니다.</p>
    `;
    bindRemodel(host);
  }

  function bindRemodel(host) {
    $$('[data-act]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.closest('[data-ct]').dataset.ct;
        remodel.acts[id] = b.dataset.act;
        if (b.dataset.act === 'reduce' && remodel.cuts[id] == null) {
          const c = planState().contracts.find((x) => x.id === id);
          remodel.cuts[id] = c ? Math.round(Number(c.premium || 0) * 0.6) : 0;
        }
        saveRemodel(); renderRemodel();
      });
    });
    $$('[data-cut]', host).forEach((inp) => {
      inp.addEventListener('input', () => {
        const id = inp.dataset.cut;
        const c = planState().contracts.find((x) => x.id === id);
        remodel.cuts[id] = clamp(Number(inp.value || 0), 0, c ? Number(c.premium || 0) : 0);
        saveRemodel(); refreshRemodelNumbers();
      });
    });
    $$('[data-boost]', host).forEach((inp) => {
      inp.addEventListener('input', () => {
        remodel.boosts[inp.dataset.boost] = Math.max(0, Number(inp.value || 0));
        saveRemodel(); refreshRemodelNumbers();
      });
    });
    $$('[data-extra]', host).forEach((inp) => {
      inp.addEventListener('input', () => {
        remodel.extra[inp.dataset.extra] = Math.max(0, Number(inp.value || 0));
        saveRemodel(); refreshRemodelNumbers();
      });
    });
    const ta = $('#rm-comment', host);
    if (ta) ta.addEventListener('input', () => { remodel.comment = ta.value.slice(0, 320); saveRemodel(); });
    const auto = $('#rm-auto', host);
    if (auto) auto.addEventListener('click', () => {
      remodel.comment = autoComment(calcRemodel()).slice(0, 320);
      saveRemodel(); renderRemodel();
    });
    const unlock = $('[data-rm-upgrade]', host);
    if (unlock) unlock.addEventListener('click', () => openPaywall('remodel'));
    const pdfBtn = $('#rm-pdf', host);
    if (pdfBtn) pdfBtn.addEventListener('click', () => { if (unlocked()) remodelPdf(); else openPaywall('remodelPdf'); });
    const copyBtn = $('#rm-copy', host);
    if (copyBtn) copyBtn.addEventListener('click', () => {
      if (!unlocked()) { openPaywall('remodel'); return; }
      if (root.__bojangCopy) root.__bojangCopy(remodelKakao(calcRemodel()), '리모델링 요약을 복사했습니다');
    });
  }

  /* 입력 중에는 결과 숫자만 갱신해 포커스를 잃지 않게 합니다 */
  function refreshRemodelNumbers() {
    const c = calcRemodel();
    if (!c) return;
    const kpis = $$('.rm-kpi-num');
    if (kpis[0]) kpis[0].querySelector('strong').textContent = won(c.afterPrem);
    if (kpis[0]) kpis[0].parentElement.querySelector('.rm-delta').textContent = c.premDelta === 0 ? '변동 없음' : `${c.premDelta > 0 ? '+' : '-'}${won(Math.abs(c.premDelta))}만원 ${c.premDelta > 0 ? '보강' : '절감'}`;
    if (kpis[1] && unlocked()) kpis[1].querySelector('strong').textContent = c.after.score;
    if (kpis[1] && unlocked()) kpis[1].parentElement.querySelector('.rm-delta').textContent = c.scoreDelta === 0 ? '변동 없음' : `${c.scoreDelta > 0 ? '+' : ''}${c.scoreDelta}점 ${c.scoreDelta > 0 ? '상승' : '하락'}`;
    if (unlocked()) {
      $$('.rm-axis').forEach((el) => {
        const key = el.dataset.axis;
        const row = c.rows.find((r) => r.key === key);
        if (!row) return;
        const bars = $$('.rma-bar', el);
        if (bars[1]) { bars[1].querySelector('i').style.width = Math.max(2, row.afterPct) + '%'; bars[1].querySelector('b').textContent = row.afterPct + '%'; }
      });
      const tb = $$('.rm-table tbody tr');
      tb.forEach((tr, i) => {
        const r = c.rows[i];
        if (!r) return;
        const tds = tr.querySelectorAll('td');
        if (tds[2]) tds[2].textContent = r.afterPct + '%';
        if (tds[3]) tds[3].innerHTML = r.afterPct - r.beforePct > 0 ? `<em class="up">+${r.afterPct - r.beforePct}%p</em>` : r.afterPct - r.beforePct < 0 ? `<em class="down">${r.afterPct - r.beforePct}%p</em>` : '—';
      });
    }
  }

  function remodelKakao(c) {
    if (!c) return '';
    const L = [];
    L.push(`[${savedBrand.name} 리모델링 제안]`);
    L.push(`${c.before.client.name}님 · ${c.before.dateLabel || ''}`);
    L.push('');
    L.push(`■ 월 보험료 : ${won(c.beforePrem)}만원 → ${won(c.afterPrem)}만원 (${c.premDelta === 0 ? '변동 없음' : `${c.premDelta > 0 ? '+' : '-'}${won(Math.abs(c.premDelta))}만원 ${c.premDelta > 0 ? '보강' : '절감'}`})`);
    L.push(`■ 종합 점수 : ${c.before.score}점 → ${c.after.score}점 (${c.scoreDelta >= 0 ? '+' : ''}${c.scoreDelta})`);
    L.push('');
    L.push('■ 5대 담보 (Before → After)');
    c.rows.forEach((r) => L.push(`· ${r.item.name} ${r.beforePct}% → ${r.afterPct}%`));
    if (c.contractRows.some((r) => r.act !== 'keep')) {
      L.push('');
      L.push('■ 계약 정리안');
      c.contractRows.forEach((r) => {
        if (r.act === 'keep') return;
        L.push(`· ${r.contract.insurer || '보험사'} ${r.contract.product || ''} — ${r.act === 'close' ? '정리' : `감액 ${won(r.now)}→${won(r.next)}만원`}`);
      });
    }
    if (remodel.comment) { L.push(''); L.push('■ 제안'); L.push(remodel.comment); }
    L.push('');
    L.push('※ 상담 보조용 시뮬레이션입니다. 실제 보험료·인수·해지환급금은 상품과 나이에 따라 달라집니다.');
    return L.join('\n');
  }

  async function remodelPdf() {
    if (!root.PDFKit) return;
    const c = calcRemodel();
    if (!c) return;
    const b = savedBrand;
    const t = themeOf(b);
    const C = root.PDFKit.C;
    const mix = root.PDFKit.mix || ((a) => a);
    const accent = t.accent;
    const who = b.consultant || c.before.client.consultant;
    const drawer = function (s) {
      /* v5.5 프리미엄 1장 — 테마 팔레트·명함·근거를 갖춘 리모델링 제안서 */
      s.photoBand(0, 132, {});
      s.header({ kicker: 'REMODELING PROPOSAL', no: '1', total: '1' });
      s.brandWordmark(s.ML, 54, { size: 8.4, contact: false });
      s.text('리모델링 Before / After', s.ML, 74, { size: 19, weight: 800, color: C.navy });
      s.text(`${c.before.client.name}님 · 상담일 ${c.before.dateLabel || '-'} · 담당 ${who}`, s.ML, 100, { size: 7.2, weight: 600, color: C.ink2 });

      let y = 146;
      const kw = (s.CW - 10) / 2;
      [['월 보험료', `${won(c.beforePrem)} → ${won(c.afterPrem)}`, '만원', c.premDelta === 0 ? '변동 없음' : `${c.premDelta > 0 ? '+' : '−'}${won(Math.abs(c.premDelta))}만원 ${c.premDelta > 0 ? '보강' : '절감'}`, c.premDelta > 0 ? 'need' : 'ok'],
       ['종합 보장 점수', `${c.before.score} → ${c.after.score}`, '점', c.scoreDelta === 0 ? '변동 없음' : `${c.scoreDelta > 0 ? '+' : '−'}${Math.abs(c.scoreDelta)}점 ${c.scoreDelta > 0 ? '상승' : '하락'}`, c.scoreDelta >= 0 ? 'ok' : 'warn']].forEach((k, i) => {
        const x = s.ML + i * (kw + 10);
        s.rect(x, y, kw, 60, { fill: i ? '#fff' : C.tint2, r: 6, stroke: C.line });
        s.text(k[0], x + 12, y + 9, { size: 6.4, weight: 700, color: C.muted });
        s.text(k[1], x + 12, y + 20, { size: 17, weight: 800, color: C.navy });
        s.text(k[2], x + 12 + s.measure(k[1], 17, 800) + 3, y + 27, { size: 6.4, weight: 600, color: C.muted });
        s.badge(x + 12, y + 43, k[3], k[4], { size: 5.8, h: 12 });
      });
      y += 70;

      y = s.sectionHead(s.ML, y, s.CW, '01', '5대 담보 비교', '권장선 100% 기준');
      const headH = 16, rowH = 19;
      s.rect(s.ML, y, s.CW, headH, { fill: C.navy });
      s.text('담보', s.ML + 7, y + 5, { size: 6.2, weight: 700, color: '#fff' });
      s.text('Before', s.ML + 170, y + 5, { size: 6.2, weight: 700, color: '#fff', align: 'center' });
      s.text('After', s.ML + 244, y + 5, { size: 6.2, weight: 700, color: '#fff', align: 'center' });
      s.text('변화', s.ML + 320, y + 5, { size: 6.2, weight: 700, color: '#fff', align: 'center' });
      s.text('After 충족도', s.W - s.MR - 7, y + 5, { size: 6.2, weight: 700, color: '#fff', align: 'right' });
      c.rows.forEach((r, i) => {
        const ry = y + headH + i * rowH;
        const d = r.afterPct - r.beforePct;
        s.rect(s.ML, ry, s.CW, rowH, { fill: i % 2 ? C.sky2 : '#fff' });
        s.line(s.ML, ry + rowH, s.ML + s.CW, ry + rowH, { color: C.line2 });
        s.text(`${i + 1}. ${r.item.name}`, s.ML + 7, ry + 4.6, { size: 7.4, weight: 800, color: C.navy });
        s.text(`${r.beforePct}%`, s.ML + 170, ry + 4.6, { size: 6.8, weight: 600, color: C.ink2, align: 'center' });
        s.text(`${r.afterPct}%`, s.ML + 244, ry + 4.6, { size: 6.8, weight: 800, color: r.afterPct > r.beforePct ? C.mint : C.navy, align: 'center' });
        s.text(d > 0 ? `+${d}%p` : d < 0 ? `${d}%p` : '—', s.ML + 320, ry + 4.6, { size: 6.4, weight: 700, color: d > 0 ? C.mint : d < 0 ? C.red : C.muted, align: 'center' });
        s.gauge(s.W - s.MR - 92, ry + 7, 66, r.afterPct / 100, { color: r.afterPct >= 99 ? C.mint : r.afterPct >= 50 ? C.orange : C.red, h: 5 });
        s.text(`${r.afterPct}%`, s.W - s.MR - 7, ry + 4.6, { size: 6.2, weight: 700, color: C.ink2, align: 'right' });
      });
      y += headH + c.rows.length * rowH + 10;

      const half = (s.CW - 10) / 2;
      const conRows = c.contractRows.filter((r) => r.act !== 'keep');
      const boxTop = y;
      const boxH = Math.max(54, 30 + Math.max(conRows.length || 1, c.axes.filter((a) => a.changed).length || 1) * 17 + 8);
      s.rect(s.ML, boxTop, half, boxH, { fill: '#fff', r: 5, stroke: C.line });
      s.text('계약 정리안', s.ML + 10, boxTop + 7, { size: 6.6, weight: 800, color: C.navy });
      if (conRows.length) {
        conRows.slice(0, 4).forEach((r, i) => {
          const ry = boxTop + 21 + i * 17;
          s.text(`${(r.contract.insurer || '보험사')} ${(r.contract.product || '')}`.slice(0, 26), s.ML + 10, ry, { size: 5.8, weight: 600, color: C.ink2 });
          s.text(`${won(r.now)}→${won(r.next)}만원`, s.ML + half - 70, ry, { size: 5.8, weight: 700, color: C.navy, align: 'right' });
          s.badge(s.ML + half - 60, ry - 1.4, r.act === 'close' ? '정리' : '감액', r.act === 'close' ? 'gap' : 'need', { size: 5.2, h: 10, padX: 3.5 });
        });
      } else {
        s.para('유지할 계약만 있습니다. 정리·감액 대상이 없으면 보강 설계만 진행합니다.', s.ML + 10, boxTop + 22, half - 20, { size: 5.8, color: C.muted, lh: 1.4 });
      }
      const rx = s.ML + half + 10;
      s.rect(rx, boxTop, half, boxH, { fill: '#fff', r: 5, stroke: C.line });
      s.text('보강 설계', rx + 10, boxTop + 7, { size: 6.6, weight: 800, color: C.navy });
      s.text('추가 보험료', rx + half - 10, boxTop + 7, { size: 5.4, weight: 600, color: C.muted, align: 'right' });
      const axes = c.axes.filter((a) => a.changed);
      if (axes.length) {
        axes.slice(0, 4).forEach((a, i) => {
          const ry = boxTop + 21 + i * 17;
          s.text(`${a.axis.name} ${a.axis.unit}`, rx + 10, ry, { size: 5.8, weight: 600, color: C.ink2 });
          s.text(`${won(a.beforeVal)}→${won(a.target)}만원`, rx + half - 66, ry, { size: 5.8, weight: 700, color: C.navy, align: 'right' });
          s.text(a.extra ? `+${won(a.extra)}만원` : '—', rx + half - 10, ry, { size: 5.8, weight: 700, color: C.orange, align: 'right' });
        });
      } else {
        s.para('보강 항목이 없습니다. 지금 구조를 유지하고 갱신·만기 점검으로 넘어갑니다.', rx + 10, boxTop + 22, half - 20, { size: 5.8, color: C.muted, lh: 1.4 });
      }
      y = boxTop + boxH + 10;

      y = s.sectionHead(s.ML, y, s.CW, '02', '담당자 제안', '이 안을 고르실 때의 기준');
      const comment = remodel.comment || autoComment(c);
      const ch = s.height(comment, s.CW - 26, 8, 1.5) + 24;
      s.rect(s.ML, y, s.CW, ch, { fill: C.tint2, r: 6, stroke: C.tintLine });
      s.rect(s.ML, y, 3, ch, { fill: accent, r: 1.5 });
      s.text('담당자 소견', s.ML + 12, y + 7, { size: 6.4, weight: 800, color: accent });
      s.text(`${who} · ${c.before.dateLabel || ''}`, s.W - s.MR - 12, y + 7, { size: 6, weight: 600, color: C.muted, align: 'right' });
      s.para(comment, s.ML + 12, y + 20, s.CW - 26, { size: 8, color: C.ink, lh: 1.5 });
      y += ch + 10;

      /* 03 리모델링 원칙 */
      y = s.sectionHead(s.ML, y, s.CW, '03', '리모델링 3원칙', '이 순서를 지키면 손해 보는 해지가 줄어듭니다');
      const rules = [
        { t: '해지가 아니라 재배치', d: '적립·중복·미사용 특약을 정리해 빈 칸으로 옮깁니다.' },
        { t: '한 번에 한 칸', d: '1순위 한 칸을 같은 보험료 안에서 채우는 것이 첫 단계입니다.' },
        { t: '금액은 고객이 선택', d: '추가 지출이 필요할 때는 고객님이 결정합니다.' }
      ];
      const rw = (s.CW - 16) / 3;
      rules.forEach((r, i) => {
        const x = s.ML + i * (rw + 8);
        s.rect(x, y, rw, 52, { fill: '#fff', r: 5, stroke: C.line });
        s.iconCircle(x + 16, y + 15, 7, { fill: C.tint, num: i + 1, size: 6.4, color: accent });
        s.text(r.t, x + 30, y + 9, { size: 7, weight: 800, color: C.navy });
        s.para(r.d, x + 10, y + 27, rw - 20, { size: 5.7, color: C.ink2, lh: 1.35 });
      });
      y += 60;

      /* 04 확인할 것 */
      y = s.sectionHead(s.ML, y, s.CW, '04', '진행 전 확인할 것', '상담 자리에서 함께 봅니다');
      s.rect(s.ML, y, s.CW, 54, { fill: '#fff', r: 5, stroke: C.line });
      [[
        '증권 원본으로 담보명·갱신 구조 확인',
        '감액·해지 시 해지환급금과 재가입 조건 확인'
      ], [
        '새로 넣는 담보의 1년 미만 감액·1회한 조항 확인',
        '고지의무(3·1·5 / 간편 3·2·5) 함께 작성'
      ]].forEach((col, ci) => {
        col.forEach((t, i) => {
          const x = s.ML + 10 + ci * (s.CW / 2);
          const cy = y + 9 + i * 20;
          s.rect(x, cy + 1, 5.2, 5.2, { fill: '#fff', stroke: accent, r: 1.1, lw: 0.9 });
          s.line(x + 1.2, cy + 4, x + 2.2, cy + 5, { color: accent, w: 0.9 });
          s.line(x + 2.2, cy + 5, x + 4, cy + 2.4, { color: accent, w: 0.9 });
          s.text(t, x + 10, cy - 0.6, { size: 6.4, weight: 500, color: C.ink2 });
        });
      });
      y += 62;

      /* 05 담당자 명함 */
      const cardH = 74;
      s.rect(s.ML, y, s.CW, cardH, { fill: '#fff', r: 6, stroke: C.tintLine });
      s.rect(s.ML, y, 3.4, cardH, { fill: accent, r: 1.7 });
      const mx = s.brandMark(s.ML + 16, y + 13, 15, { lw: 1.1, color: accent });
      s.text(b.name || '보장분석 라이프 리포트', mx + 5, y + 12, { size: 9.4, weight: 800, color: C.navy });
      if (b.slogan) s.para(b.slogan, s.ML + 16, y + 27, 250, { size: 5.8, color: C.muted, lh: 1.3 });
      s.line(s.ML + 16, y + 43, s.ML + 262, y + 43, { color: C.tintLine });
      s.text('담당 설계사', s.ML + 16, y + 48, { size: 5.4, weight: 700, color: C.muted });
      s.text(`${who}${b.title ? ' · ' + b.title : ''}`, s.ML + 16, y + 57, { size: 8.6, weight: 800, color: C.navy });
      s.line(s.ML + 272, y + 10, s.ML + 272, y + cardH - 10, { color: C.tintLine });
      s.text('연락', s.ML + 286, y + 12, { size: 5.4, weight: 700, color: C.muted });
      if (b.phone) s.text(`T. ${b.phone}`, s.ML + 286, y + 22, { size: 6.8, weight: 700, color: C.ink2 });
      if (b.kakao) s.text(`카카오톡 ${b.kakao}`, s.ML + 286, y + 33, { size: 6.4, weight: 600, color: C.ink2 });
      s.text('상담 보조용 시뮬레이션입니다. 실제 보험료·인수·해지환급금은 상품과 나이에 따라 달라집니다.', s.ML + 286, y + cardH - 16, { size: 5.2, weight: 500, color: C.muted });
      y += cardH;

      s.footer({ left: `${c.before.client.name}님 리모델링 비교 · ${c.before.dateLabel || ''}`, right: 'REMODELING' });
    };
    const overflow = [];
    const blob = await root.PDFKit.renderPages([drawer], {
      quality: 0.92, overflow, memo: false,
      meta: { title: `${c.before.client.name}_리모델링 비교` }
    });
    if (overflow.length) console.warn('[PDF] 리모델링 넘침', overflow);
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const safe = (c.before.client.name || '고객').replace(/[\\/:*?\"<>|\s]/g, '');
    await root.PDFKit.saveBlob(blob, `${safe}_리모델링비교_${date}.pdf`, { picker: false, title: '리모델링 비교' });
    toast('리모델링 비교 PDF를 저장했습니다');
  }

  /* =========================================================
     내 브랜드 설정 (화이트라벨)
     ========================================================= */
  let draft = null;

  /* 업로드한 로고 파일 → 최대 512px · base64 DataURL (localStorage 저장용) */
  function fileToLogo(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\/(?:png|jpeg|jpg|webp)$/i.test(file.type)) { reject(new Error('이미지 파일이 아닙니다')); return; }
      if (file.size > 6 * 1024 * 1024) { reject(new Error('이미지가 너무 큽니다 (6MB 이하)')); return; }
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('이미지를 해석하지 못했습니다'));
        img.onload = () => {
          const max = 512;
          const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || max) * scale));
          const h = Math.max(1, Math.round((img.height || max) * scale));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          let out = cv.toDataURL('image/png');
          if (out.length > 900000) out = cv.toDataURL('image/jpeg', 0.86);
          resolve(out);
        };
        img.src = String(fr.result || '');
      };
      fr.readAsDataURL(file);
    });
  }

  function logoTag(b, cls) {
    return b && b.logo
      ? `<img class="${cls || 'brand-logo'}" src="${b.logo}" alt="${esc(b.name)} 로고">`
      : '<span class="bp-heart" aria-hidden="true">♥</span>';
  }

  function renderBrand() {
    const host = $('#brand-body');
    if (!host) return;
    if (!draft) draft = Object.assign({}, savedBrand);
    const open = unlocked();
    const t = themeOf(draft);
    const fields = [
      ['name', '상호 / 브랜드명', '예: 김한기 종합금융 · 행복설계연구소', 24],
      ['slogan', '서브 슬로건', '고객 맞춤형 보장 점검 · 리모델링 상담 가이드', 60],
      ['consultant', '설계사 이름', '예: 김한기', 16],
      ['title', '직함', '예: 보험설계사 · FC', 20],
      ['phone', '연락처', '예: 010-0000-0000', 20],
      ['kakao', '상담 카톡 / 채널 링크', '예: open.kakao.com/… · @내채널', 48]
    ];
    host.innerHTML = `
      <div class="brand-grid">
        <div class="brand-preview" id="brand-preview" style="--bp-accent:${t.accent};--bp-deep:${t.deep};--bp-blush:${t.blush};--bp-wine:${t.wine};--bp-hdr:${t.header}">
          <div class="bp-chrome">
            <span class="bp-logo" id="bp-logo">${logoTag(draft)}</span>
            <div class="bp-lockup"><b id="bp-name">${brandNameHTML(draft.name)}</b><span id="bp-slogan">${esc(draft.slogan)}</span></div>
            <span class="bp-plan">${BETA ? 'BETA' : (open ? 'PRO' : 'FREE')}</span>
          </div>
          <div class="bp-hero">
            <span class="bp-eyebrow">LIFE REPORT V5.5</span>
            <h4 id="bp-hero-name">${brandNameHTML(draft.name)}</h4>
            <p id="bp-hero-slogan">${esc(draft.slogan)}</p>
            <div class="bp-cover">
              <span class="bp-cover-tag">고객 30장 표지</span>
              <b id="bp-cover-name">${esc(draft.name)}</b>
              <span>김고객님의 보장분석 리포트</span>
              <em>종합 보장등급 A</em>
            </div>
          </div>
          <div class="bp-foot"><span>PDF 꼬리말</span><b id="bp-foot-name">${esc(draft.name)}</b><span id="bp-foot-contact">${esc(contactLine(draft) || '설계사 정보 미입력')}</span></div>
          ${open ? '' : '<div class="bp-watermark">미리보기 · 저장과 PDF 반영은 Pro</div>'}
        </div>
        <div class="brand-form">
          <div class="bf-row bf-preset"><span>빠른 프리셋</span>
            <div class="brand-presets" id="brand-presets">
              ${BRAND_PRESETS.map((p) => `<button type="button" class="brand-preset${draft.name === p.name && draft.theme === p.theme ? ' is-on' : ''}" data-brand-preset="${p.key}">${esc(p.label)}</button>`).join('')}
            </div>
          </div>
          ${fields.map((f) => `<label class="bf-row"><span>${esc(f[1])}</span><input type="text" id="bf-${f[0]}" maxlength="${f[3]}" value="${esc(draft[f[0]] || '')}" placeholder="${esc(f[2])}" autocomplete="off"></label>`).join('')}
          <div class="bf-row bf-logo-row"><span>로고 이미지</span>
            <div class="logo-pick">
              <span class="logo-thumb" id="bf-logo-thumb">${draft.logo ? `<img src="${draft.logo}" alt="로고 미리보기">` : '기본 마크'}</span>
              <label class="logo-file">로고 파일 선택<input type="file" id="bf-logo" accept="image/png,image/jpeg,image/webp"></label>
              <button type="button" class="btn-ghost sm" id="bf-logo-clear">기본 마크로</button>
            </div>
            <p class="field-note">PNG · JPG · WebP · 512px 이내로 자동 축소 · 헤더 · 고객 표지 · PDF에 반영</p>
          </div>
          <div class="bf-row bf-theme"><span>포인트 테마</span>
            <div class="theme-grid" id="theme-grid" role="radiogroup" aria-label="포인트 테마">
              ${Object.keys(THEMES).map((k) => {
                const th = THEMES[k];
                return `<button type="button" class="theme-card${draft.theme === k ? ' is-on' : ''}" data-theme="${k}" aria-pressed="${draft.theme === k}">
                  <i style="background:linear-gradient(135deg,${th.accent},${th.deep})"></i><b>${esc(th.label)}</b></button>`;
              }).join('')}
            </div>
          </div>
          <div class="brand-actions">
            <button type="button" class="btn-primary sm" id="brand-save">${BETA ? '브랜드 저장 (베타 무료)' : (open ? '브랜드 저장' : '🔒 저장 (Pro)')}</button>
            <button type="button" class="btn-ghost sm" id="brand-reset">기본값으로</button>
          </div>
          <p class="field-note" id="brand-note">${open
            ? '저장하면 앱 헤더 · 메인 허브 · 고객 30장 표지 · 1/10/30장 PDF 표지와 꼬리말에 바로 반영됩니다.'
            : '무료 체험은 미리보기만 됩니다. Pro에서 저장하면 헤더 · 표지 · PDF에 반영됩니다.'}</p>
        </div>
      </div>`;
    bindBrand(host);
  }

  function updateBrandPreview() {
    if (!draft) return;
    const t = themeOf(draft);
    const pv = $('#brand-preview');
    if (pv) {
      pv.style.setProperty('--bp-accent', t.accent);
      pv.style.setProperty('--bp-deep', t.deep);
      pv.style.setProperty('--bp-blush', t.blush);
      pv.style.setProperty('--bp-wine', t.wine);
      pv.style.setProperty('--bp-hdr', t.header);
    }
    [['#bp-name', brandNameHTML(draft.name)], ['#bp-hero-name', brandNameHTML(draft.name)]].forEach(([sel, html]) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
    [['#bp-slogan', draft.slogan], ['#bp-hero-slogan', draft.slogan], ['#bp-cover-name', draft.name], ['#bp-foot-name', draft.name], ['#bp-foot-contact', contactLine(draft) || '설계사 정보 미입력']].forEach(([sel, txt]) => {
      const el = $(sel);
      if (el) el.textContent = txt;
    });
    const logo = $('#bp-logo');
    if (logo) logo.innerHTML = logoTag(draft);
    const thumb = $('#bf-logo-thumb');
    if (thumb) thumb.innerHTML = draft.logo ? `<img src="${draft.logo}" alt="로고 미리보기">` : '기본 마크';
    $$('.theme-card').forEach((b) => {
      const on = b.dataset.theme === draft.theme;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $$('.brand-preset').forEach((b) => b.classList.toggle('is-on', BRAND_PRESETS.some((p) => p.key === b.dataset.brandPreset && p.name === draft.name && p.theme === draft.theme)));
  }

  function bindBrand(host) {
    ['name', 'slogan', 'consultant', 'title', 'phone', 'kakao'].forEach((k) => {
      const inp = $('#bf-' + k, host);
      if (!inp) return;
      inp.addEventListener('input', () => { draft[k] = inp.value; updateBrandPreview(); });
    });
    $$('[data-theme]', host).forEach((b) => {
      b.addEventListener('click', () => { draft.theme = b.dataset.theme; updateBrandPreview(); });
    });
    $$('[data-brand-preset]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const p = BRAND_PRESETS.find((x) => x.key === b.dataset.brandPreset);
        if (!p) return;
        draft = Object.assign({}, draft, { name: p.name, slogan: p.slogan, theme: p.theme });
        renderBrand();
      });
    });
    const file = $('#bf-logo', host);
    if (file) file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        draft.logo = await fileToLogo(f);
        updateBrandPreview();
        toast('로고 이미지를 불러왔습니다 — 저장하면 반영됩니다');
      } catch (err) {
        toast(err && err.message ? err.message : '로고 이미지를 읽지 못했습니다');
      }
    });
    const clear = $('#bf-logo-clear', host);
    if (clear) clear.addEventListener('click', () => { draft.logo = ''; updateBrandPreview(); });
    $('#brand-save', host).addEventListener('click', () => {
      if (!unlocked()) { openPaywall('brandSave'); return; }
      if (!String(draft.name || '').trim()) { toast('상호를 입력해 주세요'); return; }
      if (saveBrand(draft)) { savedBrand = normalizeBrand(savedBrand); draft = Object.assign({}, savedBrand); renderBrand(); }
    });
    $('#brand-reset', host).addEventListener('click', () => {
      draft = Object.assign({}, DEFAULT_BRAND);
      if (unlocked()) { saveBrand(draft, { silent: true }); toast('중립 기본 브랜드로 되돌렸습니다'); }
      else toast('기본값 미리보기입니다 — 저장은 Pro에서');
      renderBrand();
    });
  }

  /* =========================================================
     초기화 · 공개 API
     ========================================================= */
  function init() {
    document.documentElement.dataset.plan = plan;
    if (document.body) document.body.dataset.plan = plan;
    applyBrand();
    renderPlanUI();
    ensureBetaModal();
    setupFeedbackLinks();
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-plan-open]') || e.target.closest('#plan-badge') || e.target.closest('[data-beta-open]')) openPlanModal();
    });
  }

  /* 다른 파일이 쓰는 공개 API */
  root.BojangPlan = {
    init, currentPlan, isPro, unlocked, setPlan, hydrate, serverPlan, FREE_SLIDES, FREE_CLIENTS, PRO_CLIENTS,
    openPaywall, closePaywall, afterUnlock, openPlanModal, renderPlanUI, openBetaModal, closeBetaModal,
    PRICE, PLAN_ROWS, BETA_ROWS, FEATURES, BETA, BETA_NOTE, FEEDBACK_URL, GIFT_NOTE
  };
  root.BojangBrand = {
    get: brand, themes: THEMES, defaultBrand: DEFAULT_BRAND, presets: BRAND_PRESETS, apply: applyBrand, save: saveBrand,
    normalize: normalizeBrand, parts: brandParts, nameHTML: brandNameHTML, contactLine, render: renderBrand, fileToLogo
  };
  root.BojangRemodel = { calc: calcRemodel, render: renderRemodel, autoComment, kakao: remodelKakao, pdf: remodelPdf };
})(typeof window !== 'undefined' ? window : globalThis);
