/**
 * Phase 9 结算核心:单腿判定(judgeLeg)+ 串关/单注聚合(settleSlip)。
 *
 * 复用 lib/trade/settle 的 outcome 做基础盘口判定(1X2/OU/AH 整数·半盘/BTTS/DC/DNB)。
 * 唯一新增能力:亚盘四分盘(±.25/.75)拆成两条相邻半盘,聚合出 half_won/half_lost。
 * 金额一律以截图为准,不重算赔率:**potentialReturn = 注单「可盈」= 净盈利(不含本金)**。
 *   赢 → pnl = potentialReturn(净赚);输 → pnl = −stake;走盘 → pnl = 0。
 * 任何使截图金额失真的情形(走盘、半赢半输混入串关)一律 needs_review,交人工。
 */
import { outcome } from 'lib/trade/settle';
import type { Trade, MarketType } from 'lib/trade/types';
import type { BetLeg, LegResult, BetStatus } from './types';

/**
 * 自动结算支持的盘口码。CS=全场波胆,CS1H/CS2H=上/下半场波胆(需进球事件算半场比分)。
 * 其余(角球/罚牌/球员/特色等)不臆断 → 转人工。
 */
export const VALID_MARKETS: readonly string[] = [
  '1X2',
  'OU',
  'AH',
  'BTTS',
  'DC',
  'DNB',
  'CS',
  'CS1H',
  'CS2H',
];

/** 解析比分选项 "2-0"/"2:0"/"2 - 0" → {h,a};无法解析返回 null。 */
function parseScore(sel: string): { h: number; a: number } | null {
  const m = /^\s*(\d+)\s*[-:比]\s*(\d+)\s*$/.exec(sel ?? '');
  return m ? { h: Number(m[1]), a: Number(m[2]) } : null;
}

/** 波胆(正确比分)判定:下注比分 === 实际比分 → won,否则 lost;比分无法解析 → null(转人工)。 */
function judgeCorrectScore(
  selection: string,
  scoreH: number,
  scoreA: number,
): 'won' | 'lost' | null {
  const bet = parseScore(selection);
  if (!bet) return null;
  return bet.h === scoreH && bet.a === scoreA ? 'won' : 'lost';
}

/** 调用基础盘口判定:只读 market/selection/line,返回 won/lost/void。 */
function baseOutcome(
  market: string,
  selection: string,
  line: number | undefined,
  gf: number,
  ga: number,
): 'won' | 'lost' | 'void' {
  return outcome(
    { market: market as MarketType, selection, line } as unknown as Trade,
    gf,
    ga,
  );
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
  market: string,
  selection: string,
  line: number | undefined,
  gf: number,
  ga: number,
  ht?: { h: number; a: number }, // 上半场比分(注单主客视角);CS1H/CS2H 需要
): LegResult {
  // 不支持的盘口(角球/罚牌/球员/特色等):不臆断 → 转人工
  if (!VALID_MARKETS.includes(market)) return 'unsupported';
  // 波胆(正确比分):全场用 90' 比分;上/下半场需半场比分(事件齐全才有,否则转人工)
  if (market === 'CS')
    return judgeCorrectScore(selection, gf, ga) ?? 'unsupported';
  if (market === 'CS1H') {
    if (!ht) return 'unsupported';
    return judgeCorrectScore(selection, ht.h, ht.a) ?? 'unsupported';
  }
  if (market === 'CS2H') {
    if (!ht) return 'unsupported';
    return judgeCorrectScore(selection, gf - ht.h, ga - ht.a) ?? 'unsupported';
  }
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
 * 优先级:unsupported > unmatched > pending > (half_* | void → needs_review) > lost > won。
 * 单注(legs.length===1)直接映射:走盘退本(void→pnl 0)、半赢半输/不支持交人工。
 */
export function settleSlip(
  slip: { stake: number; potentialReturn: number; legs: BetLeg[] },
  legResults: LegResult[],
): { status: BetStatus; pnl: number | null } {
  // 不支持的盘口永不自动判定 → 直接转人工(优先于其它,等比赛/匹配都没意义)
  if (legResults.some((r) => r === 'unsupported'))
    return { status: 'needs_review', pnl: null };
  if (legResults.some((r) => r === 'unmatched'))
    return { status: 'unmatched', pnl: null };
  if (legResults.some((r) => r === 'pending'))
    return { status: 'pending', pnl: null };

  // 单注特判:截图金额可直接表达走盘退本。
  if (slip.legs.length === 1) {
    const r = legResults[0];
    if (r === 'won') return { status: 'won', pnl: slip.potentialReturn };
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
  return { status: 'won', pnl: slip.potentialReturn };
}
