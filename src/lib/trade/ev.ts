/**
 * 期望值与凯利(纯函数,含走盘 push 处理)。
 * 单位本金:赢得净赔率 b=odds-1,输掉 -1,走盘 0(退本)。
 *   EV    = pWin·b − pLose       (pLose = 1 − pWin − pPush)
 *   Kelly = EV / b               (赢则下注比例;≤0 表示无优势)
 */
export function expectedValue(pWin: number, odds: number, pPush = 0): number {
  const b = odds - 1;
  const pLose = 1 - pWin - pPush;
  return +(pWin * b - pLose).toFixed(4);
}

export function kelly(pWin: number, odds: number, pPush = 0): number {
  const b = odds - 1;
  if (b <= 0) return 0;
  return +(expectedValue(pWin, odds, pPush) / b).toFixed(4);
}

/** 下注金额:四分之一凯利 × 当前余额,夹在 [最低额, 余额上限比例] 之间;无优势返回 0。 */
export function stakeFor(
  kellyFraction: number,
  balance: number,
  opts: { fraction: number; maxPct: number; minStake: number },
): number {
  if (kellyFraction <= 0 || balance <= 0) return 0;
  const raw = balance * kellyFraction * opts.fraction;
  const cap = balance * opts.maxPct;
  const stake = Math.min(raw, cap, balance);
  if (stake < opts.minStake) return 0;
  return +stake.toFixed(2);
}
