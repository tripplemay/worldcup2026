/**
 * 小组赛名次:由一组的全部比赛赛果(真实已赛 + 采样未赛)算 1–4 名,实现 2026 抢断规则。
 *
 * 2026 组内排序(注意:相互交锋先于总净胜,与 2018/2022 不同):
 *   1 积分
 *   2 相互交锋积分      ┐ 仅取「并列诸队之间」的比赛构成迷你联赛
 *   3 相互交锋净胜球    │ 若迷你联赛把并列队分成更小的并列子集,对子集「重新」递归套用 2–4
 *   4 相互交锋进球      ┘
 *   5 总净胜球
 *   6 总进球
 *   7 公平竞赛分(模拟无牌数据,略过)
 *   8 FIFA 排名
 *   9 抽签(用归一化名稳定兜底)
 */
import { getFifaRank } from 'lib/data/fifaRanking';
import type { GroupLetter, GroupMatch, GroupRow } from './types';

interface Tally {
  pts: number;
  gf: number;
  ga: number;
  gd: number;
}

const emptyTally = (): Tally => ({ pts: 0, gf: 0, ga: 0, gd: 0 });

/** 累计一组比赛里指定球队集合的迷你积分表(只计双方都在集合内的比赛)。 */
function miniTable(teams: string[], matches: GroupMatch[]): Record<string, Tally> {
  const set = new Set(teams);
  const t: Record<string, Tally> = {};
  for (const team of teams) t[team] = emptyTally();
  for (const m of matches) {
    if (!set.has(m.home) || !set.has(m.away)) continue;
    const hg = m.homeGoals ?? 0;
    const ag = m.awayGoals ?? 0;
    t[m.home].gf += hg;
    t[m.home].ga += ag;
    t[m.away].gf += ag;
    t[m.away].ga += hg;
    if (hg > ag) t[m.home].pts += 3;
    else if (hg < ag) t[m.away].pts += 3;
    else {
      t[m.home].pts += 1;
      t[m.away].pts += 1;
    }
  }
  for (const team of teams) t[team].gd = t[team].gf - t[team].ga;
  return t;
}

/** 把已按某指标排序的队按「指标三元组相等」切成连续子集(保持顺序)。 */
function clusterEqual(
  sorted: string[],
  eq: (a: string, b: string) => boolean,
): string[][] {
  const out: string[][] = [];
  for (const team of sorted) {
    const last = out[out.length - 1];
    if (last && eq(last[0], team)) last.push(team);
    else out.push([team]);
  }
  return out;
}

/**
 * 解析一个「同积分并列档」的内部顺序(递归):
 * 先相互交锋(2–4),若把并列队分成更小子集则对子集重新递归;无法再分则用总成绩(5–6)+FIFA(8)。
 */
function resolveTier(
  tier: string[],
  matches: GroupMatch[],
  overall: Record<string, Tally>,
  fifaRankOf: (team: string) => number | undefined,
): string[] {
  if (tier.length === 1) return tier;

  const h = miniTable(tier, matches);
  const byH2H = [...tier].sort(
    (a, b) => h[b].pts - h[a].pts || h[b].gd - h[a].gd || h[b].gf - h[a].gf,
  );
  const subTiers = clusterEqual(
    byH2H,
    (a, b) =>
      h[a].pts === h[b].pts && h[a].gd === h[b].gd && h[a].gf === h[b].gf,
  );

  // 相互交锋完全无法区分 → 落到总成绩 + FIFA 排名 + 稳定兜底
  if (subTiers.length === 1) {
    const fr = (t: string) => fifaRankOf(t) ?? 9999;
    return [...tier].sort(
      (a, b) =>
        overall[b].gd - overall[a].gd ||
        overall[b].gf - overall[a].gf ||
        fr(a) - fr(b) ||
        a.localeCompare(b),
    );
  }

  // 有区分 → 各子集(更小)再递归
  const out: string[] = [];
  for (const st of subTiers) out.push(...resolveTier(st, matches, overall, fifaRankOf));
  return out;
}

/** 由一组的全部比赛算 4 行名次(rank 1–4)。fifaRankOf 默认用内置 FIFA 排名表。 */
export function rankGroup(
  matches: GroupMatch[],
  fifaRankOf: (team: string) => number | undefined = getFifaRank,
): GroupRow[] {
  const group: GroupLetter = matches[0]?.group ?? 'A';
  const teams = Array.from(
    new Set(matches.flatMap((m) => [m.home, m.away])),
  );
  const overall: Record<string, Tally> = {};
  for (const team of teams) overall[team] = emptyTally();
  for (const m of matches) {
    const hg = m.homeGoals ?? 0;
    const ag = m.awayGoals ?? 0;
    overall[m.home].gf += hg;
    overall[m.home].ga += ag;
    overall[m.away].gf += ag;
    overall[m.away].ga += hg;
    if (hg > ag) overall[m.home].pts += 3;
    else if (hg < ag) overall[m.away].pts += 3;
    else {
      overall[m.home].pts += 1;
      overall[m.away].pts += 1;
    }
  }
  for (const team of teams) overall[team].gd = overall[team].gf - overall[team].ga;

  // 先按积分分档,再逐档解析
  const byPoints = [...teams].sort((a, b) => overall[b].pts - overall[a].pts);
  const tiers = clusterEqual(byPoints, (a, b) => overall[a].pts === overall[b].pts);
  const ordered: string[] = [];
  for (const tier of tiers)
    ordered.push(...resolveTier(tier, matches, overall, fifaRankOf));

  return ordered.map((team, i) => ({
    team,
    group,
    points: overall[team].pts,
    gf: overall[team].gf,
    ga: overall[team].ga,
    gd: overall[team].gd,
    rank: (i + 1) as 1 | 2 | 3 | 4,
  }));
}

export interface GroupPositions {
  winners: Record<string, GroupRow>; // 组字母 → 头名行
  runners: Record<string, GroupRow>; // 组字母 → 次名行
  thirds: GroupRow[]; // 12 个小组第三名
  rowsByGroup: Record<string, GroupRow[]>; // 组字母 → 完整名次
}

/** 对全部小组算名次,并抽出头名/次名/第三名。 */
export function simulateGroups(
  matchesByGroup: Record<string, GroupMatch[]>,
  fifaRankOf: (team: string) => number | undefined = getFifaRank,
): GroupPositions {
  const winners: Record<string, GroupRow> = {};
  const runners: Record<string, GroupRow> = {};
  const thirds: GroupRow[] = [];
  const rowsByGroup: Record<string, GroupRow[]> = {};
  for (const [g, matches] of Object.entries(matchesByGroup)) {
    const rows = rankGroup(matches, fifaRankOf);
    rowsByGroup[g] = rows;
    if (rows[0]) winners[g] = rows[0];
    if (rows[1]) runners[g] = rows[1];
    if (rows[2]) thirds.push(rows[2]);
  }
  return { winners, runners, thirds, rowsByGroup };
}
