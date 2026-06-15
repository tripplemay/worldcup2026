/**
 * 模型融合(Stacking):对各模型的胜平负做加权平均 → 最终共识概率。
 * 权重默认 泊松0.4 / Elo0.4 / 市场0.2,可用 env PREDICT_WEIGHTS 热覆盖。
 * 只对实际产出预测的模型加权(权重重归一化),进球细节沿用泊松。
 */
import type { MatchPrediction } from './model';

const DEFAULT_WEIGHTS: Record<string, number> = {
  'poisson-xg': 0.4,
  elo: 0.4,
  market: 0.2,
};

function weights(): Record<string, number> {
  const raw = process.env.PREDICT_WEIGHTS; // 形如 "poisson-xg:0.4,elo:0.4,market:0.2"
  if (!raw) return DEFAULT_WEIGHTS;
  const out: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split(':');
    const n = Number(v);
    if (k && Number.isFinite(n)) out[k.trim()] = n;
  }
  return Object.keys(out).length ? out : DEFAULT_WEIGHTS;
}

export function ensemble(
  all: MatchPrediction[],
  matchId: string,
): MatchPrediction | null {
  // 防御:只纳入概率有限的模型,绝不让 NaN 污染融合
  const preds = all.filter((p) =>
    [p.homeWin, p.draw, p.awayWin].every(Number.isFinite),
  );
  if (!preds.length) return null;
  const W = weights();
  let wsum = 0;
  let h = 0;
  let d = 0;
  let a = 0;
  for (const p of preds) {
    const w = W[p.modelId] ?? 0.2;
    wsum += w;
    h += w * p.homeWin;
    d += w * p.draw;
    a += w * p.awayWin;
  }
  const s = h + d + a;
  if (wsum <= 0 || !Number.isFinite(s) || s <= 0) return null;
  const poisson = preds.find((p) => p.modelId === 'poisson-xg');
  return {
    modelId: 'ensemble',
    matchId,
    homeWin: +(h / s).toFixed(4),
    draw: +(d / s).toFixed(4),
    awayWin: +(a / s).toFixed(4),
    confidence: poisson?.confidence ?? 'low',
    xgHome: poisson?.xgHome,
    xgAway: poisson?.xgAway,
    topScores: poisson?.topScores,
    over25: poisson?.over25,
    under25: poisson?.under25,
    btts: poisson?.btts,
  };
}
