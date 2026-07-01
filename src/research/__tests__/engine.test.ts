/**
 * 研究引擎 headless / 确定性 / 注入式 + CLV 测试。
 * 用真实 EPL seed(2023/24–2025/26)作注入 fixture:证明引擎不读 store、
 * 同输入两次结果逐字节相等、能真正跑出评估场次与 P&L;并验证开盘下注 + 闭盘量 CLV。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { runStrategy, clvFor } from '../engine';
import type { EngineDataset, StrategyParams, MatchOddsView } from '../engine';
import type { HistMatch, ResultMatch } from 'lib/predict/types';

const seed = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'seed/leagues', name), 'utf8'));

const allHist = Object.values(
  seed('league-epl-2025-historical.json') as Record<string, HistMatch>,
);
const allRes = Object.values(
  seed('league-epl-2025-results.json') as Record<string, ResultMatch>,
);
const closing = seed('league-epl-2025-odds.json') as Record<
  string,
  { h: number; d: number; a: number }
>;

// 仅闭盘视图(P1 口径:在闭盘价下注,无 CLV)
const oddsCloseOnly: Record<string, MatchOddsView> = {};
for (const [k, c] of Object.entries(closing)) oddsCloseOnly[k] = { x2: { close: c } };

// 开盘=闭盘×1.05 的合成视图(在开盘下注 → 每注 CLV 恒为 +0.05)
const oddsOpenClose: Record<string, MatchOddsView> = {};
for (const [k, c] of Object.entries(closing))
  oddsOpenClose[k] = {
    x2: { open: { h: c.h * 1.05, d: c.d * 1.05, a: c.a * 1.05 }, close: c },
  };

const baseParams: StrategyParams = {
  tuning: { goalShrink: 0.6, dcRho: -0.14, shrinkEloScale: 100 },
  home: { eloBonus: 65, goalMult: 1.12 },
  marketWeight: 0.4,
  bet: {
    minProb: 0.3,
    minEv: 0.03,
    maxEv: 0.3,
    kellyFraction: 0.25,
    maxStakePct: 0.05,
    minStake: 10,
    coverageStakePct: 0.005,
    initialBalance: 10000,
  },
};

const dataset = (odds: Record<string, MatchOddsView>): EngineDataset => ({
  allHist,
  allRes,
  odds,
});

describe('研究引擎(注入式 / headless / 确定性)', () => {
  const params: StrategyParams = { ...baseParams, from: '2026-05-01' };

  it('注入 seed 数据即可跑,产出已评估场次与有限 P&L', () => {
    const r = runStrategy(dataset(oddsCloseOnly), params);
    expect(r.matches).toBeGreaterThan(0);
    expect(Number.isFinite(r.bankrollEnd)).toBe(true);
    expect(r.value.bets + r.coverage.bets).toBeGreaterThan(0);
    const totalPnl = r.bets.reduce((s, b) => s + b.pnl, 0);
    expect(r.bankrollEnd).toBeCloseTo(r.bankrollStart + totalPnl, 1);
  });

  it('同输入两次 → 结果逐字节相等(确定性)', () => {
    expect(runStrategy(dataset(oddsCloseOnly), params)).toEqual(
      runStrategy(dataset(oddsCloseOnly), params),
    );
  });

  it('仅闭盘视图 → 闭盘下注、无 CLV(clv.n=0)', () => {
    const r = runStrategy(dataset(oddsCloseOnly), params);
    expect(r.clv.n).toBe(0);
    expect(r.bets.every((b) => b.betPhase === 'close')).toBe(true);
  });

  it('PREDICT_WEIGHTS 已设 → 入口硬守卫抛错', () => {
    const prev = process.env.PREDICT_WEIGHTS;
    process.env.PREDICT_WEIGHTS = 'elo:1';
    try {
      expect(() => runStrategy(dataset(oddsCloseOnly), params)).toThrow(
        /PREDICT_WEIGHTS/,
      );
    } finally {
      if (prev == null) delete process.env.PREDICT_WEIGHTS;
      else process.env.PREDICT_WEIGHTS = prev;
    }
  });
});

describe('clvFor(成交价 vs 闭盘价)', () => {
  it('主/客/平 各方向 + 无效闭盘', () => {
    expect(clvFor('home', 2.1, { h: 2.0, d: 3.4, a: 3.6 })).toBeCloseTo(0.05);
    expect(clvFor('away', 3.6, { h: 2.0, d: 3.4, a: 4.0 })).toBeCloseTo(-0.1);
    expect(clvFor('draw', 3.5, { h: 2.0, d: 3.5, a: 3.5 })).toBeCloseTo(0);
    expect(clvFor('home', 2.0, { h: 1.0, d: 3, a: 3 })).toBeNull(); // co≤1
  });
});

describe('开盘下注 + 闭盘量 CLV(开盘=闭盘×1.05 → 每注 CLV=+0.05)', () => {
  const params: StrategyParams = { ...baseParams, from: '2025-08-01' }; // 整季确保有 value 注
  const r = runStrategy(dataset(oddsOpenClose), params);

  it('value 注均在开盘下注、CLV 恒 +0.05', () => {
    const vs = r.bets.filter((b) => b.tier === 'value');
    expect(vs.length).toBeGreaterThan(0);
    expect(vs.every((b) => b.betPhase === 'open')).toBe(true);
    expect(vs.every((b) => Math.abs((b.clv ?? 0) - 0.05) < 1e-6)).toBe(true);
  });

  it('CLV 汇总:n=value 注数、avgClv≈+0.05、posRate=1', () => {
    expect(r.clv.n).toBe(r.value.bets);
    expect(r.clv.avgClv).toBeCloseTo(0.05);
    expect(r.clv.posRate).toBe(1);
  });
});
