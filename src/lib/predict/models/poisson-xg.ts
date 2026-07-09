/**
 * 模型 #1:xG 泊松模型(Bottom-Up 统计学模型,含 Dixon-Coles 低分修正)。
 *
 * λ主 = 主队场均创造 xG × 客队场均丢失 xG / 联赛基准(强度相乘)
 * μ客 = 客队场均创造 xG × 主队场均丢失 xG / 联赛基准
 * 进球矩阵 + Dixon-Coles 修正 → 胜平负/比分/大小球/BTTS(见 poissonCore)。中立场地,不加主场优势。
 */
import type { PredictionModel, PredictionContext } from '../model';
import { dcPoisson } from './poissonCore';
import { GOAL_SHRINK, DC_RHO, SHRINK_ELO_SCALE, effShrink } from '../tuning';

const clamp = (x: number) => Math.min(5, Math.max(0.15, x));
/** 向联赛均值 L 收缩(shrink<1 抑制大比分高估;1=不变)。 */
const damp = (raw: number, L: number, shrink: number) =>
  clamp(L + shrink * (raw - L));

export const poissonXgModel: PredictionModel = {
  id: 'poisson-xg',
  nameKey: 'predict.modelPoisson',
  predict(ctx: PredictionContext) {
    const h = ctx.rating(ctx.homeNorm);
    const a = ctx.rating(ctx.awayNorm);
    if (!h || !a) return null;
    const L = Math.max(0.6, ctx.leagueAvg);
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
    // 总进球水平缩放(λ、μ 同乘,净胜结构不变):非英超联赛代理 xG 水平系统性
    // 高于真实进球,damp 锚 L=xgFor 均值修不到总水平 —— 研究内核逐联赛校准此参
    const ts = ctx.tuning?.totalScale ?? 1;
    const lambda = clamp(
      damp(((h.xgFor * a.xgAgainst) / L) * hfa, L, shrink) * ts,
    );
    const mu = clamp(damp((a.xgFor * h.xgAgainst) / L / hfa, L, shrink) * ts);
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
