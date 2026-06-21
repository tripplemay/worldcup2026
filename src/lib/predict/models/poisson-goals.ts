/**
 * 模型 #4:实际进球泊松(Dixon-Coles 修正)。
 *
 * 与 xG 泊松同构,但用「场均实际进球」而非 xG:
 * λ主 = 主队场均进球 × 客队场均失球 / 联赛进球基准;μ客 对称。
 * xG 衡量机会质量、进球衡量转化与结果,二者互补 → 给融合增加独立信号。
 */
import type { PredictionModel, PredictionContext } from '../model';
import { dcPoisson } from './poissonCore';
import { GOAL_SHRINK, DC_RHO, SHRINK_ELO_SCALE, effShrink } from '../tuning';

const clamp = (x: number) => Math.min(5, Math.max(0.15, x));
const damp = (raw: number, L: number, shrink: number) =>
  clamp(L + shrink * (raw - L));

export const poissonGoalsModel: PredictionModel = {
  id: 'poisson-goals',
  nameKey: 'predict.modelPoissonGoals',
  predict(ctx: PredictionContext) {
    const h = ctx.rating(ctx.homeNorm);
    const a = ctx.rating(ctx.awayNorm);
    if (!h || !a) return null;
    const L = Math.max(0.6, ctx.leagueAvgGoals);
    const base = ctx.tuning?.goalShrink ?? GOAL_SHRINK;
    const eh = ctx.eloOf?.(ctx.homeNorm);
    const ea = ctx.eloOf?.(ctx.awayNorm);
    const eloDiff = eh != null && ea != null ? Math.abs(eh - ea) : undefined;
    const shrink = effShrink(
      base,
      eloDiff,
      ctx.tuning?.shrinkEloScale ?? SHRINK_ELO_SCALE,
    );
    const hfa = ctx.homeGoalMult ?? 1; // 主场优势:主 λ×hfa、客 μ÷hfa(中立=1)
    const lambda = damp(((h.goalsFor * a.goalsAgainst) / L) * hfa, L, shrink);
    const mu = damp((a.goalsFor * h.goalsAgainst) / L / hfa, L, shrink);
    if (!Number.isFinite(lambda) || !Number.isFinite(mu)) return null;
    return dcPoisson({
      modelId: this.id,
      matchId: ctx.matchId,
      lambda,
      mu,
      sample: Math.min(h.sample, a.sample),
      rho: ctx.tuning?.dcRho ?? DC_RHO,
    });
  },
};
