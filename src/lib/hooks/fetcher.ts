/** SWR 通用 fetcher:解包统一响应封装(success/data/error),失败抛错。 */
import type { ApiResponse } from 'lib/api/respond';

export async function fetcher<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // no-store + 唯一 URL buster:实时比分/赔率必须最新。
    // 仅 no-store 在 iOS Safari/PWA 上可能被忽略;附唯一 _ts 让每次请求 URL 唯一 →
    // 任何缓存层(浏览器/SW/nginx)都必然 miss、回源取最新。SWR 仍按原 key 去重/节流,
    // buster 只作用于真正发出的那次 fetch。
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${sep}_ts=${Date.now()}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const json = (await res.json()) as ApiResponse<T>;
    if (!json.success || json.data == null) {
      throw new Error(json.error || `请求失败: ${res.status}`);
    }
    return json.data;
  } finally {
    clearTimeout(id);
  }
}
