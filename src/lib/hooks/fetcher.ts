/** SWR 通用 fetcher:解包统一响应封装(success/data/error),失败抛错。 */
import type { ApiResponse } from 'lib/api/respond';

export async function fetcher<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // no-store:每次走网络,绝不命中浏览器/代理的 HTTP 缓存(实时比分/赔率必须最新);
    // SWR 自己控制刷新节流与去重,无需 HTTP 缓存层。
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    const json = (await res.json()) as ApiResponse<T>;
    if (!json.success || json.data == null) {
      throw new Error(json.error || `请求失败: ${res.status}`);
    }
    return json.data;
  } finally {
    clearTimeout(id);
  }
}
