/**
 * perUserPnl 期初净盈亏(openingPnl)聚合行为。
 */
import { perUserPnl } from '../bets';
import type { BetSlip, Bettor, Withdrawal } from '../types';

const bettor = (id: string, name: string, openingPnl?: number): Bettor => ({
  id,
  name,
  active: true,
  ...(openingPnl != null ? { openingPnl } : {}),
});

const slip = (
  bettorId: string,
  status: BetSlip['status'],
  pnl: number,
  stake = 100,
): BetSlip =>
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

describe('perUserPnl —— 提款(withdrawn / undrawn)', () => {
  const wd = (bettorId: string, amount: number): Withdrawal => ({
    id: `w_${Math.random()}`,
    bettorId,
    amount,
    at: 0,
  });

  it('未提款 = 净盈亏 − 已提款;同一人多笔提款累加', () => {
    const bettors = [bettor('a', '甲', 200)];
    const slips = [slip('a', 'won', 660)]; // 系统内 +660,期初 +200 → pnl 860
    const res = perUserPnl(slips, bettors, [wd('a', 100), wd('a', 200)]);
    const a = res.find((r) => r.bettorId === 'a')!;
    expect(a.pnl).toBe(860);
    expect(a.withdrawn).toBe(300);
    expect(a.undrawn).toBe(560);
  });

  it('亏损者未提款为负(应得余额为负)', () => {
    const res = perUserPnl([], [bettor('b', '乙', -160)]);
    const b = res.find((r) => r.bettorId === 'b')!;
    expect(b.pnl).toBe(-160);
    expect(b.withdrawn).toBe(0);
    expect(b.undrawn).toBe(-160);
  });

  it('无提款时 withdrawn=0、undrawn=pnl;缺省第三参不报错', () => {
    const res = perUserPnl([slip('c', 'won', 50)], [bettor('c', '丙')]);
    const c = res.find((r) => r.bettorId === 'c')!;
    expect(c.withdrawn).toBe(0);
    expect(c.undrawn).toBe(c.pnl);
  });

  it('指向不在册投注人的提款不计入任何在册行', () => {
    const res = perUserPnl([], [bettor('d', '丁', 100)], [wd('ghost', 999)]);
    const d = res.find((r) => r.bettorId === 'd')!;
    expect(d.withdrawn).toBe(0);
    expect(d.undrawn).toBe(100);
  });
});
