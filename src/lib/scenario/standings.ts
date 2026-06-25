/**
 * 当前真实小组形势 —— 由实时积分榜行 + 未赛对阵推导每队现状(供沙盘页「现状 vs 预测」对照)。
 * 纯函数,不触网;数据由 compute.ts 从 espnProvider.getStandings() / byGroup 喂入。
 */
import type { GroupMatch, TeamStanding } from './types';
import type { GroupStandingRow } from 'lib/espn/types';

/** ESPN 积分榜行 → TeamStanding(remaining 待 deriveRemaining 补)。 */
export function rowToStanding(row: GroupStandingRow): TeamStanding {
  return {
    rank: row.rank,
    played: row.played,
    win: row.win,
    draw: row.draw,
    loss: row.loss,
    gf: row.goalsFor,
    ga: row.goalsAgainst,
    gd: row.goalDiff,
    points: row.points,
    remaining: 0,
  };
}

/**
 * 由小组赛未赛场次推导每队的剩余对手(归一化名 → 剩余对手列表)。
 * 一场未赛比赛同时计入双方各自的剩余对手。
 */
export function deriveRemaining(
  matches: GroupMatch[],
  nameOf: (norm: string) => string,
): Record<string, { norm: string; name: string }[]> {
  const out: Record<string, { norm: string; name: string }[]> = {};
  for (const m of matches) {
    if (m.played) continue;
    (out[m.home] ??= []).push({ norm: m.away, name: nameOf(m.away) });
    (out[m.away] ??= []).push({ norm: m.home, name: nameOf(m.home) });
  }
  return out;
}
