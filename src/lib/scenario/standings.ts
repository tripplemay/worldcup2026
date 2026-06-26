/**
 * 当前真实小组形势 —— 由实时积分榜行 + 未赛对阵推导每队现状(供沙盘页「现状 vs 预测」对照)。
 * 纯函数,不触网;数据由 compute.ts 从 espnProvider.getStandings() / byGroup 喂入。
 */
import { getFifaRank } from 'lib/data/fifaRanking';
import { rankGroup } from './groupSim';
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

/** 可达名次区间 + 锁定/出局标志(单组)。 */
export interface RankRange {
  bestRank: number;
  worstRank: number;
  clinchedTop1: boolean;
  clinchedTop2: boolean;
  eliminatedTop2: boolean;
}

/** 胜/平/负 → 代表比分(喂 rankGroup 做名次枚举;净胜球临界情形为估算)。 */
const REP_SCORE: [number, number][] = [
  [1, 0], // 0 = 主胜
  [0, 0], // 1 = 平
  [0, 1], // 2 = 客胜
];

/**
 * 由「已赛(真实赛果)+ 剩余小组赛」枚举每队**可达组内名次区间** + 锁定/出局标志(T2)。
 *
 * 枚举每场剩余比赛的胜/平/负(代表比分),用 rankGroup 套 2026 抢断算名次,取每队 min/max。
 * - clinchedTop2 = 任何剩余结果下都 ≤ 第 2(直接出线已锁);clinchedTop1 同理对头名。
 * - eliminatedTop2 = 任何剩余结果下都 ≥ 第 3(无缘前二;仍可能以第三名出线 → 另看 thirdRace)。
 * ⚠ 基于胜平负枚举,净胜球临界情形可能略有出入;末轮剩 ≤2 场时几乎精确。
 * 剩余场次过多(>5,小组赛初期)直接返回 undefined(此时区间无信息量)。
 */
export function reachableRankRange(
  matches: GroupMatch[],
  fifaRankOf: (team: string) => number | undefined = getFifaRank,
): Record<string, RankRange> | undefined {
  const teams = Array.from(new Set(matches.flatMap((m) => [m.home, m.away])));
  if (teams.length === 0) return undefined;
  const played = matches.filter((m) => m.played);
  const unplayed = matches.filter((m) => !m.played);
  if (unplayed.length > 5) return undefined; // 初期组合爆炸且无信息量

  const seen: Record<string, Set<number>> = {};
  for (const t of teams) seen[t] = new Set();

  const combos = 3 ** unplayed.length;
  for (let c = 0; c < combos; c++) {
    let code = c;
    const filled: GroupMatch[] = unplayed.map((m) => {
      const r = code % 3;
      code = Math.floor(code / 3);
      const [hg, ag] = REP_SCORE[r];
      return { ...m, homeGoals: hg, awayGoals: ag, played: true };
    });
    const rows = rankGroup([...played, ...filled], fifaRankOf);
    for (const row of rows) seen[row.team]?.add(row.rank);
  }

  const out: Record<string, RankRange> = {};
  for (const t of teams) {
    const ranks = [...seen[t]];
    if (!ranks.length) continue;
    const bestRank = Math.min(...ranks);
    const worstRank = Math.max(...ranks);
    out[t] = {
      bestRank,
      worstRank,
      clinchedTop1: worstRank === 1,
      clinchedTop2: worstRank <= 2,
      eliminatedTop2: bestRank >= 3,
    };
  }
  return out;
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
