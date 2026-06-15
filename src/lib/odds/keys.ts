/**
 * The Odds API 多 key 池(突破单账号 500/月限额)。
 *
 * 配置:ODDS_API_KEY 和/或 ODDS_API_KEYS,两者都可逗号分隔多个 key,合并去重。
 *   例:ODDS_API_KEY="key1,key2,key3"
 *
 * 轮换策略「粘性」:一直用当前 key,直到它配额耗尽(剩余<=0 或请求返回配额错误)
 * 才切到下一个有余额的 key。每个 key 的剩余额度从响应头 x-requests-remaining 实时跟踪。
 */
interface KeyState {
  key: string;
  remaining: number | null; // null = 本进程尚未用过(未知,乐观假设满额)
  used: number | null;
  last: number | null;
}

/** 单账号每月额度(免费档 500);用于聚合显示的分母,可用 env 覆盖。 */
export const PER_KEY_LIMIT = Number(process.env.ODDS_API_MONTHLY_LIMIT ?? 500);

function parsePool(): KeyState[] {
  const raw = [process.env.ODDS_API_KEY, process.env.ODDS_API_KEYS]
    .filter(Boolean)
    .join(',');
  const seen = new Set<string>();
  const pool: KeyState[] = [];
  for (const k of raw.split(',').map((s) => s.trim())) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    pool.push({ key: k, remaining: null, used: null, last: null });
  }
  return pool;
}

const pool = parsePool();
let current = 0;

export function hasKeys(): boolean {
  return pool.length > 0;
}

const usable = (k: KeyState) => k.remaining == null || k.remaining > 0;

/** 选当前应使用的 key:粘住 current,耗尽则前移到下一个可用 key;全耗尽返回 null。 */
export function pickKey(): string | null {
  if (!pool.length) return null;
  for (let i = 0; i < pool.length; i++) {
    const idx = (current + i) % pool.length;
    if (usable(pool[idx])) {
      current = idx;
      return pool[idx].key;
    }
  }
  return null;
}

const toNum = (v: string | null): number | null =>
  v == null || v === '' ? null : Number(v);

/** 用一次请求的响应头更新该 key 的配额。 */
export function reportKeyQuota(key: string, headers: Headers): void {
  const k = pool.find((x) => x.key === key);
  if (!k) return;
  const rem = toNum(headers.get('x-requests-remaining'));
  const used = toNum(headers.get('x-requests-used'));
  const last = toNum(headers.get('x-requests-last'));
  if (rem != null) k.remaining = rem;
  if (used != null) k.used = used;
  if (last != null) k.last = last;
}

/** 标记 key 已耗尽(收到配额/鉴权错误时),下次 pickKey 自动跳过。 */
export function markKeyExhausted(key: string): void {
  const k = pool.find((x) => x.key === key);
  if (k) k.remaining = 0;
}

/** 聚合配额:跨所有 key 的总剩余/总已用/总额 + key 数。 */
export function getAggregateQuota() {
  if (!pool.length) {
    return {
      remaining: null,
      used: null,
      last: null,
      keyCount: 0,
      keysAvailable: 0,
      total: null,
    };
  }
  const remaining = pool.reduce(
    (s, k) => s + (k.remaining ?? PER_KEY_LIMIT),
    0,
  );
  const used = pool.reduce((s, k) => s + (k.used ?? 0), 0);
  const last = pool.reduce<number | null>(
    (m, k) => (k.last != null ? Math.max(m ?? 0, k.last) : m),
    null,
  );
  return {
    remaining,
    used,
    last,
    keyCount: pool.length,
    keysAvailable: pool.filter(usable).length,
    total: PER_KEY_LIMIT * pool.length,
  };
}
