/**
 * 模型 #2:Elo 实力模型(宏观,基于历史胜负战绩)。
 * Elo 分由 ratings 阶段回放历史比赛得出。预测为中立场地(不加主场优势)。
 *   期望胜率 Ea = 1/(1+10^(-(Elo主-Elo客)/400))
 *   再用平局模型把 Ea 拆为 胜/平/负(势均力敌时平局概率更高)。
 */
import type {
  PredictionModel,
  PredictionContext,
  MatchPrediction,
} from '../model';

const DRAW_MAX = 0.32; // 势均力敌时的平局基准概率

function confidence(n: number): MatchPrediction['confidence'] {
  if (n >= 8) return 'high';
  if (n >= 4) return 'medium';
  return 'low';
}

export const eloModel: PredictionModel = {
  id: 'elo',
  nameKey: 'predict.modelElo',
  predict(ctx: PredictionContext): MatchPrediction | null {
    const h = ctx.rating(ctx.homeNorm);
    const a = ctx.rating(ctx.awayNorm);
    // 评分缺失或无 elo(如旧版 ratings)→ 干净跳过,绝不输出 NaN 污染融合
    if (!h || !a || !Number.isFinite(h.elo) || !Number.isFinite(a.elo)) {
      return null;
    }

    // 中立场地:不加主场优势
    const ea = 1 / (1 + Math.pow(10, (a.elo - h.elo) / 400)); // 主队期望得分 0~1
    // 平局模型:越接近 0.5(势均力敌)平局概率越高,悬殊时趋近 0
    let d = DRAW_MAX * (1 - Math.abs(2 * ea - 1));
    d = Math.min(d, 2 * Math.min(ea, 1 - ea)); // 保证 P(主)、P(客) ≥ 0
    const home = Math.max(0, ea - 0.5 * d);
    const away = Math.max(0, 1 - ea - 0.5 * d);
    const sum = home + d + away;
    const hw = home / sum;
    const dr = d / sum;
    const aw = away / sum;
    if (![hw, dr, aw].every(Number.isFinite)) return null;

    return {
      modelId: this.id,
      matchId: ctx.matchId,
      homeWin: +hw.toFixed(4),
      draw: +dr.toFixed(4),
      awayWin: +aw.toFixed(4),
      confidence: confidence(Math.min(h.sample, a.sample)),
    };
  },
};
