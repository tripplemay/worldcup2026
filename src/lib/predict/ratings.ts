/**
 * 球队动态评分:对每队近期比赛的单场 xG 做指数加权移动平均(EWMA),
 * 得「场均创造 xG」(进攻)和「场均丢失 xG」(防守),写入 ratings.json。
 */
import {
  loadHistorical,
  loadResults,
  loadRatings,
  saveRatings,
  saveElo,
} from 'lib/db/store';
import { normalizeTeam } from 'lib/match/normalize';
import type { TeamRating } from './types';

const ALPHA = 0.85; // 衰减系数:越近的比赛权重越高
const MAX_GAMES = 15; // 最多取近 N 场(xG EWMA)

/** Elo 回放所需的最小赛果字段(HistMatch / ResultMatch 都兼容)。 */
export type GameLike = {
  date: string;
  homeNorm: string;
  awayNorm: string;
  homeGoals: number;
  awayGoals: number;
};

// ── Elo ──────────────────────────────────────────────
const ELO_START = 1500;
const ELO_K = 30; // 基础 K
const ELO_HOME_ADV = 65; // 历史比赛主场优势(更新时加,预测中立场不加)

/** 净胜球放大系数(World Football Elo 风格)。 */
function marginMult(diff: number): number {
  const d = Math.abs(diff);
  if (d <= 1) return 1;
  if (d === 2) return 1.5;
  return (11 + d) / 8;
}

/** 按日期回放所有历史比赛,得到各队 Elo(归一化队名 → 分)。 */
export function computeElo(games: GameLike[]): Map<string, number> {
  const elo = new Map<string, number>();
  const get = (k: string) => elo.get(k) ?? ELO_START;
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));
  for (const m of sorted) {
    const Ra = get(m.homeNorm);
    const Rb = get(m.awayNorm);
    const Ea = 1 / (1 + Math.pow(10, (Rb - (Ra + ELO_HOME_ADV)) / 400));
    const Sa =
      m.homeGoals > m.awayGoals ? 1 : m.homeGoals === m.awayGoals ? 0.5 : 0;
    const k = ELO_K * marginMult(m.homeGoals - m.awayGoals);
    const delta = k * (Sa - Ea);
    elo.set(m.homeNorm, Ra + delta);
    elo.set(m.awayNorm, Rb - delta);
  }
  return elo;
}

interface Sample {
  date: string;
  name: string;
  xgFor: number;
  xgAgainst: number;
  gf: number;
  ga: number;
}

/** 重算所有球队评分。authElo 为 eloratings.net 权威 Elo(优先);缺失回退自算。 */
export function recomputeRatings(authElo?: Map<string, number>): {
  teams: number;
} {
  const hist = Object.values(loadHistorical());
  // 自算 Elo(results.json,last=40;缺失退回 historical)作为回退
  const results = Object.values(loadResults());
  const selfElo = computeElo(results.length ? results : hist);

  // 权威 Elo(eloratings.net)优先存为独立 elo.json,覆盖全部队;
  // 缺失的队用自算补齐,供 Elo 模型对任意对阵都能查到。
  const eloOut: Record<string, number> = {};
  for (const [k, v] of selfElo) eloOut[k] = Math.round(v);
  if (authElo) for (const [k, v] of authElo) eloOut[k] = v; // 权威覆盖
  saveElo(eloOut);
  const byTeam = new Map<string, Sample[]>();
  const add = (norm: string, s: Sample) => {
    if (!byTeam.has(norm)) byTeam.set(norm, []);
    byTeam.get(norm)!.push(s);
  };
  // 按「当前归一化(从原始队名重算)」聚合,而非沿用入库时存的 homeNorm/awayNorm:
  // 否则别名等归一化规则更新后,旧数据的键不会跟着变,导致查不到(如 Congo DR)。
  for (const m of hist) {
    add(normalizeTeam(m.homeName), {
      date: m.date,
      name: m.homeName,
      xgFor: m.homeXg,
      xgAgainst: m.awayXg,
      gf: m.homeGoals,
      ga: m.awayGoals,
    });
    add(normalizeTeam(m.awayName), {
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
      elo: authElo?.get(norm) ?? Math.round(selfElo.get(norm) ?? ELO_START),
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
