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

/** 双重机会:1X(主或平)/ 12(主或客)/ X2(平或客)。 */
export function projectDoubleChance(m: number[][]): {
  homeDraw: number;
  homeAway: number;
  drawAway: number;
} {
  const { home, draw, away } = projectMatchWinner(m);
  return {
    homeDraw: home + draw,
    homeAway: home + away,
    drawAway: draw + away,
  };
}

/** 胜平负去平(DNB):平局退款 → 平为 push;主/客胜各为 pWin。 */
export function projectDrawNoBet(m: number[][]): {
  home: number;
  away: number;
  push: number;
} {
  const { home, draw, away } = projectMatchWinner(m);
  return { home, away, push: draw };
}

/** 双方进球(BTTS)。 */
export function projectBtts(m: number[][]): { yes: number; no: number } {
  let yes = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++) if (i >= 1 && j >= 1) yes += m[i][j];
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

/** 四分盘判定:盘口线小数位为 .25 或 .75(含负)。纯谓词,供投影/结算共用。 */
export function isQuarterLine(line: number | undefined): boolean {
  if (line == null || !Number.isFinite(line)) return false;
  return Math.abs((line * 4) % 2) === 1;
}

/**
 * 亚洲让分盘·四分盘(±.25/.75)投影:拆两条相邻半盘(line±0.25,一条整数可走盘、
 * 一条 .5 永不走盘),逐格分桶成四类结果概率(和恒为 1)。
 * side='home' 让分施于主队(base=主−客净胜);side='away' 施于客队(base=客−主)。
 */
export function projectAsianHandicapQuarter(
  m: number[][],
  line: number,
  side: 'home' | 'away',
): {
  pFullWin: number;
  pHalfWin: number;
  pHalfLoss: number;
  pFullLoss: number;
} {
  const low = line - 0.25;
  const high = line + 0.25;
  const evalHalf = (x: number): 'win' | 'loss' | 'push' =>
    x > 1e-9 ? 'win' : x < -1e-9 ? 'loss' : 'push';
  let pFullWin = 0,
    pHalfWin = 0,
    pHalfLoss = 0,
    pFullLoss = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      const base = side === 'home' ? i - j : j - i; // 所选队净胜
      const a = evalHalf(base + low);
      const b = evalHalf(base + high);
      if (a === 'win' && b === 'win') pFullWin += p;
      else if (a === 'loss' && b === 'loss') pFullLoss += p;
      else if (a === 'win' || b === 'win') pHalfWin += p; // 赢 + 走盘
      else pHalfLoss += p; // 输 + 走盘(两半相差 0.5,至多一条走盘,不会赢+输)
    }
  return { pFullWin, pHalfWin, pHalfLoss, pFullLoss };
}
