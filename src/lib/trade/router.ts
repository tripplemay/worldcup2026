/**
 * 智能盘口路由(纯函数):跨盘口候选 → 过滤 → 排序 → 取单场最优一注。
 *  1. 方差过滤:剔除模型胜率 < MIN_PROB 的高赔率盘口
 *  2. EV 区间:仅保留 MIN_EV < EV ≤ MAX_EV(超上限视为赔率/口径错配,弃用)
 *  3. 按凯利比例降序,取第一名(同场互斥)
 */
import { expectedValue, kelly, expectedValueQuarter, kellyQuarter } from './ev';
import { MIN_EV, MAX_EV, MIN_PROB } from './config';
import type { BetCandidate } from './types';

/** 给候选补齐 ev/kelly(四分盘走四类概率口径,其余走 pWin/pPush/odds)。 */
export function scoreCandidate(
  c: Omit<BetCandidate, 'ev' | 'kelly'>,
): BetCandidate {
  if (c.quarter) {
    const { pFullWin, pHalfWin, pHalfLoss, pFullLoss } = c.quarter;
    return {
      ...c,
      ev: expectedValueQuarter(
        pFullWin,
        pHalfWin,
        pHalfLoss,
        pFullLoss,
        c.odds,
      ),
      kelly: kellyQuarter(pFullWin, pHalfWin, pHalfLoss, pFullLoss, c.odds),
    };
  }
  return {
    ...c,
    ev: expectedValue(c.pWin, c.odds, c.pPush),
    kelly: kelly(c.pWin, c.odds, c.pPush),
  };
}

/** 选注阈值(缺省回退 config 常量);研究引擎 sweep 时注入覆盖。 */
export interface SelectOpts {
  minProb?: number;
  minEv?: number;
  maxEv?: number;
}

/** 从候选集挑出单场最优 +EV 注;无合格项返回 null。阈值默认取 config,可经 opts 覆盖。 */
export function selectBest(
  candidates: BetCandidate[],
  opts?: SelectOpts,
): BetCandidate | null {
  const minProb = opts?.minProb ?? MIN_PROB;
  const minEv = opts?.minEv ?? MIN_EV;
  const maxEv = opts?.maxEv ?? MAX_EV;
  const qualified = candidates
    .filter((c) => c.pWin >= minProb && c.ev > minEv && c.ev <= maxEv)
    .sort((a, b) => b.kelly - a.kelly);
  return qualified[0] ?? null;
}
