/**
 * 可注入种子的伪随机数发生器(模拟可复现:同种子 → 同结果,测试可断言)。
 * mulberry32:32 位状态,质量足够蒙特卡洛用;hashSeed 把字符串映射为种子。
 */

export type Rng = () => number; // 返回 [0,1)

/** mulberry32 PRNG(确定性,快)。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串 → 32 位种子(xfnv1a),用于按对阵/实体生成稳定种子。 */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 从累积分布数组里按 rng 抽一个下标(线性扫描;短数组够快)。
 * cum 必须单调不减、末元≈1。
 */
export function sampleCumulative(cum: number[], rng: Rng): number {
  const r = rng();
  for (let i = 0; i < cum.length; i++) if (r < cum[i]) return i;
  return cum.length - 1;
}
