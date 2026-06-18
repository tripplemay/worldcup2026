/**
 * 智能盘口路由(纯函数):跨盘口候选 → 过滤 → 排序 → 取单场最优一注。
 *  1. 方差过滤:剔除模型胜率 < MIN_PROB 的高赔率盘口
 *  2. 正 EV 过滤:仅保留 EV > MIN_EV
 *  3. 按凯利比例降序,取第一名(同场互斥)
 */
import { expectedValue, kelly } from './ev';
import { MIN_EV, MIN_PROB } from './config';
import type { BetCandidate } from './types';

/** 给候选补齐 ev/kelly(从 pWin/pPush/odds 计算)。 */
export function scoreCandidate(
  c: Omit<BetCandidate, 'ev' | 'kelly'>,
): BetCandidate {
  return {
    ...c,
    ev: expectedValue(c.pWin, c.odds, c.pPush),
    kelly: kelly(c.pWin, c.odds, c.pPush),
  };
}

/** 从候选集挑出单场最优 +EV 注;无合格项返回 null。 */
export function selectBest(candidates: BetCandidate[]): BetCandidate | null {
  const qualified = candidates
    .filter((c) => c.pWin >= MIN_PROB && c.ev > MIN_EV)
    .sort((a, b) => b.kelly - a.kelly);
  return qualified[0] ?? null;
}
