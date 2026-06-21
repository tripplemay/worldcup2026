/**
 * 泊松进球矩阵核心(xG 泊松 / 进球泊松 共用),含 Dixon-Coles 低分修正。
 *
 * 独立泊松假设主客进球独立,会低估 0-0/1-0/0-1/1-1 与平局;Dixon-Coles 用相关参数 ρ
 * 对这 4 个比分加修正因子 τ,提升低分/平局校准。其余比分 τ=1。
 * ρ 取小负值(默认 -0.10);λ 已 clamp≤5,保证 τ>0(λ|ρ|<1)。
 */
import type { MatchPrediction, ScoreProb } from '../model';
import { DC_RHO } from '../tuning';

const MAXG = 8; // 进球矩阵上限(0..8,尾部概率极小)

/** 泊松概率质量 P(X=k) = e^-λ λ^k / k!。 */
function pmf(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

/** Dixon-Coles 低分修正因子 τ(只影响 0-0/1-0/0-1/1-1);rho 更负=更多平局/低分。 */
function tau(
  i: number,
  j: number,
  lambda: number,
  mu: number,
  rho: number,
): number {
  if (i === 0 && j === 0) return 1 - lambda * mu * rho;
  if (i === 0 && j === 1) return 1 + lambda * rho;
  if (i === 1 && j === 0) return 1 + mu * rho;
  if (i === 1 && j === 1) return 1 - rho;
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
export function buildMatrix(
  lambda: number,
  mu: number,
  rho: number = DC_RHO,
): number[][] {
  const ph = Array.from({ length: MAXG + 1 }, (_, i) => pmf(i, lambda));
  const pa = Array.from({ length: MAXG + 1 }, (_, j) => pmf(j, mu));
  const m: number[][] = [];
  let total = 0;
  for (let i = 0; i <= MAXG; i++) {
    m[i] = [];
    for (let j = 0; j <= MAXG; j++) {
      const p = ph[i] * pa[j] * tau(i, j, lambda, mu, rho);
      m[i][j] = p;
      total += p;
    }
  }
  if (total > 0)
    for (let i = 0; i <= MAXG; i++)
      for (let j = 0; j <= MAXG; j++) m[i][j] /= total;
  return m;
}

/** 从(归一化)比分矩阵汇总盘口:大/小 2.5、双方进球、最可能比分(降序前 8)。 */
export function scoreStatsFromMatrix(m: number[][]): {
  over25: number;
  under25: number;
  btts: number;
  topScores: ScoreProb[];
} {
  let over25 = 0;
  let btts = 0;
  let total = 0;
  const scores: ScoreProb[] = [];
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      total += p;
      if (i + j >= 3) over25 += p;
      if (i >= 1 && j >= 1) btts += p;
      scores.push({ score: `${i}-${j}`, p });
    }
  }
  const t = total || 1;
  const norm = (x: number) => +(x / t).toFixed(4);
  return {
    over25: norm(over25),
    under25: +(1 - over25 / t).toFixed(4),
    btts: norm(btts),
    topScores: scores
      .map((s) => ({ score: s.score, p: norm(s.p) }))
      .sort((x, y) => y.p - x.p)
      .slice(0, 8),
  };
}

/**
 * 后验矩阵倾斜(Phase 8.1 Q5,展示层):把原始泊松比分矩阵按「ensemble 头条 / 泊松 1X2」
 * 分区(主胜 i>j / 平 i=j / 客胜 i<j)整体缩放后重归一化 → 倾斜矩阵的胜平负严格等于 ensemble
 * 头条,使展示的比分/大小球与头条数学自洽(解决"84% 胜率却首推 1-1")。pois/ens 一致时为恒等。
 */
export function tiltMatrix(
  m: number[][],
  pois: { h: number; d: number; a: number },
  ens: { h: number; d: number; a: number },
): number[][] {
  const eps = 1e-6;
  const sH = ens.h / Math.max(eps, pois.h);
  const sD = ens.d / Math.max(eps, pois.d);
  const sA = ens.a / Math.max(eps, pois.a);
  let total = 0;
  const out = m.map((row, i) =>
    row.map((p, j) => {
      const v = p * (i > j ? sH : i === j ? sD : sA);
      total += v;
      return v;
    }),
  );
  if (total > 0)
    for (let i = 0; i < out.length; i++)
      for (let j = 0; j < out[i].length; j++) out[i][j] /= total;
  return out;
}

/**
 * 对 ensemble 预测做展示层后验倾斜:用 poisson-xg 的 λ/μ 重建矩阵,按(泊松 1X2 → ensemble 头条)
 * 倾斜,重算比分/大小球/双方进球挂回 ensemble(头条 1X2 不变)。无 poisson 腿则原样返回。
 * 仅用于实时展示路径;回测/交易决策仍走原始分布。
 */
export function tiltEnsembleScores(
  ens: MatchPrediction,
  models: MatchPrediction[],
): MatchPrediction {
  const pois = models.find((p) => p.modelId === 'poisson-xg');
  if (
    !pois ||
    pois.xgHome == null ||
    pois.xgAway == null ||
    !Number.isFinite(pois.homeWin)
  )
    return ens;
  const raw = buildMatrix(pois.xgHome, pois.xgAway, DC_RHO);
  const tilted = tiltMatrix(
    raw,
    { h: pois.homeWin, d: pois.draw, a: pois.awayWin },
    { h: ens.homeWin, d: ens.draw, a: ens.awayWin },
  );
  const s = scoreStatsFromMatrix(tilted);
  return { ...ens, ...s };
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
  rho?: number;
}): MatchPrediction {
  const { modelId, matchId, lambda, mu, sample } = opts;
  const rho = opts.rho ?? DC_RHO;
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
      const p = ph[i] * pa[j] * tau(i, j, lambda, mu, rho);
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
    .slice(0, 8); // 多留候选,供「与预测方一致的最可能比分」筛选(展示层再截断)

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
