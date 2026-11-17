/* 보장분석 라이프 리포트 v6.0 — 스마트키 (smartkey.js)

   핸드폰 = 마스터 스마트키. 이 파일이 담당하는 것
   ① PC 터미널 화면 : Web Crypto 로 PC RAM 에만 ECDH·ECDSA 키쌍을 만들고,
      1회용 challenge(6자리 코드 · 2자리 확인 숫자 · 180초 만료)를 발급해 QR 로 보여 줍니다.
   ② 폰 스마트키 화면 : 카메라 스캔(순수 JS 디코더, iOS·Android 공통) 또는 6자리 코드 입력으로
      challenge 를 받아, PC 기기명·접속 시각·공식 도메인·2자리 숫자를 확인한 뒤 승인합니다.
      승인은 https 에서 WebAuthn(얼굴·지문), file:// · 미지원 환경에서는 PIN 으로 자동 분기합니다.
   ③ 계정 잠금 : 최대 2기기(마스터 폰 1 + PC 1) 바인딩, 1탭 기존 PC 밀어내기, 원격 잠금,
      자리 비움 자동 잠금(PIN·생체), 고객 앞 프라이버시 가림 모드.
   ④ 복제 방지 : 서버가 180초 만료 · 단회 소비 · 폰 기기키 서명 · pc_pub_hash 일치를 검증합니다.
      상담 데이터는 폰 → PC 구간이 ECDH+AES-GCM 으로 암호화되어 서버(릴레이)는 평문을 보지 못합니다.

   정직한 한계 (억지 구현 금지)
   · 웹 브라우저는 OS 백그라운드 강제 잠금·F12 원천 봉쇄를 할 수 없습니다. 이 앱은
     "화면 가림 + PIN/생체 잠금 + 세션 무효화"까지이며, 기기 자체의 OS 잠금을 대체하지 않습니다.
   · 기기 개인키는 이 브라우저 저장소(localStorage)에 JWK 로 보관합니다. OS 보안칩(Secure Enclave)이
     아닙니다. WebAuthn 생체인증은 https 에서만 동작합니다(file:// 는 PIN).
   · 실서버(Edge Function)가 배포되지 않은 환경에서는 같은 브라우저 안의 모의 릴레이로 동작합니다.
     이때는 서버 검증 규칙(만료·단회·서명)을 브라우저 안에서 똑같이 적용하지만, 기기를 넘나드는
     동기화는 되지 않습니다. 화면에 그 사실을 항상 표시합니다.
*/
(function (root) {
  'use strict';

  const VERSION = 'v6.0';
  const NS = 'bojang.sk.';
  const K = {
    server: NS + 'server',
    phone: NS + 'phone',
    pc: NS + 'pc',
    prefs: NS + 'prefs',
    pin: NS + 'pin',
    bio: NS + 'bio',
    probe: NS + 'probe'
  };
  const TTL = 180;                       // 챌린지 만료(초)
  const BUS = 'bojang-smartkey';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.prototype.slice.call((r || document).querySelectorAll(sel));
  const now = () => Date.now();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function lsGet(key, dflt) {
    try {
      const raw = root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : dflt;
    } catch (e) { return dflt; }
  }
  function lsSet(key, val) {
    try { root.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function lsDel(key) { try { root.localStorage.removeItem(key); } catch (e) { /* noop */ } }

  /* ---------- 표기 도우미 ---------- */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function timeLabel(ts) {
    const d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function dateTimeLabel(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function officialDomain() {
    try { return String(root.location.hostname || 'local'); } catch (e) { return 'local'; }
  }
  function isHttps() {
    try { return root.location.protocol === 'https:'; } catch (e) { return false; }
  }
  function platformName() {
    const ua = String((root.navigator && root.navigator.userAgent) || '');
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'PC';
  }
  function browserName() {
    const ua = String((root.navigator && root.navigator.userAgent) || '');
    if (/CriOS|Chrome/.test(ua)) return 'Chrome';
    if (/FxiOS|Firefox/.test(ua)) return 'Firefox';
    if (/Edg/.test(ua)) return 'Edge';
    if (/Safari/.test(ua)) return 'Safari';
    return '브라우저';
  }
  function deviceLabel(kind) {
    if (kind === 'phone') {
      const p = platformName();
      const mobile = ['iPhone', 'iPad', 'Android'].indexOf(p) >= 0 ? p : '휴대폰';
      return mobile + ' · ' + browserName();
    }
    const p = platformName();
    return (p === 'PC' ? 'PC' : 'PC · ' + p) + ' · ' + browserName();
  }

  /* ---------- 암호 도우미 (Web Crypto) ---------- */
  const subtle = () => (root.crypto && root.crypto.subtle) || null;
  function rndBytes(n) {
    const b = new Uint8Array(n);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(b);
    else for (let i = 0; i < n; i += 1) b[i] = Math.floor(Math.random() * 256);
    return b;
  }
  function b64u(buf) {
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return root.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(txt) {
    const s = String(txt || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = s + '==='.slice((s.length + 3) % 4);
    const bin = root.atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function randDigits(n) {
    let s = '';
    const b = rndBytes(n);
    for (let i = 0; i < n; i += 1) s += String(b[i] % 10);
    return s;
  }
  function randId(prefix, n) {
    return prefix + hex(rndBytes(n || 8));
  }

  async function sha256Hex(text) {
    if (!subtle()) return 'nohash' + String(text).length;
    const buf = await subtle().digest('SHA-256', new TextEncoder().encode(String(text)));
    return hex(buf);
  }

  async function genEcdh() {
    if (!subtle()) throw new Error('이 브라우저는 Web Crypto(ECDH)를 지원하지 않습니다');
    const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']);
    return pair;
  }
  async function genEcdsa() {
    if (!subtle()) throw new Error('이 브라우저는 Web Crypto(ECDSA)를 지원하지 않습니다');
    const pair = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return pair;
  }
  /* v6.1.1 — 처음부터 비추출(non-extractable) 개인키로 생성합니다.
     공개키는 스펙상 항상 추출 가능하므로 이 경로만 성공하면 개인키 JWK 는 어디에도 남지 않습니다. */
  async function genEcdsaNonextractable() {
    if (!subtle()) throw new Error('이 브라우저는 Web Crypto(ECDSA)를 지원하지 않습니다');
    return subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  }
  /* v6.1.1 — 보안 폴백은 조용히 넘어가지 않고 경고를 남깁니다 */
  const SEC_WARNINGS = [];
  function securityWarn(kind, message) {
    const item = { kind, message, at: Date.now() };
    SEC_WARNINGS.push(item);
    try { console.warn('[SmartKey] 보안 경고 — ' + message); } catch (e) { /* 콘솔 없음 */ }
    try { if (typeof toast === 'function') toast('⚠ ' + message); } catch (e) { /* 토스트 없음 */ }
    return item;
  }
  function securityWarnings() { return SEC_WARNINGS.slice(); }
  async function exportPubJwk(key) {
    const jwk = await subtle().exportKey('jwk', key);
    return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  }
  async function exportKeyJwk(key) {
    return subtle().exportKey('jwk', key);
  }
  async function importEcdsaPub(jwk) {
    return subtle().importKey('jwk', Object.assign({ ext: true }, jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }
  async function importEcdhPub(jwk) {
    return subtle().importKey('jwk', Object.assign({ ext: true }, jwk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  }
  async function importEcdsaPriv(jwk) {
    return subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  async function importEcdhPriv(jwk) {
    return subtle().importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']);
  }
  async function signText(privKey, text) {
    const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, new TextEncoder().encode(text));
    return b64u(sig);
  }
  async function verifyText(pubJwk, sigB64, text) {
    try {
      const pub = await importEcdsaPub(pubJwk);
      const ok = await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, pub,
        unb64u(sigB64), new TextEncoder().encode(text));
      return !!ok;
    } catch (e) { return false; }
  }
  async function deriveAes(privKey, pubJwk) {
    const pub = await importEcdhPub(pubJwk);
    return subtle().deriveKey({ name: 'ECDH', public: pub }, privKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function aesEncrypt(key, obj) {
    const iv = rndBytes(12);
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv: b64u(iv), ct: b64u(ct) };
  }
  async function aesDecrypt(key, ivB64, ctB64) {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(ivB64) }, key, unb64u(ctB64));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function hashPin(pin, saltB64) {
    if (!subtle()) return null;
    const salt = saltB64 ? unb64u(saltB64) : rndBytes(16);
    const base = await subtle().importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle().deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, base, 256);
    /* v6.1 — WebCrypto 가 없는 환경(file://)에는 PIN 을 저장하지 않습니다(평문 금지) */
    return { salt: b64u(salt), hash: b64u(bits) };
  }
  async function checkPin(pin, rec) {
    if (!rec) return false;
    /* v6.1 — 예전 plain: 기록은 더 이상 인정하지 않습니다(평문 PIN 폐기) */
    if (String(rec.hash).indexOf('plain:') === 0) return false;
    const out = await hashPin(pin, rec.salt);
    if (!out) return false;
    return out.hash === rec.hash;
  }

  /* ---------- 서명 대상 문자열 (릴레이 방어의 핵심) ---------- */
  function transcriptChallenge(ch) {
    return ['SMK1', 'challenge', ch.id, ch.pc_pub_hash, String(ch.issued_at)].join('|');
  }
  /* v6.1 — 승인 서명에 양측 공개키·IV·암호문 해시를 함께 묶어,
     중간에서 암호문만 바꿔치기하는 릴레이를 막습니다. */
  async function transcriptApprove(ch, body, phonePub, enc) {
    const phoneHash = phonePub ? (await sha256Hex(JSON.stringify([phonePub.x, phonePub.y]))).slice(0, 16) : '';
    const ctHash = (enc && enc.ct) ? (await sha256Hex(String(enc.ct))).slice(0, 16) : '';
    return ['SMK1', 'approve2', ch.id, ch.code2, ch.pc_pub_hash, body.device_id, String(ch.issued_at),
      phoneHash, (enc && enc.iv) || '', ctHash].join('|');
  }

  /* ---------- v6.1 — 기기 개인키를 비추출(non-extractable) 키로 보관 ----------
     localStorage 에는 공개키·지문만 남기고, 서명 키는 IndexedDB 에 CryptoKey 객체로 저장합니다.
     IndexedDB 를 쓸 수 없는 환경에서는 세션 메모리에만 두고(새로고침 시 재등록) 평문 JWK 저장을 중단합니다. */
  const memKeys = {};
  const KEYDB = 'bojang-smartkey';
  let keyDbPromise = null;
  function keyDb() {
    if (keyDbPromise) return keyDbPromise;
    keyDbPromise = new Promise((resolve) => {
      let factory = null;
      try { factory = root.indexedDB || null; } catch (e) { factory = null; }
      if (!factory) return resolve(null);
      let req;
      try { req = factory.open(KEYDB, 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 2500);
    });
    return keyDbPromise;
  }
  async function keyIdbPut(id, key) {
    const db = await keyDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').put({ id, key, at: now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }
  async function keyIdbGet(id) {
    const db = await keyDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('keys', 'readonly');
        const rq = tx.objectStore('keys').get(id);
        rq.onsuccess = () => resolve((rq.result && rq.result.key) || null);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async function storeDevicePriv(dev, keyObj) {
    /* v6.1.1 — 저장 위치(IndexedDB / 세션 메모리)를 호출자에게 알려 key_store 표기와 경고에 씁니다. */
    const ok = await keyIdbPut(dev.id, keyObj);
    if (!ok) memKeys[dev.id] = keyObj;
    return !!ok;
  }
  async function devicePriv(dev) {
    let key = await keyIdbGet(dev.id);
    if (!key) key = memKeys[dev.id] || null;
    if (!key && dev && dev.priv) {
      /* v6.0 이전 평문 JWK → 비추출 키로 이관하고 localStorage 에서 지움 */
      key = await importEcdsaPriv(dev.priv);
      await storeDevicePriv(dev, key);
      delete dev.priv;
      lsSet(K.phone, dev);
    }
    return key || null;
  }

  /* ---------- 미리보기 ---------- */
  function pubHashOf(ecdhJwk, ecdsaJwk) {
    return sha256Hex(JSON.stringify([ecdhJwk.x, ecdhJwk.y, ecdsaJwk.x, ecdsaJwk.y])).then((h) => h.slice(0, 16));
  }

  /* =========================================================
     모의 릴레이 서버 — 실서버(Edge Function) 미배포 시 폴백
     서버와 같은 규칙을 그대로 적용합니다: 180초 만료 · 단회 소비 · 기기 서명 · pc_pub_hash 일치.
     ========================================================= */
  const local = {
    read() {
      const st = lsGet(K.server, null);
      if (st && st.challenges && st.devices && st.sessions) return st;
      return { challenges: {}, devices: {}, sessions: {}, events: [], rate: [], seq: 0 };
    },
    write(st) { st.updated_at = now(); lsSet(K.server, st); },
    log(st, type, detail) {
      st.events.unshift({ type, detail: detail || {}, at: now() });
      st.events = st.events.slice(0, 40);
    },
    async create(body) {
      const st = this.read();
      const t = now();
      st.rate = (st.rate || []).filter((x) => t - x < 60000);
      if (st.rate.length >= 8) return { ok: false, error: 'rate-limit', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' };
      st.rate.push(t);
      if (!body || !body.pc_pub_hash || !body.pc_pub_ecdh || !body.pc_pub_ecdsa) {
        return { ok: false, error: 'bad-request', message: 'PC 공개키 정보가 없습니다.' };
      }
      const sigOk = await verifyText(body.pc_pub_ecdsa,
        body.pc_sig, ['SMK1', 'challenge', body.pc_pub_hash, String(body.issued_at)].join('|'));
      if (!sigOk) return { ok: false, error: 'bad-pc-signature', message: 'PC 키 서명 검증에 실패했습니다.' };
      /* 같은 PC 의 이전 미사용 코드는 즉시 무효화 */
      Object.keys(st.challenges).forEach((id) => {
        const c = st.challenges[id];
        if (c.status === 'pending' && c.pc_pub_hash === body.pc_pub_hash) c.status = 'replaced';
      });
      const ch = {
        id: randId('ch_', 8),
        code6: randDigits(6),
        code2: randDigits(2),
        pc_pub_ecdh: body.pc_pub_ecdh,
        pc_pub_ecdsa: body.pc_pub_ecdsa,
        pc_pub_hash: body.pc_pub_hash,
        pc_name: body.pc_name || 'PC',
        pc_platform: body.pc_platform || '',
        pc_host: body.pc_host || '',
        pc_sig: body.pc_sig,
        issued_at: body.issued_at,
        expires_at: body.issued_at + TTL * 1000,
        status: 'pending',
        consumed_at: null
      };
      st.challenges[ch.id] = ch;
      this.log(st, 'challenge-created', { id: ch.id, pc: ch.pc_name });
      this.write(st);
      return { ok: true, challenge: ch, ttl: TTL };
    },
    get(id) {
      const st = this.read();
      const c = st.challenges[id];
      if (!c) return { ok: false, error: 'not-found', message: '코드를 찾을 수 없습니다. PC 화면에서 새 코드를 받아 주세요.' };
      if (c.status === 'pending' && now() > c.expires_at) { c.status = 'expired'; this.write(st); }
      return { ok: true, challenge: c };
    },
    byCode(code6) {
      const st = this.read();
      const list = Object.keys(st.challenges).map((k) => st.challenges[k])
        .filter((c) => c.code6 === String(code6) && c.status === 'pending')
        .sort((a, b) => b.issued_at - a.issued_at);
      if (!list.length) return { ok: false, error: 'not-found', message: '6자리 코드가 맞지 않거나 이미 만료되었습니다.' };
      const c = list[0];
      if (now() > c.expires_at) { c.status = 'expired'; this.write(st); return { ok: false, error: 'expired', message: '코드가 만료되었습니다. PC 화면에서 새 코드를 받아 주세요.' }; }
      return { ok: true, challenge: c };
    },
    async approve(body) {
      const st = this.read();
      const c = st.challenges[body.challenge_id];
      if (!c) return { ok: false, error: 'not-found', message: '요청을 찾을 수 없습니다.' };
      if (c.status === 'approved') return { ok: false, error: 'used', message: '이미 사용된 코드입니다.' };
      if (c.status !== 'pending') return { ok: false, error: 'not-pending', message: '만료되었거나 교체된 코드입니다.' };
      if (now() > c.expires_at) { c.status = 'expired'; this.write(st); return { ok: false, error: 'expired', message: '180초가 지나 만료되었습니다.' }; }
      if (String(body.pc_pub_hash) !== String(c.pc_pub_hash)) return { ok: false, error: 'relay-mismatch', message: 'PC 키 해시가 일치하지 않습니다(릴레이 의심).' };
      if (String(body.code2) !== String(c.code2)) return { ok: false, error: 'code-mismatch', message: '확인 숫자가 일치하지 않습니다.' };
      const dev = st.devices[body.device_id];
      if (!dev) return { ok: false, error: 'unregistered-device', message: '등록된 마스터 기기가 아닙니다.' };
      if (!dev.master) return { ok: false, error: 'not-master', message: '마스터 휴대폰에서만 승인할 수 있습니다.' };
      const sigOk = await verifyText(dev.pub_ecdsa, body.signature, await transcriptApprove(c, body, body.phone_pub, body.enc));
      if (!sigOk) return { ok: false, error: 'bad-signature', message: '기기 서명 검증에 실패했습니다.' };
      c.status = 'approved';
      c.consumed_at = now();
      c.device_id = body.device_id;
      c.phone_pub = body.phone_pub;
      c.enc = body.enc;
      c.approve_sig = body.signature;
      const token = randId('pcs_', 12);
      st.sessions[token] = {
        token,
        device_id: body.device_id,
        pc_pub_hash: c.pc_pub_hash,
        pc_name: c.pc_name,
        created_at: now(),
        last_seen: now(),
        revoked_at: null,
        revoked_by: null
      };
      c.session_token = token;
      dev.last_seen = now();
      this.log(st, 'approved', { id: c.id, device: dev.name });
      this.write(st);
      return { ok: true, session_token: token, pc_name: c.pc_name };
    },
    cancel(payload) {
      const id = typeof payload === 'string' ? payload : payload && payload.id;
      const st = this.read();
      const c = st.challenges[id];
      if (!c) return { ok: false, error: 'not-found' };
      if (c.status === 'pending') c.status = 'replaced';
      this.log(st, 'challenge-cancelled', { id });
      this.write(st);
      return { ok: true };
    },
    reject(body) {
      const st = this.read();
      const c = st.challenges[body.challenge_id];
      if (!c) return { ok: false, error: 'not-found' };
      if (c.status === 'pending') c.status = 'rejected';
      c.rejected_at = now();
      this.log(st, 'rejected', { id: c.id });
      this.write(st);
      return { ok: true };
    },
    poll(id) {
      const st = this.read();
      const c = st.challenges[id];
      if (!c) return { ok: false, error: 'not-found' };
      if (c.status === 'pending' && now() > c.expires_at) { c.status = 'expired'; this.write(st); }
      return {
        ok: true,
        status: c.status,
        session_token: c.session_token || null,
        phone_pub: c.phone_pub || null,
        enc: c.enc || null,
        pc_name: c.pc_name,
        consumed_at: c.consumed_at
      };
    },
    session(token) {
      const st = this.read();
      const s = st.sessions[token];
      if (!s) return { ok: false, error: 'no-session' };
      if (s.revoked_at) return { ok: false, error: 'revoked', session: s };
      s.last_seen = now();
      this.write(st);
      return { ok: true, session: s };
    },
    bind(body) {
      const st = this.read();
      const list = Object.keys(st.devices).map((k) => st.devices[k]);
      const same = list.find((d) => d.pub_hash === body.pub_hash && d.kind === body.kind);
      if (same) { same.last_seen = now(); this.write(st); return { ok: true, device: same, existing: true }; }
      if (body.kind === 'phone') {
        const master = list.find((d) => d.master);
        if (master) return { ok: false, error: 'master-exists', message: '이미 등록된 마스터 휴대폰이 있습니다. 기기 관리에서 먼저 해제해 주세요.' };
      }
      if (body.kind === 'pc') {
        const pcs = list.filter((d) => d.kind === 'pc');
        if (pcs.length >= 1) {
          return { ok: false, error: 'device-limit', message: 'PC는 1대까지 연결됩니다. 기존 PC를 밀어내면 바로 연결됩니다.',
                   evictable: pcs.map((d) => ({ id: d.id, name: d.name, last_seen: d.last_seen, session_token: d.session_token })) };
        }
      }
      if (list.length >= 2) return { ok: false, error: 'device-limit', message: '최대 2기기(휴대폰 1 + PC 1)까지 등록됩니다.' };
      const dev = {
        id: body.id || randId(body.kind === 'phone' ? 'ph_' : 'pc_', 6),
        kind: body.kind,
        name: body.name || deviceLabel(body.kind),
        pub_ecdsa: body.pub_ecdsa || null,
        pub_hash: body.pub_hash || '',
        master: body.kind === 'phone',
        created_at: now(),
        last_seen: now(),
        session_token: body.session_token || null
      };
      st.devices[dev.id] = dev;
      this.log(st, 'device-bound', { id: dev.id, kind: dev.kind, name: dev.name });
      this.write(st);
      return { ok: true, device: dev };
    },
    evict(deviceId, token) {
      const st = this.read();
      const dev = st.devices[deviceId];
      if (!dev) return { ok: false, error: 'not-found' };
      if (dev.master && token) return { ok: false, error: 'master-protected', message: '마스터 휴대폰은 원격 잠금 대상이 아닙니다.' };
      if (dev.session_token && st.sessions[dev.session_token]) {
        st.sessions[dev.session_token].revoked_at = now();
        st.sessions[dev.session_token].revoked_by = 'phone';
      }
      Object.keys(st.sessions).forEach((t) => {
        const s = st.sessions[t];
        if (s.device_id === deviceId && !s.revoked_at) { s.revoked_at = now(); s.revoked_by = 'phone'; }
      });
      delete st.devices[deviceId];
      this.log(st, 'device-evicted', { id: deviceId, name: dev.name });
      this.write(st);
      return { ok: true, evicted: { id: deviceId, name: dev.name } };
    },
    revoke(token, by) {
      const st = this.read();
      const s = st.sessions[token];
      if (!s) return { ok: true, already: true };
      s.revoked_at = now();
      s.revoked_by = by || 'phone';
      this.log(st, 'session-revoked', { token: token.slice(0, 10) });
      this.write(st);
      return { ok: true };
    },
    devices() {
      const st = this.read();
      const list = Object.keys(st.devices).map((k) => st.devices[k]);
      list.forEach((d) => {
        d.session = d.session_token && st.sessions[d.session_token] ? st.sessions[d.session_token] : null;
      });
      return { ok: true, devices: list, sessions: Object.keys(st.sessions).map((k) => st.sessions[k]) };
    },
    reset() { lsDel(K.server); return { ok: true }; }
  };

  /* ---------- 서버 어댑터 (실서버 → 실패 시 모의 릴레이) ---------- */
  const server = {
    remote: 'unknown',           // unknown | ok | unavailable
    lastError: '',

    mode() { return this.remote === 'ok' ? 'server' : 'local'; },
    statusText() {
      if (this.remote === 'ok') return '실서버 검증 (Supabase Edge Function)';
      if (this.configured() && !this.demo()) return '스마트키 서버 오류 — 모의 전환 차단(fail-closed)';
      return '이 브라우저 안 모의 검증 · 실서버 함수 미배포';
    },
    /* v6.1 — 모의 릴레이는 명시적 데모 모드에서만 허용합니다.
       운영(configured)에서 서버가 오류·미응답이면 자동으로 모의 검증으로 넘어가지 않습니다(fail-closed). */
    demo() {
      try {
        if (root.BOJANG_SMARTKEY_DEMO === true) return true;
        const ls = root.localStorage;
        if (ls && ls.getItem('bojang.smartkey.demo') === '1') return true;
        const host = String((root.location && root.location.hostname) || '');
        if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
        return false;
      } catch (e) { return false; }
    },
    configured() { return !!this.endpoint('qr-auth-challenge'); },
    failClosed() {
      return { ok: false, error: 'server-unavailable', demoBlocked: true,
        message: '스마트키 서버에 연결할 수 없습니다. 운영 모드에서는 모의 검증으로 자동 전환하지 않습니다. 잠시 후 다시 시도해 주세요.' };
    },
    async viaServer(name, payload, localFn) {
      const out = await this.call(name, payload);
      if (out) return out;
      if (this.demo() || !this.configured()) return localFn();
      return this.failClosed();
    },
    endpoint(name) {
      const B = root.BojangBackend;
      if (!B || !B.isLive || !B.isLive()) return '';
      const cfg = B.config ? B.config() : null;
      if (!cfg || !cfg.SUPABASE_URL) return '';
      return String(cfg.SUPABASE_URL).replace(/\/$/, '') + '/functions/v1/' + name;
    },
    async call(name, payload) {
      const url = this.endpoint(name);
      if (!url) { this.remote = 'unavailable'; return null; }
      const B = root.BojangBackend;
      const cfg = B && B.config ? B.config() : {};
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY || '' },
            B && B.sessionToken && B.sessionToken() ? { Authorization: 'Bearer ' + B.sessionToken() } : {}),
          body: JSON.stringify(payload || {}),
          cache: 'no-store'
        });
        if (res.status === 404) { this.remote = 'unavailable'; this.lastError = '404'; return null; }
        if (!res.ok) {
          let body = null;
          try { body = await res.json(); } catch (e) { body = null; }
          this.remote = 'ok';
          return body || { ok: false, error: 'http-' + res.status };
        }
        this.remote = 'ok';
        return await res.json();
      } catch (e) {
        this.remote = 'unavailable';
        this.lastError = String(e && e.message || e);
        return null;
      }
    },

    async createChallenge(body) {
      return this.viaServer('qr-auth-challenge', body, () => local.create(body));
    },
    async getChallenge(id) { return local.get(id); },
    async peekByCode(code6) {
      return this.viaServer('qr-auth-challenge', { action: 'peek', code6 }, () => local.byCode(code6));
    },
    async approve(body) {
      return this.viaServer('qr-auth-approve', body, () => local.approve(body));
    },
    async cancel(payload) {
      const p = typeof payload === 'string' ? { id: payload } : (payload || {});
      return this.viaServer('qr-auth-challenge', { action: 'cancel', challenge_id: p.id, cancel_sig: p.sig || '' }, () => local.cancel(p));
    },
    async reject(body) {
      return this.viaServer('qr-auth-approve', { action: 'reject', challenge_id: body.challenge_id }, () => local.reject(body));
    },
    async poll(id) {
      return this.viaServer('qr-auth-challenge', { action: 'poll', challenge_id: id }, () => local.poll(id));
    },
    async session(token) {
      return this.viaServer('device-manage', { action: 'session', token }, () => local.session(token));
    },
    async devices() {
      return this.viaServer('device-manage', { action: 'list' }, () => local.devices());
    },
    async bind(body) {
      return this.viaServer('device-manage', Object.assign({ action: 'bind' }, body), () => local.bind(body));
    },
    async evict(deviceId) {
      return this.viaServer('device-manage', { action: 'evict', device_id: deviceId }, () => local.evict(deviceId));
    },
    async revoke(token) {
      return this.viaServer('device-manage', { action: 'revoke', token }, () => local.revoke(token));
    },
    _local: local
  };

  /* =========================================================
     PC 터미널
     ========================================================= */
  const pc = {
    keys: null,
    challenge: null,
    status: 'idle',
    session: null,
    inherited: null,
    tickTimer: null,
    pollTimer: null,
    remain: TTL,

    payload(ch) {
      return ['BJK1', ch.id, ch.code6, ch.code2, ch.pc_pub_hash].join('|');
    },

    async issue() {
      this.stopTimers();
      /* 새 코드를 받으면 이 PC 의 이전 코드는 즉시 무효화합니다(단회·교체) */
      if (this.challenge && this.challenge.id) {
        const prev = this.challenge.id;
        let cancelSig = '';
        try {
          if (this.keys && this.keys.ecdsa) cancelSig = await signText(this.keys.ecdsa.privateKey, ['SMK1', 'cancel', prev].join('|'));
        } catch (e) { cancelSig = ''; }
        this.challenge = null;
        try { await server.cancel({ id: prev, sig: cancelSig }); } catch (e) { /* noop */ }
      }
      this.status = 'issuing';
      this.inherited = null;
      this.render();
      try {
        this.keys = { ecdh: await genEcdh(), ecdsa: await genEcdsa() };
        const ecdhPub = await exportPubJwk(this.keys.ecdh.publicKey);
        const ecdsaPub = await exportPubJwk(this.keys.ecdsa.publicKey);
        const hash = await pubHashOf(ecdhPub, ecdsaPub);
        const issuedAt = now();
        const sig = await signText(this.keys.ecdsa.privateKey,
          ['SMK1', 'challenge', hash, String(issuedAt)].join('|'));
        const out = await server.createChallenge({
          pc_pub_ecdh: ecdhPub,
          pc_pub_ecdsa: ecdsaPub,
          pc_pub_hash: hash,
          pc_name: deviceLabel('pc'),
          pc_platform: platformName(),
          pc_host: officialDomain(),
          issued_at: issuedAt,
          pc_sig: sig
        });
        if (!out || !out.ok) {
          this.status = 'error';
          this.error = (out && out.message) || '챌린지를 발급하지 못했습니다.';
          this.render();
          return { ok: false, error: out && out.error, message: this.error };
        }
        this.challenge = out.challenge;
        this.status = 'waiting';
        this.remain = out.ttl || TTL;
        this.render();
        this.startTimers();
        return { ok: true, challenge: this.challenge, ttl: this.remain };
      } catch (e) {
        this.status = 'error';
        this.error = String(e && e.message || e);
        this.render();
        return { ok: false, error: 'crypto', message: this.error };
      }
    },

    startTimers() {
      this.stopTimers();
      const deadline = this.challenge ? this.challenge.expires_at : now() + TTL * 1000;
      this.tickTimer = root.setInterval(() => {
        this.remain = Math.max(0, Math.ceil((deadline - now()) / 1000));
        this.paintClock();
        if (this.remain <= 0 && this.status === 'waiting') {
          this.status = 'expired';
          this.render();
        }
      }, 250);
      this.pollTimer = root.setInterval(() => { this.pollOnce(); }, 1100);
      this.pollOnce();
    },
    stopTimers() {
      if (this.tickTimer) { root.clearInterval(this.tickTimer); this.tickTimer = null; }
      if (this.pollTimer) { root.clearInterval(this.pollTimer); this.pollTimer = null; }
    },

    async pollOnce() {
      if (!this.challenge || this.status !== 'waiting') return;
      const out = await server.poll(this.challenge.id);
      if (!out || !out.ok) return;
      if (out.status === 'approved' && out.session_token && out.enc && out.phone_pub) {
        await this.accept(out);
      } else if (out.status === 'rejected') {
        this.status = 'rejected';
        this.render();
      } else if (out.status === 'expired') {
        this.status = 'expired';
        this.render();
      }
    },

    async accept(out) {
      this.status = 'approving';
      this.render();
      try {
        const aes = await deriveAes(this.keys.ecdh.privateKey, out.phone_pub);
        const data = await aesDecrypt(aes, out.enc.iv, out.enc.ct);
        this.inherited = data || null;
        const ecdsaPub = await exportPubJwk(this.keys.ecdsa.publicKey);
        const bind = await server.bind({
          kind: 'pc', name: deviceLabel('pc'), pub_ecdsa: ecdsaPub,
          pub_hash: this.challenge.pc_pub_hash, session_token: out.session_token
        });
        this.session = {
          token: out.session_token,
          pc_pub_hash: this.challenge ? this.challenge.pc_pub_hash : '',
          pc_name: out.pc_name,
          device_id: bind && bind.device ? bind.device.id : (out.pc_device_id || ''),
          bound: !!(bind && bind.ok) || !!out.pc_device_id,
          bindError: bind && bind.ok ? '' : (bind && bind.message) || '',
          evictable: bind && bind.evictable ? bind.evictable : [],
          created_at: now()
        };
        lsSet(K.pc, this.session);
        this.status = 'approved';
        this.stopTimers();
        this.render();
        watch.start();
        toast('스마트키로 PC가 열렸습니다');
        return { ok: true };
      } catch (e) {
        this.status = 'error';
        this.error = '상담 데이터 복호화에 실패했습니다: ' + String(e && e.message || e);
        this.render();
        return { ok: false, error: 'decrypt', message: this.error };
      }
    },

    async pushOut(deviceId) {
      const out = await server.evict(deviceId);
      if (out && out.ok) {
        const ecdsaPub = this.keys ? await exportPubJwk(this.keys.ecdsa.publicKey) : null;
        const bind = await server.bind({
          kind: 'pc', name: deviceLabel('pc'), pub_ecdsa: ecdsaPub,
          pub_hash: this.challenge ? this.challenge.pc_pub_hash : (this.session && this.session.pc_pub_hash) || '',
          session_token: this.session ? this.session.token : ''
        });
        if (bind && bind.ok && this.session) {
          this.session.bound = true;
          this.session.device_id = bind.device.id;
          this.session.evictable = [];
          lsSet(K.pc, this.session);
        }
        this.render();
        return { ok: true };
      }
      return out || { ok: false };
    },

    async resume() {
      const saved = lsGet(K.pc, null);
      if (!saved || !saved.token) return { ok: false, reason: 'none' };
      const out = await server.session(saved.token);
      if (out && out.ok) {
        this.session = Object.assign({}, saved, { bound: true });
        lsSet(K.pc, this.session);
        watch.start();
        return { ok: true, session: this.session };
      }
      this.session = null;
      lsDel(K.pc);
      if (out && out.error === 'revoked') {
        lock.lock('remote');
        return { ok: false, reason: 'revoked' };
      }
      return { ok: false, reason: 'invalid' };
    },

    async lockNow() {
      if (!this.session) return { ok: false, reason: 'no-session' };
      await server.revoke(this.session.token);
      this.session = null;
      lsDel(K.pc);
      watch.stop();
      lock.lock('remote');
      this.render();
      return { ok: true };
    },

    statusLine() {
      if (this.status === 'issuing') return 'PC 전용 키쌍을 만들고 1회용 코드를 발급하는 중…';
      if (this.status === 'waiting') return '휴대폰 승인을 기다리는 중 · 코드는 1회만 쓸 수 있습니다';
      if (this.status === 'approved') return '연결됨 · 이 PC는 마스터 휴대폰으로만 다시 열 수 있습니다';
      if (this.status === 'expired') return '180초가 지나 만료되었습니다. 새 코드를 받아 주세요';
      if (this.status === 'rejected') return '휴대폰에서 승인을 거절했습니다';
      if (this.status === 'error') return this.error || '오류가 발생했습니다';
      return '준비됨';
    },

    paintClock() {
      const el = $('#sk-remain');
      if (!el) return;
      const t = this.remain;
      el.textContent = '남은 시간 ' + pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
      el.dataset.remain = String(t);
      const bar = $('#sk-bar');
      if (bar) bar.style.width = Math.round((t / TTL) * 100) + '%';
    },

    render() {
      const modal = $('#smartkey-pc-modal');
      if (!modal) return;
      const waiting = this.status === 'waiting' || this.status === 'issuing';
      const qrWrap = $('#sk-qr');
      if (qrWrap) {
        qrWrap.innerHTML = waiting && this.challenge
          ? root.BojangQR.svg(this.payload(this.challenge), { px: 4, quiet: 2 })
          : '<div class="sk-qr-empty">' + (this.status === 'expired' ? '만료됨' : this.status === 'approved' ? '연결됨' : '준비 중') + '</div>';
      }
      const c6 = $('#sk-code6');
      if (c6) {
        const code = this.challenge && waiting ? String(this.challenge.code6) : '';
        c6.textContent = code ? code.slice(0, 3) + ' ' + code.slice(3) : '— — —';
      }
      const c2 = $('#sk-code2');
      if (c2) {
        c2.textContent = this.challenge && waiting ? this.challenge.code2 : '--';
        c2.hidden = !(this.challenge && waiting);
      }
      const st = $('#sk-pc-status');
      if (st) st.textContent = this.statusLine();
      const note = $('#sk-pc-note');
      if (note) note.textContent = '검증 방식: ' + server.statusText() + ' · 상담 데이터는 이 PC의 임시 키로만 복호화됩니다.';
      const sess = $('#sk-pc-session');
      if (sess) {
        sess.hidden = this.status !== 'approved';
        if (this.status === 'approved' && this.session) {
          const name = this.inherited && this.inherited.client ? this.inherited.client.name : '';
          sess.innerHTML =
            '<div class="sk-live"><span class="sk-dot"></span><b>PC 인증 완료</b></div>' +
            '<dl class="sk-facts">' +
            '<div><dt>기기</dt><dd>' + esc(this.session.pc_name || 'PC') + '</dd></div>' +
            '<div><dt>연결 시각</dt><dd>' + esc(dateTimeLabel(this.session.created_at || now())) + '</dd></div>' +
            '<div><dt>기기 등록</dt><dd>' + (this.session.bound ? '마스터 휴대폰에 등록됨' : esc(this.session.bindError || '미등록')) + '</dd></div>' +
            '<div><dt>받은 상담 데이터</dt><dd>' + (name ? esc(name) + '님' : (this.inherited ? '요약 데이터' : '없음')) + '</dd></div>' +
            '</dl>' +
            (this.session.evictable && this.session.evictable.length
              ? '<button type="button" class="sk-btn ghost" id="sk-pc-pushout">기존 PC 밀어내기 · ' + esc(this.session.evictable[0].name) + '</button>'
              : '') +
            '<button type="button" class="sk-btn ghost danger" id="sk-pc-locknow">이 PC 원격 잠금</button>';
          const push = $('#sk-pc-pushout');
          if (push) push.addEventListener('click', () => this.pushOut(this.session.evictable[0].id));
          const lk = $('#sk-pc-locknow');
          if (lk) lk.addEventListener('click', () => this.lockNow());
        }
      }
      const qrBox = $('#sk-pc-qrbox');
      if (qrBox) qrBox.hidden = this.status === 'approved';
      const refresh = $('#sk-refresh');
      if (refresh) refresh.disabled = this.status === 'issuing';
      this.paintClock();
    },

    async open() {
      ensureModal('pc');
      const modal = $('#smartkey-pc-modal');
      if (modal) modal.hidden = false;
      this.render();
      if (this.status === 'waiting' && this.challenge && this.remain > 0) return { ok: true, reused: true };
      if (this.status === 'approved' && this.session) return { ok: true, reused: true };
      return this.issue();
    },
    close() {
      const modal = $('#smartkey-pc-modal');
      if (modal) modal.hidden = true;
    }
  };

  /* =========================================================
     기기 관리 · 원격 잠금
     ========================================================= */
  const devices = {
    async list() {
      const out = await server.devices();
      return out && out.ok ? out : { devices: [], sessions: [] };
    },
    async open() {
      ensureModal('devices');
      const modal = $('#smartkey-devices-modal');
      if (modal) modal.hidden = false;
      await this.render();
      return { ok: true };
    },
    close() {
      const modal = $('#smartkey-devices-modal');
      if (modal) modal.hidden = true;
    },
    async render() {
      const out = await this.list();
      const box = $('#sk-device-list');
      if (!box) return out;
      const prefs = prefsGet();
      const rows = (out.devices || []).map((d) => {
        const isPc = d.kind === 'pc';
        const revoked = d.session && d.session.revoked_at;
        return '<div class="sk-device" data-device="' + esc(d.id) + '" data-kind="' + esc(d.kind) + '">' +
          '<span class="sk-device-ico">' + (d.master ? '📱' : isPc ? '🖥' : '📟') + '</span>' +
          '<span class="sk-device-main"><b>' + esc(d.name || d.kind) + '</b>' +
          '<em>' + (d.master ? '마스터 휴대폰' : isPc ? '연결된 PC' : '기기') + ' · 최근 ' + esc(dateTimeLabel(d.last_seen || d.created_at)) +
          (revoked ? ' · 잠김' : '') + '</em></span>' +
          (isPc ? '<button type="button" class="sk-mini danger" data-sk-revoke="' + esc(d.session_token || '') + '">원격 잠금</button>' : '') +
          (!d.master ? '<button type="button" class="sk-mini" data-sk-unbind="' + esc(d.id) + '">해제</button>' : '') +
          '</div>';
      }).join('');
      box.innerHTML = rows || '<p class="sk-empty">아직 등록된 기기가 없습니다. 이 폰에서 「PC 연결」을 한 번 하면 마스터 휴대폰으로 등록됩니다.</p>';
      const state = $('#sk-device-state');
      if (state) state.textContent = (out.devices || []).length + '/2대 등록 · ' + server.statusText();
      $$('[data-sk-revoke]', box).forEach((b) => b.addEventListener('click', async () => {
        const token = b.getAttribute('data-sk-revoke');
        if (!token) { toast('연결된 세션이 없습니다'); return; }
        const r = await server.revoke(token);
        if (r && r.ok) {
          toast('원격 잠금을 보냈습니다');
          if (pc.session && pc.session.token === token) { pc.session = null; lsDel(K.pc); lock.lock('remote'); }
          await this.render();
        }
      }));
      $$('[data-sk-unbind]', box).forEach((b) => b.addEventListener('click', async () => {
        const id = b.getAttribute('data-sk-unbind');
        const r = await server.evict(id);
        if (r && r.ok) { toast('기기를 해제했습니다'); await this.render(); }
      }));
      const pToggle = $('#sk-pref-privacy');
      if (pToggle) { pToggle.checked = !!prefs.privacy; }
      const aSel = $('#sk-pref-autolock');
      if (aSel) aSel.value = String(prefs.autoLockMin || 0);
      const pinState = $('#sk-pin-state');
      if (pinState) pinState.textContent = lsGet(K.pin, null) ? 'PIN 설정됨 · 잠금 해제에 사용' : 'PIN 미설정 · 잠금을 쓰려면 먼저 설정하세요';
      return out;
    }
  };

  /* =========================================================
     폰 스마트키
     ========================================================= */
  const phone = {
    pending: null,
    scannedHash: '',
    stream: null,
    scanTimer: null,
    step: 'idle',           // idle | approve | done
    authMethodCache: null,

    payloadParse(text) {
      const parts = String(text || '').split('|');
      if (parts.length !== 5 || parts[0] !== 'BJK1') return null;
      return { challenge_id: parts[1], code6: parts[2], code2: parts[3], pc_pub_hash: parts[4] };
    },

    device() {
      const saved = lsGet(K.phone, null);
      if (!saved || !saved.id || !saved.pub_ecdsa) return null;
      /* v6.1 — 개인키는 localStorage 에 두지 않습니다. 비추출 키(IndexedDB) 또는 세션 메모리에 보관. */
      return saved;
    },

    async ensureDevice() {
      let dev = this.device();
      if (dev) return dev;
      /* v6.1.1 — 비추출 키 생성 → (실패 시) 추출 키 생성 후 비추출 재가져오기 → (그마저 실패) 세션 메모리 + 경고.
         어느 경로로도 조용히 추출 가능 키를 상시 보관하지 않습니다. */
      let pair = null;
      let keyObj = null;
      let keyStore = 'mem-extractable';
      try {
        pair = await genEcdsaNonextractable();
        keyObj = pair.privateKey;
        keyStore = 'idb';
      } catch (e0) {
        pair = await genEcdsa();
        try {
          const jwk = await exportKeyJwk(pair.privateKey);
          keyObj = await importEcdsaPriv(jwk);
          keyStore = 'idb';
        } catch (e1) {
          keyObj = pair.privateKey;
          keyStore = 'mem-extractable';
          securityWarn('nonextractable-key-fallback',
            '이 브라우저가 비추출 개인키를 만들지 못해 추출 가능 키를 세션 메모리에만 보관합니다. 새로고침하면 기기를 다시 등록해야 하니, 가능하면 최신 브라우저에서 다시 등록하세요.');
        }
      }
      const pub = await exportPubJwk(pair.publicKey);
      const hash = (await sha256Hex(JSON.stringify([pub.x, pub.y]))).slice(0, 16);
      dev = {
        id: randId('ph_', 6),
        name: deviceLabel('phone'),
        pub_ecdsa: pub,
        pub_hash: hash,
        key_store: keyStore,
        created_at: now()
      };
      const stored = keyObj ? await storeDevicePriv(dev, keyObj) : false;
      if (!stored && keyStore === 'idb') {
        dev.key_store = 'mem';
        securityWarn('idb-unavailable', 'IndexedDB 를 쓸 수 없어 기기 개인키를 이번 세션 메모리에만 보관합니다.');
      }
      lsSet(K.phone, dev);
      await server.bind({ id: dev.id, kind: 'phone', name: dev.name, pub_ecdsa: pub, pub_hash: hash });
      return dev;
    },

    async ensureRegistered() {
      const dev = await this.ensureDevice();
      const out = await server.devices();
      const found = (out.devices || []).find((d) => d.kind === 'phone' && d.pub_hash === dev.pub_hash);
      if (!found) {
        const bind = await server.bind({ id: dev.id, kind: 'phone', name: dev.name, pub_ecdsa: dev.pub_ecdsa, pub_hash: dev.pub_hash });
        if (!bind || !bind.ok) return { ok: false, message: bind ? bind.message : '기기 등록에 실패했습니다.' };
        return { ok: true, device: dev };
      }
      return { ok: true, device: dev };
    },

    async open() {
      ensureModal('phone');
      const modal = $('#smartkey-phone-modal');
      if (modal) modal.hidden = false;
      const reg = await this.ensureRegistered();
      const st = $('#sk-ph-status');
      if (st) st.textContent = reg.ok ? ('이 폰: ' + (this.device() ? this.device().name : deviceLabel('phone')) + ' · 마스터 스마트키') : (reg.message || '');
      this.setStep(this.step === 'approve' ? 'approve' : 'idle');
      return reg;
    },
    close() {
      this.stopScan();
      const modal = $('#smartkey-phone-modal');
      if (modal) modal.hidden = true;
    },
    setStep(step) {
      this.step = step;
      const map = { idle: '#sk-ph-scan', approve: '#sk-approve', done: '#sk-ph-done' };
      Object.keys(map).forEach((k) => { const el = $(map[k]); if (el) el.hidden = k !== step; });
      const title = $('#sk-ph-title');
      if (title) title.textContent = step === 'approve' ? '🔐 PC 연결 승인' : '📱 이 폰을 스마트키로';
    },

    authMethod() {
      if (auth.__force) return auth.__force;
      const supported = !!(root.PublicKeyCredential && isHttps() && root.isSecureContext !== false);
      return supported ? 'webauthn' : 'pin';
    },

    async submitCode(code) {
      const digits = String(code || '').replace(/\D/g, '');
      if (digits.length !== 6) return this.fail('6자리 숫자를 입력해 주세요.');
      const out = await server.peekByCode(digits);
      if (!out || !out.ok) return this.fail((out && out.message) || '코드를 찾을 수 없습니다.');
      return this.showApprove(out.challenge, '');
    },

    async onDecode(text) {
      const p = this.payloadParse(text);
      if (!p) { this.fail('이 앱의 스마트키 QR이 아닙니다.'); return { ok: false, reason: 'payload' }; }
      const out = await server.peekByCode(p.code6);
      if (!out || !out.ok) { this.fail((out && out.message) || 'QR이 만료되었습니다.'); return { ok: false, reason: out && out.error }; }
      if (String(out.challenge.code2) !== String(p.code2)) {
        this.fail('확인 숫자가 서버 값과 다릅니다. 화면이 바뀌었을 수 있습니다.');
        return { ok: false, reason: 'code2-mismatch' };
      }
      if (String(out.challenge.pc_pub_hash) !== String(p.pc_pub_hash)) {
        this.fail('PC 키 해시가 일치하지 않습니다(릴레이 의심). 승인하지 마세요.');
        return { ok: false, reason: 'relay' };
      }
      return this.showApprove(out.challenge, p.pc_pub_hash);
    },

    fail(msg) {
      const el = $('#sk-ph-err');
      if (el) { el.hidden = false; el.textContent = msg; }
      return { ok: false, message: msg };
    },

    showApprove(ch, scannedHash) {
      this.pending = ch;
      this.scannedHash = scannedHash || ch.pc_pub_hash;
      const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
      set('#sk-ap-code2', ch.code2);
      set('#sk-ap-code2b', ch.code2 + '  (PC 화면과 같은지 확인)');
      set('#sk-ap-pcname', ch.pc_name || 'PC');
      set('#sk-ap-device', ch.pc_name || 'PC');
      set('#sk-ap-time', dateTimeLabel(ch.issued_at));
      set('#sk-ap-time2', dateTimeLabel(ch.issued_at));
      set('#sk-ap-domain', ch.pc_host || officialDomain());
      const err = $('#sk-ph-err');
      if (err) err.hidden = true;
      const method = this.authMethod();
      const bio = $('#sk-auth-bio');
      const pinBox = $('#sk-pin-box');
      const note = $('#sk-auth-note');
      if (bio) bio.hidden = method !== 'webauthn';
      if (pinBox) pinBox.hidden = method === 'webauthn';
      if (note) {
        note.textContent = method === 'webauthn'
          ? 'Face ID · 지문으로 승인합니다. 안 되면 PIN 입력으로 바꿀 수 있습니다.'
          : '이 환경은 생체인증(https 전용)을 쓸 수 없어 PIN 4~6자리로 승인합니다.';
      }
      this.setStep('approve');
      const input = $('#sk-pin');
      if (input && method !== 'webauthn') { try { input.focus({ preventScroll: true }); } catch (e) { /* noop */ } }
      return { ok: true, challenge: ch, method };
    },

    async approveWithPin(pin) {
      if (!subtle()) return this.fail('이 환경(file://)에서는 PIN 승인을 사용할 수 없습니다. https 로 열어 주세요.');
      const digits = String(pin || '').replace(/\D/g, '');
      if (digits.length < 4 || digits.length > 6) return this.fail('PIN은 4~6자리입니다.');
      /* v6.1 — 승인 화면에도 5회/30초 제한을 둡니다(추측 방어) */
      const t = now();
      this._pinTries = (this._pinTries || []).filter((x) => t - x < 30000);
      if (this._pinTries.length >= 5) return this.fail('PIN 시도가 너무 많습니다. 30초 후 다시 시도해 주세요.');
      let rec = lsGet(K.pin, null);
      if (!rec) { rec = await hashPin(digits); lsSet(K.pin, rec); }
      else if (!(await checkPin(digits, rec))) {
        this._pinTries.push(t);
        return this.fail('PIN이 맞지 않습니다.');
      }
      return this.finishApprove();
    },

    async approveWithBiometric() {
      const ok = await auth.assertBiometric();
      if (!ok.ok) {
        const bio = $('#sk-auth-bio');
        const pinBox = $('#sk-pin-box');
        if (bio) bio.hidden = true;
        if (pinBox) pinBox.hidden = false;
        const note = $('#sk-auth-note');
        if (note) note.textContent = '생체인증을 쓸 수 없어 PIN 입력으로 전환했습니다.';
        return this.fail('생체인증을 사용할 수 없습니다. PIN으로 승인해 주세요.');
      }
      return this.finishApprove();
    },

    async finishApprove() {
      const ch = this.pending;
      if (!ch) return this.fail('승인할 요청이 없습니다.');
      const err = $('#sk-ph-err');
      if (err) err.hidden = true;
      try {
        const dev = await this.ensureDevice();
        const priv = await devicePriv(dev);
        if (!priv) return this.fail('기기 서명 키를 찾을 수 없습니다. 기기를 다시 등록해 주세요.');
        const phoneKeys = await genEcdh();
        const phonePub = await exportPubJwk(phoneKeys.publicKey);
        const aes = await deriveAes(phoneKeys.privateKey, ch.pc_pub_ecdh);
        const payload = consultationPayload();
        const enc = await aesEncrypt(aes, payload);
        const sig = await signText(priv, await transcriptApprove(ch, { device_id: dev.id }, phonePub, enc));
        const B = root.BojangBackend;
        const jwt = B && B.sessionToken ? B.sessionToken() : '';
        const out = await server.approve({
          challenge_id: ch.id,
          device_id: dev.id,
          code2: ch.code2,
          pc_pub_hash: this.scannedHash || ch.pc_pub_hash,
          phone_pub: phonePub,
          enc,
          signature: sig,
          jwt
        });
        if (!out || !out.ok) return this.fail((out && out.message) || '승인에 실패했습니다.');
        this.pending = null;
        const done = $('#sk-ph-done');
        if (done) {
          done.innerHTML = '<div class="sk-ok"><span class="sk-ok-ico">✓</span><b>PC 연결을 승인했습니다</b>' +
            '<p>' + esc(ch.pc_name || 'PC') + ' · ' + esc(dateTimeLabel(now())) + '<br>' +
            '상담 데이터는 암호화되어 PC로만 전달되었습니다. 이 창은 닫아도 됩니다.</p></div>' +
            '<button type="button" class="sk-btn ghost" id="sk-ph-close2">닫기</button>';
          const cb = $('#sk-ph-close2');
          if (cb) cb.addEventListener('click', () => this.close());
        }
        this.setStep('done');
        toast('PC 연결을 승인했습니다');
        return { ok: true, session_token: out.session_token };
      } catch (e) {
        return this.fail('승인 처리 중 오류: ' + String(e && e.message || e));
      }
    },

    async reject() {
      const ch = this.pending;
      if (ch) await server.reject({ challenge_id: ch.id });
      this.pending = null;
      this.setStep('idle');
      toast('요청을 거절했습니다');
      return { ok: true };
    },

    async scanStart() {
      ensureModal('phone');
      const wrap = $('#sk-cam-wrap');
      const video = $('#sk-video');
      const err = $('#sk-ph-err');
      if (!root.navigator || !root.navigator.mediaDevices || !root.navigator.mediaDevices.getUserMedia) {
        return this.fail('이 브라우저에서는 카메라를 열 수 없습니다. 아래 6자리 코드를 입력해 주세요.');
      }
      if (!root.BojangQRScan) return this.fail('QR 스캐너를 불러오지 못했습니다. 6자리 코드를 입력해 주세요.');
      try {
        this.stream = await root.navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        this.stream = null;
        return this.fail('카메라 권한이 없습니다. 아래 6자리 코드를 입력하면 그대로 인증됩니다.');
      }
      if (wrap) wrap.hidden = false;
      if (video) {
        video.srcObject = this.stream;
        try { await video.play(); } catch (e) { /* noop */ }
      }
      if (err) err.hidden = true;
      this.stopTimerOnly();
      this.scanTimer = root.setInterval(() => this.scanTick(), 220);
      return { ok: true };
    },

    scanTick() {
      const video = $('#sk-video');
      if (!video || !this.stream) return;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      const scale = Math.min(1, 480 / w);
      const cw = Math.round(w * scale), chh = Math.round(h * scale);
      let canvas = this.canvas;
      if (!canvas) { canvas = document.createElement('canvas'); this.canvas = canvas; }
      canvas.width = cw; canvas.height = chh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      try { ctx.drawImage(video, 0, 0, cw, chh); } catch (e) { return; }
      let text = null;
      try { text = root.BojangQRScan.decodeCanvas(canvas); } catch (e) { text = null; }
      if (text) {
        this.stopScan();
        this.onDecode(text);
      }
    },

    stopTimerOnly() {
      if (this.scanTimer) { root.clearInterval(this.scanTimer); this.scanTimer = null; }
    },
    stopScan() {
      this.stopTimerOnly();
      if (this.stream) {
        try { this.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* noop */ }
        this.stream = null;
      }
      const wrap = $('#sk-cam-wrap');
      if (wrap) wrap.hidden = true;
    }
  };

  /* 상담 데이터 요약 (폰 → PC) */
  function consultationPayload() {
    const S = root.BojangApp && root.BojangApp.state;
    if (!S) return { v: 1, client: null, at: now() };
    return {
      v: 1,
      at: now(),
      client: S.client ? { name: S.client.name || '', birth: S.client.birth || '', consultant: S.client.consultant || '', dateLabel: S.client.dateLabel || '' } : null,
      age: S.age || '', gender: S.gender || '', premium: S.premium || 0,
      cov: { cancer: S.cov && S.cov.cancer ? S.cov.cancer.general || 0 : 0 }
    };
  }

  /* =========================================================
     생체인증 (WebAuthn · https 전용)
     ========================================================= */
  const auth = {
    __force: null,
    method() { return phone.authMethod(); },
    async platformAvailable() {
      try {
        return !!(root.PublicKeyCredential && root.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
          await root.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
      } catch (e) { return false; }
    },
    async registerBiometric() {
      if (!isHttps() || !root.PublicKeyCredential || !root.navigator.credentials) {
        return { ok: false, reason: 'unsupported', message: '생체인증은 https 에서만 등록됩니다. PIN 을 사용해 주세요.' };
      }
      try {
        const cred = await root.navigator.credentials.create({
          publicKey: {
            challenge: rndBytes(32),
            rp: { name: '보장분석 라이프 리포트', id: officialDomain() },
            user: { id: rndBytes(16), name: 'fc@bojang', displayName: '보장분석 스마트키' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
            authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
            timeout: 60000
          }
        });
        if (!cred) return { ok: false, reason: 'cancelled' };
        lsSet(K.bio, { id: b64u(cred.rawId), at: now() });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'failed', message: String(e && e.message || e) };
      }
    },
    async assertBiometric() {
      if (this.__force === 'pin') return { ok: false, reason: 'forced-pin' };
      const saved = lsGet(K.bio, null);
      if (!saved || !isHttps() || !root.navigator.credentials) return { ok: false, reason: 'unsupported' };
      try {
        const res = await root.navigator.credentials.get({
          publicKey: {
            challenge: rndBytes(32),
            timeout: 60000,
            userVerification: 'required',
            allowCredentials: [{ type: 'public-key', id: unb64u(saved.id) }]
          }
        });
        return res ? { ok: true } : { ok: false, reason: 'cancelled' };
      } catch (e) {
        return { ok: false, reason: 'failed', message: String(e && e.message || e) };
      }
    },
    async registerPin(pin) {
      const digits = String(pin || '').replace(/\D/g, '');
      if (digits.length < 4 || digits.length > 6) return { ok: false, message: 'PIN은 4~6자리입니다.' };
      lsSet(K.pin, await hashPin(digits));
      return { ok: true };
    },
    async checkPin(pin) { return checkPin(pin, lsGet(K.pin, null)); },
    hasPin() { return !!lsGet(K.pin, null); }
  };

  /* =========================================================
     잠금 (자동 잠금 · 원격 잠금 · PIN/생체)
     ========================================================= */
  const lock = {
    locked: false,
    reason: '',
    idleTimer: null,
    tries: 0,
    lastAt: 0,

    config() {
      const p = prefsGet();
      return { autoLockMin: p.autoLockMin == null ? 3 : p.autoLockMin, enabled: p.lockEnabled !== false };
    },
    isLocked() { return this.locked; },

    arm() {
      this.disarm();
      const cfg = this.config();
      if (!cfg.enabled || !cfg.autoLockMin) return;
      if (!auth.hasPin() && !lsGet(K.bio, null)) return;   // 잠금 수단이 없으면 예약하지 않음
      const reset = () => {
        if (this.locked) return;
        root.clearTimeout(this.idleTimer);
        this.idleTimer = root.setTimeout(() => this.lock('idle'), cfg.autoLockMin * 60000);
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
      this._reset = reset;
      reset();
    },
    disarm() {
      if (this.idleTimer) { root.clearTimeout(this.idleTimer); this.idleTimer = null; }
      if (this._reset) {
        ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.removeEventListener(ev, this._reset));
        this._reset = null;
      }
    },

    reasons: {
      idle: '자리를 비운 사이 자동으로 잠겼습니다',
      remote: '휴대폰에서 원격 잠금을 보냈습니다',
      manual: '잠금 버튼으로 화면을 잠갔습니다',
      start: '이 기기는 잠겨 있습니다. PIN 또는 생체인증으로 열어 주세요'
    },

    lock(reason) {
      if (!auth.hasPin() && !lsGet(K.bio, null)) {
        /* PIN 이 없으면 잠글 수 없습니다. 자동 잠금(idle)은 조용히 넘어가고,
           수동·원격 잠금은 PIN 설정을 안내합니다(자가 잠김 방지). */
        if (reason === 'idle') return { ok: false, reason: 'no-pin' };
        this.openSetup(reason);
        return { ok: false, reason: 'no-pin' };
      }
      this.locked = true;
      this.reason = reason || 'manual';
      this.tries = 0;
      this.render();
      return { ok: true };
    },
    unlock(pin) { return this.tryUnlock(pin); },

    async tryUnlock(pin) {
      if (now() - this.lastAt < 250) return { ok: false, reason: 'slow' };
      this.lastAt = now();
      if (!(await auth.checkPin(pin))) {
        this.tries += 1;
        const msg = this.tries >= 5 ? '5회 실패 · 30초간 잠시 막았습니다' : 'PIN이 맞지 않습니다 (' + this.tries + '/5)';
        this.paintError(msg);
        if (this.tries >= 5) { root.setTimeout(() => { this.tries = 0; this.paintError(''); }, 30000); }
        return { ok: false, reason: 'bad-pin', tries: this.tries };
      }
      this.locked = false;
      this.reason = '';
      this.tries = 0;
      this.render();
      this.arm();
      toast('잠금을 해제했습니다');
      return { ok: true };
    },

    async unlockBiometric() {
      const r = await auth.assertBiometric();
      if (!r.ok) { this.paintError('생체인증을 쓸 수 없습니다. PIN을 입력해 주세요.'); return r; }
      this.locked = false;
      this.reason = '';
      this.render();
      this.arm();
      return { ok: true };
    },

    openSetup(reason) {
      ensureModal('lock-setup');
      const m = $('#sk-setup-modal');
      if (m) m.hidden = false;
      const why = $('#sk-setup-why');
      if (why) why.textContent = this.reasons[reason || 'manual'] || '';
      return { ok: true };
    },

    paintError(msg) {
      const el = $('#sk-lock-err');
      if (el) { el.hidden = !msg; el.textContent = msg || ''; }
    },

    render() {
      const el = $('#sk-lock');
      if (!el) return;
      el.hidden = !this.locked;
      document.documentElement.classList.toggle('is-sk-locked', this.locked);
      if (!this.locked) return;
      const why = $('#sk-lock-why');
      if (why) why.textContent = this.reasons[this.reason] || '화면이 잠겼습니다';
      const bio = $('#sk-lock-bio');
      if (bio) bio.hidden = !(lsGet(K.bio, null) && isHttps());
      this.paintError('');
      const input = $('#sk-lock-pin');
      if (input) { input.value = ''; try { input.focus({ preventScroll: true }); } catch (e) { /* noop */ } }
    }
  };

  /* ---------- 환경 설정 ---------- */
  function prefsGet() {
    return lsGet(K.prefs, { privacy: false, autoLockMin: 3, lockEnabled: true });
  }
  function prefsSet(patch) {
    const p = Object.assign(prefsGet(), patch || {});
    lsSet(K.prefs, p);
    return p;
  }

  /* =========================================================
     프라이버시 가림 모드 — 고객 앞 30장 화면에서 고객명·연락처 마스킹
     ========================================================= */
  const privacy = {
    maskName(name) {
      const s = String(name || '').trim();
      if (!s) return '';
      if (s.length === 1) return '*';
      if (s.length === 2) return s[0] + '*';
      return s[0] + '*'.repeat(Math.max(1, s.length - 2)) + s[s.length - 1];
    },
    maskText(text) {
      let out = String(text == null ? '' : text);
      const S = root.BojangApp && root.BojangApp.state;
      const name = S && S.client ? String(S.client.name || '').trim() : '';
      if (name && name.length >= 2) {
        const masked = this.maskName(name);
        out = out.split(name).join(masked);
      }
      out = out.replace(/\b(01[016789])[-.\s]?(\d{3,4})[-.\s]?(\d{4})\b/g, (m, a, b, c) => a + '-****-' + c.slice(-2));
      out = out.replace(/\b(\d{6})[-.\s]?([1-4])\d{6}\b/g, (m, a, b) => a + '-' + b + '******');
      return out;
    },
    enabled() { return !!prefsGet().privacy; },
    originals: typeof WeakMap === 'function' ? new WeakMap() : null,

    setEnabled(on) {
      const p = prefsSet({ privacy: !!on });
      this.refresh();
      const chip = $('#sk-privacy-chip');
      if (chip) {
        chip.classList.toggle('is-on', !!on);
        chip.textContent = on ? '🙈 가림 모드 ON' : '🙈 가림 모드 OFF';
        chip.setAttribute('aria-pressed', String(!!on));
      }
      const t = $('#sk-pref-privacy');
      if (t) t.checked = !!on;
      toast(on ? '고객명을 가렸습니다 · 화면·입력창·PDF 모두' : '가림을 해제했습니다');
      return p;
    },

    walk(node, fn) {
      const doc = document;
      if (!node) return;
      const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (/^(SCRIPT|STYLE|TEXTAREA|INPUT)$/.test(n.parentNode && n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
      });
      const list = [];
      while (walker.nextNode()) list.push(walker.currentNode);
      list.forEach(fn);
    },

    refresh() {
      const on = this.enabled();
      /* v6.1 — 고객 화면 카드만이 아니라 라이브 대본·요약·상단 서식 등
         고객 실명이 보이는 모든 영역을 마스킹합니다(4호 봇 적발 결함). */
      const targets = ['#deck', '#view-live', '#live-body', '#cs-name', '#client-banner', '#home-client',
        '#view-analysis', '#view-home', '#view-toolkit', '#summary', '#client-strip', '#kakao-preview',
        '#deck-stage', '#view-guide', '#view-quick'];
      const hosts = [];
      targets.forEach((sel) => { const h = $(sel); if (h && hosts.indexOf(h) < 0) hosts.push(h); });
      if (!hosts.length) hosts.push(document.body);
      hosts.forEach((host) => {
        this.walk(host, (node) => {
          if (!this.originals) return;
          if (on) {
            if (!this.originals.has(node)) this.originals.set(node, node.nodeValue);
            const masked = this.maskText(this.originals.get(node));
            if (node.nodeValue !== masked) node.nodeValue = masked;
          } else if (this.originals.has(node)) {
            const orig = this.originals.get(node);
            if (node.nodeValue !== orig) node.nodeValue = orig;
            this.originals.delete(node);
          }
        });
      });
      /* 어느 영역에도 남지 않도록 본문 전체를 한 번 더 확인(중복은 WeakMap으로 방지) */
      if (on && hosts.indexOf(document.body) < 0) {
        this.walk(document.body, (node) => {
          if (!this.originals.has(node)) this.originals.set(node, node.nodeValue);
          const masked = this.maskText(this.originals.get(node));
          if (node.nodeValue !== masked) node.nodeValue = masked;
        });
      }
      const chip = $('#sk-privacy-chip');
      if (chip) {
        chip.classList.toggle('is-on', on);
        chip.textContent = on ? '🙈 가림 모드 ON' : '🙈 가림 모드 OFF';
        chip.setAttribute('aria-pressed', String(on));
      }
      /* v6.1.1 — 입력창(고객명)도 같은 상태를 따릅니다 */
      this.syncInputs();
    },

    /* v6.1.1 — 입력창(고객명 <input>)까지 가림.
       · 표시값만 마스킹하고 state.client.name 원문은 절대 건드리지 않습니다.
       · 포커스가 들어오면 원문을 되살려 편집하게 하고, 블러·비활성화·재렌더에서 다시 가립니다. */
    realClientName() {
      const S = root.BojangApp && root.BojangApp.state;
      const n = S && S.client ? String(S.client.name || '').trim() : '';
      return n === '홍길동' ? '' : n;
    },

    bindInputMask(el) {
      if (!el || !el.dataset || el.dataset.skMaskBound === '1') return;
      el.dataset.skMaskBound = '1';
      const reveal = () => {
        if (!this.enabled()) return;
        if (el.dataset.skMasked !== '1') return;
        const real = this.realClientName();
        if (real) el.value = real;
        el.dataset.skMasked = '0';
      };
      /* focus 만으로는 터치·프로그램 포커스에서 놓칠 수 있어 포인터 진입도 함께 처리합니다 */
      el.addEventListener('focus', reveal);
      el.addEventListener('pointerdown', reveal);
      el.addEventListener('blur', () => { if (this.enabled()) this.syncInputs(); });
    },

    syncInputs() {
      const on = this.enabled();
      const real = this.realClientName();
      let list = [];
      try {
        list = Array.prototype.slice.call(document.querySelectorAll('input[type="text"], input:not([type]), textarea'));
      } catch (e) { list = []; }
      list.forEach((el) => {
        this.bindInputMask(el);
        if (!on) {
          if (el.dataset.skMasked === '1') {
            el.value = real || '';
            el.dataset.skMasked = '0';
          }
          return;
        }
        if (!real || real.length < 2) return;
        /* 입력 중인 필드는 편집할 수 있어야 하므로 원문을 유지합니다 */
        if (document.activeElement === el) return;
        const masked = this.maskName(real);
        const v = String(el.value || '').trim();
        if (v === real) { el.value = masked; el.dataset.skMasked = '1'; }
        else if (el.dataset.skMasked === '1' && v !== masked) { el.value = masked; }
      });
    },

    installObserver() {
      if (this._obs || typeof MutationObserver !== 'function') return;
      const obs = new MutationObserver(() => {
        if (!this.enabled()) return;
        if (this._busy) return;
        this._busy = true;
        root.requestAnimationFrame(() => { this._busy = false; this.refresh(); });
      });
      const target = document.body;
      obs.observe(target, { childList: true, subtree: true, characterData: true });
      this._obs = obs;
    }
  };

  /* PC 세션 원격 잠금 감시 */
  const watch = {
    timer: null,
    start() {
      this.stop();
      if (!pc.session) return;
      this.timer = root.setInterval(async () => {
        if (!pc.session) { this.stop(); return; }
        const out = await server.session(pc.session.token);
        if (!out || !out.ok) {
          if (out && out.error === 'revoked') {
            pc.session = null;
            lsDel(K.pc);
            this.stop();
            lock.lock('remote');
          }
        }
      }, 1500);
    },
    stop() { if (this.timer) { root.clearInterval(this.timer); this.timer = null; } }
  };

  function toast(msg) {
    if (root.__bojangToast) { root.__bojangToast(msg); return; }
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    root.setTimeout(() => el.classList.remove('is-on'), 2400);
  }

  /* =========================================================
     화면 생성 — 필요한 순간에만 DOM 을 만듭니다(첫 화면 가볍게)
     ========================================================= */
  function ensureModal(kind) {
    if (kind === 'pc' && !$('#smartkey-pc-modal')) document.body.insertAdjacentHTML('beforeend', pcModalHTML());
    if (kind === 'phone' && !$('#smartkey-phone-modal')) document.body.insertAdjacentHTML('beforeend', phoneModalHTML());
    if (kind === 'devices' && !$('#smartkey-devices-modal')) document.body.insertAdjacentHTML('beforeend', devicesModalHTML());
    if (kind === 'lock-setup' && !$('#sk-setup-modal')) document.body.insertAdjacentHTML('beforeend', setupModalHTML());
    if (!$('#sk-lock')) document.body.insertAdjacentHTML('beforeend', lockHTML());
    if (!$('#sk-privacy-chip')) document.body.insertAdjacentHTML('beforeend', privacyChipHTML());
    if (!$('#sk-lock-fab')) document.body.insertAdjacentHTML('beforeend', lockFabHTML());
    bindOnce();
  }

  function pcModalHTML() {
    return '<div class="modal sk-modal" id="smartkey-pc-modal" hidden>\n' +
      '<div class="modal-card sk-card" role="dialog" aria-modal="true" aria-labelledby="sk-pc-title">\n' +
      '<button type="button" class="pw-x" id="sk-pc-x" aria-label="닫기">×</button>\n' +
      '<span class="pw-eyebrow">SMART KEY · PC LOGIN</span>\n' +
      '<strong id="sk-pc-title">🔑 스마트키로 PC 열기</strong>\n' +
      '<p class="sk-sub">휴대폰 카메라로 아래 QR을 찍거나, QR 아래 <b>6자리 코드</b>를 폰에 입력하세요.</p>\n' +
      '<div id="sk-pc-qrbox">\n' +
      '<div class="sk-qr-wrap"><div id="sk-qr" class="sk-qr" aria-label="스마트키 QR"></div>' +
      '<span class="sk-qr-badge" id="sk-code2" hidden>00</span></div>\n' +
      '<div class="sk-code6" id="sk-code6">------</div>\n' +
      '<div class="sk-remain" id="sk-remain" data-remain="180">남은 시간 03:00</div>\n' +
      '<div class="sk-progress"><i id="sk-bar"></i></div>\n' +
      '</div>\n' +
      '<div id="sk-pc-session" hidden></div>\n' +
      '<div class="sk-status" id="sk-pc-status">준비됨</div>\n' +
      '<div class="sk-actions">\n' +
      '<button type="button" class="sk-btn ghost" id="sk-refresh">🔄 새 코드</button>\n' +
      '<button type="button" class="sk-btn ghost" id="sk-pc-close">닫기</button>\n' +
      '</div>\n' +
      '<p class="sk-note" id="sk-pc-note"></p>\n' +
      '</div></div>';
  }

  function phoneModalHTML() {
    return '<div class="modal sk-modal" id="smartkey-phone-modal" hidden>\n' +
      '<div class="modal-card sk-card" role="dialog" aria-modal="true" aria-labelledby="sk-ph-title">\n' +
      '<button type="button" class="pw-x" id="sk-ph-x" aria-label="닫기">×</button>\n' +
      '<span class="pw-eyebrow">SMART KEY · THIS PHONE</span>\n' +
      '<strong id="sk-ph-title">📱 이 폰을 스마트키로</strong>\n' +
      '<p class="sk-status" id="sk-ph-status"></p>\n' +
      '<div id="sk-ph-scan">\n' +
      '<button type="button" class="sk-btn primary" id="sk-scan-start">📷 카메라로 PC 화면 QR 스캔</button>\n' +
      '<div class="sk-cam" id="sk-cam-wrap" hidden><video id="sk-video" playsinline muted></video>' +
      '<span class="sk-cam-hint">QR을 화면 가운데에 맞춰 주세요</span></div>\n' +
      '<p class="sk-or"><span>또는</span></p>\n' +
      '<div class="sk-manual">\n' +
      '<label class="sk-label" for="sk-code-input">PC 화면의 6자리 코드</label>\n' +
      '<div class="sk-manual-row"><input id="sk-code-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autocomplete="one-time-code" aria-label="6자리 코드">' +
      '<button type="button" class="sk-btn" id="sk-code-submit">확인</button></div></div>\n' +
      '<p class="sk-err" id="sk-ph-err" hidden></p>\n' +
      '</div>\n' +
      '<div id="sk-approve" hidden>\n' +
      '<div class="sk-approve-head"><span class="sk-2digit" id="sk-ap-code2">00</span>' +
      '<span class="sk-approve-main"><b id="sk-ap-pcname">PC</b><em id="sk-ap-time"></em></span></div>\n' +
      '<dl class="sk-facts">' +
      '<div><dt>접속 기기</dt><dd id="sk-ap-device"></dd></div>' +
      '<div><dt>요청 시각</dt><dd id="sk-ap-time2"></dd></div>' +
      '<div><dt>공식 도메인</dt><dd id="sk-ap-domain"></dd></div>' +
      '<div><dt>확인 숫자</dt><dd id="sk-ap-code2b"></dd></div>' +
      '</dl>\n' +
      '<p class="sk-warn">PC 화면의 숫자와 <b>같아야</b> 합니다. 다르거나 모르는 요청이면 거절하세요.</p>\n' +
      '<div class="sk-auth">\n' +
      '<button type="button" class="sk-btn primary" id="sk-auth-bio" hidden>👆 Face ID · 지문으로 승인</button>\n' +
      '<div id="sk-pin-box"><label class="sk-label" for="sk-pin">PIN 4~6자리</label>' +
      '<input id="sk-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" aria-label="PIN"></div>\n' +
      '<p class="sk-note" id="sk-auth-note"></p>\n' +
      '</div>\n' +
      '<div class="sk-approve-actions">\n' +
      '<button type="button" class="sk-btn reject" id="sk-reject">거절</button>\n' +
      '<button type="button" class="sk-btn approve" id="sk-approve-btn">승인</button>\n' +
      '</div>\n' +
      '<p class="sk-err" id="sk-ap-err" hidden></p>\n' +
      '</div>\n' +
      '<div id="sk-ph-done" hidden></div>\n' +
      '</div></div>';
  }

  function devicesModalHTML() {
    return '<div class="modal sk-modal" id="smartkey-devices-modal" hidden>\n' +
      '<div class="modal-card sk-card" role="dialog" aria-modal="true" aria-labelledby="sk-dev-title">\n' +
      '<button type="button" class="pw-x" id="sk-dev-x" aria-label="닫기">×</button>\n' +
      '<span class="pw-eyebrow">DEVICES · LOCK · PRIVACY</span>\n' +
      '<strong id="sk-dev-title">🖥 기기 관리 · 잠금</strong>\n' +
      '<p class="sk-status" id="sk-device-state"></p>\n' +
      '<div class="sk-device-list" id="sk-device-list"></div>\n' +
      '<div class="sk-prefs">\n' +
      '<label class="sk-switch"><input type="checkbox" id="sk-pref-privacy"><span>고객 앞 가림 모드 <em>화면·입력창·PDF 고객명을 홍*동·김*수로</em></span></label>\n' +
      '<label class="sk-row"><span>자동 잠금</span><select id="sk-pref-autolock">' +
      '<option value="0">사용 안 함</option><option value="1">1분</option><option value="3">3분</option><option value="5">5분</option><option value="10">10분</option>' +
      '</select></label>\n' +
      '<div class="sk-pin-row"><span id="sk-pin-state">PIN 미설정</span>' +
      '<button type="button" class="sk-mini" id="sk-pin-set">PIN 설정</button>' +
      '<button type="button" class="sk-mini" id="sk-bio-reg">생체인증 등록</button></div>\n' +
      '</div>\n' +
      '<p class="sk-note">최대 2기기(마스터 휴대폰 1 + PC 1)까지 등록됩니다. PC를 바꾸면 1탭으로 기존 PC를 밀어낼 수 있습니다.</p>\n' +
      '</div></div>';
  }

  function setupModalHTML() {
    return '<div class="modal sk-modal" id="sk-setup-modal" hidden>\n' +
      '<div class="modal-card sk-card" role="dialog" aria-modal="true" aria-labelledby="sk-setup-title">\n' +
      '<button type="button" class="pw-x" id="sk-setup-x" aria-label="닫기">×</button>\n' +
      '<span class="pw-eyebrow">LOCK · SETUP</span>\n' +
      '<strong id="sk-setup-title">🔒 잠금 PIN 만들기</strong>\n' +
      '<p class="sk-sub" id="sk-setup-why"></p>\n' +
      '<label class="sk-label" for="sk-setup-pin">PIN 4~6자리</label>\n' +
      '<input id="sk-setup-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off">\n' +
      '<label class="sk-label" for="sk-setup-pin2">한 번 더</label>\n' +
      '<input id="sk-setup-pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="off">\n' +
      '<p class="sk-err" id="sk-setup-err" hidden></p>\n' +
      '<div class="sk-actions"><button type="button" class="sk-btn ghost" id="sk-setup-cancel">나중에</button>' +
      '<button type="button" class="sk-btn primary" id="sk-setup-save">PIN 저장</button></div>\n' +
      '<p class="sk-note">PIN은 이 기기에 해시(PBKDF2)로만 저장됩니다. 잊으면 기기 데이터를 지워야 합니다.</p>\n' +
      '</div></div>';
  }

  function lockHTML() {
    return '<div class="sk-lock" id="sk-lock" hidden role="dialog" aria-modal="true" aria-labelledby="sk-lock-title">\n' +
      '<div class="sk-lock-card">\n' +
      '<span class="sk-lock-ico" aria-hidden="true">🔒</span>\n' +
      '<b id="sk-lock-title">화면 잠김</b>\n' +
      '<p id="sk-lock-why"></p>\n' +
      '<input id="sk-lock-pin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN" aria-label="잠금 PIN">\n' +
      '<p class="sk-err" id="sk-lock-err" hidden></p>\n' +
      '<div class="sk-lock-actions"><button type="button" class="sk-btn primary" id="sk-lock-open">잠금 해제</button>' +
      '<button type="button" class="sk-btn ghost" id="sk-lock-bio" hidden>생체인증</button></div>\n' +
      '<p class="sk-lock-note">고객 정보는 잠금 상태에서 가려집니다.</p>\n' +
      '</div></div>';
  }

  function privacyChipHTML() {
    return '<button type="button" class="sk-privacy-chip" id="sk-privacy-chip" aria-pressed="false">🙈 가림 모드 OFF</button>';
  }
  function lockFabHTML() {
    return '<button type="button" class="sk-lock-fab" id="sk-lock-fab" aria-label="화면 잠금">🔒</button>';
  }

  /* v6.1 — 최초 PIN 은 한 번 더 확인한 뒤 등록합니다(입력값이 그대로 저장되던 결함). */
  function submitPin() {
    const inp = $('#sk-pin');
    const val = inp ? inp.value : '';
    if (!lsGet(K.pin, null)) {
      if (phone._pendingPin !== val) {
        phone._pendingPin = val;
        const note = $('#sk-auth-note');
        if (note) note.textContent = 'PIN을 이 값으로 설정합니다. 같은 번호를 한 번 더 입력하고 승인을 누르세요.';
        if (inp) inp.value = '';
        return;
      }
    }
    phone._pendingPin = null;
    phone.approveWithPin(val);
  }

  let bound = false;
  function bindOnce() {
    if (bound) return;
    bound = true;
    const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
    on('#sk-pc-x', 'click', () => pc.close());
    on('#sk-pc-close', 'click', () => pc.close());
    on('#sk-refresh', 'click', () => pc.issue());
    on('#sk-ph-x', 'click', () => phone.close());
    on('#sk-scan-start', 'click', () => phone.scanStart());
    on('#sk-code-submit', 'click', () => phone.submitCode($('#sk-code-input').value));
    on('#sk-code-input', 'keydown', (e) => { if (e.key === 'Enter') phone.submitCode($('#sk-code-input').value); });
    on('#sk-approve-btn', 'click', () => {
      const method = phone.authMethod();
      if (method === 'webauthn') phone.approveWithBiometric();
      else submitPin();
    });
    on('#sk-auth-bio', 'click', () => phone.approveWithBiometric());
    on('#sk-pin', 'keydown', (e) => { if (e.key === 'Enter') submitPin(); });
    on('#sk-reject', 'click', () => phone.reject());
    on('#sk-dev-x', 'click', () => devices.close());
    on('#sk-pref-privacy', 'change', (e) => privacy.setEnabled(e.target.checked));
    on('#sk-pref-autolock', 'change', (e) => { prefsSet({ autoLockMin: Number(e.target.value) }); lock.arm(); toast('자동 잠금을 바꿨습니다'); });
    on('#sk-pin-set', 'click', () => { $('#smartkey-devices-modal').hidden = true; lock.openSetup('manual'); });
    on('#sk-bio-reg', 'click', async () => {
      const r = await auth.registerBiometric();
      toast(r.ok ? '생체인증을 등록했습니다' : (r.message || '생체인증을 쓸 수 없습니다'));
    });
    on('#sk-setup-x', 'click', () => { $('#sk-setup-modal').hidden = true; });
    on('#sk-setup-cancel', 'click', () => { $('#sk-setup-modal').hidden = true; });
    on('#sk-setup-save', 'click', async () => {
      const a = $('#sk-setup-pin').value, b = $('#sk-setup-pin2').value;
      const err = $('#sk-setup-err');
      if (a !== b) { if (err) { err.hidden = false; err.textContent = '두 PIN이 다릅니다.'; } return; }
      const r = await auth.registerPin(a);
      if (!r.ok) { if (err) { err.hidden = false; err.textContent = r.message; } return; }
      $('#sk-setup-modal').hidden = true;
      lock.arm();
      toast('잠금 PIN을 만들었습니다');
    });
    on('#sk-lock-open', 'click', () => lock.tryUnlock($('#sk-lock-pin').value));
    on('#sk-lock-pin', 'keydown', (e) => { if (e.key === 'Enter') lock.tryUnlock($('#sk-lock-pin').value); });
    on('#sk-lock-bio', 'click', () => lock.unlockBiometric());
    on('#sk-lock-fab', 'click', () => lock.lock('manual'));
    on('#sk-privacy-chip', 'click', () => privacy.setEnabled(!privacy.enabled()));

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      ['#smartkey-pc-modal', '#smartkey-phone-modal', '#smartkey-devices-modal', '#sk-setup-modal'].forEach((sel) => {
        const el = $(sel);
        if (el && !el.hidden) el.hidden = true;
      });
      phone.stopScan();
    });
  }

  /* ---------- 메뉴 연결 ---------- */
  function injectMenu() {
    const box = $('#more-menu .mm-tools');
    if (box && !$('#btn-smartkey-pc')) {
      const frag = document.createElement('div');
      frag.className = 'mm-sk';
      frag.innerHTML =
        '<button type="button" class="mm-btn" id="btn-smartkey-pc"><span aria-hidden="true">🔑</span> 스마트키로 PC 열기 <em>QR · 6자리 코드</em></button>' +
        '<button type="button" class="mm-btn" id="btn-smartkey-phone"><span aria-hidden="true">📱</span> PC 연결 (이 폰으로 승인) <em>마스터</em></button>' +
        '<button type="button" class="mm-btn" id="btn-smartkey-devices"><span aria-hidden="true">🖥</span> 기기 관리 · 원격 잠금 <em>최대 2대</em></button>';
      box.appendChild(frag);
    }
    const bind = (id, fn) => { const el = $('#' + id); if (el && !el.dataset.skBound) { el.dataset.skBound = '1'; el.addEventListener('click', fn); } };
    bind('btn-smartkey-pc', () => { pc.open(); });
    bind('btn-smartkey-phone', () => { phone.open(); });
    bind('btn-smartkey-devices', () => { devices.open(); });
  }

  /* ---------- 초기화 ---------- */
  async function init() {
    ensureModal('pc');
    injectMenu();
    privacy.installObserver();
    const prefs = prefsGet();
    privacy.refresh();
    const chip = $('#sk-privacy-chip');
    if (chip) chip.hidden = false;
    if (prefs.lockEnabled !== false) lock.arm();
    if (root.BojangApp) {
      const S = root.BojangApp.state;
      if (S && S.view === 'client') $('#sk-privacy-chip').hidden = false;
    }
    document.addEventListener('click', (e) => {
      const t = e.target.closest ? e.target.closest('[data-mode]') : null;
      if (t) root.setTimeout(() => privacy.refresh(), 60);
    });
    const resume = await pc.resume();
    if (resume && resume.reason === 'revoked') toast('이 PC 세션은 원격 잠금되었습니다');
    return { ok: true, version: VERSION, transport: server.mode() };
  }

  root.BojangSmartKey = {
    version: VERSION,
    init,
    securityWarnings,
    crypto: {
      genEcdh, genEcdsa, exportPubJwk, exportKeyJwk, importEcdsaPriv, signText, verifyText,
      deriveAes, aesEncrypt, aesDecrypt, sha256Hex, hashPin, checkPin, b64u, unb64u, rndBytes, randDigits
    },
    server: {
      mode: () => server.mode(),
      statusText: () => server.statusText(),
      createChallenge: (b) => server.createChallenge(b),
      getChallenge: (id) => server.getChallenge(id),
      peekByCode: (c) => server.peekByCode(c),
      approve: (b) => server.approve(b),
      reject: (b) => server.reject(b),
      cancel: (id) => server.cancel(id),
      poll: (id) => server.poll(id),
      session: (t) => server.session(t),
      devices: () => server.devices(),
      bind: (b) => server.bind(b),
      evict: (id) => server.evict(id),
      revoke: (t) => server.revoke(t),
      reset: () => local.reset(),
      _local: local
    },
    pc: {
      open: () => pc.open(), close: () => pc.close(), issue: () => pc.issue(),
      refresh: () => pc.issue(), resume: () => pc.resume(), poll: () => pc.pollOnce(),
      state: () => ({ status: pc.status, remain: pc.remain, challenge: pc.challenge, session: pc.session, inherited: pc.inherited, error: pc.error || '' }),
      challenge: () => pc.challenge, payload: () => (pc.challenge ? pc.payload(pc.challenge) : ''),
      pushOut: (id) => pc.pushOut(id), lockNow: () => pc.lockNow()
    },
    phone: {
      open: () => phone.open(), close: () => phone.close(),
      submitCode: (c) => phone.submitCode(c),
      onDecode: (t) => phone.onDecode(t),
      scanStart: () => phone.scanStart(), scanStop: () => phone.stopScan(),
      approveWithPin: (p) => phone.approveWithPin(p),
      approveWithBiometric: () => phone.approveWithBiometric(),
      reject: () => phone.reject(),
      step: () => phone.step,
      pending: () => phone.pending,
      device: () => phone.device(),
      authMethod: () => phone.authMethod(),
      parse: (t) => phone.payloadParse(t)
    },
    devices: { open: () => devices.open(), close: () => devices.close(), render: () => devices.render(), list: () => devices.list() },
    lock: {
      lock: (r) => lock.lock(r), unlock: (p) => lock.tryUnlock(p), unlockBiometric: () => lock.unlockBiometric(),
      isLocked: () => lock.locked, arm: () => lock.arm(), disarm: () => lock.disarm(),
      config: () => lock.config(), openSetup: (r) => lock.openSetup(r)
    },
    auth: {
      method: () => auth.method(), platformAvailable: () => auth.platformAvailable(),
      registerBiometric: () => auth.registerBiometric(), registerPin: (p) => auth.registerPin(p),
      hasPin: () => auth.hasPin(), setForce: (v) => { auth.__force = v; return v; }
    },
    privacy: {
      setEnabled: (v) => privacy.setEnabled(v), enabled: () => privacy.enabled(),
      maskName: (n) => privacy.maskName(n), maskText: (t) => privacy.maskText(t),
      refresh: () => privacy.refresh(), syncInputs: () => privacy.syncInputs()
    },
    prefs: {
      get: () => prefsGet(), set: (p) => prefsSet(p)
    },
    _internals: { local, transcriptChallenge, transcriptApprove, pubHashOf, devicePriv, TTL, ensureModal }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { init(); });
  else root.setTimeout(() => { init(); }, 0);
})(typeof window !== 'undefined' ? window : globalThis);
