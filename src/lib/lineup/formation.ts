/**
 * 首发阵型布局(纯计算):把 ESPN 的有序首发 + 阵型串排到球场坐标。
 * 数据全部来自 ESPN summary(formation + 带左右的 position + jersey),无需额外数据源。
 */
import type { RosterPlayer, PlayerForm } from 'lib/espn/types';

export interface PitchSpot {
  jersey?: string;
  name: string;
  zh?: string; // 中文名(有则优先展示)
  pos?: string;
  form?: PlayerForm; // 近期状态(评分等)
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

/**
 * 位置纵深档(越大越靠前):门将 0 / 后卫 1 / 后腰 2 / 中场 3 / 前腰 4 / 前锋 5。
 * ESPN 的 roster 数组顺序并非「门将→后卫→中场→前锋」(更像按球衣号排),
 * 直接按数组顺序分行会错位;故先按位置缩写(已含 G/CD/DM/CM/AM/F 与边路标记)
 * 推断纵深档,排序后再按阵型分行,贴合真实站位。
 */
function posRank(pos = ''): number {
  let c = pos.toUpperCase().replace(/[^A-Z]/g, ''); // 去掉 '-' 等
  if (c === 'G' || c === 'GK') return 0;
  c = c.replace(/^[LR]/, '').replace(/[LRC]$/, ''); // 去左右边路标记 → 取核心角色
  if (/^(F|FW|CF|W|ST|SS|S)$/.test(c)) return 5; // 前锋 / 边锋
  if (c === 'AM' || c === 'CAM') return 4; // 前腰
  if (c === 'DM' || c === 'CDM') return 2; // 后腰
  if (c.includes('M')) return 3; // 中场
  return 1; // 其余按后卫
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
  // 先按位置纵深排序(GK→后卫→后腰→中场→前腰→前锋),修正 ESPN 数组的乱序;
  // 同档保持原序(行内左右由 lr 再排)。
  const xi = starters
    .slice(0, 11)
    .sort((a, b) => posRank(a.position) - posRank(b.position));
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
        form: p.form,
        x: ((ci + 1) / (sorted.length + 1)) * 100,
        adv,
      });
    });
  });
  return spots;
}
