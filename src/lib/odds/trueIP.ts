/**
 * 比例去水法(Margin Proportional Removal):从十进制赔率剥离庄家抽水,
 * 得真实隐含概率 True_IP。CLV 真值靶 / 微观异动雷达的唯一概率来源。
 * 严禁直接用未去水的简单倒数。
 */
const valid = (x: number | null | undefined): x is number =>
  typeof x === 'number' && x > 1;

/** 1X2(三项):返回去水后 {home,draw,away}(和=1);任一无效返回 null。 */
export function trueIP3(
  home?: number | null,
  draw?: number | null,
  away?: number | null,
): { home: number; draw: number; away: number } | null {
  if (!valid(home) || !valid(draw) || !valid(away)) return null;
  const ih = 1 / home;
  const id = 1 / draw;
  const ia = 1 / away;
  const sum = ih + id + ia;
  if (sum <= 0) return null;
  return { home: ih / sum, draw: id / sum, away: ia / sum };
}

/** 两项(亚盘/大小球):返回去水后 {a,b}(和=1);任一无效返回 null。 */
export function trueIP2(
  a?: number | null,
  b?: number | null,
): { a: number; b: number } | null {
  if (!valid(a) || !valid(b)) return null;
  const ia = 1 / a;
  const ib = 1 / b;
  const sum = ia + ib;
  if (sum <= 0) return null;
  return { a: ia / sum, b: ib / sum };
}
