/**
 * 模型 #2:Elo 实力模型(宏观)。
 * Elo 分优先用 eloratings.net 权威值(覆盖全部国家队),缺失回退自算。
 *   期望胜率 Ea = 1/(1+10^((Elo客−Elo主−H)/400)),H 为主场优势(中立0/美加墨主场100)
 *   再用平局模型把 Ea 拆为 胜/平/负(势均力敌时平局概率更高)。
 */
import type {
  PredictionModel,
  PredictionContext,
  MatchPrediction,
} from '../model';
import { ELO_DRAW_SCALE } from '../tuning';

const DRAW_MAX = 0.32; // 势均力敌时的平局基准概率(可经 eloDrawScale 放大)

export const eloModel: PredictionModel = {
  id: 'elo',
  nameKey: 'predict.modelElo',
  predict(ctx: PredictionContext): MatchPrediction | null {
    // 权威 Elo(eloratings.net)对任意队可用,不依赖 xG 摄取
    const eh = ctx.eloOf(ctx.homeNorm);
    const ea_ = ctx.eloOf(ctx.awayNorm);
    if (!Number.isFinite(eh) || !Number.isFinite(ea_)) return null;

    // 主队期望得分:Elo 差 + 主场优势 H(中立场 H=0,美加墨主场 H=100)
    const H = ctx.homeAdvantage ?? 0;
    const ea =
      1 / (1 + Math.pow(10, ((ea_ as number) - (eh as number) - H) / 400)); // 0~1
    // 平局模型:越接近 0.5(势均力敌)平局概率越高,悬殊时趋近 0
    const drawMax = DRAW_MAX * (ctx.tuning?.eloDrawScale ?? ELO_DRAW_SCALE);
    let d = drawMax * (1 - Math.abs(2 * ea - 1));
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
      // eloratings.net 为权威全量 Elo(数千场积累),视为高置信
      confidence: 'high',
    };
  },
};
