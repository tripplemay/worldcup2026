/**
 * 泊松进球矩阵核心(xG 泊松 / 进球泊松 共用),含 Dixon-Coles 低分修正。
 *
 * 独立泊松假设主客进球独立,会低估 0-0/1-0/0-1/1-1 与平局;Dixon-Coles 用相关参数 ρ
 * 对这 4 个比分加修正因子 τ,提升低分/平局校准。其余比分 τ=1。
 * ρ 取小负值(默认 -0.10);λ 已 clamp≤5,保证 τ>0(λ|ρ|<1)。
 */
import type { MatchPrediction, ScoreProb } from '../model';

const MAXG = 8; // 进球矩阵上限(0..8,尾部概率极小)
const RHO = Number(process.env.PREDICT_DC_RHO ?? -0.1); // Dixon-Coles 低分相关参数

/** 泊松概率质量 P(X=k) = e^-λ λ^k / k!。 */
function pmf(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

/** Dixon-Coles 低分修正因子 τ(只影响 0-0/1-0/0-1/1-1)。 */
function tau(i: number, j: number, lambda: number, mu: number): number {
  if (i === 0 && j === 0) return 1 - lambda * mu * RHO;
  if (i === 0 && j === 1) return 1 + lambda * RHO;
  if (i === 1 && j === 0) return 1 + mu * RHO;
  if (i === 1 && j === 1) return 1 - RHO;
  return 1;
}

function confidence(n: number): MatchPrediction['confidence'] {
  if (n >= 8) return 'high';
  if (n >= 4) return 'medium';
  return 'low';
}

/**
 * 由 λ/μ 构建归一化比分矩阵 m[i][j]=P(主 i 球, 客 j 球)(含 Dixon-Coles 修正)。
 * 供盘口投影(projectMarkets)降维求和。i,j ∈ [0, MAXG]。
 */
export function buildMatrix(lambda: number, mu: number): number[][] {
  const ph = Array.from({ length: MAXG + 1 }, (_, i) => pmf(i, lambda));
  const pa = Array.from({ length: MAXG + 1 }, (_, j) => pmf(j, mu));
  const m: number[][] = [];
  let total = 0;
  for (let i = 0; i <= MAXG; i++) {
    m[i] = [];
    for (let j = 0; j <= MAXG; j++) {
      const p = ph[i] * pa[j] * tau(i, j, lambda, mu);
      m[i][j] = p;
      total += p;
    }
  }
  if (total > 0)
    for (let i = 0; i <= MAXG; i++)
      for (let j = 0; j <= MAXG; j++) m[i][j] /= total;
  return m;
}

/**
 * 由主客预期进球 λ/μ 构建进球矩阵(Dixon-Coles 修正)→ 胜平负/最可能比分/大小球/双方进球。
 * 调用方需保证 λ/μ 为有限正数(已 clamp)。
 */
export function dcPoisson(opts: {
  modelId: string;
  matchId: string;
  lambda: number;
  mu: number;
  sample: number;
}): MatchPrediction {
  const { modelId, matchId, lambda, mu, sample } = opts;
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
      const p = ph[i] * pa[j] * tau(i, j, lambda, mu);
      total += p;
      if (i > j) homeWin += p;
      else if (i === j) draw += p;
      else awayWin += p;
      if (i + j >= 3) over25 += p;
      if (i >= 1 && j >= 1) btts += p;
      scores.push({ score: `${i}-${j}`, p });
    }
  }
  const norm = (x: number) => +(x / total).toFixed(4);
  const topScores = scores
    .map((s) => ({ score: s.score, p: norm(s.p) }))
    .sort((x, y) => y.p - x.p)
    .slice(0, 3);

  return {
    modelId,
    matchId,
    homeWin: norm(homeWin),
    draw: norm(draw),
    awayWin: norm(awayWin),
    xgHome: +lambda.toFixed(2),
    xgAway: +mu.toFixed(2),
    topScores,
    over25: norm(over25),
    under25: +(1 - over25 / total).toFixed(4),
    btts: norm(btts),
    confidence: confidence(sample),
  };
}
