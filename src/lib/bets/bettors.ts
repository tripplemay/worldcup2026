/**
 * Phase 9 投注人名册(预置 + 增删)。
 * 名册可由 env BET_TRACKER_BETTORS="张三,李四,王五" 预置(仅当当前为空),
 * 也可经盈亏页管理端新增。Telegram 归属按钮从此名册取选项。
 */
import { loadBettors, saveBettors } from 'lib/db/store';
import { genId } from './id';
import type { Bettor } from './types';

/** 从 env 预置名册;仅当当前名册为空时写入。返回最终名册。 */
export function seedBettorsFromEnv(): Bettor[] {
  const cur = loadBettors();
  if (cur.length) return cur;
  const raw = process.env.BET_TRACKER_BETTORS ?? '';
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return cur;
  const list = names.map((name) => ({ id: genId('bettor'), name, active: true }));
  saveBettors(list);
  return list;
}

/** 名册(空则尝试 env 预置兜底)。 */
export function listBettors(): Bettor[] {
  const cur = loadBettors();
  return cur.length ? cur : seedBettorsFromEnv();
}

export function getBettor(id: string): Bettor | undefined {
  return loadBettors().find((b) => b.id === id);
}

/** 新增投注人(重名则返回已存在者);空名返回 null。 */
export function addBettor(name: string): Bettor | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  const list = loadBettors();
  const dup = list.find((b) => b.name === n);
  if (dup) return dup;
  const b: Bettor = { id: genId('bettor'), name: n, active: true };
  saveBettors([...list, b]);
  return b;
}

/** 启用/停用(停用者不再出现在归属按钮)。 */
export function setBettorActive(id: string, active: boolean): boolean {
  const list = loadBettors();
  if (!list.some((b) => b.id === id)) return false;
  saveBettors(list.map((b) => (b.id === id ? { ...b, active } : b)));
  return true;
}
