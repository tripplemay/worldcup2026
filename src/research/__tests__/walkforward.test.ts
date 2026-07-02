/**
 * P3a walk-forward 切分 + 嵌套选择 单测(seed 注入,结构 + 确定性)。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { sliceDates, nestedSelect } from '../walkforward';
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
const cfg = (shrinkEloScale: number, marketWeight: number): StrategyParams => ({
  tuning: { goalShrink: 0.6, dcRho: -0.14, shrinkEloScale },
  home: { eloBonus: 65, goalMult: 1.12 },
  marketWeight,
  bet,
});

describe('P3a walk-forward + 嵌套选择', () => {
  it('sliceDates 三分边界有序、含 embargo', () => {
    const p = sliceDates(dataset);
    expect(p.trainTo < p.valFrom).toBe(true); // embargo 隔离
    expect(p.valFrom <= p.valTo).toBe(true);
    expect(p.valTo < p.holdoutFrom).toBe(true);
    expect(p.holdoutFrom <= p.holdoutTo).toBe(true);
  });

  it('nestedSelect:IS 选优 + OOS 评,结构完整', () => {
    const part = sliceDates(dataset);
    const grid = [
      { label: 'shrink100/mw0.4', params: cfg(100, 0.4) },
      { label: 'shrink150/mw0.5', params: cfg(150, 0.5) },
    ];
    const r = nestedSelect(dataset, grid, part, 'gapBrier');
    expect(r.all).toHaveLength(2);
    expect(['shrink100/mw0.4', 'shrink150/mw0.5']).toContain(r.best.label);
    // 选出的是 IS gapBrier 最小者
    const minIsGap = Math.min(...r.all.map((a) => a.is.gapBrier));
    expect(r.best.is.gapBrier).toBeCloseTo(minIsGap);
    expect(Number.isFinite(r.best.oos.gapBrier)).toBe(true);
    expect(r.best.oos.matches).toBeGreaterThan(0);
  }, 60000);

  it('确定性:同输入两次相等', () => {
    const part = sliceDates(dataset);
    const grid = [{ label: 'a', params: cfg(100, 0.4) }];
    expect(nestedSelect(dataset, grid, part)).toEqual(
      nestedSelect(dataset, grid, part),
    );
  }, 60000);
});
