/**
 * 球队杯赛档案领域类型(球队页 /team/[id])。
 * 「实力档案」雷达 + 「当前状态」+ 杯赛数据 + 阵容,服务端组装为一个 TeamProfile。
 */
import type { RosterPlayer } from 'lib/espn/types';
import type { TeamTmi } from 'lib/tmi/types';

/** 逐场赛果(球队视角)。 */
export interface TeamFixture {
  eventId: string;
  date: string; // ISO
  opponent: string;
  opponentLogo?: string;
  home: boolean;
  gf?: number;
  ga?: number;
  result: 'W' | 'D' | 'L' | '';
  status: 'pre' | 'in' | 'post';
}

/** 小组战绩。 */
export interface TeamStandingInfo {
  group?: string;
  rank?: number;
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

/** 杯赛聚合数据(均值口径;possession 等需 box-score 聚合,缺失为 undefined)。 */
export interface CupStats {
  matchesPlayed: number;
  xgForPerMatch: number;
  xgAgainstPerMatch: number;
  xgSource: 'cup' | 'season'; // 杯赛口径 / 近期 EWMA 回退
  goalsForPerMatch?: number;
  goalsAgainstPerMatch?: number;
  shotsPerMatch?: number;
  sotPerMatch?: number;
  possessionPct?: number;
  cornersPerMatch?: number;
  foulsPerMatch?: number;
  yellowPerMatch?: number;
  redTotal?: number;
}

/** 阵容深度(最近一场首发聚合)。 */
export interface SquadDepth {
  avgRating: number; // 首发赛季均评分
  top5Share: number; // 五大联赛球员占比 0..1
  count: number; // 计入的球员数
}

/** 雷达单轴(0–100)。available=false 表示数据暂缺(UI 淡显并提示)。 */
export interface RadarAxis {
  key: string;
  value: number;
  available: boolean;
}

/** 球队完整档案。 */
export interface TeamProfile {
  id: string;
  name: string;
  normName: string;
  logo?: string;
  standing: TeamStandingInfo | null;
  fixtures: TeamFixture[];
  cup: CupStats;
  /** 实力档案:进攻 / 防守 / 实力 / 阵容。 */
  strengthRadar: RadarAxis[];
  strengthAvg: number; // 实力档案均分(仅计有数据的轴)
  state: {
    momentum: number; // 0–100
    fitness: number; // 0–100
    recentForm: number; // 0–100
    formStreak: Array<'W' | 'D' | 'L' | ''>;
    tmi: TeamTmi | null; // 原始三因子拆解
  };
  grade: number; // 0–100,偏当前状态
  squad: SquadDepth | null;
  roster: RosterPlayer[]; // 最近一场首发(含 form)
  rosterFormation?: string;
}
