/**
 * 模型 #4:实际进球泊松(Dixon-Coles 修正)。
 *
 * 与 xG 泊松同构,但用「场均实际进球」而非 xG:
 * λ主 = 主队场均进球 × 客队场均失球 / 联赛进球基准;μ客 对称。
 * xG 衡量机会质量、进球衡量转化与结果,二者互补 → 给融合增加独立信号。
 */
import type { PredictionModel, PredictionContext } from '../model';
import { dcPoisson } from './poissonCore';

const clamp = (x: number) => Math.min(5, Math.max(0.15, x));

export const poissonGoalsModel: PredictionModel = {
  id: 'poisson-goals',
  nameKey: 'predict.modelPoissonGoals',
  predict(ctx: PredictionContext) {
    const h = ctx.rating(ctx.homeNorm);
    const a = ctx.rating(ctx.awayNorm);
    if (!h || !a) return null;
    const L = Math.max(0.6, ctx.leagueAvgGoals);
    const lambda = clamp((h.goalsFor * a.goalsAgainst) / L);
    const mu = clamp((a.goalsFor * h.goalsAgainst) / L);
    if (!Number.isFinite(lambda) || !Number.isFinite(mu)) return null;
    return dcPoisson({
      modelId: this.id,
      matchId: ctx.matchId,
      lambda,
      mu,
      sample: Math.min(h.sample, a.sample),
    });
  },
};
