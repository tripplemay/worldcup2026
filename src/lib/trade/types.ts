/**
 * 模拟交易(paper trading)领域类型。
 * 纯虚拟资金,验证「市场无关模型概率 vs 市场赔率」的 +EV 策略,不接真钱。
 */

export type MarketType = '1X2' | 'OU' | 'AH';
export type TradeStatus = 'pending' | 'won' | 'lost' | 'void';

/** 归一化盘口快照(各家取最优价);AF 与 The Odds API 两源统一成此形,再投影成候选。 */
export interface OddsPick {
  price: number;
  book: string;
}
export interface MarketSnapshot {
  h2h?: { home?: OddsPick; draw?: OddsPick; away?: OddsPick };
  totals: { point: number; over?: OddsPick; under?: OddsPick }[];
  spreads: { side: 'home' | 'away'; point: number; pick: OddsPick }[];
}

/** 一个候选下注(某盘口某选项 + 市场赔率 + 模型概率)。 */
export interface BetCandidate {
  market: MarketType;
  selection: string; // 'home'|'draw'|'away' | 'Over'|'Under' | 'home'|'away'(AH)
  line?: number; // O/U 或 AH 盘口线(1X2 无)
  odds: number; // 小数赔率(市场)
  book: string; // 博彩商
  pWin: number; // 模型胜率(市场无关)
  pPush: number; // 走盘概率(整数盘;半盘为 0)
  ev: number; // 期望值 = pWin·(odds-1) − (1−pWin−pPush)
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
}
