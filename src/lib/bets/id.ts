/** Phase 9 轻量 id 生成(时间戳 base36 + 随机后缀;注单/投注人量级足够)。 */
export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
