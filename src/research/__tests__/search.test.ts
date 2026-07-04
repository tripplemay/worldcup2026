/**
 * P4 搜索环单测:runSearch 结构、注册表累计(含传入)、确定性、EPL null 冠军三筛不过。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { runSearch, selectWinner, IS_CLV_SELECT_MIN_N } from '../search';
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
    const { epoch, registry } = await runSearch(dataset, grid, {
      registry: reg,
    });
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

  it('configs 带 IS 段 CLV 字段(两段式选参数据源)', async () => {
    const { epoch } = await runSearch(dataset, grid, { epoch: 1 });
    for (const c of epoch.configs) {
      expect(typeof c.isClvN).toBe('number');
      expect(typeof c.isClvT).toBe('number');
    }
  }, 120000);
});

describe('两段式选参 selectWinner(仪器修复:过滤参数进入选优)', () => {
  const row = (
    isGap: number,
    isClvN: number,
    isClvT: number,
    hash: string,
  ) => ({
    isGap,
    isClvN,
    isClvT,
    hash,
  });
  it('isGap 同组内按 IS 段 CLV t 选,不再按 hash 字典序', () => {
    const rows = [
      row(0.02, 60, 0.5, 'aaa'), // hash 最小但 CLV 弱
      row(0.02, 60, 2.5, 'zzz'), // CLV 强 → 应胜出
      row(0.03, 200, 9.9, 'bbb'), // isGap 更差 → 首键淘汰
    ];
    expect(selectWinner(rows, 'gapBrier').hash).toBe('zzz');
  });
  it(`IS 注数不足(<${IS_CLV_SELECT_MIN_N})沉底:t 再高也不可信`, () => {
    const rows = [row(0.02, 5, 99, 'aaa'), row(0.02, 60, 0.2, 'zzz')];
    expect(selectWinner(rows, 'gapBrier').hash).toBe('zzz');
  });
  it('全组注数不足 → 退回 isGap+hash 字典序(诚实缺省)', () => {
    const rows = [row(0.02, 5, 9, 'zzz'), row(0.02, 4, 1, 'aaa')];
    expect(selectWinner(rows, 'gapBrier').hash).toBe('aaa');
  });
  it("selectBy='clvT' 用 IS 段 CLV 而非 OOS(修选参泄漏)", () => {
    const rows = [
      { ...row(0.9, 60, 3.0, 'aaa'), oosClvT: -5 },
      { ...row(0.01, 60, 0.1, 'zzz'), oosClvT: 9 },
    ];
    expect(selectWinner(rows, 'clvT').hash).toBe('aaa');
  });
});
