/**
 * 模型 #1:xG 泊松模型(spec 的 Bottom-Up 统计学模型)。
 *
 * λ主 = 主队场均创造 xG × 客队场均丢失 xG / 联赛基准(Dixon-Coles 风格强度相乘)
 * μ客 = 客队场均创造 xG × 主队场均丢失 xG / 联赛基准
 * 进球数服从泊松分布,独立假设构建 0..MAXG 进球矩阵 → 胜平负/比分/大小球/BTTS。
 * 中立场地,不加主场优势。
 */
import type {
  PredictionModel,
  PredictionContext,
  MatchPrediction,
  ScoreProb,
} from '../model';

const MAXG = 8; // 进球矩阵上限(0..8,尾部概率极小)

/** 泊松概率质量 P(X=k) = e^-λ λ^k / k!。 */
function pmf(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

const clamp = (x: number) => Math.min(5, Math.max(0.15, x));

function confidence(n: number): MatchPrediction['confidence'] {
  if (n >= 8) return 'high';
  if (n >= 4) return 'medium';
  return 'low';
}

export const poissonXgModel: PredictionModel = {
  id: 'poisson-xg',
  nameKey: 'predict.modelPoisson',
  predict(ctx: PredictionContext): MatchPrediction | null {
    const h = ctx.rating(ctx.homeNorm);
    const a = ctx.rating(ctx.awayNorm);
    if (!h || !a) return null;

    const L = Math.max(0.6, ctx.leagueAvg);
    const lambda = clamp((h.xgFor * a.xgAgainst) / L); // 主队预期进球
    const mu = clamp((a.xgFor * h.xgAgainst) / L); // 客队预期进球
    if (!Number.isFinite(lambda) || !Number.isFinite(mu)) return null;

    // 进球分布向量
    const ph = Array.from({ length: MAXG + 1 }, (_, i) => pmf(i, lambda));
    const pa = Array.from({ length: MAXG + 1 }, (_, j) => pmf(j, mu));

    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;
    let over25 = 0;
    let btts = 0;
    let total = 0;
    const scores: ScoreProb[] = [];
    for (let i = 0; i <= MAXG; i++) {
      for (let j = 0; j <= MAXG; j++) {
        const p = ph[i] * pa[j];
        total += p;
        if (i > j) homeWin += p;
        else if (i === j) draw += p;
        else awayWin += p;
        if (i + j >= 3) over25 += p;
        if (i >= 1 && j >= 1) btts += p;
        scores.push({ score: `${i}-${j}`, p });
      }
    }
    if (!Number.isFinite(total) || total <= 0) return null;
    // 归一化(截断尾部补偿)
    const norm = (x: number) => +(x / total).toFixed(4);
    const topScores = scores
      .map((s) => ({ score: s.score, p: norm(s.p) }))
      .sort((x, y) => y.p - x.p)
      .slice(0, 3);

    return {
      modelId: this.id,
      matchId: ctx.matchId,
      homeWin: norm(homeWin),
      draw: norm(draw),
      awayWin: norm(awayWin),
      xgHome: +lambda.toFixed(2),
      xgAway: +mu.toFixed(2),
      topScores,
      over25: norm(over25),
      under25: +(1 - over25 / total).toFixed(4),
      btts: norm(btts),
      confidence: confidence(Math.min(h.sample, a.sample)),
    };
  },
};
