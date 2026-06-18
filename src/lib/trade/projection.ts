/**
 * 泊松矩阵降维投影(纯函数):把比分矩阵 m[i][j] 求和成各盘口概率。
 * 矩阵由 xG 泊松 λ/μ 生成(市场无关),供 EV 计算与盘口路由使用。
 */

/** 胜平负(矩阵边际)。 */
export function projectMatchWinner(m: number[][]): {
  home: number;
  draw: number;
  away: number;
} {
  let home = 0,
    draw = 0,
    away = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  return { home, draw, away };
}

/** 大小球某线:over(总进球>line)/ under(<line)/ push(==line,仅整数盘)。 */
export function projectOverUnder(
  m: number[][],
  line: number,
): { over: number; under: number; push: number } {
  let over = 0,
    under = 0,
    push = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++) {
      const t = i + j;
      const p = m[i][j];
      if (t > line) over += p;
      else if (t < line) under += p;
      else push += p;
    }
  return { over, under, push };
}

/** 双方进球(BTTS)。 */
export function projectBtts(m: number[][]): { yes: number; no: number } {
  let yes = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++)
      if (i >= 1 && j >= 1) yes += m[i][j];
  return { yes, no: 1 - yes };
}

/**
 * 亚洲让分盘(让分施加于主队 point,如主 -1.5 → point=-1.5)。
 * 主赢盘:(主−客)+point > 0;走盘:==0(整数盘);客赢盘:<0。
 */
export function projectAsianHandicap(
  m: number[][],
  point: number,
): { homeCover: number; push: number; awayCover: number } {
  let homeCover = 0,
    push = 0,
    awayCover = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++) {
      const d = i - j + point;
      const p = m[i][j];
      if (d > 1e-9) homeCover += p;
      else if (d < -1e-9) awayCover += p;
      else push += p;
    }
  return { homeCover, push, awayCover };
}
