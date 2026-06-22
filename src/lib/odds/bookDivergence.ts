/**
 * 跨家盘口分歧(读盘第 4 步):对一场比赛各家 h2h 赔率**逐家去水**(True_IP),
 * 算跨家概率离散度 → 标出「分歧大」的场 + 谁报得最高(领跑)/最低(滞后)。
 *
 * 纯展示层市场情报:看各家共识 vs 离群,帮助读盘,不构成下注建议。
 * 同一数据源(the-odds-api)内多家比较,无跨源 id 对齐问题;复用已抓赔率,零额外配额。
 * 严禁直接用未去水赔率——所有概率都过 trueIP3。
 */
import { trueIP3 } from './trueIP';
import type { BookmakerOdds } from './types';

export type Side = 'home' | 'draw' | 'away';
export type DivergenceLevel = 'tight' | 'moderate' | 'wide';

/** 单家去水后的真实概率(详情表逐行用)。 */
export interface BookProb {
  key: string;
  title: string;
  home: number;
  draw: number;
  away: number;
}

/** 离散度最大那一路上的极值家(领跑 = 报得最高 / 滞后 = 报得最低)。 */
export interface BookExtreme {
  key: string;
  title: string;
  prob: number; // 该家在 topSide 上的去水概率
}

export interface BookDivergence {
  books: number; // 参与去水的家数
  consensus: { home: number; draw: number; away: number }; // 各家中位数(重归一化)
  topSide: Side; // 离散度最大的一路(读盘头条)
  spreadPp: number; // topSide 上 (最高 − 最低) × 100,保留 1 位(百分点)
  level: DivergenceLevel;
  high: BookExtreme; // 领跑:topSide 上报得最高的一家
  low: BookExtreme; // 滞后:topSide 上报得最低的一家
  perBook: BookProb[]; // 各家去水概率
}

/** 至少 3 家才算得上「跨家共识/分歧」,否则样本太薄不可信。 */
const MIN_BOOKS = 3;
/** 分歧分级阈值(去水概率极差,百分点):温和 ≥3pp,显著 ≥6pp。 */
const MODERATE_PP = 3;
const WIDE_PP = 6;

const SIDES: Side[] = ['home', 'draw', 'away'];
const round4 = (x: number) => +x.toFixed(4);

/** 中位数(对单一软盘离群稳健;偶数取中间两值平均)。 */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function levelOf(spreadPp: number): DivergenceLevel {
  if (spreadPp >= WIDE_PP) return 'wide';
  if (spreadPp >= MODERATE_PP) return 'moderate';
  return 'tight';
}

/**
 * 计算一场比赛的跨家分歧。家数 < 3 或无有效去水赔率返回 null(不展示)。
 */
export function computeBookDivergence(
  bookmakers: BookmakerOdds[],
): BookDivergence | null {
  const perBook: BookProb[] = [];
  for (const b of bookmakers) {
    const ip = trueIP3(b.home, b.draw, b.away);
    if (!ip) continue;
    perBook.push({
      key: b.key,
      title: b.title,
      home: round4(ip.home),
      draw: round4(ip.draw),
      away: round4(ip.away),
    });
  }
  if (perBook.length < MIN_BOOKS) return null;

  // 共识:各路中位数,重归一化到和为 1
  const med = {
    home: median(perBook.map((p) => p.home)),
    draw: median(perBook.map((p) => p.draw)),
    away: median(perBook.map((p) => p.away)),
  };
  const ms = med.home + med.draw + med.away;
  const consensus = {
    home: round4(med.home / ms),
    draw: round4(med.draw / ms),
    away: round4(med.away / ms),
  };

  // 找离散度(极差)最大的一路 + 该路上的领跑/滞后家
  let topSide: Side = 'home';
  let topRange = -1;
  let topHigh = perBook[0];
  let topLow = perBook[0];
  for (const s of SIDES) {
    let hi = perBook[0];
    let lo = perBook[0];
    for (const p of perBook) {
      if (p[s] > hi[s]) hi = p;
      if (p[s] < lo[s]) lo = p;
    }
    const range = hi[s] - lo[s];
    if (range > topRange) {
      topRange = range;
      topSide = s;
      topHigh = hi;
      topLow = lo;
    }
  }
  const spreadPp = +(topRange * 100).toFixed(1);

  return {
    books: perBook.length,
    consensus,
    topSide,
    spreadPp,
    level: levelOf(spreadPp),
    high: { key: topHigh.key, title: topHigh.title, prob: topHigh[topSide] },
    low: { key: topLow.key, title: topLow.title, prob: topLow[topSide] },
    perBook,
  };
}
