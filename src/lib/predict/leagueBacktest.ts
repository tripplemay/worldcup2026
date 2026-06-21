/**
 * 联赛历史 walk-forward 回测(Phase 1:大样本模型校准)。
 * 复用 predictPointInTime(点对点、无泄漏:自算 Elo + 评分均来自该场之前的数据)。
 * 报告聚焦我们一直在啃的校准问题:Brier、各模型对比、平局校准、大球偏差(预测 vs 实际)。
 * 仅用比赛结果(无需赔率);市场模型因无 marketOdds 自动不参与融合(同 WC 回测)。
 */
import { predictPointInTime } from './backtest';
import {
  loadLeagueHistorical,
  loadLeagueResults,
  loadLeagueOdds,
} from 'lib/db/store';
import { matchKey } from 'lib/match/normalize';
import { trueIP3 } from 'lib/odds/trueIP';

const dateKey = (iso: string) => iso.slice(0, 10);
const MISMATCH = 0.6; // 闭盘隐含热门方 ≥60% 视为错配(R1 子集)

export interface LeagueBacktestResult {
  key: string;
  from?: string;
  hfa: { elo: number; mult: number };
  n: number;
  skipped: number;
  ensemble: { brier: number; logLoss: number; hitRate: number };
  perModel: Record<string, { brier: number; hitRate: number; n: number }>;
  draw: { actualRate: number; pickedRate: number; meanPredicted: number };
  over25: {
    predOverRate: number;
    actualOverRate: number;
    hitRate: number;
    meanPredicted: number;
  };
  goals: { meanPred: number; meanActual: number };
  // R1:各模型在「闭盘热门方」上的概率 − 闭盘该项(<0=比市场欠自信)。mismatch=错配子集。
  oddsCoverage: { withOdds: number; mismatch: number };
  r1: Record<string, { favBias: number; favBiasMismatch: number }>;
}

export function runLeagueBacktest(opts: {
  key: string;
  from?: string;
  hfaElo?: number;
  hfaMult?: number;
}): LeagueBacktestResult {
  const hfaElo = opts.hfaElo ?? 65; // 联赛主场优势(Elo 分);0=中立
  const hfaMult = opts.hfaMult ?? 1.12; // 泊松主场进球乘子;1=中立
  const allHist = Object.values(loadLeagueHistorical(opts.key));
  const allRes = Object.values(loadLeagueResults(opts.key));
  const oddsMap = loadLeagueOdds(opts.key);
  const matches = allRes
    .filter((r) => !opts.from || dateKey(r.date) >= opts.from)
    .sort((a, b) => a.date.localeCompare(b.date));

  // R1 favBias 累加(各模型 + ensemble)
  const r1acc: Record<
    string,
    { sum: number; n: number; sumMis: number; nMis: number }
  > = {};
  let withOdds = 0,
    mismatchN = 0;
  const accR1 = (id: string, bias: number, mis: boolean) => {
    const a = (r1acc[id] ??= { sum: 0, n: 0, sumMis: 0, nMis: 0 });
    a.sum += bias;
    a.n++;
    if (mis) {
      a.sumMis += bias;
      a.nMis++;
    }
  };

  let brier = 0,
    ll = 0,
    hits = 0,
    n = 0,
    skipped = 0;
  let drawActual = 0,
    drawPicked = 0,
    drawPredSum = 0;
  let ouHits = 0,
    ouOverPicked = 0,
    ouOverActual = 0,
    ouN = 0,
    over25Sum = 0;
  let sumPred = 0,
    sumActual = 0;
  const mm: Record<string, { brier: number; hits: number; n: number }> = {};

  for (const m of matches) {
    const o = oddsMap[matchKey(m.homeNorm, m.awayNorm, m.date)];
    const pp = predictPointInTime(
      allHist,
      allRes,
      m.homeNorm,
      m.awayNorm,
      m.date,
      undefined,
      undefined,
      hfaElo || hfaMult !== 1
        ? { eloBonus: hfaElo, goalMult: hfaMult }
        : undefined,
      o ? { home: o.h, draw: o.d, away: o.a } : undefined,
    );
    if (!pp) {
      skipped++;
      continue;
    }
    const result: 'H' | 'D' | 'A' =
      m.homeGoals > m.awayGoals ? 'H' : m.homeGoals < m.awayGoals ? 'A' : 'D';
    const { pHome: pH, pDraw: pD, pAway: pA } = pp;
    const pick: 'H' | 'D' | 'A' =
      pH >= pD && pH >= pA ? 'H' : pA >= pD && pA >= pH ? 'A' : 'D';
    const bH = (result === 'H' ? 1 : 0) - pH;
    const bD = (result === 'D' ? 1 : 0) - pD;
    const bA = (result === 'A' ? 1 : 0) - pA;
    brier += bH * bH + bD * bD + bA * bA;
    ll += -Math.log(
      Math.max(1e-9, result === 'H' ? pH : result === 'A' ? pA : pD),
    );
    hits += pick === result ? 1 : 0;
    drawActual += result === 'D' ? 1 : 0;
    drawPicked += pick === 'D' ? 1 : 0;
    drawPredSum += pD;
    const actualGoals = m.homeGoals + m.awayGoals;
    sumPred += pp.predGoals;
    sumActual += actualGoals;
    if (pp.over25 != null) {
      over25Sum += pp.over25;
      const po = pp.over25 >= 0.5;
      const ao = actualGoals > 2.5;
      if (po === ao) ouHits++;
      if (po) ouOverPicked++;
      if (ao) ouOverActual++;
      ouN++;
    }
    for (const md of pp.models ?? []) {
      const a = (mm[md.id] ??= { brier: 0, hits: 0, n: 0 });
      const x = (result === 'H' ? 1 : 0) - md.home;
      const y = (result === 'D' ? 1 : 0) - md.draw;
      const z = (result === 'A' ? 1 : 0) - md.away;
      a.brier += x * x + y * y + z * z;
      const mp: 'H' | 'D' | 'A' =
        md.home >= md.draw && md.home >= md.away
          ? 'H'
          : md.away >= md.draw && md.away >= md.home
          ? 'A'
          : 'D';
      a.hits += mp === result ? 1 : 0;
      a.n++;
    }
    // R1:各模型/融合在「闭盘热门方」上 vs 市场去水概率的偏差
    if (o) {
      const ip = trueIP3(o.h, o.d, o.a);
      if (ip) {
        withOdds++;
        const mk: Record<'home' | 'draw' | 'away', number> = {
          home: ip.home,
          draw: ip.draw,
          away: ip.away,
        };
        const favKey = (['home', 'draw', 'away'] as const).reduce((b, k) =>
          mk[k] > mk[b] ? k : b,
        );
        const favP = mk[favKey];
        const mis = favP >= MISMATCH;
        if (mis) mismatchN++;
        const ensFav = favKey === 'home' ? pH : favKey === 'away' ? pA : pD;
        accR1('ensemble', ensFav - favP, mis);
        for (const md of pp.models ?? []) {
          const mFav =
            favKey === 'home' ? md.home : favKey === 'away' ? md.away : md.draw;
          accR1(md.id, mFav - favP, mis);
        }
      }
    }
    n++;
  }

  const r1: LeagueBacktestResult['r1'] = {};
  for (const [id, a] of Object.entries(r1acc))
    r1[id] = {
      favBias: a.n ? +(a.sum / a.n).toFixed(3) : 0,
      favBiasMismatch: a.nMis ? +(a.sumMis / a.nMis).toFixed(3) : 0,
    };

  const perModel: LeagueBacktestResult['perModel'] = {};
  for (const [id, a] of Object.entries(mm))
    perModel[id] = {
      brier: a.n ? +(a.brier / a.n).toFixed(3) : 0,
      hitRate: a.n ? +(a.hits / a.n).toFixed(3) : 0,
      n: a.n,
    };

  return {
    key: opts.key,
    from: opts.from,
    hfa: { elo: hfaElo, mult: hfaMult },
    n,
    skipped,
    ensemble: {
      brier: n ? +(brier / n).toFixed(3) : 0,
      logLoss: n ? +(ll / n).toFixed(3) : 0,
      hitRate: n ? +(hits / n).toFixed(3) : 0,
    },
    perModel,
    draw: {
      actualRate: n ? +(drawActual / n).toFixed(3) : 0,
      pickedRate: n ? +(drawPicked / n).toFixed(3) : 0,
      meanPredicted: n ? +(drawPredSum / n).toFixed(3) : 0,
    },
    over25: {
      predOverRate: ouN ? +(ouOverPicked / ouN).toFixed(3) : 0,
      actualOverRate: ouN ? +(ouOverActual / ouN).toFixed(3) : 0,
      hitRate: ouN ? +(ouHits / ouN).toFixed(3) : 0,
      meanPredicted: ouN ? +(over25Sum / ouN).toFixed(3) : 0,
    },
    goals: {
      meanPred: n ? +(sumPred / n).toFixed(2) : 0,
      meanActual: n ? +(sumActual / n).toFixed(2) : 0,
    },
    oddsCoverage: { withOdds, mismatch: mismatchN },
    r1,
  };
}
