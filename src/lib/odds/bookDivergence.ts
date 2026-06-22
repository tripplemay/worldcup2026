/**
 * 跨家盘口分歧(读盘第 4 步 + 校准升级):对一场比赛各家 h2h 赔率**逐家去水**(True_IP),
 * 算跨家共识 / 离散度,并按**锐度**分组——**锐盘子集**(Pinnacle/Betfair 交易所/Matchbook)
 * 共识 vs **软市场**共识。
 *
 * 历史校准(docs/分析报告:跨家分歧历史校准…;n=4405)结论:**真正有信息量的是「谁在领跑」
 * 而非「分歧多大」**——Pinnacle 是领先指标(其偏离能预测软市场收盘移动),软盘领跑多为噪声。
 * 故头条读盘用「锐盘 vs 软市场」差,而非裸幅度。⚠️阈值/系数不可移植,仅家身份方向可移植。
 *
 * 纯展示层市场情报:帮助读盘,不构成下注建议。同一数据源(the-odds-api)内多家比较,
 * 无跨源 id 对齐;复用已抓赔率,零额外配额。严禁直接用未去水赔率——所有概率都过 trueIP3。
 */
import { trueIP3 } from './trueIP';
import type { BookmakerOdds } from './types';

export type Side = 'home' | 'draw' | 'away';
export type DivergenceLevel = 'tight' | 'moderate' | 'wide';
export type SharpGapLevel = 'aligned' | 'mild' | 'divergent';

/**
 * 锐盘集合(低水/交易所,历史校准证实的领先指标;the-odds-api regions=eu 实测均在)。
 * pinnacle=Pinnacle(领盘);betfair_ex_eu=Betfair 交易所;matchbook=Matchbook 交易所;
 * smarkets 交易所(当前 feed 未见,留作可移植)。其余一律视为软市场。
 */
export const SHARP_BOOKS = new Set([
  'pinnacle',
  'betfair_ex_eu',
  'matchbook',
  'smarkets',
]);

export const isSharpBook = (key: string): boolean => SHARP_BOOKS.has(key);

/** 单家去水后的真实概率(详情表逐行用)。 */
export interface BookProb {
  key: string;
  title: string;
  home: number;
  draw: number;
  away: number;
  sharp: boolean; // 是否锐盘
}

/** 离散度最大那一路上的极值家(领跑 = 报得最高 / 滞后 = 报得最低)。 */
export interface BookExtreme {
  key: string;
  title: string;
  prob: number; // 该家在 topSide 上的去水概率
}

/** 锐盘 vs 软市场读盘(校准升级:头条信号)。需 ≥1 锐盘且 ≥1 软盘。 */
export interface SharpRead {
  sharpCount: number;
  softCount: number;
  sharpTitles: string[]; // 参与的锐盘名(展示「锐盘:Pinnacle·Betfair…」)
  sharpConsensus: { home: number; draw: number; away: number };
  softConsensus: { home: number; draw: number; away: number };
  gapSide: Side; // 锐盘与软市场分歧最大的一路
  gapPp: number; // gapSide 上 (锐盘 − 软市场) × 100,带符号,1 位;>0 = 锐盘看高
  level: SharpGapLevel;
}

export interface BookDivergence {
  books: number; // 参与去水的家数
  consensus: { home: number; draw: number; away: number }; // 全市场各家中位数(重归一化)
  topSide: Side; // 离散度最大的一路
  spreadPp: number; // topSide 上 (最高 − 最低) × 100,1 位(裸幅度;校准证实信息量低)
  level: DivergenceLevel;
  high: BookExtreme; // 领跑:topSide 上报得最高的一家
  low: BookExtreme; // 滞后:topSide 上报得最低的一家
  sharp: SharpRead | null; // 锐盘 vs 软市场(校准升级头条;无锐盘或无软盘时 null)
  perBook: BookProb[]; // 各家去水概率
}

/** 至少 3 家才算得上「跨家共识/分歧」,否则样本太薄不可信。 */
const MIN_BOOKS = 3;
/** 裸幅度分级阈值(去水概率极差,百分点):温和 ≥3pp,显著 ≥6pp。 */
const MODERATE_PP = 3;
const WIDE_PP = 6;
/** 锐盘 vs 软市场分级阈值(百分点;校准:此差比裸幅度更有信息量,但仍偏读盘提示)。 */
const SHARP_MILD_PP = 1.5;
const SHARP_DIVERGENT_PP = 3;

const SIDES: Side[] = ['home', 'draw', 'away'];
const round4 = (x: number) => +x.toFixed(4);

/** 中位数(对单一软盘离群稳健;偶数取中间两值平均)。 */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 一组去水概率 → 共识(各路中位数,重归一化到和为 1)。 */
function consensusOf(books: BookProb[]): {
  home: number;
  draw: number;
  away: number;
} {
  const med = {
    home: median(books.map((p) => p.home)),
    draw: median(books.map((p) => p.draw)),
    away: median(books.map((p) => p.away)),
  };
  const s = med.home + med.draw + med.away;
  return {
    home: round4(med.home / s),
    draw: round4(med.draw / s),
    away: round4(med.away / s),
  };
}

function levelOf(spreadPp: number): DivergenceLevel {
  if (spreadPp >= WIDE_PP) return 'wide';
  if (spreadPp >= MODERATE_PP) return 'moderate';
  return 'tight';
}

/** 锐盘子集共识 vs 软市场共识。任一组为空返回 null。 */
function sharpReadOf(perBook: BookProb[]): SharpRead | null {
  const sharp = perBook.filter((p) => p.sharp);
  const soft = perBook.filter((p) => !p.sharp);
  if (!sharp.length || !soft.length) return null;
  const sc = consensusOf(sharp);
  const fc = consensusOf(soft);
  // 锐盘与软市场分歧最大的一路
  let gapSide: Side = 'home';
  let best = -1;
  for (const s of SIDES) {
    const g = Math.abs(sc[s] - fc[s]);
    if (g > best) {
      best = g;
      gapSide = s;
    }
  }
  const gapPp = +((sc[gapSide] - fc[gapSide]) * 100).toFixed(1);
  const abs = Math.abs(gapPp);
  const level: SharpGapLevel =
    abs >= SHARP_DIVERGENT_PP
      ? 'divergent'
      : abs >= SHARP_MILD_PP
      ? 'mild'
      : 'aligned';
  return {
    sharpCount: sharp.length,
    softCount: soft.length,
    sharpTitles: sharp.map((p) => p.title),
    sharpConsensus: sc,
    softConsensus: fc,
    gapSide,
    gapPp,
    level,
  };
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
      sharp: isSharpBook(b.key),
    });
  }
  if (perBook.length < MIN_BOOKS) return null;

  const consensus = consensusOf(perBook);

  // 找离散度(极差)最大的一路 + 该路上的领跑/滞后家(裸幅度;校准证实信息量低,保留作回退)
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
    sharp: sharpReadOf(perBook),
    perBook,
  };
}
