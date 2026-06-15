/** SWR 通用 fetcher:解包统一响应封装(success/data/error),失败抛错。 */
import type { ApiResponse } from 'lib/api/respond';

export async function fetcher<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const json = (await res.json()) as ApiResponse<T>;
    if (!json.success || json.data == null) {
      throw new Error(json.error || `请求失败: ${res.status}`);
    }
    return json.data;
  } finally {
    clearTimeout(id);
  }
}
