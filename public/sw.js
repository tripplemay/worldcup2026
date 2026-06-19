/* 世界杯 2026 PWA Service Worker v2 — 部署安全
 *
 * 关键修复(v1 → v2):不再用 cache-first 缓存 /_next 等不可变静态资源。
 * 原因:cache-first + 固定缓存名会让旧 chunk 永驻缓存;新版本上线后引用新 chunk,
 *       一旦回退到旧缓存壳就会请求已被删除的旧 chunk → 404 → 白屏。
 *
 * 现策略:
 *  - /api/* 与静态资源(/_next、icons):**不拦截**,交给网络 + 浏览器原生 HTTP 缓存
 *    (Next 给 /_next/static 打了 immutable 长缓存,既高效又不会残留跨版本旧文件)
 *  - 导航请求:network-first(在线永远拿最新 HTML),成功时刷新离线壳;断网才回退缓存壳
 */
const CACHE = 'wc2026-shell-v3';
const SHELL = ['/', '/manifest.json', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // 只接管导航;其余(/_next chunk、/api、icons)一律放行给网络/浏览器缓存
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  event.respondWith(
    fetch(request)
      .then((resp) => {
        // 在线:更新离线壳为最新 HTML(引用当前版本 chunk)
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put('/', copy));
        return resp;
      })
      .catch(() => caches.match('/')),
  );
});
