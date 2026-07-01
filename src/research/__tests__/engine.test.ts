/**
 * 研究引擎 headless / 确定性 / 注入式 冒烟测试。
 * 用真实 EPL seed(2023/24–2025/26)作注入 fixture:证明引擎不读 store、
 * 同输入两次结果逐字节相等、且能真正跑出评估场次与 P&L。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { runStrategy } from '../engine';
import type { EngineDataset, StrategyParams } from '../engine';
import type { HistMatch, ResultMatch } from 'lib/predict/types';
import type { LeagueClosing } from 'lib/db/store';

const seed = (name: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'seed/leagues', name), 'utf8'),
  );

const dataset: EngineDataset = {
  allHist: Object.values(
    seed('league-epl-2025-historical.json') as Record<string, HistMatch>,
  ),
  allRes: Object.values(
    seed('league-epl-2025-results.json') as Record<string, ResultMatch>,
  ),
  oddsMap: seed('league-epl-2025-odds.json') as Record<string, LeagueClosing>,
};

// EPL calib(见 leagues.ts):完整 Tuning + 主场 + marketWeight,勿留 env 回落
const params: StrategyParams = {
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
  from: '2026-05-01', // 末段小窗(前有 ~2 季历史,评分充足)
};

describe('研究引擎(注入式 / headless / 确定性)', () => {
  it('注入 seed 数据即可跑,产出已评估场次与有限 P&L', () => {
    const r = runStrategy(dataset, params);
    expect(r.matches).toBeGreaterThan(0); // 真跑出评估场次(非全 skip)
    expect(Number.isFinite(r.bankrollEnd)).toBe(true);
    expect(Number.isFinite(r.roiCompound)).toBe(true);
    expect(r.value.bets + r.coverage.bets).toBeGreaterThan(0);
    // 复利终值 = 初始 + 各注 pnl 之和(内存 bankroll 自洽)
    const totalPnl = r.bets.reduce((s, b) => s + b.pnl, 0);
    expect(r.bankrollEnd).toBeCloseTo(r.bankrollStart + totalPnl, 1);
  });

  it('同输入两次 → 结果逐字节相等(确定性)', () => {
    const a = runStrategy(dataset, params);
    const b = runStrategy(dataset, params);
    expect(a).toEqual(b);
  });

  it('PREDICT_WEIGHTS 已设 → 入口硬守卫抛错(防静态权重毒化 sweep)', () => {
    const prev = process.env.PREDICT_WEIGHTS;
    process.env.PREDICT_WEIGHTS = 'elo:1';
    try {
      expect(() => runStrategy(dataset, params)).toThrow(/PREDICT_WEIGHTS/);
    } finally {
      if (prev == null) delete process.env.PREDICT_WEIGHTS;
      else process.env.PREDICT_WEIGHTS = prev;
    }
  });
});
