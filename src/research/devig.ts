/**
 * 去水方法(devig)敏感性:gap-to-market 的"市场真相"依赖去水法。
 * 默认比例法(trueIP3);此处补幂法(power):p_i = q_i^k,解 k 使 Σp=1。
 * 幂法把更多水分配给长赔(favourite-longshot 偏差),是主流替代口径;
 * 用于敏感性验证——两法下 gap 结论若不翻,测量才算稳。
 */
export function powerDevig(
  h: number,
  d: number,
  a: number,
): { home: number; draw: number; away: number } | null {
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const q = [1 / h, 1 / d, 1 / a];
  const f = (k: number) => q.reduce((s, x) => s + Math.pow(x, k), 0) - 1;
  // Σq>1(含水)→ 需 k>1 压到 1;二分 [1, 5]
  let lo = 1,
    hi = 5;
  if (f(lo) < 0) return { home: q[0], draw: q[1], away: q[2] }; // 已无水(异常)
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  const p = q.map((x) => Math.pow(x, k));
  const sum = p[0] + p[1] + p[2];
  return { home: p[0] / sum, draw: p[1] / sum, away: p[2] / sum };
}
