/**
 * The Odds API 多 key 池(突破单账号 500/月限额)。
 *
 * key 来源合并去重:① env ODDS_API_KEY / ODDS_API_KEYS(均可逗号分隔)
 *   ② 持久文件 ODDS_KEYS_FILE(前端添加的 key,JSON 数组;部署目录之外,重启/部署不丢)。
 *
 * 轮换策略「粘性」:一直用当前 key,直到它配额耗尽(剩余<=0 或请求返回配额错误)
 * 才切到下一个有余额的 key。每个 key 的剩余额度从响应头 x-requests-remaining 实时跟踪。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

interface KeyState {
  key: string;
  remaining: number | null; // null = 本进程尚未用过(未知,乐观假设满额)
  used: number | null;
  last: number | null;
}

/** 单账号每月额度(免费档 500);用于聚合显示的分母,可用 env 覆盖。 */
export const PER_KEY_LIMIT = Number(process.env.ODDS_API_MONTHLY_LIMIT ?? 500);

/** 前端添加的 key 的持久文件(应指向部署目录之外的路径,避免部署覆盖)。 */
const KEYS_FILE = process.env.ODDS_KEYS_FILE ?? '.data/odds-keys.json';

function loadFileKeys(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(KEYS_FILE, 'utf8'));
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && !!x.trim())
      : [];
  } catch {
    return []; // 文件不存在/损坏 → 空
  }
}

function saveFileKeys(keys: string[]): void {
  try {
    mkdirSync(dirname(KEYS_FILE), { recursive: true });
    writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  } catch {
    // 持久化失败不阻断:至少内存池已生效(下次重启会丢,记录但不抛)
  }
}

function envKeys(): string[] {
  return [process.env.ODDS_API_KEY, process.env.ODDS_API_KEYS]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildPool(): KeyState[] {
  const seen = new Set<string>();
  const pool: KeyState[] = [];
  for (const k of [...envKeys(), ...loadFileKeys()]) {
    if (seen.has(k)) continue;
    seen.add(k);
    pool.push({ key: k, remaining: null, used: null, last: null });
  }
  return pool;
}

const pool = buildPool();
let current = 0;

/** key 打码显示(只露首尾,绝不回显完整值)。 */
export function maskKey(k: string): string {
  return k.length <= 8 ? '****' : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/** 添加一个 key 到池 + 持久化(调用方应已校验有效性)。返回是否新增 + 打码。 */
export function addKeyToPool(key: string): { added: boolean; masked: string } {
  const k = key.trim();
  const masked = maskKey(k);
  if (!k || pool.some((x) => x.key === k)) return { added: false, masked };
  pool.push({ key: k, remaining: null, used: null, last: null });
  const fileKeys = loadFileKeys();
  if (!fileKeys.includes(k)) {
    fileKeys.push(k);
    saveFileKeys(fileKeys);
  }
  return { added: true, masked };
}

/** 列出所有 key(打码)+ 各自剩余/已用,供管理页展示。 */
export function listKeys(): {
  masked: string;
  remaining: number | null;
  used: number | null;
}[] {
  return pool.map((k) => ({
    masked: maskKey(k.key),
    remaining: k.remaining,
    used: k.used,
  }));
}

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
