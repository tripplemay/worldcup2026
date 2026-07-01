/**
 * 模拟交易(paper trading)领域类型。
 * 纯虚拟资金,验证「市场无关模型概率 vs 市场赔率」的 +EV 策略,不接真钱。
 */

export type MarketType = '1X2' | 'OU' | 'AH' | 'BTTS' | 'DC' | 'DNB';
export type TradeStatus = 'pending' | 'won' | 'lost' | 'void';
/** 结算细分(含亚盘四分盘半赢/半输);持久化时 half_won→won、half_lost→lost。 */
export type SettleResult = 'won' | 'half_won' | 'void' | 'half_lost' | 'lost';
export type TradeTier = 'value' | 'coverage'; // value=+EV 精选;coverage=每场覆盖小注

/** 归一化盘口快照(各家取最优价);AF 与 The Odds API 两源统一成此形,再投影成候选。 */
export interface OddsPick {
  price: number;
  book: string;
}
export interface MarketSnapshot {
  h2h?: { home?: OddsPick; draw?: OddsPick; away?: OddsPick };
  totals: { point: number; over?: OddsPick; under?: OddsPick }[];
  spreads: { side: 'home' | 'away'; point: number; pick: OddsPick }[];
  btts?: { yes?: OddsPick; no?: OddsPick }; // 双方进球
  dc?: { homeDraw?: OddsPick; homeAway?: OddsPick; drawAway?: OddsPick }; // 双重机会
  dnb?: { home?: OddsPick; away?: OddsPick }; // 胜平负去平(平局退款)
}

/** 一个候选下注(某盘口某选项 + 市场赔率 + 模型概率)。 */
export interface BetCandidate {
  market: MarketType;
  selection: string; // 'home'|'draw'|'away' | 'Over'|'Under' | 'home'|'away'(AH)
  line?: number; // O/U 或 AH 盘口线(1X2 无)
  odds: number; // 小数赔率(市场)
  book: string; // 博彩商
  pWin: number; // 模型胜率(市场无关;四分盘=全赢+半赢,供 MIN_PROB 门槛)
  pPush: number; // 走盘概率(整数盘;半盘/四分盘为 0)
  // 亚盘四分盘专用四类概率(在场则 EV/Kelly 走四分盘口径,见 router.scoreCandidate)
  quarter?: {
    pFullWin: number;
    pHalfWin: number;
    pHalfLoss: number;
    pFullLoss: number;
  };
  ev: number; // 期望值(四分盘用 expectedValueQuarter)
  kelly: number; // 凯利比例 = ev/(odds-1)
}

/** 账户总览。 */
export interface Wallet {
  initialBalance: number;
  currentBalance: number;
  lockedBalance: number;
  totalTrades: number;
  wins: number;
  losses: number;
  updatedAt: number;
}

/** 一笔交易流水。 */
export interface Trade {
  tradeId: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  date: string; // 比赛开赛 ISO
  market: MarketType;
  selection: string;
  line?: number;
  odds: number;
  modelProb: number;
  ev: number;
  stake: number;
  status: TradeStatus;
  result: 'won' | 'lost' | 'void' | null;
  pnl: number | null;
  placedAt: number;
  settledAt?: number;
  tier?: TradeTier; // 缺省视为 value(旧数据)
}
