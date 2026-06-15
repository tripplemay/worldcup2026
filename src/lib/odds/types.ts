/**
 * The Odds API — 类型定义
 * 原始响应类型 + 归一化领域类型。
 */

// ── 原始 API 响应(用于解析)──────────────────────────
export interface RawOutcome {
  name: string; // 队名 / "Draw" / "Over" / "Under" / "Yes" / "No"
  price: number; // 小数赔率
  point?: number; // 让分 / 大小球盘口线(spreads/totals)
  description?: string; // 球员名(player props 市场)
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

// ── 富盘口分组(详情页按需:上半场 / 角球 / 红黄牌 / 球员)────────
/** 盘口分组键(handicap 走 MatchMarkets,其余走 GroupMarkets)。 */
export type MarketGroup =
  | 'handicap'
  | 'firsthalf'
  | 'corners'
  | 'cards'
  | 'players';

/** 某一报价的最优值(赔率 + 博彩商名)。 */
export interface BestPick {
  price: number;
  book: string;
}
/** 聚合后的大小球一条(按盘口线,取各家最优大/最优小)。 */
export interface AggOuLine {
  point: number;
  over?: BestPick;
  under?: BestPick;
}
/** 聚合后的让球一条(队 + 让分,取各家最优价)。 */
export interface AggAhLine {
  team: string;
  point: number;
  best: BestPick;
}
/** 单家博彩三路赔率(上半场胜平负)。 */
export interface BookThreeWay {
  key: string;
  title: string;
  home?: number;
  draw?: number;
  away?: number;
}
/** 单家博彩大小球主线(上半场大小球)。 */
export interface BookTotalsLine {
  key: string;
  title: string;
  overPoint?: number;
  over?: number;
  underPoint?: number;
  under?: number;
}
/** 球员是/否盘一条(球员 + 最优价)。 */
export interface PlayerPick {
  player: string;
  best: BestPick;
}
/** 球员大小盘一条(球员 + 线 + 最优价)。 */
export interface PlayerOuPick {
  player: string;
  point: number;
  best: BestPick;
}
/** 单场富盘口(按 group 填充相应字段;取各家最优值聚合)。 */
export interface GroupMarkets {
  group: MarketGroup;
  homeTeam: string;
  awayTeam: string;
  // 上半场
  h1ThreeWay?: BookThreeWay[];
  h1Totals?: BookTotalsLine[];
  // 角球
  cornersTotals?: AggOuLine[];
  cornersSpreads?: AggAhLine[];
  // 红黄牌
  cardsTotals?: AggOuLine[];
  cardsSpreads?: AggAhLine[];
  // 球员
  goalScorers?: PlayerPick[]; // player_goal_scorer_anytime
  shots?: PlayerOuPick[]; // player_shots_on_target
  cardPlayers?: PlayerPick[]; // player_to_receive_card
}
