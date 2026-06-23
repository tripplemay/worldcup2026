/**
 * Phase 9 结算核心:单腿判定(judgeLeg)+ 串关/单注聚合(settleSlip)。
 *
 * 复用 lib/trade/settle 的 outcome 做基础盘口判定(1X2/OU/AH 整数·半盘/BTTS/DC/DNB)。
 * 唯一新增能力:亚盘四分盘(±.25/.75)拆成两条相邻半盘,聚合出 half_won/half_lost。
 * 金额一律以截图为准(stake / potentialReturn 含本金口径),不重算赔率;
 * 任何使截图金额失真的情形(走盘、半赢半输混入串关)一律 needs_review,交人工。
 */
import { outcome } from 'lib/trade/settle';
import type { Trade, MarketType } from 'lib/trade/types';
import type { BetLeg, LegResult, BetStatus } from './types';

/** 结算引擎支持的 6 个盘口码;其余一律不臆断(否则 outcome 会落到 AH 分支误判)。 */
const VALID_MARKETS: readonly MarketType[] = [
  '1X2',
  'OU',
  'AH',
  'BTTS',
  'DC',
  'DNB',
];

/** 调用基础盘口判定:只读 market/selection/line,返回 won/lost/void。 */
function baseOutcome(
  market: MarketType,
  selection: string,
  line: number | undefined,
  gf: number,
  ga: number,
): 'won' | 'lost' | 'void' {
  return outcome({ market, selection, line } as unknown as Trade, gf, ga);
}

/** 四分盘判定:盘口线小数位为 .25 或 .75(含负)。 */
function isQuarterLine(line: number | undefined): boolean {
  if (line == null || !Number.isFinite(line)) return false;
  return Math.abs((line * 4) % 2) === 1;
}

/**
 * 单腿判定:给定盘口与 90' 比分,返回逐腿结果。
 * 四分盘拆两条相邻半盘(各以 .0/.5 结尾)分别判定再聚合;
 * 因两半相差 0.5,至多一条走盘,故只会出现 won/lost/half_won/half_lost。
 */
export function judgeLeg(
  market: MarketType,
  selection: string,
  line: number | undefined,
  gf: number,
  ga: number,
): LegResult {
  // 未知盘口码:不臆断(避免 outcome 落到 AH 分支误判)→ 交人工
  if (!VALID_MARKETS.includes(market)) return 'unmatched';
  if (market === 'AH' && isQuarterLine(line)) {
    const base = line as number;
    const lowHalf = base - 0.25;
    const highHalf = base + 0.25;
    const a = baseOutcome('AH', selection, lowHalf, gf, ga);
    const b = baseOutcome('AH', selection, highHalf, gf, ga);
    if (a === 'won' && b === 'won') return 'won';
    if (a === 'lost' && b === 'lost') return 'lost';
    // 一赢一走 → 半赢;一输一走 → 半输
    if (a === 'won' || b === 'won') return 'half_won';
    return 'half_lost';
  }
  return baseOutcome(market, selection, line, gf, ga);
}

/**
 * 串关/单注聚合:legResults 与 slip.legs 1:1 对齐(已判定或 pending/unmatched)。
 *
 * 优先级:unmatched > pending > (half_* | void → needs_review) > lost > won。
 * 单注(legs.length===1)直接映射:走盘退本(void→pnl 0)、半赢半输交人工。
 */
export function settleSlip(
  slip: { stake: number; potentialReturn: number; legs: BetLeg[] },
  legResults: LegResult[],
): { status: BetStatus; pnl: number | null } {
  if (legResults.some((r) => r === 'unmatched'))
    return { status: 'unmatched', pnl: null };
  if (legResults.some((r) => r === 'pending'))
    return { status: 'pending', pnl: null };

  // 单注特判:截图金额可直接表达走盘退本。
  if (slip.legs.length === 1) {
    const r = legResults[0];
    if (r === 'won')
      return { status: 'won', pnl: +(slip.potentialReturn - slip.stake) };
    if (r === 'lost') return { status: 'lost', pnl: -slip.stake };
    if (r === 'void') return { status: 'void', pnl: 0 };
    return { status: 'needs_review', pnl: null }; // half_won / half_lost
  }

  // 串关:半赢半输无法在截图金额里表达 → 人工。
  if (legResults.some((r) => r === 'half_won' || r === 'half_lost'))
    return { status: 'needs_review', pnl: null };
  if (legResults.some((r) => r === 'lost'))
    return { status: 'lost', pnl: -slip.stake };
  // 走盘腿使截图 potentialReturn 失真(应重算赔率)→ 人工。
  if (legResults.some((r) => r === 'void'))
    return { status: 'needs_review', pnl: null };
  // 全赢。
  return { status: 'won', pnl: +(slip.potentialReturn - slip.stake) };
}
