/**
 * 首发阵型布局(纯计算):把 ESPN 的有序首发 + 阵型串排到球场坐标。
 * 数据全部来自 ESPN summary(formation + 带左右的 position + jersey),无需额外数据源。
 */
import type { RosterPlayer } from 'lib/espn/types';

export interface PitchSpot {
  jersey?: string;
  name: string;
  zh?: string; // 中文名(有则优先展示)
  pos?: string;
  x: number; // 0..100,观众视角从左到右
  adv: number; // 0..1,0=门将线,1=最靠前(进攻方向)
}

/**
 * 位置左右倾向(数值越小越靠左):
 *  宽位(边后卫/边前卫/边锋,缩写以 L/R 开头)±2;半边位(CD-L/CM-R 等带 -L/-R 后缀)±1;居中 0。
 *  这样边后卫排在中后卫外侧、边锋排在中锋外侧,更贴近真实站位。
 */
function lr(pos = ''): number {
  const p = pos.toUpperCase();
  if (/^L/.test(p)) return -2;
  if (/^R/.test(p)) return 2;
  if (/-L$/.test(p)) return -1;
  if (/-R$/.test(p)) return 1;
  return 0;
}

/** 阵型缺失/不匹配时,按位置缩写粗分 后卫/中场/前锋 行数。 */
function groupLines(rest: RosterPlayer[]): number[] {
  let d = 0,
    m = 0,
    f = 0;
  for (const p of rest) {
    const u = (p.position || '').toUpperCase();
    if (/F/.test(u)) f++;
    else if (/M/.test(u)) m++;
    else d++;
  }
  return [d, m, f].filter((n) => n > 0);
}

/**
 * 排布首发到球场坐标。
 * @param formation 如 "4-3-3"(可空)
 * @param starters 有序首发(ESPN 顺序:门将→后卫→中场→前锋)
 */
export function layoutXI(
  formation: string | undefined,
  starters: RosterPlayer[],
): PitchSpot[] {
  const xi = starters.slice(0, 11);
  if (!xi.length) return [];

  let lines = (formation || '')
    .split('-')
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0);
  if (lines.reduce((s, n) => s + n, 0) + 1 !== xi.length) {
    lines = groupLines(xi.slice(1)); // 阵型不可用 → 按位置粗分
  }
  if (!lines.length) lines = [xi.length - 1]; // 兜底:除门将外全塞一行

  const rows: RosterPlayer[][] = [[xi[0]]]; // 第 0 行:门将
  let idx = 1;
  for (const n of lines) {
    rows.push(xi.slice(idx, idx + n));
    idx += n;
  }
  if (idx < xi.length) rows[rows.length - 1].push(...xi.slice(idx));

  const spots: PitchSpot[] = [];
  const lastRow = rows.length - 1;
  rows.forEach((row, ri) => {
    const sorted = [...row].sort((a, b) => lr(a.position) - lr(b.position));
    const adv = lastRow === 0 ? 0 : ri / lastRow;
    sorted.forEach((p, ci) => {
      spots.push({
        jersey: p.jersey,
        name: p.name,
        zh: p.zh,
        pos: p.position,
        x: ((ci + 1) / (sorted.length + 1)) * 100,
        adv,
      });
    });
  });
  return spots;
}
