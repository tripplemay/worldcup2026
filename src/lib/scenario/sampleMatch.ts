/**
 * 比分采样器:把单场融合预测变成可重复抽样的具体比分。
 *
 * 做法:用泊松腿的 λ/μ 建 Dixon-Coles 比分矩阵,再按「该矩阵原生胜平负 → 融合头条胜平负」
 * 整体区域缩放(复用展示层同款 tiltMatrix)→ 采样比分的胜平负严格等于融合头条,同时进球分布
 * 由泊松给出(供小组净胜/进球抢断与淘汰赛点球判定)。无 λ/μ 时退化为按 1X2 抽代表比分。
 */
import { buildMatrix, tiltMatrix } from 'lib/predict/models/poissonCore';
import type { MatchPrediction } from 'lib/predict/model';
import type { Rng } from './rng';
import { sampleCumulative } from './rng';

export interface SampledScore {
  homeGoals: number;
  awayGoals: number;
}

/** 预建采样器:并行的比分表 + 累积分布。 */
export interface ScoreSampler {
  hg: number[];
  ag: number[];
  cum: number[];
  /** 融合头条(供点球判定等复用)。 */
  pHome: number;
  pDraw: number;
  pAway: number;
}

/** 由矩阵求原生胜平负区域和。 */
function regionSums(m: number[][]): { h: number; d: number; a: number } {
  let h = 0;
  let d = 0;
  let a = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      if (i > j) h += p;
      else if (i === j) d += p;
      else a += p;
    }
  return { h, d, a };
}

/** 从融合预测构建比分采样器(一次构建,多次采样)。 */
export function buildScoreSampler(pred: MatchPrediction): ScoreSampler {
  const pHome = pred.homeWin;
  const pDraw = pred.draw;
  const pAway = pred.awayWin;

  // 无 λ/μ(如 Elo-only 融合):退化为按头条抽代表比分
  if (pred.xgHome == null || pred.xgAway == null) {
    const hg = [1, 1, 0];
    const ag = [0, 1, 1];
    const cum = [pHome, pHome + pDraw, 1];
    return { hg, ag, cum, pHome, pDraw, pAway };
  }

  const raw = buildMatrix(pred.xgHome, pred.xgAway);
  const native = regionSums(raw);
  const tilted = tiltMatrix(raw, native, { h: pHome, d: pDraw, a: pAway });

  const hg: number[] = [];
  const ag: number[] = [];
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < tilted.length; i++)
    for (let j = 0; j < tilted[i].length; j++) {
      acc += tilted[i][j];
      hg.push(i);
      ag.push(j);
      cum.push(acc);
    }
  // 收尾归一(浮点误差)
  if (acc > 0) for (let k = 0; k < cum.length; k++) cum[k] /= acc;
  return { hg, ag, cum, pHome, pDraw, pAway };
}

/** 从采样器抽一个比分。 */
export function sampleScore(s: ScoreSampler, rng: Rng): SampledScore {
  const k = sampleCumulative(s.cum, rng);
  return { homeGoals: s.hg[k], awayGoals: s.ag[k] };
}
