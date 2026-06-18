/**
 * Walk-forward 回测:对每场已结束的世界杯比赛,只用「该场日期之前」的数据重算评分/自算 Elo,
 * 生成真正的赛前预测,再对实际结果。避免用含赛果的当前评分预测过去(数据泄漏)。
 *
 * 口径:用自算 Elo(可点位重建;权威 eloratings.net 无法回溯);市场模型缺席(无赛前赔率快照),
 * 故评估的是「市场无关的 泊松+Elo 融合」。这与生产对已结束场次的现算结果在结构上一致。
 */
import { loadHistorical, loadResults } from 'lib/db/store';
import { computeElo, ratingsFromHistorical } from './ratings';
import { ensemble } from './ensemble';
import { getModels } from './registry';
import './models'; // 副作用:注册模型
import { DEFAULT_WC_START } from 'lib/tmi/constants';
import type { PredictionContext } from './model';
import type { HistMatch, ResultMatch } from './types';
import type { Tuning } from './tuning';

const dateKey = (iso: string) => iso.slice(0, 10);

export interface PointPrediction {
  pHome: number;
  pDraw: number;
  pAway: number;
  predGoals: number;
  over25?: number;
  btts?: number;
}

/**
 * 点位重建预测:只用 beforeISO 之前的数据重算评分/自算 Elo → 融合预测(市场无关)。
 * 回测与回填共用。评分样本不足返回 null。
 */
export function predictPointInTime(
  allHist: HistMatch[],
  allRes: ResultMatch[],
  homeNorm: string,
  awayNorm: string,
  beforeISO: string,
  tuning?: Tuning,
): PointPrediction | null {
  const D = dateKey(beforeISO);
  const selfElo = computeElo(allRes.filter((r) => dateKey(r.date) < D));
  const ratings = ratingsFromHistorical(
    allHist.filter((h) => dateKey(h.date) < D),
    (norm) => selfElo.get(norm),
  );
  if (!ratings[homeNorm] || !ratings[awayNorm]) return null;
  const vals = Object.values(ratings);
  const leagueAvg = Math.max(
    0.6,
    vals.reduce((s, r) => s + r.xgFor, 0) / vals.length,
  );
  const leagueAvgGoals = Math.max(
    0.6,
    vals.reduce((s, r) => s + r.goalsFor, 0) / vals.length,
  );
  const ctx: PredictionContext = {
    matchId: 'pit',
    homeName: homeNorm,
    awayName: awayNorm,
    homeNorm,
    awayNorm,
    neutral: true,
    homeAdvantage: 0,
    leagueAvg,
    leagueAvgGoals,
    marketOdds: undefined,
    rating: (nm) => ratings[nm],
    eloOf: (nm) => selfElo.get(nm),
    tuning,
  };
  const preds = getModels()
    .map((md) => md.predict(ctx))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const eh = selfElo.get(homeNorm);
  const ea = selfElo.get(awayNorm);
  const eloDiff = eh != null && ea != null ? Math.abs(eh - ea) : undefined;
  const ens = ensemble(preds, 'pit', eloDiff);
  if (!ens) return null;
  return {
    pHome: ens.homeWin,
    pDraw: ens.draw,
    pAway: ens.awayWin,
    predGoals: (ens.xgHome ?? 0) + (ens.xgAway ?? 0),
    over25: ens.over25,
    btts: ens.btts,
  };
}

export interface BacktestRow {
  date: string;
  home: string;
  away: string;
  gh: number;
  ga: number;
  result: 'H' | 'D' | 'A';
  pHome: number;
  pDraw: number;
  pAway: number;
  pick: 'H' | 'D' | 'A';
  hit: boolean;
  predGoals: number;
  actualGoals: number;
}

export interface BacktestResult {
  n: number;
  skipped: number; // 评分样本不足、无法预测的场次
  hitRate: number;
  brier: number;
  logLoss: number;
  drawActual: number;
  drawPicked: number;
  meanPredGoals: number;
  meanActualGoals: number;
  rows: BacktestRow[];
}

export function runBacktest(opts?: {
  wcStart?: string;
  goalShrink?: number;
  dcRho?: number;
  eloDrawScale?: number;
}): BacktestResult {
  const wcStart =
    opts?.wcStart || process.env.WC_START?.trim() || DEFAULT_WC_START;
  const tuning =
    opts?.goalShrink != null ||
    opts?.dcRho != null ||
    opts?.eloDrawScale != null
      ? {
          goalShrink: opts?.goalShrink,
          dcRho: opts?.dcRho,
          eloDrawScale: opts?.eloDrawScale,
        }
      : undefined;
  const allHist = Object.values(loadHistorical());
  const allRes = Object.values(loadResults());
  const wcMatches = allRes
    .filter((r) => dateKey(r.date) >= wcStart)
    .sort((a, b) => a.date.localeCompare(b.date));

  const rows: BacktestRow[] = [];
  let brier = 0,
    ll = 0,
    hits = 0,
    drawActual = 0,
    drawPicked = 0,
    sumPred = 0,
    sumActual = 0,
    n = 0,
    skipped = 0;

  for (const m of wcMatches) {
    const pp = predictPointInTime(
      allHist,
      allRes,
      m.homeNorm,
      m.awayNorm,
      m.date,
      tuning,
    );
    if (!pp) {
      skipped += 1;
      continue;
    }
    const D = dateKey(m.date);
    const { pHome: pH, pDraw: pD, pAway: pA } = pp;
    const result: 'H' | 'D' | 'A' =
      m.homeGoals > m.awayGoals ? 'H' : m.homeGoals < m.awayGoals ? 'A' : 'D';
    const pick: 'H' | 'D' | 'A' =
      pH >= pD && pH >= pA ? 'H' : pA >= pD && pA >= pH ? 'A' : 'D';
    const hit = pick === result;
    const predGoals = pp.predGoals;
    const actualGoals = m.homeGoals + m.awayGoals;

    const bH = (result === 'H' ? 1 : 0) - pH;
    const bD = (result === 'D' ? 1 : 0) - pD;
    const bA = (result === 'A' ? 1 : 0) - pA;
    brier += bH * bH + bD * bD + bA * bA;
    const pact = result === 'H' ? pH : result === 'A' ? pA : pD;
    ll += -Math.log(Math.max(1e-9, pact));
    hits += hit ? 1 : 0;
    drawActual += result === 'D' ? 1 : 0;
    drawPicked += pick === 'D' ? 1 : 0;
    sumPred += predGoals;
    sumActual += actualGoals;
    n += 1;
    rows.push({
      date: D,
      home: m.homeNorm,
      away: m.awayNorm,
      gh: m.homeGoals,
      ga: m.awayGoals,
      result,
      pHome: +pH.toFixed(3),
      pDraw: +pD.toFixed(3),
      pAway: +pA.toFixed(3),
      pick,
      hit,
      predGoals: +predGoals.toFixed(2),
      actualGoals,
    });
  }

  return {
    n,
    skipped,
    hitRate: n ? +(hits / n).toFixed(3) : 0,
    brier: n ? +(brier / n).toFixed(3) : 0,
    logLoss: n ? +(ll / n).toFixed(3) : 0,
    drawActual,
    drawPicked,
    meanPredGoals: n ? +(sumPred / n).toFixed(2) : 0,
    meanActualGoals: n ? +(sumActual / n).toFixed(2) : 0,
    rows,
  };
}
