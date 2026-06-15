/**
 * FIFA 男足世界排名(快照)。
 *
 * 1–50 为官方 FIFA/Coca-Cola 排名(2026-06-11 版,2026 世界杯开赛前最后一版,来源 ESPN)。
 * 50 名以后为世界杯参赛队的近似排名(标注 ★,可能与最新官方值略有出入,易在本文件更新)。
 *
 * 用真实队名作 key,查询时两边都过 normalizeTeam 对齐 ESPN/OddsAPI 队名差异。
 */
import { normalizeTeam } from 'lib/match/normalize';

// [队名, 排名] —— 1~50 官方
const OFFICIAL: [string, number][] = [
  ['Argentina', 1],
  ['Spain', 2],
  ['France', 3],
  ['England', 4],
  ['Portugal', 5],
  ['Brazil', 6],
  ['Morocco', 7],
  ['Netherlands', 8],
  ['Belgium', 9],
  ['Germany', 10],
  ['Croatia', 11],
  ['Italy', 12],
  ['Colombia', 13],
  ['Mexico', 14],
  ['Senegal', 15],
  ['Uruguay', 16],
  ['USA', 17],
  ['Japan', 18],
  ['Switzerland', 19],
  ['Iran', 20],
  ['Denmark', 21],
  ['Türkiye', 22],
  ['Ecuador', 23],
  ['Austria', 24],
  ['South Korea', 25],
  ['Nigeria', 26],
  ['Australia', 27],
  ['Algeria', 28],
  ['Egypt', 29],
  ['Canada', 30],
  ['Norway', 31],
  ['Ukraine', 32],
  ['Ivory Coast', 33],
  ['Panama', 34],
  ['Russia', 35],
  ['Poland', 36],
  ['Wales', 37],
  ['Sweden', 38],
  ['Hungary', 39],
  ['Czechia', 40],
  ['Paraguay', 41],
  ['Scotland', 42],
  ['Serbia', 43],
  ['Cameroon', 44],
  ['Tunisia', 45],
  ['Congo DR', 46],
  ['Slovakia', 47],
  ['Greece', 48],
  ['Venezuela', 49],
  ['Uzbekistan', 50],
];

// ★ 50 名以后的世界杯参赛队(近似,非官方 top50 快照,按需校正)
const APPROX: [string, number][] = [
  ['Qatar', 51],
  ['Costa Rica', 54],
  ['Saudi Arabia', 58],
  ['Iraq', 57],
  ['Jordan', 62],
  ['South Africa', 61],
  ['Jamaica', 63],
  ['Cape Verde', 70],
  ['Honduras', 71],
  ['Ghana', 73],
  ['Curaçao', 82],
  ['Haiti', 83],
  ['New Zealand', 86],
  ['New Caledonia', 150],
];

const RANKS = new Map<string, number>(
  [...OFFICIAL, ...APPROX].map(([name, rank]) => [normalizeTeam(name), rank]),
);

/** 取球队 FIFA 排名(对齐 ESPN/OddsAPI 队名);未收录返回 undefined。 */
export function getFifaRank(team: string): number | undefined {
  return RANKS.get(normalizeTeam(team));
}
