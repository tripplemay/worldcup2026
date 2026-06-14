/**
 * The Odds API — 类型定义
 * 原始响应类型 + 归一化领域类型。
 */

// ── 原始 API 响应(用于解析)──────────────────────────
export interface RawOutcome {
  name: string; // 队名 / "Draw" / "Over" / "Under"
  price: number; // 小数赔率
  point?: number; // 让分 / 大小球盘口线(spreads/totals)
}
export interface RawMarket {
  key: string; // 'h2h' | 'spreads' | 'totals' | 'outrights' | ...
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

// ── 归一化领域类型(胜平负 + 夺冠)────────────────────
export interface BookmakerOdds {
  key: string;
  title: string;
  lastUpdate: string;
  home?: number;
  draw?: number;
  away?: number;
}

export interface MatchOdds {
  id: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: BookmakerOdds[];
  best: {
    home?: { price: number; bookmaker: string };
    draw?: { price: number; bookmaker: string };
    away?: { price: number; bookmaker: string };
  };
}

export interface OutrightOdds {
  team: string;
  price: number;
  bookmaker: string;
  impliedProbability: number;
}

export interface WinnerMarket {
  lastUpdate: string;
  outrights: OutrightOdds[];
}

export interface QuotaInfo {
  remaining: number | null;
  used: number | null;
  last: number | null;
}

// ── 让球 + 大小球(详情页按需多市场)──────────────────
/** 让球盘一条(队 + 让分 + 赔率)。 */
export interface SpreadLine {
  team: string;
  point: number;
  price: number;
}
/** 大小球一条(Over/Under + 盘口 + 赔率)。 */
export interface TotalLine {
  type: string; // 'Over' | 'Under'
  point: number;
  price: number;
}
/** 单家博彩的让球/大小球。 */
export interface BookmakerMarkets {
  key: string;
  title: string;
  spreads?: SpreadLine[];
  totals?: TotalLine[];
}
/** 单场让球 + 大小球(详情页按需)。 */
export interface MatchMarkets {
  homeTeam: string;
  awayTeam: string;
  bookmakers: BookmakerMarkets[];
}
