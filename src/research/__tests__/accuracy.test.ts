/**
 * 精度测量(gap-to-market)单测:注入 seed(含已提交 oddsx),小窗断言结构 + 确定性。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { runAccuracy } from '../accuracy';
import type { AccuracyParams } from '../accuracy';
import type { EngineDataset, MatchOddsView } from '../engine';
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

const params: AccuracyParams = {
  tuning: { goalShrink: 0.6, dcRho: -0.14, shrinkEloScale: 100 },
  home: { eloBonus: 65, goalMult: 1.12 },
  marketWeight: 0.4,
  from: '2026-03-01', // 末段小窗(前有充足历史)
};

describe('runAccuracy(gap-to-market)', () => {
  it('产出双方 Brier + gap,数值合理', () => {
    const r = runAccuracy(dataset, params);
    expect(r.n).toBeGreaterThan(0);
    expect(r.ours.brier).toBeGreaterThan(0);
    expect(r.ours.brier).toBeLessThan(1);
    expect(r.market.brier).toBeGreaterThan(0);
    expect(r.market.brier).toBeLessThan(1);
    expect(Number.isFinite(r.gapBrier)).toBe(true);
    expect(r.ours.n).toBe(r.market.n); // 同批比赛
    expect(r.perModel['poisson-xg']).toBeDefined();
  });

  it('确定性:同输入两次相等', () => {
    expect(runAccuracy(dataset, params)).toEqual(runAccuracy(dataset, params));
  });
});
