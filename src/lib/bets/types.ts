/**
 * Phase 9：他平台投注单识别与自动结算 领域类型。
 *
 * 数据流:Telegram 截图 → 视觉 LLM 识别(RecognizedSlip)→ 管理员按钮归属 →
 * 落库 BetSlip(pending)→ 赛后逐腿匹配赛果 + 串关聚合 → 回填 pnl。
 * 金额(本金/可赢)一律以截图为准,系统只做「结果匹配」,不重算赔率。
 */

/** 可下注人(小范围预置名册;Telegram 按钮归属用)。 */
export interface Bettor {
  id: string;
  name: string;
  active?: boolean; // 缺省视为 true
  openingPnl?: number; // 期初净盈亏:用本系统前的累计输赢(正=赢/负=输),计入排行总额
}

/**
 * 一笔提款记录(流水台账)。管理员在比赛过程中为投注人逐笔记录提款。
 * 提款是现金流出事件,**不计入净盈亏、不影响排行**;仅用于「已提款/未提款」展示。
 */
export interface Withdrawal {
  id: string;
  bettorId: string;
  amount: number; // 提款金额(正数)
  at: number; // 提款时间 epoch ms
  note?: string; // 可选备注
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
  | 'unmatched'
  | 'unsupported'; // 盘口不被自动结算引擎支持(波胆/半场/角球等)→ 转人工

/** 注单整体状态。 */
export type BetStatus =
  | 'pending' // 尚有腿未完赛
  | 'won'
  | 'lost'
  | 'void' // 整单退款(单注走盘)
  | 'unmatched' // 有腿对不上比赛
  | 'needs_review'; // 识别低置信 / 走盘致截图金额失真 / 半赢半输 → 人工

/** 同场组合盘的一个子盘(market 用标准可结算码;全中才算赢)。 */
export interface ComboPart {
  market: string; // 1X2|OU|AH|BTTS|DC|DNB|CS|CS1H|CS2H(不含 COMBO/OTHER)
  selection: string;
  line?: number; // 仅 AH/OU 有意义
}

/** 一腿(一场比赛上的一个选项)。识别字段 + 结算回填字段。 */
export interface BetLeg {
  // —— 识别原文(供匹配 + 人工核对)——
  homeName: string;
  awayName: string;
  league?: string; // 'wc' | 'epl' | 'laliga' | 'bundesliga' | 'seriea' | 'ligue1' | 原文
  matchDate?: string; // ISO 或 YYYY-MM-DD(识别到的开赛时间;匹配用)
  market: string; // 可结算的 6 码(1X2|OU|AH|BTTS|DC|DNB)或 'OTHER'(波胆/半场/角球等不支持→人工)
  selection: string; // 归一结算词汇:home|draw|away / Over|Under / Yes|No / 1X|12|X2;OTHER 时存原文选项(如比分 1-1)
  line?: number; // OU/AH 盘口线(含 ±.25/.75 四分盘)
  odds?: number; // 各腿赔率(展示用;不参与金额结算)
  rawText?: string; // 不支持盘口的中文描述(如「下半场波胆 1-1」),供人工核对/展示
  parts?: ComboPart[]; // market==='COMBO' 时:同场多段子盘(全中才赢,AND 语义)
  // —— 滚球(in-play)剩余赛程口径:从下注时比分起算的让球/大小 ——
  live?: boolean; // 滚球/进行中下单 → 按「剩余赛程」口径结算(对下注后净增比分判定)
  baseHome?: number; // 下注时比分(注单主客视角),剩余赛程结算基线;与 homeGoals 同视角
  baseAway?: number;

  // —— 结算回填 ——
  matchId?: string; // 解析到的 ESPN/联赛 eventId
  kickoff?: string; // 比赛开赛 ISO(系统赛程权威;显示用 UTC+8)
  homeGoals?: number; // 90' 比分(注单主客视角)
  awayGoals?: number;
  htHome?: number; // 上半场比分(≤45';仅进球事件齐全时给出,供波胆半场判定)
  htAway?: number;
  result?: LegResult; // 逐腿判定
}

/** 一张注单(串关为主:legs.length≥1)。金额按截图。 */
export interface BetSlip {
  id: string;
  bettorId: string | null; // null=未归属(待按钮指定)
  platform?: string;
  stake: number; // 本金(截图)
  potentialReturn: number; // 「可赢/可盈」= 净盈利(截图;不含本金)
  currency?: string;
  legs: BetLeg[];
  status: BetStatus;
  pnl: number | null; // 赢=potentialReturn(净赚);输=−stake;void=0;未结=null
  confidence: number; // 识别置信度 0–1
  imageRef?: string; // 落盘原图相对路径(复核)
  source?: { chatId?: number; messageId?: number; fileId?: string };
  recognizedRaw?: unknown; // 识别原始 JSON(debug/复核)
  note?: string; // 人工备注 / 复核原因
  placedAt?: number; // 下注时间:图片拍摄/创建(EXIF/PNG 元数据;无则展示回退 createdAt)
  createdAt: number; // 入库(收到截图)时刻
  updatedAt: number;
  settledAt?: number;
}

/** 视觉识别输出(部分 BetSlip;webhook 再补 id/bettorId/状态/时间)。 */
export interface RecognizedSlip {
  stake: number;
  potentialReturn: number; // 「可赢/可盈」= 净盈利(不含本金)
  currency?: string;
  platform?: string;
  legs: BetLeg[];
  confidence: number;
}

/** 单腿赛果解析输出(90' 比分)。 */
export interface LegResolution {
  status: 'matched' | 'pending' | 'unmatched';
  matchId?: string;
  kickoff?: string; // 开赛 ISO(系统赛程)
  homeGoals?: number;
  awayGoals?: number;
  htHome?: number; // 上半场比分(进球事件齐全时;否则缺省 → 半场波胆转人工)
  htAway?: number;
}
