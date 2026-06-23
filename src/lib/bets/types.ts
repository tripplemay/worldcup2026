/**
 * Phase 9：他平台投注单识别与自动结算 领域类型。
 *
 * 数据流:Telegram 截图 → 视觉 LLM 识别(RecognizedSlip)→ 管理员按钮归属 →
 * 落库 BetSlip(pending)→ 赛后逐腿匹配赛果 + 串关聚合 → 回填 pnl。
 * 金额(本金/可赢)一律以截图为准,系统只做「结果匹配」,不重算赔率。
 */
import type { MarketType } from 'lib/trade/types';

/** 可下注人(小范围预置名册;Telegram 按钮归属用)。 */
export interface Bettor {
  id: string;
  name: string;
  active?: boolean; // 缺省视为 true
}

/**
 * 单腿判定结果。串关由各腿聚合;四分盘(±.25/.75)可能出现 half_*。
 * pending=已匹配比赛但未完赛;unmatched=对不上系统已覆盖的比赛(需人工绑定)。
 */
export type LegResult =
  | 'won'
  | 'lost'
  | 'void'
  | 'half_won'
  | 'half_lost'
  | 'pending'
  | 'unmatched';

/** 注单整体状态。 */
export type BetStatus =
  | 'pending' // 尚有腿未完赛
  | 'won'
  | 'lost'
  | 'void' // 整单退款(单注走盘)
  | 'unmatched' // 有腿对不上比赛
  | 'needs_review'; // 识别低置信 / 走盘致截图金额失真 / 半赢半输 → 人工

/** 一腿(一场比赛上的一个选项)。识别字段 + 结算回填字段。 */
export interface BetLeg {
  // —— 识别原文(供匹配 + 人工核对)——
  homeName: string;
  awayName: string;
  league?: string; // 'wc' | 'epl' | 'laliga' | 'bundesliga' | 'seriea' | 'ligue1' | 原文
  matchDate?: string; // ISO 或 YYYY-MM-DD(识别到的开赛时间;匹配用)
  market: MarketType; // 复用结算引擎盘口码:1X2|OU|AH|BTTS|DC|DNB
  selection: string; // 归一结算词汇:home|draw|away / Over|Under / Yes|No / 1X|12|X2
  line?: number; // OU/AH 盘口线(含 ±.25/.75 四分盘)
  odds?: number; // 各腿赔率(展示用;不参与金额结算)
  rawText?: string; // 识别原始文字(debug/复核)

  // —— 结算回填 ——
  matchId?: string; // 解析到的 ESPN/联赛 eventId
  homeGoals?: number; // 90' 比分
  awayGoals?: number;
  result?: LegResult; // 逐腿判定
}

/** 一张注单(串关为主:legs.length≥1)。金额按截图。 */
export interface BetSlip {
  id: string;
  bettorId: string | null; // null=未归属(待按钮指定)
  platform?: string;
  stake: number; // 本金(截图)
  potentialReturn: number; // 可赢/总返款(截图;默认含本金口径)
  currency?: string;
  legs: BetLeg[];
  status: BetStatus;
  pnl: number | null; // 赢=potentialReturn−stake;输=−stake;void=0;未结=null
  confidence: number; // 识别置信度 0–1
  imageRef?: string; // 落盘原图相对路径(复核)
  source?: { chatId?: number; messageId?: number; fileId?: string };
  recognizedRaw?: unknown; // 识别原始 JSON(debug/复核)
  note?: string; // 人工备注 / 复核原因
  createdAt: number;
  updatedAt: number;
  settledAt?: number;
}

/** 视觉识别输出(部分 BetSlip;webhook 再补 id/bettorId/状态/时间)。 */
export interface RecognizedSlip {
  stake: number;
  potentialReturn: number;
  currency?: string;
  platform?: string;
  legs: BetLeg[];
  confidence: number;
}

/** 单腿赛果解析输出(90' 比分)。 */
export interface LegResolution {
  status: 'matched' | 'pending' | 'unmatched';
  matchId?: string;
  homeGoals?: number;
  awayGoals?: number;
}
