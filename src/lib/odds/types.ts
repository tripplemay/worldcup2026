/**
 * The Odds API — 类型定义
 * 原始响应类型 + 归一化领域类型。
 * 基于实测结构(2026-06-14 验证):
 *   单场 soccer_fifa_world_cup(markets=h2h,3-way:home/away/Draw,outcomes 用队名标识)
 *   夺冠 soccer_fifa_world_cup_winner(markets=outrights,忽略 outrights_lay)
 */

// ── 原始 API 响应(用于解析)──────────────────────────
export interface RawOutcome {
  name: string; // 队名 或 "Draw"
  price: number; // 小数赔率
}
export interface RawMarket {
  key: string; // 'h2h' | 'outrights' | 'outrights_lay' | ...
  last_update: string;
  outcomes: RawOutcome[];
}
export interface RawBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: RawMarket[];
}
export interface RawOddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string; // ISO UTC
  home_team: string;
  away_team: string;
  bookmakers: RawBookmaker[];
}

// ── 归一化领域类型 ────────────────────────────────────
/** 单家博彩公司对某场比赛的 h2h 赔率(已归位主胜/平/客胜)。 */
export interface BookmakerOdds {
  key: string;
  title: string;
  lastUpdate: string;
  home?: number;
  draw?: number;
  away?: number;
}

/** 一场比赛的赔率(聚合多家博彩 + 全场最优)。 */
export interface MatchOdds {
  id: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string; // ISO UTC
  bookmakers: BookmakerOdds[];
  /** 各结果的全场最优(最高)赔率与对应博彩 key。 */
  best: {
    home?: { price: number; bookmaker: string };
    draw?: { price: number; bookmaker: string };
    away?: { price: number; bookmaker: string };
  };
}

/** 夺冠候选的赔率(取各家最优 back 赔率)。 */
export interface OutrightOdds {
  team: string;
  price: number; // 全场最优(最低=最被看好)
  bookmaker: string;
  impliedProbability: number; // 1 / price
}

/** 夺冠赔率榜。 */
export interface WinnerMarket {
  lastUpdate: string;
  outrights: OutrightOdds[]; // 按赔率升序(最被看好在前)
}

/** API 配额信息(从响应头读取)。 */
export interface QuotaInfo {
  remaining: number | null;
  used: number | null;
  last: number | null;
}
