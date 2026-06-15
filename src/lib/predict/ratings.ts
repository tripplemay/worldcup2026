/**
 * 球队动态评分:对每队近期比赛的单场 xG 做指数加权移动平均(EWMA),
 * 得「场均创造 xG」(进攻)和「场均丢失 xG」(防守),写入 ratings.json。
 */
import { loadHistorical, loadRatings, saveRatings } from 'lib/db/store';
import type { TeamRating } from './types';

const ALPHA = 0.85; // 衰减系数:越近的比赛权重越高
const MAX_GAMES = 10; // 最多取近 N 场

interface Sample {
  date: string;
  name: string;
  xgFor: number;
  xgAgainst: number;
  gf: number;
  ga: number;
}

/** 重算所有球队评分(基于 historical.json)。返回参与计算的球队数。 */
export function recomputeRatings(): { teams: number } {
  const hist = Object.values(loadHistorical());
  const byTeam = new Map<string, Sample[]>();
  const add = (norm: string, s: Sample) => {
    if (!byTeam.has(norm)) byTeam.set(norm, []);
    byTeam.get(norm)!.push(s);
  };
  for (const m of hist) {
    add(m.homeNorm, {
      date: m.date,
      name: m.homeName,
      xgFor: m.homeXg,
      xgAgainst: m.awayXg,
      gf: m.homeGoals,
      ga: m.awayGoals,
    });
    add(m.awayNorm, {
      date: m.date,
      name: m.awayName,
      xgFor: m.awayXg,
      xgAgainst: m.homeXg,
      gf: m.awayGoals,
      ga: m.homeGoals,
    });
  }

  const ratings: Record<string, TeamRating> = {};
  const now = Date.now();
  for (const [norm, all] of byTeam) {
    const samples = all
      .sort((a, b) => b.date.localeCompare(a.date)) // 最近在前
      .slice(0, MAX_GAMES);
    if (!samples.length) continue;
    let w = 0;
    let f = 0;
    let a = 0;
    let gf = 0;
    let ga = 0;
    samples.forEach((s, i) => {
      const weight = Math.pow(ALPHA, i);
      w += weight;
      f += weight * s.xgFor;
      a += weight * s.xgAgainst;
      gf += weight * s.gf;
      ga += weight * s.ga;
    });
    ratings[norm] = {
      norm,
      name: samples[0].name,
      xgFor: +(f / w).toFixed(3),
      xgAgainst: +(a / w).toFixed(3),
      goalsFor: +(gf / w).toFixed(3),
      goalsAgainst: +(ga / w).toFixed(3),
      sample: samples.length,
      updatedAt: now,
    };
  }
  saveRatings(ratings);
  return { teams: Object.keys(ratings).length };
}

/** 读取单队评分(归一化队名)。 */
export function getRating(norm: string): TeamRating | undefined {
  return loadRatings()[norm];
}
