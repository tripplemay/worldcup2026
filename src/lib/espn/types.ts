/**
 * ESPN(隐藏 API)— 类型定义
 * 基于实测结构(2026-06-14 验证):
 *   scoreboard?dates=YYYYMMDD  → 赛程 + 实时比分 + 进球事件
 *   apis/v2/.../standings       → 12 小组积分(children[].standings.entries[])
 *   teams                       → 48 强
 */

export type MatchStatus = 'pre' | 'in' | 'post';

/** 赛程中的一场比赛(可含实时比分)。 */
export interface ScheduleMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string; // ISO UTC
  stage: string; // season.slug,如 'group-stage' / 'round-of-32' …
  venue?: string;
  status: MatchStatus; // pre / in / post
  statusDetail?: string; // 'FT' / 'HT' / 'Scheduled' …
  clock?: string; // displayClock,如 "73'"
  homeScore?: number;
  awayScore?: number;
  group?: string; // 由 standings 关联补充(可选)
}

/** 比赛内事件(进球 / 红黄牌)。 */
export interface MatchEvent {
  minute?: string; // "28'"
  type: string; // 'Goal' / 'Yellow Card' / 'Red Card' / 'Penalty' …
  team?: string;
  player?: string;
  scoringPlay?: boolean;
}

/** 小组积分榜的一行。 */
export interface GroupStandingRow {
  team: string;
  rank: number;
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

/** 一个小组的积分表。 */
export interface GroupStanding {
  group: string; // 'Group A' …
  rows: GroupStandingRow[]; // 已按排名排序
}

/** 参赛球队。 */
export interface Team {
  id: string;
  name: string;
  displayName: string;
  abbreviation?: string;
  group?: string;
}

/** 淘汰赛对阵树节点(由赛段数据构建)。 */
export interface BracketMatch {
  id: string;
  stage: string; // 'round-of-16' / 'quarterfinal' …
  homeTeam?: string;
  awayTeam?: string;
  commenceTime?: string;
  homeScore?: number;
  awayScore?: number;
  status: MatchStatus;
}
