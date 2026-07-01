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
import { isQuarterLine } from 'lib/trade/projection';
import type { Trade, MarketType } from 'lib/trade/types';
import type { BetLeg, ComboPart, LegResult, BetStatus } from './types';

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
  'COMBO', // 同场组合盘(多段子盘 AND;由 judgeCombo 逐段判定)
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

/**
 * 单腿判定:给定盘口与 90' 比分,返回逐腿结果。
 * 四分盘拆两条相邻半盘(各以 .0/.5 结尾)分别判定再聚合;
 * 因两半相差 0.5,至多一条走盘,故只会出现 won/lost/half_won/half_lost。
 */
/**
 * 滚球「剩余赛程」口径**仅适用于**亚盘(AH)/亚洲大小(OU):它们的盘线随当前比分重锚
 * (等价于把当前比分重置 0-0,只算下注后净增进球),故对下注后增量判定。
 * 1X2(全场胜平负)/BTTS(全场双方进球)/DNB(全场去平)/波胆 等是**全场赛果型**盘——
 * 即便滚球下单,主流平台(bet365 等)仍按**全场终分**结算,绝不可用增量重置,否则把领先方
 * 「保持比分到终场」的赢单错判成平/输/退款。这些盘有 base 时一律忽略基线、走全场口径。
 */
const REST_OF_MATCH_MARKETS: readonly string[] = ['AH', 'OU'];

export function judgeLeg(
  market: string,
  selection: string,
  line: number | undefined,
  gf: number,
  ga: number,
  ht?: { h: number; a: number }, // 上半场比分(注单主客视角);CS1H/CS2H 需要
  parts?: ComboPart[], // market==='COMBO' 时的各子盘
  base?: { h: number; a: number }, // 滚球剩余赛程口径:下注时比分(注单主客视角),仅 AH/OU 生效
): LegResult {
  // 不支持的盘口(角球/罚牌/球员/特色等):不臆断 → 转人工
  if (!VALID_MARKETS.includes(market)) return 'unsupported';
  // 滚球剩余赛程口径:**仅** AH/OU 对「下注后净增比分」判定(必须先于 COMBO/CS 等分支);
  // 其余盘口忽略基线,落到下方全场口径常规判定(全场赛果型盘滚球下单仍按全场结算)。
  if (base && REST_OF_MATCH_MARKETS.includes(market)) {
    const dh = gf - base.h;
    const da = ga - base.a;
    if (dh < 0 || da < 0) return 'unsupported'; // 终分 < 基线(改分/数据异常)→ 人工
    return judgeLeg(market, selection, line, dh, da); // 递归走常规增量判定(复用半盘/四分盘)
  }
  // 同场组合盘:逐段判定再按 AND 合并
  if (market === 'COMBO') return judgeCombo(parts, gf, ga, ht);
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
 * 同场组合盘判定(AND 语义:各子盘全中才赢)。判定时比赛已完赛(有终分),故子盘不会 pending。
 * 合并优先级(最阻断优先):任一确输→lost;否则任一不支持→unsupported(完赛后某段无法判,转人工);
 * 否则任一走盘→void(金额失真,聚合层转人工);否则任一四分盘半赢/半输→对应 half(转人工);
 * 全中→won。子盘为空/缺失→unsupported。
 */
function judgeCombo(
  parts: ComboPart[] | undefined,
  gf: number,
  ga: number,
  ht?: { h: number; a: number },
): LegResult {
  if (!parts || parts.length === 0) return 'unsupported';
  const rs = parts.map((p) =>
    judgeLeg(p.market, p.selection, p.line, gf, ga, ht),
  );
  if (rs.includes('lost')) return 'lost';
  if (rs.includes('unsupported')) return 'unsupported';
  if (rs.includes('void')) return 'void';
  if (rs.includes('half_lost')) return 'half_lost';
  if (rs.includes('half_won')) return 'half_won';
  return 'won';
}

/**
 * 串关/单注聚合:legResults 与 slip.legs 1:1 对齐(已判定或 pending/unmatched)。
 *
 * AND 语义 + **即时判输**:任一腿「确输」⇒ 整单立刻判输,不等其余腿(每场收官即时结算)。
 * 优先级:lost > unmatched > pending > (单注特判 / half_* / void / unsupported → 人工或退本) > won。
 * 即时判输置顶,使「一腿已输、其余腿还 pending/不支持」的串关也能即刻判输(−stake);
 * 反之只要没有确输腿,就保持 pending/unmatched 直到能定论,避免过早转人工。
 */
export function settleSlip(
  slip: { stake: number; potentialReturn: number; legs: BetLeg[] },
  legResults: LegResult[],
): { status: BetStatus; pnl: number | null } {
  // 任一腿确输 ⇒ 整单即时判输(其余腿结果已无关,整单 = −stake)。置顶优先于一切。
  if (legResults.some((r) => r === 'lost'))
    return { status: 'lost', pnl: -slip.stake };

  // 仍有腿未匹配/未结 → 尚不能定论(未来某腿可能再输 → 届时走上面的即时判输)。
  if (legResults.some((r) => r === 'unmatched'))
    return { status: 'unmatched', pnl: null };
  if (legResults.some((r) => r === 'pending'))
    return { status: 'pending', pnl: null };

  // —— 至此所有腿都已终结(won / void / half_* / unsupported)且无一确输 ——

  // 单注特判:截图金额可直接表达走盘退本。
  if (slip.legs.length === 1) {
    const r = legResults[0];
    if (r === 'won') return { status: 'won', pnl: slip.potentialReturn };
    if (r === 'void')
      // 单一盘口走盘 → 退本;组合盘里某段走盘 → 应去该段重算赔率,我们不重算 → 转人工
      return slip.legs[0]?.market === 'COMBO'
        ? { status: 'needs_review', pnl: null }
        : { status: 'void', pnl: 0 };
    return { status: 'needs_review', pnl: null }; // half_won / half_lost / unsupported
  }

  // 串关且无确输:半赢半输 / 走盘 / 不支持 都使截图金额无法表达或无法判定 → 人工。
  if (legResults.some((r) => r === 'half_won' || r === 'half_lost'))
    return { status: 'needs_review', pnl: null };
  if (legResults.some((r) => r === 'void'))
    return { status: 'needs_review', pnl: null };
  if (legResults.some((r) => r === 'unsupported'))
    return { status: 'needs_review', pnl: null };
  // 全赢。
  return { status: 'won', pnl: slip.potentialReturn };
}
