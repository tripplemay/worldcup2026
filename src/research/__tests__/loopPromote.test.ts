/**
 * P4 收尾单测:多 epoch 循环(累积注册表 + 追踪最优 + loop-until-no-improve)+ 全 gauntlet promoteCandidate。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { runSearchLoop, defaultGrids } from '../loop';
import { promoteCandidate } from '../promote';
import type { SweepConfig } from '../search';
import type { EngineDataset, StrategyParams, MatchOddsView } from '../engine';
import type { HistMatch, ResultMatch } from 'lib/predict/types';

const seed = (n: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'seed/leagues', n), 'utf8'));
const ds: EngineDataset = {
  allHist: Object.values(
    seed('league-epl-2025-historical.json') as Record<string, HistMatch>,
  ),
  allRes: Object.values(
    seed('league-epl-2025-results.json') as Record<string, ResultMatch>,
  ),
  odds: seed('league-epl-2025-oddsx.json') as Record<string, MatchOddsView>,
};

// 7 季 seed 后为控测试时长:截到近 3 季(既有断言行为不变)
const SINCE = '2023-08-01';
ds.allRes = ds.allRes.filter((r) => r.date >= SINCE);
ds.allHist = ds.allHist.filter((h) => h.date >= SINCE);
const bet = {
  minProb: 0.3,
  minEv: 0.03,
  maxEv: 0.3,
  kellyFraction: 0.25,
  maxStakePct: 0.05,
  minStake: 10,
  coverageStakePct: 0.005,
  initialBalance: 10000,
};
const cfg = (gs: number): StrategyParams => ({
  tuning: { goalShrink: gs, dcRho: -0.14, shrinkEloScale: 100 },
  home: { eloBonus: 65, goalMult: 1.12 },
  marketWeight: 0.4,
  bet,
});
const grids: SweepConfig[][] = [
  [
    { label: 'gs0.4', params: cfg(0.4) },
    { label: 'gs0.6', params: cfg(0.6) },
  ],
  [
    { label: 'gs0.8', params: cfg(0.8) },
    { label: 'gs1.0', params: cfg(1.0) },
  ],
];

describe('P4 runSearchLoop', () => {
  it('defaultGrids 三个有意义维度网格', () => {
    const g = defaultGrids();
    expect(g).toHaveLength(3);
    expect(g[0][0].label).toMatch(/^gs/);
    expect(g[2][0].label).toMatch(/^minEv/);
  });

  it('多轮累积注册表 + 追踪最优', async () => {
    const r = await runSearchLoop(ds, grids, { at: 0 });
    expect(r.epochs).toHaveLength(2);
    expect(r.epochs[0].epoch).toBe(1);
    expect(r.epochs[1].epoch).toBe(2);
    // 注册表跨轮累积:第 2 轮累计 N = 4(2+2)
    expect(r.epochs[1].cumulativeTrials).toBe(4);
    expect(r.best).not.toBeNull();
    expect(
      ['gs0.4', 'gs0.6', 'gs0.8', 'gs1.0'].includes(r.best!.label),
    ).toBe(true);
  }, 120000);

  it('确定性:同输入两次相等', async () => {
    const a = await runSearchLoop(ds, grids, { at: 0 });
    const b = await runSearchLoop(ds, grids, { at: 0 });
    expect(a.epochs).toEqual(b.epochs);
    expect(a.best).toEqual(b.best);
  }, 120000);
});

describe('P4 promoteCandidate 全 gauntlet', () => {
  it('产出完整 G0–G6 证据 + 闸门判定(EPL null → 被拦)', async () => {
    const r = await promoteCandidate(ds, cfg(0.6), { epoch: 1, dsr: 0.22, pbo: 0.52 }, {
      mcRuns: 200,
      seed: 1,
    });
    // 证据字段齐全
    expect(r.evidence.clv.n).toBeGreaterThan(0);
    expect(Number.isFinite(r.evidence.roi.spaP)).toBe(true);
    expect(Number.isFinite(r.evidence.roi.ciLower)).toBe(true);
    expect(Number.isFinite(r.evidence.drawdown.historicalMaxDD)).toBe(true);
    expect(Number.isFinite(r.evidence.drawdown.mc95DD)).toBe(true);
    expect(r.evidence.holdout).toBeDefined();
    // EPL 1X2 无 edge → 全 gauntlet 拦下(不 passedAll)
    expect(r.verdict.passedAll).toBe(false);
    expect(typeof r.verdict.blockedAt).toBe('string');
  }, 120000);

  it('确定性:同输入两次相等', async () => {
    const opts = { mcRuns: 100, seed: 3 };
    const a = await promoteCandidate(ds, cfg(0.6), { epoch: 1, dsr: 0.2, pbo: 0.5 }, opts);
    const b = await promoteCandidate(ds, cfg(0.6), { epoch: 1, dsr: 0.2, pbo: 0.5 }, opts);
    expect(a).toEqual(b);
  }, 120000);
});
