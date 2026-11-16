/* 보장분석 라이프 리포트 v5.4 — 백엔드 연동 레이어 (backend.js)

   외부 SDK(CDN) 없이 fetch 만으로 Supabase 와 통신합니다.
   · Auth      : 이메일/비밀번호 회원가입 · 로그인 · 로그아웃 · 토큰 자동 갱신
   · PostgREST : clients(고객 스냅샷) · brand_settings(화이트라벨) 동기화 · subscriptions 조회
   · Functions : parse-coverage-vision(사진 AI 인식) · billing-subscribe(월 5,000 / 연 50,000)

   모드
   · beta-local   — SUPABASE_URL/ANON_KEY 가 비어 있음. v5.3 정적 베타와 완전히 동일하게 동작하고
                    계정·구독 UI 는 동선 확인용으로 열리며 어떤 요청도 밖으로 나가지 않습니다.
   · live-backend — 값이 채워졌거나 개발자 설정 패널의 연결 테스트를 통과. 로그인·동기화·비전·결제가 켜집니다.

   휘발 원칙: 촬영 이미지는 메모리에서 FormData 로 한 번 보내고 참조를 즉시 버립니다.
   저장소에는 세션 토큰(localStorage 'bojang.auth.v1')만 두고 사진·비밀번호는 저장하지 않습니다. */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');

  const CFG_KEY = 'bojang.backend.v1';      /* { url, anonKey, visionFn, billingFn } */
  const SESSION_KEY = 'bojang.auth.v1';     /* { access_token, refresh_token, expires_at, user } */
  const BETA_NOTICE = '현재 베타 오프라인 모드 · 서버 연결 시 클라우드 동기화 및 AI 사진 인식이 활성화됩니다';
  const LIVE_NOTICE = '실서버 연결됨 · 계정·구독·클라우드 동기화·AI 사진 인식이 활성화됩니다';
  const AUTH_REQUIRED = '서버에 연결되었습니다. 로그인하면 클라우드 동기화 · AI 사진 인식 · 구독 결제가 켜집니다.';

  const PRICE = {
    month: { key: 'month', label: '월 구독', amount: 5000, price: '월 5,000원', note: '매월 자동결제 · 언제든 해지' },
    year: { key: 'year', label: '연 구독', amount: 50000, price: '연 50,000원', note: '2개월 무료 · 월 4,167원' }
  };

  const VISION_PATH = '/functions/v1/parse-coverage-vision';
  const BILLING_PATH = '/functions/v1/billing-subscribe';

  function lsGet(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  function trimSlash(u) { return String(u || '').trim().replace(/\/+$/, ''); }

  /* =========================================================
     설정 · 모드
     ========================================================= */
  function readConfig() {
    const w = root.__BOJANG_CONFIG__ && typeof root.__BOJANG_CONFIG__ === 'object' ? root.__BOJANG_CONFIG__ : {};
    const saved = lsGet(CFG_KEY, {}) || {};
    const val = (k) => String(w[k] || saved[k] || '').trim();
    return {
      url: trimSlash(val('SUPABASE_URL')),
      anonKey: val('SUPABASE_ANON_KEY'),
      visionFn: trimSlash(val('VISION_FN')),
      billingFn: trimSlash(val('BILLING_FN'))
    };
  }

  let cfg = readConfig();
  let session = lsGet(SESSION_KEY, null);
  if (session && !session.access_token) session = null;

  const state = {
    mode: 'beta-local',
    connection: session ? 'unknown' : 'unknown',   /* unknown | ok | fail */
    message: '',
    checkedAt: 0,
    busy: false,
    lastError: '',
    subscription: null,                            /* { plan, status, billing_cycle, current_period_end } */
    plan: 'month'
  };

  function isLive() { return state.mode === 'live-backend'; }
  function hasSession() { return !!(session && session.access_token); }
  function user() { return session && session.user ? session.user : null; }
  function canUseVision() { return isLive() && hasSession() && !!functionUrl(VISION_PATH); }
  function mode() { return state.mode; }
  function notice() { return isLive() ? (hasSession() ? LIVE_NOTICE : AUTH_REQUIRED) : BETA_NOTICE; }

  function recomputeMode() {
    const live = !!(cfg.url && cfg.anonKey);
    state.mode = live ? 'live-backend' : 'beta-local';
    if (!live) { state.connection = 'unknown'; state.subscription = null; }
    return state.mode;
  }
  recomputeMode();

  function functionUrl(path) {
    if (path === VISION_PATH && cfg.visionFn) return cfg.visionFn;
    if (path === BILLING_PATH && cfg.billingFn) return cfg.billingFn;
    if (!cfg.url) return '';
    return cfg.url + path;
  }

  function configure(next) {
    const merged = Object.assign({}, lsGet(CFG_KEY, {}) || {}, next || {});
    merged.SUPABASE_URL = trimSlash(merged.SUPABASE_URL || '');
    merged.SUPABASE_ANON_KEY = String(merged.SUPABASE_ANON_KEY || '').trim();
    merged.VISION_FN = trimSlash(merged.VISION_FN || '');
    merged.BILLING_FN = trimSlash(merged.BILLING_FN || '');
    lsSet(CFG_KEY, merged);
    cfg = readConfig();
    const live = recomputeMode();
    render();
    if (live === 'live-backend') testConnection();
    return state.mode;
  }

  function clearConfig() {
    lsDel(CFG_KEY);
    session = null;
    lsDel(SESSION_KEY);
    cfg = readConfig();
    recomputeMode();
    render();
    return state.mode;
  }

  /* =========================================================
     Auth
     ========================================================= */
  function saveSession(payload) {
    if (!payload || !payload.access_token) return null;
    const expiresIn = Number(payload.expires_in || 3600);
    session = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || '',
      expires_at: Date.now() + expiresIn * 1000,
      user: payload.user ? { id: payload.user.id, email: payload.user.email } : (session && session.user) || null
    };
    lsSet(SESSION_KEY, session);
    return session;
  }

  function clearSession() {
    session = null;
    lsDel(SESSION_KEY);
    state.subscription = null;
  }

  async function request(path, opts) {
    opts = opts || {};
    const url = cfg.url + path;
    const headers = Object.assign({
      apikey: cfg.anonKey,
      Authorization: 'Bearer ' + (opts.token || cfg.anonKey)
    }, opts.headers || {});
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(url, {
        method: opts.method || 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      });
    } catch (e) {
      return { ok: false, status: 0, error: 'network', message: '서버에 연결하지 못했습니다.' };
    }
    let data = null;
    const text = await res.text().catch(() => '');
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) {
      const msg = (data && (data.msg || data.error_description || data.message || data.error)) || ('HTTP ' + res.status);
      return { ok: false, status: res.status, error: String(msg), message: String(msg), data };
    }
    return { ok: true, status: res.status, data };
  }

  function authError(res) {
    const raw = String(res.error || res.message || '');
    const map = [
      [/invalid login credentials/i, '이메일 또는 비밀번호가 맞지 않습니다.'],
      [/email not confirmed/i, '이메일 확인이 필요합니다. 메일함의 확인 링크를 눌러 주세요.'],
      [/user already registered|already been registered/i, '이미 가입된 이메일입니다. 로그인해 주세요.'],
      [/password should be at least/i, '비밀번호는 6자 이상이어야 합니다.'],
      [/unable to validate email|invalid format/i, '이메일 형식을 확인해 주세요.'],
      [/rate limit|too many/i, '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.']
    ];
    for (const [re, msg] of map) if (re.test(raw)) return msg;
    return raw || '요청을 처리하지 못했습니다.';
  }

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()); }

  async function signUp(email, password) {
    if (!isLive()) return { ok: false, reason: 'beta-local', message: BETA_NOTICE };
    if (!validEmail(email)) return { ok: false, reason: 'invalid-email', message: '이메일 형식을 확인해 주세요.' };
    if (String(password || '').length < 6) return { ok: false, reason: 'weak-password', message: '비밀번호는 6자 이상으로 정해 주세요.' };
    state.busy = true; render();
    const res = await request('/auth/v1/signup', { method: 'POST', body: { email: String(email).trim(), password } });
    state.busy = false;
    if (!res.ok) { state.lastError = authError(res); render(); return { ok: false, reason: 'signup-failed', message: state.lastError }; }
    state.lastError = '';
    const body = res.data || {};
    const confirmed = !!(body.access_token && body.user);
    if (confirmed) { saveSession(body); await afterAuth(); }
    render();
    return {
      ok: true,
      confirmed,
      message: confirmed ? '가입과 로그인이 완료되었습니다.' : '가입되었습니다. 메일함의 확인 링크를 누른 뒤 로그인해 주세요.'
    };
  }

  async function signIn(email, password) {
    if (!isLive()) return { ok: false, reason: 'beta-local', message: BETA_NOTICE };
    if (!validEmail(email)) return { ok: false, reason: 'invalid-email', message: '이메일 형식을 확인해 주세요.' };
    if (!String(password || '')) return { ok: false, reason: 'no-password', message: '비밀번호를 입력해 주세요.' };
    state.busy = true; render();
    const res = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: String(email).trim(), password } });
    state.busy = false;
    if (!res.ok) { state.lastError = authError(res); render(); return { ok: false, reason: 'signin-failed', message: state.lastError }; }
    state.lastError = '';
    saveSession(res.data);
    await afterAuth();
    render();
    return { ok: true, message: '로그인했습니다.' };
  }

  async function signOut() {
    if (isLive() && hasSession()) {
      await request('/auth/v1/logout', { method: 'POST', token: session.access_token });
    }
    clearSession();
    if (root.BojangPlan && root.BojangPlan.hydrate) root.BojangPlan.hydrate(null);
    render();
    return { ok: true, message: '로그아웃했습니다. 이 기기의 상담 기록은 그대로 남아 있습니다.' };
  }

  async function refreshSession() {
    if (!isLive() || !session || !session.refresh_token) return false;
    if (session.expires_at && session.expires_at - Date.now() > 60 * 1000) return true;
    const res = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: { refresh_token: session.refresh_token }
    });
    if (!res.ok) { clearSession(); render(); return false; }
    saveSession(res.data);
    return true;
  }

  async function authToken() {
    if (!hasSession()) return null;
    if (!(await refreshSession())) return session ? session.access_token : null;
    return session.access_token;
  }

  async function afterAuth() {
    render();
    await refreshEntitlements();
    /* 기기 브랜드가 기본값 그대로일 때만 서버 브랜드를 내려받습니다(로컬 편집 덮어쓰기 방지) */
    try { await pullBrandSettings({ onlyIfDefault: true }); } catch (e) { /* 오프라인 */ }
  }

  /* =========================================================
     연결 테스트
     ========================================================= */
  async function testConnection() {
    if (!isLive()) {
      state.connection = 'unknown';
      state.message = BETA_NOTICE;
      render();
      return { ok: false, reason: 'beta-local', message: BETA_NOTICE };
    }
    state.busy = true; state.message = '연결을 확인하고 있습니다…'; render();
    let ok = false;
    let detail = '';
    try {
      const res = await fetch(cfg.url + '/auth/v1/health', { headers: { apikey: cfg.anonKey } });
      ok = res.ok;
      detail = 'auth/v1/health ' + res.status;
      if (!ok) {
        const r2 = await fetch(cfg.url + '/rest/v1/', { headers: { apikey: cfg.anonKey } });
        ok = r2.status === 200 || r2.status === 404 || r2.status === 400;
        detail = 'rest/v1 ' + r2.status;
      }
    } catch (e) {
      ok = false;
      detail = 'network';
    }
    state.busy = false;
    state.connection = ok ? 'ok' : 'fail';
    state.checkedAt = Date.now();
    state.message = ok
      ? '연결됨 · 실서버 모드 (' + detail + ')'
      : '연결하지 못했습니다 — URL·anon key 를 확인해 주세요 (' + detail + ')';
    if (ok) {
      /* 연결에 성공하면 개발자 설정 패널은 접어 둡니다(필요하면 다시 열 수 있음) */
      const panel = $('#acct-dev-panel');
      if (panel) panel.hidden = true;
    }
    render();
    if (ok && hasSession()) refreshEntitlements();
    return { ok, message: state.message };
  }

  /* =========================================================
     PostgREST — 구독 조회 · 고객/브랜드 동기화
     ========================================================= */
  async function selectRows(table, query, opts) {
    const token = await authToken();
    if (!token) return { ok: false, reason: 'auth-required', message: AUTH_REQUIRED };
    const res = await request('/rest/v1/' + table + (query ? '?' + query : ''), {
      token, headers: { Accept: 'application/json', ...(opts && opts.headers) }
    });
    return res.ok ? { ok: true, rows: Array.isArray(res.data) ? res.data : [] } : { ok: false, reason: 'rest', message: authError(res) };
  }

  async function upsertRows(table, row, onConflict) {
    const token = await authToken();
    if (!token) return { ok: false, reason: 'auth-required', message: AUTH_REQUIRED };
    const q = onConflict ? '?on_conflict=' + encodeURIComponent(onConflict) : '';
    return request('/rest/v1/' + table + q, {
      method: 'POST', token,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal', Accept: 'application/json' },
      body: row
    });
  }

  async function patchRow(table, id, patch) {
    const token = await authToken();
    if (!token) return { ok: false, reason: 'auth-required', message: AUTH_REQUIRED };
    return request('/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH', token, headers: { Prefer: 'return=minimal' }, body: patch
    });
  }

  async function insertRow(table, row) {
    const token = await authToken();
    if (!token) return { ok: false, reason: 'auth-required', message: AUTH_REQUIRED };
    return request('/rest/v1/' + table, {
      method: 'POST', token, headers: { Prefer: 'return=representation', Accept: 'application/json' }, body: row
    });
  }

  /** subscriptions 는 본인 행만 읽을 수 있습니다(서버 RLS). 결과를 BojangPlan 에 넘깁니다. */
  async function refreshEntitlements() {
    if (!isLive() || !hasSession()) return null;
    const uid = user() && user().id;
    const res = await selectRows('subscriptions',
      'select=plan,status,billing_cycle,current_period_end,price_krw&user_id=eq.' + encodeURIComponent(uid || '') +
      '&order=created_at.desc&limit=1');
    if (!res.ok) return null;
    const row = (res.rows && res.rows[0]) || null;
    state.subscription = row;
    if (row && row.billing_cycle) state.plan = row.billing_cycle === 'year' ? 'year' : 'month';
    if (root.BojangPlan && root.BojangPlan.hydrate) {
      root.BojangPlan.hydrate(row ? {
        plan: row.plan, status: row.status, billing_cycle: row.billing_cycle,
        current_period_end: row.current_period_end
      } : null);
    }
    render();
    return row;
  }

  /** 상담 1건 → clients 행 1건 (로컬 id 기준 upsert) */
  async function syncClient(entry) {
    if (!isLive() || !hasSession() || !entry) return { ok: false, reason: 'offline' };
    const uid = user() && user().id;
    if (!uid) return { ok: false, reason: 'auth-required' };
    const display = String(entry.label || entry.client && entry.client.name || '고객').slice(0, 40) || '고객';
    const payload = {
      local_id: String(entry.id || ''),
      score: entry.score != null ? entry.score : null,
      letter: entry.letter || null,
      saved_at: entry.savedAt || new Date().toISOString(),
      premium: entry.inputs ? entry.inputs.premium : null,
      silson: entry.inputs ? entry.inputs.silson : null,
      age: entry.inputs ? entry.inputs.age : null,
      gender: entry.inputs ? entry.inputs.gender : null
    };
    const found = await selectRows('clients', 'select=id&user_id=eq.' + encodeURIComponent(uid) +
      '&display_name=eq.' + encodeURIComponent(display) + '&limit=1');
    if (found.ok && found.rows.length) {
      const r = await patchRow('clients', found.rows[0].id, { payload, status: 'active' });
      return { ok: r.ok, reason: r.ok ? 'updated' : 'rest-error' };
    }
    const r = await insertRow('clients', {
      user_id: uid, display_name: display, payload, status: 'active',
      last_contact_at: new Date().toISOString()
    });
    return { ok: r.ok, reason: r.ok ? 'created' : 'rest-error' };
  }

  async function pushBrandSettings(brand) {
    if (!isLive() || !hasSession() || !brand) return { ok: false, reason: 'offline' };
    const uid = user() && user().id;
    const row = {
      user_id: uid,
      name: String(brand.name || '').slice(0, 40) || '보장분석 라이프 리포트',
      slogan: String(brand.slogan || '').slice(0, 80),
      consultant: brand.consultant || null,
      title: brand.title || null,
      phone: brand.phone || null,
      kakao: brand.kakao || null,
      theme: brand.theme || 'navy',
      logo_data: brand.logo || null
    };
    const res = await upsertRows('brand_settings', row, 'user_id');
    return { ok: res.ok, reason: res.ok ? 'saved' : 'rest-error' };
  }

  function brandIsDefault() {
    const B = root.BojangBrand;
    if (!B || !B.get) return false;
    const b = B.get() || {};
    const d = B.defaultBrand || {};
    return !b.logo && (!b.name || b.name === d.name) && (!b.slogan || b.slogan === d.slogan)
      && !b.consultant && !b.phone && !b.kakao;
  }

  async function pullBrandSettings(opts) {
    opts = opts || {};
    if (!isLive() || !hasSession()) return { ok: false, reason: 'offline' };
    if (opts.onlyIfDefault && !brandIsDefault()) return { ok: false, reason: 'local-edited' };
    const uid = user() && user().id;
    const res = await selectRows('brand_settings', 'select=*&user_id=eq.' + encodeURIComponent(uid || '') + '&limit=1');
    if (!res.ok || !res.rows.length) return { ok: false, reason: 'empty' };
    const row = res.rows[0];
    if (root.BojangBrand && root.BojangBrand.save) {
      root.BojangBrand.save({
        name: row.name, slogan: row.slogan, consultant: row.consultant || '', title: row.title || '',
        phone: row.phone || '', kakao: row.kakao || '', theme: row.theme || 'navy', logo: row.logo_data || ''
      }, { silent: true });
    }
    return { ok: true };
  }

  /* =========================================================
     Edge Function — AI 비전 (메모리 처리 · 저장 없음)
     ========================================================= */
  async function parseCoverageVision(blob, opts) {
    opts = opts || {};
    if (!isLive()) return { ok: false, reason: 'beta-local', items: [], premium: null, silson: null, message: BETA_NOTICE };
    if (!hasSession()) return { ok: false, reason: 'auth-required', items: [], premium: null, silson: null, message: '사진 AI 인식은 로그인 후 사용할 수 있습니다.' };
    const url = functionUrl(VISION_PATH);
    if (!url || !blob) return { ok: false, reason: 'no-endpoint', items: [], premium: null, silson: null, message: '비전 서버 주소가 설정되지 않았습니다.' };

    const token = await authToken();
    const form = new FormData();
    form.append('image', blob, opts.filename || 'capture.jpg');
    if (opts.hint) form.append('hint', String(opts.hint));

    let res = null;
    let netError = null;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (token || cfg.anonKey), apikey: cfg.anonKey },
        body: form,
        cache: 'no-store',
        credentials: 'omit'
      });
    } catch (e) {
      netError = e;
    }
    /* 전송 후 참조 즉시 해제 — 이미지는 어디에도 저장하지 않습니다 */
    try { form.delete('image'); } catch (e) {}
    opts = null;

    if (netError || !res) {
      return { ok: false, reason: 'network', items: [], premium: null, silson: null, message: '비전 서버에 연결하지 못했습니다.' };
    }
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch (e) { body = null; }
      const code = body && body.error ? body.error : 'http-' + res.status;
      const msg = body && body.message ? body.message : ('비전 서버 응답 오류 (' + res.status + ')');
      return { ok: false, reason: code, items: [], premium: null, silson: null, message: msg };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!data) return { ok: false, reason: 'bad-json', items: [], premium: null, silson: null, message: '비전 서버 응답을 읽지 못했습니다.' };

    const meta = { model: data.model || '', ms: data.ms || null, persisted: data.persisted === true, source: 'vision' };
    if (data.text && root.BojangImport && root.BojangImport.parseCoverageText) {
      const parsed = root.BojangImport.parseCoverageText(data.text);
      return Object.assign({ ok: true, text: data.text }, parsed, meta, { message: '' });
    }
    if (Array.isArray(data.items) && data.items.length) {
      return Object.assign({
        ok: true, items: data.items, premium: data.premium != null ? data.premium : null,
        silson: data.silson != null ? data.silson : null, text: data.text || ''
      }, meta);
    }
    return { ok: false, reason: data.error || 'empty', items: [], premium: null, silson: null, message: '비전 서버가 담보 항목을 돌려주지 않았습니다.' };
  }

  /* =========================================================
     Edge Function — 구독 시작 (월 5,000 / 연 50,000)
     ========================================================= */
  async function subscribe(planKey) {
    const key = planKey === 'year' ? 'year' : 'month';
    if (!isLive()) {
      return { ok: false, reason: 'beta-local', message: BETA_NOTICE + '. 서버 연결 후 실제 결제가 진행됩니다.' };
    }
    if (!hasSession()) return { ok: false, reason: 'auth-required', message: '구독은 로그인 후 시작할 수 있습니다.' };
    const url = functionUrl(BILLING_PATH);
    if (!url) return { ok: false, reason: 'no-endpoint', message: '결제 서버 주소가 설정되지 않았습니다.' };
    state.busy = true; state.message = '구독 결제를 진행하고 있습니다…'; render();
    let out;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + (await authToken() || cfg.anonKey),
          apikey: cfg.anonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ plan: key })
      });
      out = { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
    } catch (e) {
      out = { ok: false, status: 0, message: '결제 서버에 연결하지 못했습니다.' };
    }
    state.busy = false;
    if (!out.ok) {
      const msg = (out.data && (out.data.message || out.data.error)) || out.message || '결제를 시작하지 못했습니다.';
      state.message = msg; render();
      return { ok: false, reason: 'billing-failed', message: msg };
    }
    const data = out.data || {};
    state.subscription = {
      plan: data.plan || 'pro', status: data.status || 'active', billing_cycle: data.billing_cycle || key,
      current_period_end: data.current_period_end || null, price_krw: data.price_krw || PRICE[key].amount
    };
    if (root.BojangPlan && root.BojangPlan.hydrate) {
      root.BojangPlan.hydrate({ plan: 'pro', status: state.subscription.status, billing_cycle: state.subscription.billing_cycle, current_period_end: state.subscription.current_period_end });
    }
    state.message = data.test
      ? '테스트 모드로 Pro 구독을 켰습니다 (실제 결제 없음).'
      : 'Pro 구독이 시작되었습니다 — ' + PRICE[key].price;
    render();
    return { ok: true, test: !!data.test, message: state.message, subscription: state.subscription };
  }

  /* =========================================================
     계정 / 구독 모달
     ========================================================= */
  let authMode = 'signin';   /* signin | signup */
  let msgTone = '';

  function setMessage(text, tone) {
    state.message = text || '';
    msgTone = tone || '';
    const el = $('#acct-msg');
    if (el) {
      el.textContent = state.message;
      el.className = 'acct-msg' + (msgTone ? ' tone-' + msgTone : '');
    }
  }

  function statusChip() {
    if (!isLive()) return { cls: 'is-beta', label: '베타 오프라인 모드', icon: '•' };
    if (state.connection === 'ok') return { cls: 'is-live', label: '실서버 연결됨', icon: '●' };
    if (state.connection === 'fail') return { cls: 'is-fail', label: '연결 실패', icon: '!' };
    return { cls: 'is-check', label: '연결 확인 중', icon: '…' };
  }

  function ensureModal() {
    if ($('#account-modal')) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal acct-modal';
    wrap.id = 'account-modal';
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="modal-card acct-card" role="dialog" aria-modal="true" aria-labelledby="acct-title">
        <button type="button" class="pw-x" id="acct-x" aria-label="닫기">×</button>
        <span class="pw-eyebrow">ACCOUNT · SUBSCRIPTION</span>
        <strong id="acct-title">👤 계정 / 구독</strong>

        <div class="acct-server" id="acct-server">
          <div class="acct-server-top">
            <span class="acct-chip" id="acct-chip">베타 오프라인 모드</span>
            <button type="button" class="acct-mini" id="acct-test">연결 테스트</button>
            <button type="button" class="acct-mini" id="acct-dev">개발자 설정</button>
          </div>
          <p class="acct-server-note" id="acct-server-note"></p>
        </div>

        <div class="acct-dev-panel" id="acct-dev-panel" hidden>
          <label class="acct-label" for="acct-url">SUPABASE_URL</label>
          <input type="url" id="acct-url" class="acct-input" placeholder="https://abcd1234.supabase.co" autocomplete="off" spellcheck="false">
          <label class="acct-label" for="acct-key">SUPABASE_ANON_KEY</label>
          <input type="text" id="acct-key" class="acct-input" placeholder="eyJhbGciOi..." autocomplete="off" spellcheck="false">
          <div class="acct-dev-row">
            <button type="button" class="acct-btn primary" id="acct-save">저장 · 연결</button>
            <button type="button" class="acct-btn ghost" id="acct-clear">연결 해제</button>
          </div>
          <p class="acct-note">값은 이 브라우저(localStorage)에만 저장되고, anon key 는 공개 키입니다. service_role 키는 절대 넣지 마세요.</p>
        </div>

        <div class="acct-signedout" id="acct-signedout">
          <div class="acct-tabs" role="tablist" aria-label="로그인 또는 회원가입">
            <button type="button" class="acct-tab is-on" data-authtab="signin" role="tab" aria-selected="true">로그인</button>
            <button type="button" class="acct-tab" data-authtab="signup" role="tab" aria-selected="false">회원가입</button>
          </div>
          <form class="acct-form" id="acct-form" novalidate>
            <label class="acct-label" for="acct-email">이메일</label>
            <input type="email" id="acct-email" class="acct-input" placeholder="fc@example.com" autocomplete="username" inputmode="email">
            <label class="acct-label" for="acct-pw">비밀번호 <span id="acct-pw-hint">6자 이상</span></label>
            <input type="password" id="acct-pw" class="acct-input" placeholder="••••••" autocomplete="current-password">
            <button type="submit" class="acct-btn primary" id="acct-submit">로그인</button>
          </form>
        </div>

        <div class="acct-signedin" id="acct-signedin" hidden>
          <div class="acct-user">
            <span class="acct-avatar" aria-hidden="true">👤</span>
            <span class="acct-user-main"><b id="acct-email-view">-</b><em id="acct-user-sub">로그인됨</em></span>
            <button type="button" class="acct-mini" id="acct-signout">로그아웃</button>
          </div>
        </div>

        <div class="acct-sub" id="acct-sub">
          <div class="acct-sub-head"><b>Pro 구독</b><span id="acct-sub-state">미구독</span></div>
          <div class="acct-plans" role="radiogroup" aria-label="구독 플랜">
            <button type="button" class="acct-plan is-on" data-acctplan="month" aria-pressed="true">
              <span class="acct-plan-top"><b>월 구독</b><i>월 5,000원</i></span>
              <span class="acct-plan-note">매월 자동결제 · 언제든 해지</span>
            </button>
            <button type="button" class="acct-plan" data-acctplan="year" aria-pressed="false">
              <span class="acct-plan-top"><b>연 구독</b><i>연 50,000원</i></span>
              <span class="acct-plan-note">2개월 무료 · 월 4,167원</span>
            </button>
          </div>
          <button type="button" class="acct-btn primary" id="acct-pay">구독 시작 · 월 5,000원</button>
          <p class="acct-note" id="acct-pay-note">베타 기간에는 Pro 전 기능이 무료입니다. 서버 연결 후 이 버튼으로 빌링키 정기결제가 시작됩니다.</p>
        </div>

        <p class="acct-msg" id="acct-msg" role="status" aria-live="polite"></p>
        <p class="acct-note">이 기기의 상담 기록은 로그아웃해도 그대로 남습니다. 클라우드 동기화는 로그인 후 직접 실행합니다.</p>
      </div>`;
    document.body.appendChild(wrap);

    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeAccount(); });
    $('#acct-x').addEventListener('click', closeAccount);
    $('#acct-test').addEventListener('click', () => testConnection());
    $('#acct-dev').addEventListener('click', () => {
      const p = $('#acct-dev-panel');
      if (!p) return;
      p.hidden = !p.hidden;
      if (!p.hidden) {
        if ($('#acct-url')) $('#acct-url').value = cfg.url || '';
        if ($('#acct-key')) $('#acct-key').value = cfg.anonKey || '';
      }
    });
    $('#acct-save').addEventListener('click', () => {
      const url = ($('#acct-url') && $('#acct-url').value) || '';
      const key = ($('#acct-key') && $('#acct-key').value) || '';
      if (!url || !key) { setMessage('SUPABASE_URL 과 SUPABASE_ANON_KEY 를 모두 입력해 주세요.', 'warn'); return; }
      if (!/^https?:\/\//.test(url)) { setMessage('URL 은 https:// 로 시작해야 합니다.', 'warn'); return; }
      configure({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key });
      setMessage('설정을 저장했습니다. 연결을 확인합니다…', 'ok');
    });
    $('#acct-clear').addEventListener('click', () => {
      clearConfig();
      setMessage('연결을 해제하고 베타 오프라인 모드로 돌아왔습니다.', 'ok');
    });

    $$('[data-authtab]', wrap).forEach((b) => {
      b.addEventListener('click', () => {
        authMode = b.dataset.authtab === 'signup' ? 'signup' : 'signin';
        renderAuthMode();
      });
    });

    $('#acct-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = ($('#acct-email') && $('#acct-email').value) || '';
      const pw = ($('#acct-pw') && $('#acct-pw').value) || '';
      if (!validEmail(email)) { setMessage('이메일 형식을 확인해 주세요.', 'warn'); return; }
      if (String(pw).length < (authMode === 'signup' ? 6 : 1)) {
        setMessage(authMode === 'signup' ? '비밀번호는 6자 이상으로 정해 주세요.' : '비밀번호를 입력해 주세요.', 'warn');
        return;
      }
      if (!isLive()) {
        setMessage(BETA_NOTICE + '. 입력값은 서버로 전송되지 않았습니다.', 'info');
        return;
      }
      setMessage(authMode === 'signup' ? '가입을 처리하고 있습니다…' : '로그인 중입니다…', 'work');
      const res = authMode === 'signup' ? await signUp(email, pw) : await signIn(email, pw);
      setMessage(res.message || '', res.ok ? 'ok' : 'warn');
      if (res.ok) { if ($('#acct-pw')) $('#acct-pw').value = ''; render(); }
    });

    $('#acct-signout').addEventListener('click', async () => {
      const res = await signOut();
      setMessage(res.message, 'ok');
    });

    $$('[data-acctplan]', wrap).forEach((b) => {
      b.addEventListener('click', () => {
        state.plan = b.dataset.acctplan === 'year' ? 'year' : 'month';
        $$('[data-acctplan]', wrap).forEach((x) => {
          const on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-pressed', String(on));
        });
        renderPay();
      });
    });

    $('#acct-pay').addEventListener('click', async () => {
      const res = await subscribe(state.plan);
      setMessage(res.message, res.ok ? 'ok' : (res.reason === 'beta-local' ? 'info' : 'warn'));
    });
  }

  function renderAuthMode() {
    const wrap = $('#account-modal');
    if (!wrap) return;
    $$('[data-authtab]', wrap).forEach((b) => {
      const on = b.dataset.authtab === authMode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    const submit = $('#acct-submit');
    if (submit) submit.textContent = authMode === 'signup' ? '회원가입' : '로그인';
    const pw = $('#acct-pw');
    if (pw) pw.setAttribute('autocomplete', authMode === 'signup' ? 'new-password' : 'current-password');
    const hint = $('#acct-pw-hint');
    if (hint) hint.textContent = authMode === 'signup' ? '6자 이상' : '입력';
  }

  function renderPay() {
    const btn = $('#acct-pay');
    if (!btn) return;
    const p = PRICE[state.plan] || PRICE.month;
    const sub = state.subscription;
    const active = sub && (sub.status === 'active' || sub.status === 'trialing') && sub.plan === 'pro';
    btn.textContent = active ? 'Pro 구독 사용 중 · ' + (sub.billing_cycle === 'year' ? PRICE.year.price : PRICE.month.price) : '구독 시작 · ' + p.price;
    btn.disabled = !!state.busy;
  }

  function render() {
    const badge = $('#acct-chip');
    const chip = statusChip();
    if (badge) {
      badge.textContent = chip.icon + ' ' + chip.label;
      badge.className = 'acct-chip ' + chip.cls;
    }
    const note = $('#acct-server-note');
    if (note) note.textContent = state.message || notice();

    const btns = $$('[data-account]');
    btns.forEach((b) => {
      const label = b.querySelector('[data-acct-label]');
      if (label) label.textContent = hasSession() && user() && user().email ? user().email.split('@')[0] : '계정';
    });
    const hubSub = $('#acct-hub-sub');
    if (hubSub) {
      hubSub.textContent = isLive()
        ? (hasSession() ? '실서버 · ' + (user() && user().email ? user().email : '로그인됨') : '실서버 · 로그인 필요')
        : '로그인 · 구독 상태 · 서버 연결';
    }

    const so = $('#acct-signedout');
    const si = $('#acct-signedin');
    if (so) so.hidden = hasSession();
    if (si) si.hidden = !hasSession();
    if (hasSession() && user()) {
      const ev = $('#acct-email-view');
      if (ev) ev.textContent = user().email || user().id || '-';
      const us = $('#acct-user-sub');
      if (us) us.textContent = isLive() ? (state.connection === 'ok' ? '실서버 연결됨 · 동기화 가능' : '로그인됨') : '베타 오프라인 모드';
    }

    const stateEl = $('#acct-sub-state');
    if (stateEl) {
      const sub = state.subscription;
      if (!hasSession()) stateEl.textContent = isLive() ? '로그인 후 확인' : '서버 연결 후 확인';
      else if (!sub) stateEl.textContent = '미구독 (베타 무료 사용 중)';
      else {
        const tail = sub.current_period_end ? ' · ~' + String(sub.current_period_end).slice(0, 10) : '';
        stateEl.textContent = (sub.plan === 'pro' ? 'Pro' : 'Free') + ' · ' + (sub.status || '-') + tail;
      }
    }
    $$('[data-acctplan]').forEach((x) => {
      const on = x.dataset.acctplan === state.plan;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', String(on));
    });
    renderPay();
    renderAuthMode();
  }

  function openAccount(tab) {
    ensureModal();
    if (tab === 'signup' || tab === 'signin') authMode = tab;
    const el = $('#account-modal');
    if (!el) return;
    el.hidden = false;
    setMessage(isLive() ? (state.connection === 'ok' ? LIVE_NOTICE : '연결 상태를 확인해 주세요.') : BETA_NOTICE, isLive() ? 'ok' : 'info');
    render();
    const first = $('#acct-email');
    if (first && !hasSession()) { try { first.focus({ preventScroll: true }); } catch (e) {} }
  }

  function closeAccount() {
    const el = $('#account-modal');
    if (el) el.hidden = true;
  }

  /* =========================================================
     초기화
     ========================================================= */
  function init() {
    recomputeMode();
    document.addEventListener('click', (e) => {
      const open = e.target.closest('[data-account]');
      if (open) { e.preventDefault(); openAccount(open.dataset.account); return; }
    });
    document.addEventListener('keydown', (e) => {
      const el = $('#account-modal');
      if (e.key === 'Escape' && el && !el.hidden) closeAccount();
    });
    if (isLive() && hasSession()) {
      refreshSession().then(() => refreshEntitlements());
    }
    render();
    return { mode: state.mode, live: isLive() };
  }

  root.BojangBackend = {
    init, configure, clearConfig, testConnection,
    mode, isLive, hasSession, user, canUseVision, notice,
    signUp, signIn, signOut, refreshSession, refreshEntitlements,
    selectRows, insertRow, upsertRows, patchRow,
    syncClient, pushBrandSettings, pullBrandSettings,
    parseCoverageVision, subscribe,
    openAccount, closeAccount, render,
    BETA_NOTICE, LIVE_NOTICE, AUTH_REQUIRED, PRICE, CFG_KEY, SESSION_KEY,
    state: () => ({ mode: state.mode, connection: state.connection, message: state.message, busy: state.busy, subscription: state.subscription, plan: state.plan }),
    config: () => Object.assign({}, cfg)
  };
})(typeof window !== 'undefined' ? window : globalThis);
