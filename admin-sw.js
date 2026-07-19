// 後台 PWA 的 service worker：只快取「同網域的靜態檔案」（admin.html/admin.js/shared.css…），
// 讓已安裝的殼開啟時能秒開；後端 Apps Script 一律略過快取、直接打網路，避免看到舊資料。
// 策略是「網路優先，網路失敗才用快取」，所以只要有網路，使用者永遠看到最新版本，
// 不需要每次改版都手動清 cache 或改這個檔案。
const CACHE_NAME = 'admin-shell-v1';
const SHELL_ASSETS = [
  './admin.html',
  './shared.css',
  './admin-manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 跨網域（Apps Script 後端）跟非 GET 一律不攔截，維持原本行為
  if (url.origin !== self.location.origin || req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
