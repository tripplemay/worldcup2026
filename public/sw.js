/* 世界杯 2026 PWA Service Worker — 离线壳
 * 策略:
 *  - /api/* :不拦截(赔率/比分讲究新鲜度,交给网络,离线即失败由 UI 降级)
 *  - 导航请求:network-first,失败回退缓存的应用壳
 *  - 静态资源(_next、icons):cache-first
 */
const CACHE = 'wc2026-shell-v1';
const APP_SHELL = ['/', '/manifest.json', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 不缓存 API:赔率/比分需要实时,离线时让 UI 自行降级
  if (url.pathname.startsWith('/api/')) return;

  // 导航:network-first,断网回退应用壳
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((r) => r || caches.match('/'))),
    );
    return;
  }

  // 静态资源:cache-first,命中即返回,未命中再网络并回填
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((resp) => {
            const copy = resp.clone();
            if (resp.ok) caches.open(CACHE).then((c) => c.put(request, copy));
            return resp;
          }),
      ),
    );
  }
});
