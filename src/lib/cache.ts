/**
 * 进程内 TTL 缓存(单实例)。
 * 用于吸收重复请求、保护上游配额(The Odds API 500/月)。
 * 部署为单实例 PM2 进程,模块级状态在请求间持久。
 */
interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();

export function getCached<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

/** 命中返回缓存;未命中执行 loader 并写入缓存。 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  setCached(key, value, ttlMs);
  return value;
}

/** 失效缓存:传 prefix 删除前缀匹配的键(如 'predict:'),不传清空全部。返回删除数量。 */
export function clearCache(prefix?: string): number {
  let n = 0;
  for (const key of [...store.keys()]) {
    if (!prefix || key.startsWith(prefix)) {
      store.delete(key);
      n += 1;
    }
  }
  return n;
}
