/**
 * poisson-xg 模型单测:totalScale 总进球水平缩放(2026-07-09 研究平台复盘新增)。
 * 背景:冻结 EPL 内核在非英超联赛把 λ+μ 系统性高估 +24%~39%(damp 锚 leagueAvg=
 * 球队 xgFor 均值,高于真实进球水平)—— totalScale 是唯一能修总水平的自由度。
 */
import { poissonXgModel } from '../poisson-xg';
import type { PredictionContext } from '../../model';
import type { TeamRating } from '../../types';

const rating = (xgFor: number, xgAgainst: number): TeamRating => ({
  norm: 't',
  name: 't',
  xgFor,
  xgAgainst,
  goalsFor: 1.3,
  goalsAgainst: 1.3,
  elo: 1500,
  sample: 20,
  updatedAt: 0,
});

const ctx = (totalScale?: number): PredictionContext => ({
  matchId: 'm1',
  homeName: 'a',
  awayName: 'b',
  homeNorm: 'a',
  awayNorm: 'b',
  neutral: true,
  homeAdvantage: 0,
  homeGoalMult: 1,
  leagueAvg: 1.5,
  leagueAvgGoals: 1.2,
  rating: (n) => (n === 'a' ? rating(1.9, 1.1) : rating(1.4, 1.6)),
  eloOf: () => undefined,
  tuning: { goalShrink: 0.6, dcRho: -0.14, totalScale },
});

describe('poisson-xg totalScale(总进球水平缩放)', () => {
  it('缺省/1 = 行为不变;0.8 → λ、μ 各缩到 0.8×(净胜结构不变)', () => {
    const base = poissonXgModel.predict(ctx(undefined))!;
    const one = poissonXgModel.predict(ctx(1))!;
    const scaled = poissonXgModel.predict(ctx(0.8))!;
    expect(one.xgHome).toBeCloseTo(base.xgHome!, 10);
    expect(one.xgAway).toBeCloseTo(base.xgAway!, 10);
    // xgHome/xgAway 经 toFixed(2) 舍入 → 容差放到 ±0.01
    expect(Math.abs(scaled.xgHome! - base.xgHome! * 0.8)).toBeLessThanOrEqual(
      0.01,
    );
    expect(Math.abs(scaled.xgAway! - base.xgAway! * 0.8)).toBeLessThanOrEqual(
      0.01,
    );
  });

  it('缩小总水平 → 平局概率上升(低分化的必然方向)', () => {
    const base = poissonXgModel.predict(ctx(1))!;
    const scaled = poissonXgModel.predict(ctx(0.7))!;
    expect(scaled.draw).toBeGreaterThan(base.draw);
    // 三向概率仍归一
    expect(scaled.homeWin + scaled.draw + scaled.awayWin).toBeCloseTo(1, 6);
  });

  it('极端缩放被 clamp 兜底(不产出非法 λ)', () => {
    const tiny = poissonXgModel.predict(ctx(0.01))!;
    expect(tiny.xgHome).toBeGreaterThanOrEqual(0.15);
    expect(tiny.xgAway).toBeGreaterThanOrEqual(0.15);
  });
});
