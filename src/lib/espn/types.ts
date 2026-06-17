/**
 * ESPN(隐藏 API)— 类型定义
 * scoreboard(赛程+比分+logo)/ standings(积分)/ teams(48强)/ summary(统计+阵容)。
 */

export type MatchStatus = 'pre' | 'in' | 'post';

/** 赛程中的一场比赛(可含实时比分 + 双方队徽)。 */
export interface ScheduleMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  commenceTime: string; // ISO UTC
  stage: string;
  venue?: string;
  status: MatchStatus;
  statusDetail?: string;
  clock?: string;
  homeScore?: number;
  awayScore?: number;
  group?: string;
}

/** 比赛内事件(进球 / 红黄牌)。 */
export interface MatchEvent {
  minute?: string;
  type: string;
  team?: string;
  player?: string;
  scoringPlay?: boolean;
}

/** 小组积分榜的一行。 */
export interface GroupStandingRow {
  team: string;
  logo?: string;
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
  group: string;
  rows: GroupStandingRow[];
}

/** 参赛球队。 */
export interface Team {
  id: string;
  name: string;
  displayName: string;
  abbreviation?: string;
  logo?: string;
  group?: string;
}

/** 淘汰赛对阵树节点。 */
export interface BracketMatch {
  id: string;
  stage: string;
  homeTeam?: string;
  awayTeam?: string;
  homeLogo?: string;
  awayLogo?: string;
  commenceTime?: string;
  homeScore?: number;
  awayScore?: number;
  status: MatchStatus;
}

/** 单队比赛统计(ESPN boxscore)。 */
export interface TeamMatchStats {
  possessionPct?: string;
  totalShots?: string;
  shotsOnTarget?: string;
  wonCorners?: string;
  foulsCommitted?: string;
  yellowCards?: string;
  redCards?: string;
  saves?: string;
  offsides?: string;
}

/** 阵容球员。 */
export interface RosterPlayer {
  name: string;
  zh?: string; // 中文名(LLM 翻译,详情页按需填充)
  position?: string;
  jersey?: string; // 球衣号
  starter: boolean;
}

/** 近期战绩一场(球队视角)。 */
export interface RecentGame {
  eventId: string; // ESPN 全局赛事 ID(可据此拉该场 boxscore)
  date: string; // ISO
  result: 'W' | 'D' | 'L' | '';
  score: string; // "2-2"
  opponent: string;
  opponentLogo?: string;
  home: boolean; // 主场?(atVs === 'vs')
  competition?: string;
}

/** 任意一场比赛的射门/进球统计(预测系统摄取用)。 */
export interface EventStats {
  eventId: string;
  date: string; // ISO
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  homeSoT: number; // 射正
  homeShots: number; // 总射门
  awaySoT: number;
  awayShots: number;
}

/** 历史交锋一场。 */
export interface H2HGame {
  date: string; // ISO
  homeTeam: string;
  awayTeam: string;
  homeScore: string;
  awayScore: string;
  competition?: string;
}

/** 单场比赛详情(summary 端点聚合)。 */
export interface MatchSummary {
  id: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  homeScore?: number;
  awayScore?: number;
  status: MatchStatus;
  statusDetail?: string;
  venue?: string;
  city?: string; // ESPN venue.address.city(形如 "Atlanta, Georgia")
  homeStats?: TeamMatchStats;
  awayStats?: TeamMatchStats;
  events: MatchEvent[];
  homeRoster: RosterPlayer[];
  awayRoster: RosterPlayer[];
  homeFormation?: string; // 阵型(如 4-3-3)
  awayFormation?: string;
  homeForm: RecentGame[]; // 近 5 场
  awayForm: RecentGame[];
  h2h: H2HGame[]; // 历史交锋(常为空)
}
