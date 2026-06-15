/**
 * 模型 #3:市场隐含概率(群体智慧)。
 * 取该场各家最优 h2h 赔率,1/赔率 得原始隐含概率,除以总和(去抽水/overround)
 * 得归一化的市场隐含胜平负。免费——复用我们已抓的赔率,无额外配额。
 */
import type {
  PredictionModel,
  PredictionContext,
  MatchPrediction,
} from '../model';

export const marketImpliedModel: PredictionModel = {
  id: 'market',
  nameKey: 'predict.modelMarket',
  predict(ctx: PredictionContext): MatchPrediction | null {
    const o = ctx.marketOdds;
    if (!o || !o.home || !o.draw || !o.away) return null;
    const rh = 1 / o.home;
    const rd = 1 / o.draw;
    const ra = 1 / o.away;
    const overround = rh + rd + ra;
    if (overround <= 0) return null;
    return {
      modelId: this.id,
      matchId: ctx.matchId,
      homeWin: +(rh / overround).toFixed(4),
      draw: +(rd / overround).toFixed(4),
      awayWin: +(ra / overround).toFixed(4),
      // 市场盘口通常多家覆盖,视为中等置信
      confidence: 'medium',
    };
  },
};
