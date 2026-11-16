/* 보장분석 라이프 리포트 v5.9 — IndexedDB 저장소 (storage-idb.js)

   v5.9: 상담 이력(대용량·다고객)을 IndexedDB 로 옮깁니다.
   · localStorage 'bojang.history.v4' 에 쌓이던 고객명·생년월일·담보 금액·계약 스냅샷을
     더 이상 localStorage 에 두지 않습니다 (이관 후 옛 키는 삭제).
   · 외부 라이브러리(Dexie) 없이 순수 JS 로 같은 모양의 API 를 제공합니다.
       await BojangStore.table('history').put(row)
       await BojangStore.table('history').bulkPut(rows)
       await BojangStore.table('history').toArray()
       await BojangStore.table('history').get(id) / delete(id) / clear() / count()
       await BojangStore.table('history').where('savedAt').below(x).toArray()
   · IndexedDB 를 쓸 수 없는 환경(사생활 보호 모드·일부 file://)은
     예전과 같은 localStorage 키로 안전하게 폴백합니다 (mode() === 'local').

   저장 구조
     DB  bojang-guide (version 1)
       history  keyPath 'id'  index 'savedAt'
       meta     keyPath 'key' (마이그레이션 표시)
*/
(function (root) {
  'use strict';

  const DB_NAME = 'bojang-guide';
  const DB_VERSION = 1;
  const LEGACY_HISTORY = 'bojang.history.v4';
  const MIGRATED_KEY = 'bojang.idb.v1';
  const OPEN_TIMEOUT_MS = 2500;

  let opening = null;
  let mode = 'pending';   /* 'idb' | 'local' */

  function lsGet(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (e) { /* noop */ }
  }
  function lsRaw(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function idbFactory() {
    try { return root.indexedDB || root.mozIndexedDB || root.webkitIndexedDB || null; }
    catch (e) { return null; }
  }

  function open() {
    if (opening) return opening;
    const factory = idbFactory();
    if (!factory) { mode = 'local'; opening = Promise.resolve(null); return opening; }
    opening = new Promise((resolve) => {
      let settled = false;
      const done = (db) => {
        if (settled) return;
        settled = true;
        mode = db ? 'idb' : 'local';
        resolve(db || null);
      };
      let req;
      try { req = factory.open(DB_NAME, DB_VERSION); } catch (e) { done(null); return; }
      /* 사생활 보호 모드 등에서 열림 이벤트가 오지 않는 경우를 대비한 안전장치 */
      setTimeout(() => done(null), OPEN_TIMEOUT_MS);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('history')) {
          const st = db.createObjectStore('history', { keyPath: 'id' });
          st.createIndex('savedAt', 'savedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => done(req.result);
      req.onerror = () => done(null);
      req.onblocked = () => done(null);
    });
    return opening;
  }

  function ready() { return open().then((db) => !!db); }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('idb error'));
    });
  }

  /* ---------- localStorage 폴백용 같은 모양 테이블 ---------- */
  function localHistoryTable() {
    const read = () => lsGet(LEGACY_HISTORY, []) || [];
    return {
      put(row) {
        const next = read().filter((x) => x && x.id !== row.id);
        next.unshift(row);
        lsSet(LEGACY_HISTORY, next);
        return Promise.resolve(row.id);
      },
      bulkPut(rows) { lsSet(LEGACY_HISTORY, rows || []); return Promise.resolve(true); },
      get(id) { return Promise.resolve(read().find((x) => x.id === id) || undefined); },
      toArray() { return Promise.resolve(read()); },
      delete(id) { lsSet(LEGACY_HISTORY, read().filter((x) => x.id !== id)); return Promise.resolve(true); },
      clear() { lsDel(LEGACY_HISTORY); return Promise.resolve(true); },
      count() { return Promise.resolve(read().length); }
    };
  }

  function localMetaTable() {
    const KEY = 'bojang.idb.meta.v1';
    return {
      put(row) { const cur = lsGet(KEY, {}) || {}; cur[row.key] = row.value; lsSet(KEY, cur); return Promise.resolve(row.key); },
      bulkPut(rows) { const cur = lsGet(KEY, {}) || {}; (rows || []).forEach((r) => { cur[r.key] = r.value; }); lsSet(KEY, cur); return Promise.resolve(true); },
      get(key) { const cur = lsGet(KEY, {}) || {}; return Promise.resolve(cur[key] === undefined ? undefined : { key, value: cur[key] }); },
      toArray() { const cur = lsGet(KEY, {}) || {}; return Promise.resolve(Object.keys(cur).map((k) => ({ key: k, value: cur[k] }))); },
      delete(key) { const cur = lsGet(KEY, {}) || {}; delete cur[key]; lsSet(KEY, cur); return Promise.resolve(true); },
      clear() { lsDel(KEY); return Promise.resolve(true); },
      count() { return Promise.resolve(Object.keys(lsGet(KEY, {}) || {}).length); }
    };
  }

  /* ---------- Dexie 스타일 테이블 ---------- */
  function table(name) {
    if (name !== 'history' && name !== 'meta') throw new Error('unknown store: ' + name);
    const api = {
      name,
      async put(row) {
        const db = await open();
        if (!db) return (name === 'history' ? localHistoryTable() : localMetaTable()).put(row);
        return wrap(db.transaction(name, 'readwrite').objectStore(name).put(row));
      },
      async bulkPut(rows) {
        const db = await open();
        if (!db) return (name === 'history' ? localHistoryTable() : localMetaTable()).bulkPut(rows);
        const t = db.transaction(name, 'readwrite');
        const st = t.objectStore(name);
        (rows || []).forEach((r) => st.put(r));
        return new Promise((resolve, reject) => {
          t.oncomplete = () => resolve(true);
          t.onerror = () => reject(t.error || new Error('idb error'));
          t.onabort = () => reject(t.error || new Error('idb abort'));
        });
      },
      async get(id) {
        const db = await open();
        if (!db) return (name === 'history' ? localHistoryTable() : localMetaTable()).get(id);
        return wrap(db.transaction(name, 'readonly').objectStore(name).get(id));
      },
      async toArray() {
        const db = await open();
        if (!db) return (name === 'history' ? localHistoryTable() : localMetaTable()).toArray();
        return wrap(db.transaction(name, 'readonly').objectStore(name).getAll());
      },
      async delete(id) {
        const db = await open();
        if (!db) return (name === 'history' ? localHistoryTable() : localMetaTable()).delete(id);
        return wrap(db.transaction(name, 'readwrite').objectStore(name).delete(id));
      },
      async clear() {
        const db = await open();
        if (!db) return (name === 'history' ? localHistoryTable() : localMetaTable()).clear();
        return wrap(db.transaction(name, 'readwrite').objectStore(name).clear());
      },
      async count() {
        const db = await open();
        if (!db) return (name === 'history' ? localHistoryTable() : localMetaTable()).count();
        return wrap(db.transaction(name, 'readonly').objectStore(name).count());
      },
      where(index) {
        const pick = (rows, fn) => (rows || []).filter((r) => r && fn(r[index]));
        return {
          equals(value) {
            return { toArray: async () => pick(await api.toArray(), (v) => String(v) === String(value)) };
          },
          below(value) {
            return { toArray: async () => pick(await api.toArray(), (v) => String(v) < String(value)) };
          }
        };
      }
    };
    return api;
  }

  /* ---------- 이전 버전 localStorage 이력 이관 ---------- */
  async function migrate() {
    if (lsRaw(MIGRATED_KEY) === '1') return { migrated: false, history: 0 };
    const legacy = lsGet(LEGACY_HISTORY, null);
    const db = await open();
    let moved = 0;
    if (Array.isArray(legacy) && legacy.length) {
      if (db) await table('history').bulkPut(legacy.filter((r) => r && r.id));
      moved = legacy.length;
    }
    /* 이관이 끝나면 민감정보가 남은 옛 키를 지웁니다 (폴백 모드에서는 같은 키를 계속 씁니다) */
    if (db) lsDel(LEGACY_HISTORY);
    try { localStorage.setItem(MIGRATED_KEY, '1'); } catch (e) { /* private mode */ }
    return { migrated: true, history: moved };
  }

  /* ---------- 앱이 쓰는 상위 API ---------- */
  async function loadHistory() {
    await open();
    const rows = await table('history').toArray();
    return (rows || []).filter((r) => r && r.id)
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  async function saveHistory(list) {
    await open();
    const rows = Array.isArray(list) ? list : [];
    const st = table('history');
    await st.clear();
    if (rows.length) await st.bulkPut(rows);
    return true;
  }

  function modeNow() { return mode; }

  root.BojangStore = {
    open, ready, migrate, mode: modeNow, table, loadHistory, saveHistory,
    /* localStorage 에 남기는 것은 화면 설정뿐입니다 */
    PREFS: {
      view: 'bojang.viewmode.v1', tour: 'bojang.tour.v1', tourSnooze: 'bojang.tour.snooze',
      senior: 'bojang.senior.v1', lastMode: 'bojang.lastmode.v1', migrated: MIGRATED_KEY
    },
    lsGet, lsSet, lsDel
  };
})(typeof window !== 'undefined' ? window : globalThis);
