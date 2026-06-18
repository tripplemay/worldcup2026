/**
 * 球队评测打分(纯函数,可测)。各轴归一化到 0–100;总评级偏「当前状态」。
 * 标尺为经验值,集中在此便于调参。
 */
import type { SquadDepth } from './types';

export const clamp100 = (x: number) => Math.max(0, Math.min(100, x));

/** 线性映射 [lo,hi] → [0,100] 并钳制。 */
export const mapRange = (x: number, lo: number, hi: number) =>
  clamp100(((x - lo) / (hi - lo)) * 100);

// ── 实力档案四轴 ─────────────────────────────────────
/** 进攻:杯赛场均创造 xG(0→2.5)。 */
export const attackScore = (xgForPerMatch: number) =>
  mapRange(xgForPerMatch, 0, 2.5);

/** 防守:杯赛场均丢失 xG 反向(0→满分,2.0→0 分)。 */
export const defenseScore = (xgAgainstPerMatch: number) =>
  clamp100(100 - mapRange(xgAgainstPerMatch, 0, 2.0));

/** 实力:Elo(1350→0,2050→100)。 */
export const strengthScore = (elo: number) => mapRange(elo, 1350, 2050);

/** 阵容:首发赛季均评分(6.2→7.4)+ 五大联赛占比加成;无数据返回 null。 */
export function squadScore(depth: SquadDepth | null): number | null {
  if (!depth || !depth.count) return null;
  return clamp100(mapRange(depth.avgRating, 6.2, 7.4) + 12 * depth.top5Share);
}

// ── 当前状态三轴 ─────────────────────────────────────
/** 动能:TMI 总分 [-1,1] → [0,100]。 */
export const momentumScore = (tmiTotal: number) =>
  clamp100(((tmiTotal + 1) / 2) * 100);

/** 体能:TMI 体能惩罚(0..-0.6)→ 100..40。 */
export const fitnessScore = (fatiguePenalty: number) =>
  clamp100(100 + (fatiguePenalty / 0.6) * 60);

/** 近期走势:近 N 场积分率(W=3/D=1/L=0);无场次记中性 50。 */
export function formScore(results: Array<'W' | 'D' | 'L' | ''>): number {
  const played = results.filter((r) => r === 'W' || r === 'D' || r === 'L');
  if (!played.length) return 50;
  const pts = played.reduce(
    (a, r) => a + (r === 'W' ? 3 : r === 'D' ? 1 : 0),
    0,
  );
  return clamp100((pts / (played.length * 3)) * 100);
}

/** 总评级(0–100,偏当前状态):动能 50% · 近期走势 30% · 体能 20%。 */
export function grade(state: {
  momentum: number;
  recentForm: number;
  fitness: number;
}): number {
  return Math.round(
    0.5 * state.momentum + 0.3 * state.recentForm + 0.2 * state.fitness,
  );
}

/** 评级 → 字母档(仅展示用)。 */
export function gradeLetter(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}
