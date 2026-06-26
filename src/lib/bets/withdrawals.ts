/**
 * Phase 9 提款流水台账(增删 + 聚合)。
 * 仿 bettors.ts 的 load→改→save 薄包装;提款不重算、不入盈亏,仅记录现金流出。
 */
import { loadWithdrawals, saveWithdrawals } from 'lib/db/store';
import { getBettor } from './bettors';
import { genId } from './id';
import type { Withdrawal } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 全部提款流水(按时间倒序:最近在前)。 */
export function listWithdrawals(): Withdrawal[] {
  return [...loadWithdrawals()].sort((a, b) => b.at - a.at);
}

/**
 * 新增一笔提款。金额须为有限正数,投注人须存在;否则返回 null。
 * at 缺省取当前时刻;note 去空白后非空才保留。
 */
export function addWithdrawal(
  bettorId: string,
  amount: number,
  note?: string,
  at?: number,
): Withdrawal | null {
  if (!bettorId || !getBettor(bettorId)) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const w: Withdrawal = {
    id: genId('wd'),
    bettorId,
    amount: round2(amount),
    at: Number.isFinite(at) ? (at as number) : Date.now(),
  };
  const n = (note ?? '').trim();
  if (n) w.note = n;
  saveWithdrawals([...loadWithdrawals(), w]);
  return w;
}

/** 删除一笔提款(命中返回 true)。 */
export function removeWithdrawal(id: string): boolean {
  const list = loadWithdrawals();
  if (!list.some((w) => w.id === id)) return false;
  saveWithdrawals(list.filter((w) => w.id !== id));
  return true;
}

/** 纯聚合:bettorId → 已提款合计(2 位小数收敛)。 */
export function withdrawnByBettor(list: Withdrawal[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of list) {
    if (!Number.isFinite(w.amount)) continue;
    m.set(w.bettorId, (m.get(w.bettorId) ?? 0) + w.amount);
  }
  for (const [k, v] of m) m.set(k, round2(v));
  return m;
}
