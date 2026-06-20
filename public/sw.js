/* 世界杯 2026 PWA Service Worker v4 — 极简、零拦截(修复白屏)
 *
 * v3→v4:彻底移除对请求的 fetch 拦截。
 * 根因:根路径 `/` 会 307 跳转到 `/schedule`;旧 SW 用 respondWith 接管导航并返回
 *   「重定向后的响应」(redirected=true)。浏览器规范禁止把 redirected response 用于
 *   navigation 请求 → 导航失败 → 白屏。
 * 解法:SW 完全不拦截 fetch,导航 / 重定向 / HTTP 缓存全部交还浏览器原生处理。
 *   仅保留:安装即接管(skipWaiting)+ 激活时清掉所有旧版本缓存(含可能缓存了
 *   重定向响应的旧 shell)+ 立即 claim 现有页面。
 */
const CACHE = 'wc2026-v4';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 注意:不注册 'fetch' 监听器 —— 不拦截任何请求,避免再次破坏导航/重定向。
