/**
 * perUserPnl 期初净盈亏(openingPnl)聚合行为。
 */
import { perUserPnl } from '../bets';
import type { BetSlip, Bettor } from '../types';

const bettor = (id: string, name: string, openingPnl?: number): Bettor => ({
  id,
  name,
  active: true,
  ...(openingPnl != null ? { openingPnl } : {}),
});

const slip = (bettorId: string, status: BetSlip['status'], pnl: number, stake = 100): BetSlip =>
  ({
    id: `s_${Math.random()}`,
    bettorId,
    stake,
    potentialReturn: pnl > 0 ? pnl : 0,
    legs: [],
    status,
    pnl,
    confidence: 1,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as BetSlip);

describe('perUserPnl —— 期初净盈亏', () => {
  it('期初盈亏并入总盈亏(pnl = 系统内 + 期初),并保留 openingPnl 字段', () => {
    const bettors = [bettor('a', '甲', 500), bettor('b', '乙', -300)];
    const slips = [slip('a', 'won', 200), slip('a', 'lost', -100)];
    const res = perUserPnl(slips, bettors);
    const a = res.find((r) => r.bettorId === 'a')!;
    const b = res.find((r) => r.bettorId === 'b')!;
    // 甲:系统内 200-100=100,期初 500 → 600
    expect(a.pnl).toBe(600);
    expect(a.openingPnl).toBe(500);
    expect(a.staked).toBe(200);
    // 乙:无系统注,仅期初 -300
    expect(b.pnl).toBe(-300);
    expect(b.openingPnl).toBe(-300);
    expect(b.bets).toBe(0);
  });

  it('无期初也无注 → pnl/openingPnl 均 0', () => {
    const res = perUserPnl([], [bettor('c', '丙')]);
    const c = res.find((r) => r.bettorId === 'c')!;
    expect(c.pnl).toBe(0);
    expect(c.openingPnl).toBe(0);
    expect(c.bets).toBe(0);
  });
});
