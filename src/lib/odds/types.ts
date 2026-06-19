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
  // 初盘(自捕获首见,1X2;由 live-odds 路由从 opening-odds.json 合入)
  opening?: { capturedAt: number; home: number; draw: number; away: number };
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
  remaining: number | null; // 跨所有 key 的总剩余
  used: number | null;
  last: number | null;
  keyCount?: number; // 配置的 key 数量
  total?: number; // 总额度(PER_KEY_LIMIT × keyCount)
}

/** odds-api.io 限流状态(实时看板;来自响应头 x-ratelimit-*)。 */
export interface LiveRate {
  limit: number | null; // 每小时上限(100)
  remaining: number | null; // 本小时剩余
  reset: string | null; // 重置时间(ISO)
}

// ── 实时全市场(odds-api.io,详情展开按标签分组展示)──────────
/** 单条赔率(通用形:按字段判断市场类型;价格已转 number)。 */
export interface LiveOddsRow {
  label?: string; // 结果标签(球员名/比分/"主或平"等)
  hdp?: number; // 盘口线
  home?: number;
  draw?: number;
  away?: number;
  over?: number;
  under?: number;
  yes?: number;
  no?: number;
  odds?: number; // 单一赔率(波胆/半全场等带 label 的市场)
}
/** 单个市场(名称 + 多条赔率)。 */
export interface LiveMarket {
  name: string; // 原始市场名(英文,如 "Correct Score")
  rows: LiveOddsRow[];
}
/** 市场分组(对应一个标签页)。 */
export interface LiveMarketGroup {
  key: string; // 'main' | 'lines' | 'score' | 'corners' | 'cards' | 'players' | 'other'
  markets: LiveMarket[];
}
/** 单场全市场(按分组,供详情展开的标签页)。 */
export interface LiveMatchMarkets {
  id: string;
  homeTeam: string;
  awayTeam: string;
  groups: LiveMarketGroup[];
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
