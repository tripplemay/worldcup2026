/**
 * 模型融合(Stacking):对各模型的胜平负做加权平均 → 最终共识概率。
 *
 * 上下文感知动态权重(Phase 5):市场固定锚定 0.2,其余在泊松↔Elo 间按 Elo 差动态分配——
 *  · 实力悬殊(|ΔElo|>250):宏观实力主导 → Elo 重(0.8)、泊松轻(0.2)
 *  · 势均力敌(|ΔElo|<50):近期战术状态主导 → 泊松重(0.7)、Elo 轻(0.3)
 *  · 常规:0.45/0.55
 * env PREDICT_WEIGHTS 可作静态逃生舱覆盖。进球细节沿用泊松。
 */
import type { MatchPrediction } from './model';

const MARKET_W = 0.2; // 市场隐含锚定权重默认(WC;联赛经 sweep 提高,见 leagues.ts calib)

/** 解析 env 静态权重覆盖(逃生舱);未设返回 null。 */
function staticOverride(): Record<string, number> | null {
  const raw = process.env.PREDICT_WEIGHTS;
  if (!raw) return null;
  const out: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split(':');
    const n = Number(v);
    if (k && Number.isFinite(n)) out[k.trim()] = n;
  }
  return Object.keys(out).length ? out : null;
}

/** 按 Elo 差动态权重(market 锚定 marketW,其余在 poisson↔elo 间按 |ΔElo| 动态)。 */
function dynamicWeights(
  eloDiff?: number,
  marketW = MARKET_W,
): Record<string, number> {
  const override = staticOverride();
  if (override) return override;
  let pPoisson = 0.45;
  let pElo = 0.55;
  if (eloDiff != null) {
    if (eloDiff > 250) {
      pPoisson = 0.2;
      pElo = 0.8;
    } else if (eloDiff < 50) {
      pPoisson = 0.7;
      pElo = 0.3;
    }
  }
  const rest = 1 - marketW;
  // 泊松总权重在 xG 与 实际进球 间 6:4 拆分(xG 一般更稳),保持泊松总影响不变
  return {
    'poisson-xg': +(rest * pPoisson * 0.6).toFixed(3),
    'poisson-goals': +(rest * pPoisson * 0.4).toFixed(3),
    elo: +(rest * pElo).toFixed(3),
    market: marketW,
  };
}

export function ensemble(
  all: MatchPrediction[],
  matchId: string,
  eloDiff?: number,
  marketWeight = MARKET_W, // 竞赛市场锚定权重(WC 0.2;联赛见 calib)
): MatchPrediction | null {
  // 防御:只纳入概率有限的模型,绝不让 NaN 污染融合
  const preds = all.filter((p) =>
    [p.homeWin, p.draw, p.awayWin].every(Number.isFinite),
  );
  if (!preds.length) return null;
  const W = dynamicWeights(eloDiff, marketWeight);
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
    confidence: poisson?.confidence ?? 'medium',
    xgHome: poisson?.xgHome,
    xgAway: poisson?.xgAway,
    topScores: poisson?.topScores,
    over25: poisson?.over25,
    under25: poisson?.under25,
    btts: poisson?.btts,
  };
}
