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

  /* =========================================================
     v7.2 — 기기 로컬 저장 암호화 (WebCrypto AES-GCM)
     · 키는 IndexedDB 에 '추출 불가(non-extractable)' CryptoKey 로 보관합니다.
       localStorage 를 통째로 덤프해도 입력 중 상담(고객명·금액)이 평문으로 보이지 않습니다.
     · '민감정보 미저장(세션 전용)' 모드에서는 아예 저장하지 않고 메모리에만 둡니다.
     · 로그아웃 시 로컬 데이터 삭제 선택권(deleteOnLogout)을 따로 저장합니다.
     WebCrypto 가 없는 환경(구형 브라우저)에서는 available()=false 이고, 앱은 종전처럼
     평문 저장으로 내려갑니다(기능 정지보다 안전한 폴백).
     ========================================================= */
  const SECURE_DB = 'bojang-secure';
  const SECURE_STORE = 'keys';
  const PRIVACY_KEY = 'bojang.privacy.v1';       /* 'session' | 'persist' */
  const PURGE_KEY = 'bojang.purge.v1';           /* 로그아웃 시 삭제 '1' */
  let keyPromise = null;

  function available() {
    try { return !!(root.crypto && root.crypto.subtle && root.crypto.subtle.generateKey && root.indexedDB); }
    catch (e) { return false; }
  }

  function openDb() {
    return new Promise((resolve) => {
      let req;
      try { req = root.indexedDB.open(SECURE_DB, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db && !db.objectStoreNames.contains(SECURE_STORE)) db.createObjectStore(SECURE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  function idbGet(db, k) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(SECURE_STORE, 'readonly');
        const rq = tx.objectStore(SECURE_STORE).get(k);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  function idbPut(db, k, v) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(SECURE_STORE, 'readwrite');
        tx.objectStore(SECURE_STORE).put(v, k);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }

  function deviceKey() {
    if (keyPromise) return keyPromise;
    keyPromise = (async () => {
      if (!available()) return null;
      const db = await openDb();
      try {
        if (db) {
          const cur = await idbGet(db, 'device');
          if (cur) return cur;
        }
        const k = await root.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        if (db) await idbPut(db, 'device', k);
        return k;
      } catch (e) { return null; }
    })();
    return keyPromise;
  }

  function b64(u8) {
    let s = '';
    const a = new Uint8Array(u8);
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return root.btoa ? root.btoa(s) : s;
  }
  function unb64(s) {
    const bin = root.atob ? root.atob(s) : String(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function encrypt(obj) {
    const key = await deviceKey();
    if (!key) return null;
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const data = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { v: 1, enc: 'AES-GCM', iv: b64(iv), data: b64(data), at: Date.now() };
  }
  async function decrypt(payload) {
    const p = payload && typeof payload === 'object' ? payload : null;
    if (!p || p.enc !== 'AES-GCM' || !p.iv || !p.data) return null;
    const key = await deviceKey();
    if (!key) return null;
    const plain = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function isEncrypted(v) { return !!(v && typeof v === 'object' && v.enc === 'AES-GCM' && v.data); }

  function privacyMode() {
    try { return root.localStorage.getItem(PRIVACY_KEY) === 'session' ? 'session' : 'persist'; }
    catch (e) { return 'persist'; }
  }
  function setPrivacyMode(mode) {
    const m = mode === 'session' ? 'session' : 'persist';
    try { root.localStorage.setItem(PRIVACY_KEY, m); } catch (e) { /* private mode */ }
    return m;
  }
  function deleteOnLogout() {
    try { return root.localStorage.getItem(PURGE_KEY) === '1'; } catch (e) { return false; }
  }
  function setDeleteOnLogout(on) {
    try { root.localStorage.setItem(PURGE_KEY, on ? '1' : '0'); } catch (e) { /* private mode */ }
    return !!on;
  }

  const KEEP_KEYS = [PRIVACY_KEY, PURGE_KEY, 'bojang.viewmode.v1', 'bojang.tour.v1', 'bojang.tour.snooze', 'bojang.senior.v1', 'bojang.lastmode.v1'];
  /* 기기 저장 데이터 삭제 — 설정값(화면 모드)은 남기고 상담·입력값은 지웁니다 */
  async function purgeLocal() {
    const removed = [];
    try {
      const keys = [];
      for (let i = 0; i < root.localStorage.length; i++) keys.push(root.localStorage.key(i));
      keys.forEach((k) => {
        if (!k || KEEP_KEYS.indexOf(k) >= 0) return;
        if (k.indexOf('bojang') === 0 || k.indexOf('sb-') === 0) { root.localStorage.removeItem(k); removed.push(k); }
      });
    } catch (e) { /* private mode */ }
    try {
      const dbs = root.indexedDB && root.indexedDB.databases ? await root.indexedDB.databases() : [];
      for (const d of dbs) {
        if (d && d.name && d.name.indexOf('bojang') === 0 && d.name !== SECURE_DB) {
          await new Promise((r) => { const rq = root.indexedDB.deleteDatabase(d.name); rq.onsuccess = rq.onerror = rq.onblocked = () => r(); });
          removed.push('idb:' + d.name);
        }
      }
    } catch (e) { /* noop */ }
    return removed;
  }
  async function logout() {
    const purged = deleteOnLogout() ? await purgeLocal() : [];
    return { purged, deleteOnLogout: deleteOnLogout() };
  }

  function privacyState() {
    return { mode: privacyMode(), deleteOnLogout: deleteOnLogout(), crypto: available() };
  }

  root.BojangGuard = {
    init, isOfficial, isClone, networkAllowed, networkReason, isExternalUrl, host, protocol, banner, mark, stamp,
    identity, OFFICIAL_HOSTS, OFFICIAL_LABEL,
    blocked: () => blockedCount, blockedUrls: () => blockedUrls.slice(), blockedError,
    /* v7.2 — 기기 저장 보안 */
    Secure: { available, encrypt, decrypt, isEncrypted, deviceKey, privacyMode, setPrivacyMode, deleteOnLogout, setDeleteOnLogout, purgeLocal, logout, privacyState, PRIVACY_KEY, PURGE_KEY }
  };
  root.BojangSecure = root.BojangGuard.Secure;
})(typeof window !== 'undefined' ? window : globalThis);
