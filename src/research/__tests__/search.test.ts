/**
 * P4 搜索环单测:runSearch 结构、注册表累计(含传入)、确定性、EPL null 冠军三筛不过。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { runSearch } from '../search';
import type { SweepConfig } from '../search';
import { newRegistry, registerTrial } from '../governance';
import type { EngineDataset, StrategyParams, MatchOddsView } from '../engine';
import type { HistMatch, ResultMatch } from 'lib/predict/types';

const seed = (n: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'seed/leagues', n), 'utf8'));
const dataset: EngineDataset = {
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
dataset.allRes = dataset.allRes.filter((r) => r.date >= SINCE);
dataset.allHist = dataset.allHist.filter((h) => h.date >= SINCE);
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
const grid: SweepConfig[] = [
  { label: 'gs0.4', params: cfg(0.4) },
  { label: 'gs0.6', params: cfg(0.6) },
  { label: 'gs0.8', params: cfg(0.8) },
];

describe('P4 runSearch', () => {
  it('结构完整 + 冠军来自网格 + 三筛为布尔', async () => {
    const { epoch } = await runSearch(dataset, grid, { epoch: 1 });
    expect(epoch.gridSize).toBe(3);
    expect(epoch.cumulativeTrials).toBe(3);
    expect(epoch.configs).toHaveLength(3);
    expect(grid.map((g) => g.label)).toContain(epoch.winner.label);
    expect(epoch.pbo).toBeGreaterThanOrEqual(0);
    expect(epoch.pbo).toBeLessThanOrEqual(1);
    expect(typeof epoch.screen.overall).toBe('boolean');
  }, 120000);

  it('注册表累计(含传入的历史试验)', async () => {
    let reg = newRegistry();
    reg = registerTrial(reg, { prior: 1 });
    reg = registerTrial(reg, { prior: 2 }); // 已有 2 个历史试验
    const { epoch, registry } = await runSearch(dataset, grid, { registry: reg });
    expect(epoch.cumulativeTrials).toBe(5); // 2 历史 + 3 本轮
    expect(registry.trials).toHaveLength(5);
  }, 120000);

  it('确定性:同输入两次相等', async () => {
    const a = (await runSearch(dataset, grid, { epoch: 1 })).epoch;
    const b = (await runSearch(dataset, grid, { epoch: 1 })).epoch;
    expect(a).toEqual(b);
  }, 120000);

  it('EPL 1X2 null:冠军三筛不通过(已证无 edge)', async () => {
    const { epoch } = await runSearch(dataset, grid);
    expect(epoch.screen.overall).toBe(false); // CLV/PBO/DSR 至少一项不过
  }, 120000);
});
