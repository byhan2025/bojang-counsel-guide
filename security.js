/* 보장분석 라이프 리포트 v5.9 — 배포 보호 레이어 (security.js)

   ① 공식 도메인 잠금 (Domain Lock)
      공식 배포처(byhan2025.github.io) · localhost · 127.0.0.1 · file: 에서만
      클라우드 동기화와 AI 사진 인식 서버 호출을 허용합니다.
      그 밖의 도메인에서 파일을 복제해 열면 복제 경고 배너를 띄우고 서버 호출을 차단합니다.
      (화면·입력·PDF 같은 기기 안 기능은 그대로 동작합니다 — 오프라인 단일 파일 배포를 위해서입니다.)

   ② 유출 추적 워터마크 (ID-XXXX)
      발급 설계사 계정·브랜드 정보를 해시해 PDF 꼬리말에 넣습니다.
      어떤 파일이 밖으로 돌았는지 발급 단위로 추적할 수 있습니다.

   시험용 훅: window.__BOJANG_DOMAIN_OVERRIDE__ = 'clone.example.com' 처럼 지정하면
   그 값을 현재 호스트로 봅니다(복제 상황 재현용). */
(function (root) {
  'use strict';

  const OFFICIAL_HOSTS = ['byhan2025.github.io', 'localhost', '127.0.0.1', '::1', '[::1]'];
  const OFFICIAL_LABEL = 'byhan2025.github.io';

  function host() {
    const override = root.__BOJANG_DOMAIN_OVERRIDE__;
    if (override) return String(override).toLowerCase();
    try { return String((root.location && root.location.hostname) || '').toLowerCase(); }
    catch (e) { return ''; }
  }

  function protocol() {
    try { return String((root.location && root.location.protocol) || ''); }
    catch (e) { return ''; }
  }

  /* file: 로 연 단일 HTML · 공식 호스트 · 로컬 개발 서버는 정품 실행으로 봅니다 */
  function isOfficial() {
    if (protocol() === 'file:') return true;
    const h = host();
    if (!h) return true;
    return OFFICIAL_HOSTS.indexOf(h) >= 0;
  }

  function isClone() { return !isOfficial(); }

  /* =========================================================
     v7.1 — 네트워크 가드 fail-closed (4호 보고서 P0)
     판정 근거가 하나라도 비면(가드 없음·메서드 없음·file: 실행·호스트 없음·비공식 호스트)
     외부 요청을 보내지 않습니다. 기기 안 기능은 그대로 동작합니다.
     ========================================================= */
  function networkReason() {
    const g = root.bojangDomainGuard;
    if (!g || typeof g.allowed !== 'function') return 'no-guard';
    const p = protocol();
    if (!p) return 'no-protocol';
    if (p === 'file:') return 'file-protocol';
    const h = host();
    if (!h) return 'no-host';
    if (p !== 'https:' && p !== 'http:') return 'not-http';
    if (OFFICIAL_HOSTS.indexOf(h) < 0) return 'unofficial-host';
    return '';
  }

  /* 서버(클라우드·비전·프록시) 호출 허용 여부 — 위 근거가 모두 맞을 때만 */
  function networkAllowed() { return networkReason() === ''; }

  function blockedError(reason) {
    const e = new Error('GUARD_BLOCKED:' + (reason || 'blocked'));
    e.code = 'GUARD_BLOCKED';
    e.reason = reason || 'blocked';
    return e;
  }

  /* 외부(교차 출처) 요청인지 — 판정할 수 없으면 외부로 봅니다(보수적) */
  function isExternalUrl(url) {
    const raw = String(url == null ? '' : (typeof url === 'string' ? url : (url.url || '')));
    if (!raw) return true;
    if (/^(data|blob):/i.test(raw)) return false;
    if (!/^https?:/i.test(raw) && !/^\//.test(raw)) return false;
    let u;
    try { u = new URL(raw, (root.location && root.location.href) || 'https://invalid.local/'); } catch (e) { return true; }
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (protocol() === 'file:') return true;                 /* 파일 실행에서는 모든 http(s)가 외부 */
    const origin = (root.location && root.location.origin) || '';
    if (!origin || origin === 'null') return true;           /* 출처를 알 수 없으면 외부로 간주 */
    return u.origin !== origin;
  }

  /* =========================================================
     v7.1 — 전역 fetch 가드 (단일 차단 지점)
     같은 출처(앱 파일) 요청은 그대로, 외부 요청은 허용되지 않으면 0회로 막습니다.
     ========================================================= */
  let blockedCount = 0;
  const blockedUrls = [];
  function installFetchGuard() {
    if (root.__bojangFetchGuarded) return;
    const orig = root.fetch;
    if (typeof orig !== 'function') return;
    root.__bojangFetchGuarded = true;
    root.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isExternalUrl(url) && !networkAllowed()) {
        blockedCount++;
        if (blockedUrls.length < 20) blockedUrls.push(String(url).slice(0, 80));
        return Promise.reject(blockedError(networkReason()));
      }
      return orig.call(root, input, init);
    };
  }

  root.bojangDomainGuard = {
    enabled: true,
    allowed: networkAllowed,
    reason: networkReason,
    isExternalUrl,
    assert() { if (!networkAllowed()) throw blockedError(networkReason()); return true; },
    blocked: () => blockedCount,
    blockedUrls: () => blockedUrls.slice(),
    reset() { blockedCount = 0; blockedUrls.length = 0; }
  };

  function banner() {
    if (!isClone()) return null;
    const doc = root.document;
    if (!doc || !doc.body) return null;
    let el = doc.getElementById('clone-warning');
    if (el) return el;
    el = doc.createElement('div');
    el.id = 'clone-warning';
    el.className = 'clone-warning';
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <span class="cw-tag">복제 의심</span>
      <p><b>공식 배포처가 아닌 주소에서 실행되고 있습니다.</b>
        이 파일은 <b>${OFFICIAL_LABEL}</b> 에서만 배포합니다. 클라우드 동기화와 AI 사진 인식 서버 호출이 차단되었습니다.</p>`;
    doc.body.insertBefore(el, doc.body.firstChild);
    doc.documentElement.classList.add('is-clone');
    return el;
  }

  /* =========================================================
     유출 추적 워터마크 — ID-XXXX
     발급 설계사 계정(이메일) · 브랜드 상호 · 담당자 · 연락처를 섞어 해시합니다.
     ========================================================= */
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  function identity() {
    const bits = [];
    try {
      const B = root.BojangBrand && root.BojangBrand.get ? root.BojangBrand.get() : null;
      if (B) bits.push(B.name || '', B.consultant || '', B.phone || '', B.kakao || '');
    } catch (e) { /* noop */ }
    try {
      const acct = root.BojangBackend && root.BojangBackend.user ? root.BojangBackend.user() : null;
      const email = acct && acct.email ? acct.email : '';
      if (email) bits.push(email);
    } catch (e) { /* noop */ }
    if (!bits.filter(Boolean).length) bits.push('bojang-guide', 'beta');
    return bits.filter(Boolean).join('|');
  }

  let markCache = null;
  let markSource = null;
  function mark() {
    const src = identity();
    if (markCache && markSource === src) return markCache;
    const n = fnv(src);
    const body = n.toString(36).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(-4).padStart(4, '0');
    markCache = 'ID-' + body;
    markSource = src;
    return markCache;
  }

  function stamp() {
    return 'ID-' + mark().slice(3) + ' · ' + OFFICIAL_LABEL;
  }

  function init() {
    installFetchGuard();
    banner();
    if (!networkAllowed()) {
      try { console.warn('[BojangGuard] 외부 요청 차단( fail-closed ) —', networkReason(), host()); } catch (e) { /* noop */ }
    }
    return { official: isOfficial(), host: host(), mark: mark(), network: networkAllowed(), reason: networkReason() };
  }

  root.BojangGuard = {
    init, isOfficial, isClone, networkAllowed, networkReason, isExternalUrl, host, protocol, banner, mark, stamp,
    identity, OFFICIAL_HOSTS, OFFICIAL_LABEL,
    blocked: () => blockedCount, blockedUrls: () => blockedUrls.slice(), blockedError
  };
})(typeof window !== 'undefined' ? window : globalThis);
