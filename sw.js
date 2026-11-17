/* 보장분석 상담 가이드 — 서비스 워커 (v7.2)
   앱 셸을 캐시해 홈 화면에서 오프라인으로도 열립니다.

   v7.2 캐시 원칙
     · API(/functions/v1/, /rest/v1/, /auth/v1/) · 상담기록(list/record/history) · PDF(.pdf) 경로는
       캐시에 넣지 않습니다 — 민감 데이터와 매번 달라지는 산출물이 기기에 쌓이지 않게.
     · cache.addAll 은 파일 하나만 실패해도 설치 전체가 실패합니다. v7.2는 파일별 cache.add 로
       실패를 격리하고, 실패 목록을 남긴 채 설치를 끝냅니다(앱은 온라인에서 그대로 동작). */
const CACHE = 'bojang-guide-v7.2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './version.js',
  './security.js',
  './storage-idb.js',
  './content.js',
  './dambo-dictionary.js',
  './jobgrades.js',
  './ocr.js',
  './playbook.js',
  './model.js',
  './pdfkit.js',
  './qr.js',
  './report.js',
  './client.js',
  './live.js',
  './tools.js',
  './aftercare.js',
  './claimcheck.js',
  './publicdata.js',
  './memofill.js',
  './monetize.js',
  './backend.js',
  './qrscan.js',
  './smartkey.js',
  './import-parser.js',
  './inputhub.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

/* 캐시 금지 경로 — API·상담기록·PDF */
const NO_CACHE = [
  /\/functions\/v1\//,
  /\/rest\/v1\//,
  /\/auth\/v1\//,
  /\/(list|record|records|history)(\/|$|\?)/i,
  /\.pdf($|\?)/i,
  /\/(export|download)(\/|$|\?)/i
];
function cacheable(url, req) {
  try {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) return false;
    const path = u.pathname + u.search;
    if (NO_CACHE.some((re) => re.test(path))) return false;
    return true;
  } catch (e) { return false; }
}

const FAILED = [];
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((a) => c.add(a).catch((err) => { FAILED.push(a); }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (!cacheable(req.url, req)) return;          /* API·기록·PDF 는 서비스워커가 손대지 않음 */
  if (new URL(req.url).origin !== location.origin) return;

  /* 화면(내비게이션)은 네트워크 우선 — 배포 직후 새 버전이 바로 뜨고, 오프라인이면 캐시로 엽니다 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // 캐시 우선 + 백그라운드 갱신
        fetch(req).then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
