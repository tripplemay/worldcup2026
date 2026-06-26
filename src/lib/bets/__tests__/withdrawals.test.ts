/**
 * withdrawnByBettor 纯聚合行为(提款合计 + 收敛)。
 * 增删器(add/remove)是 load→改→save 薄包装,沿用 bettors.ts 的无直接 I/O 测试惯例。
 */
import { withdrawnByBettor } from '../withdrawals';
import type { Withdrawal } from '../types';

const wd = (bettorId: string, amount: number): Withdrawal => ({
  id: `w_${Math.random()}`,
  bettorId,
  amount,
  at: 0,
});

describe('withdrawnByBettor', () => {
  it('空数组 → 空 Map', () => {
    expect(withdrawnByBettor([]).size).toBe(0);
  });

  it('同一人多笔累加,不同人分桶', () => {
    const m = withdrawnByBettor([wd('a', 100), wd('a', 200), wd('b', 50)]);
    expect(m.get('a')).toBe(300);
    expect(m.get('b')).toBe(50);
  });

  it('浮点求和做 2 位小数收敛', () => {
    const m = withdrawnByBettor([wd('a', 0.1), wd('a', 0.2)]);
    expect(m.get('a')).toBe(0.3);
  });

  it('跳过非有限金额(NaN/Infinity)', () => {
    const m = withdrawnByBettor([wd('a', 100), wd('a', NaN), wd('a', Infinity)]);
    expect(m.get('a')).toBe(100);
  });
});
