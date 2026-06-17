/**
 * 模型 #1:xG 泊松模型(Bottom-Up 统计学模型,含 Dixon-Coles 低分修正)。
 *
 * λ主 = 主队场均创造 xG × 客队场均丢失 xG / 联赛基准(强度相乘)
 * μ客 = 客队场均创造 xG × 主队场均丢失 xG / 联赛基准
 * 进球矩阵 + Dixon-Coles 修正 → 胜平负/比分/大小球/BTTS(见 poissonCore)。中立场地,不加主场优势。
 */
import type { PredictionModel, PredictionContext } from '../model';
import { dcPoisson } from './poissonCore';

const clamp = (x: number) => Math.min(5, Math.max(0.15, x));

export const poissonXgModel: PredictionModel = {
  id: 'poisson-xg',
  nameKey: 'predict.modelPoisson',
  predict(ctx: PredictionContext) {
    const h = ctx.rating(ctx.homeNorm);
    const a = ctx.rating(ctx.awayNorm);
    if (!h || !a) return null;
    const L = Math.max(0.6, ctx.leagueAvg);
    const lambda = clamp((h.xgFor * a.xgAgainst) / L);
    const mu = clamp((a.xgFor * h.xgAgainst) / L);
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
