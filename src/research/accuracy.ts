/**
 * Phase 10 · 精度轴(成功轴 C)测量:gap-to-market。
 *
 * 对注入数据无泄漏 walk-forward(predictPointInTime,只用该场之前数据),逐场比较:
 *   · ours   = 我们的【市场无关】融合(poisson+elo,不含 market)—— 即引擎下注用的同一套 mw;
 *   · market = 闭盘去水概率(trueIP3)—— 公开可得的最准基准。
 * 报告双方 Brier/LogLoss/命中率 + gap(ours − market;>0 = 我们更差)+ 各基础模型对照。
 * 这是「精度作为独立交付物」的头条指标:我们自建的免费透明模型,离市场精度还有多远。
 */
import { predictPointInTime } from 'lib/predict/backtest';
import { trueIP3 } from 'lib/odds/trueIP';
import { matchKey } from 'lib/match/normalize';
import type { Tuning } from 'lib/predict/tuning';
import type { EngineDataset } from './engine';

const dateKey = (iso: string) => iso.slice(0, 10);

export interface CalibStat {
  n: number;
  brier: number;
  logLoss: number;
  hitRate: number;
}

export interface AccuracyParams {
  tuning: Tuning;
  home?: { eloBonus: number; goalMult: number };
  marketWeight: number;
  from?: string;
  to?: string;
}

export interface AccuracyResult {
  n: number;
  ours: CalibStat; // 市场无关融合
  market: CalibStat; // 闭盘去水(基准/天花板)
  gapBrier: number; // ours.brier − market.brier(>0 = 我们更差)
  gapLogLoss: number;
  perModel: Record<string, CalibStat>; // poisson-xg / poisson-goals / elo(市场无关)
}

interface Acc {
  brierSum: number;
  llSum: number;
  hits: number;
  n: number;
}
const newAcc = (): Acc => ({ brierSum: 0, llSum: 0, hits: 0, n: 0 });
const finalize = (a: Acc): CalibStat => ({
  n: a.n,
  brier: a.n ? +(a.brierSum / a.n).toFixed(4) : 0,
  logLoss: a.n ? +(a.llSum / a.n).toFixed(4) : 0,
  hitRate: a.n ? +(a.hits / a.n).toFixed(4) : 0,
});

type R = 'H' | 'D' | 'A';
function accum(
  a: Acc,
  p: { home: number; draw: number; away: number },
  result: R,
): void {
  const bH = (result === 'H' ? 1 : 0) - p.home;
  const bD = (result === 'D' ? 1 : 0) - p.draw;
  const bA = (result === 'A' ? 1 : 0) - p.away;
  a.brierSum += bH * bH + bD * bD + bA * bA;
  const pact = result === 'H' ? p.home : result === 'A' ? p.away : p.draw;
  a.llSum += -Math.log(Math.max(1e-9, pact));
  const pick: R =
    p.home >= p.draw && p.home >= p.away
      ? 'H'
      : p.away >= p.draw && p.away >= p.home
      ? 'A'
      : 'D';
  if (pick === result) a.hits += 1;
  a.n += 1;
}

/** 跑一次精度测量:同 (dataset, params) 恒返回同结果。 */
export function runAccuracy(
  dataset: EngineDataset,
  params: AccuracyParams,
): AccuracyResult {
  if (process.env.PREDICT_WEIGHTS)
    throw new Error('[research] PREDICT_WEIGHTS 必须 unset(见 ensemble.ts)');

  const { allHist, allRes, odds, sosEloOf } = dataset;
  const { tuning, home, marketWeight } = params;
  const matches = allRes
    .filter(
      (r) =>
        (!params.from || dateKey(r.date) >= params.from) &&
        (!params.to || dateKey(r.date) <= params.to),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId),
    );

  const oursAcc = newAcc();
  const mktAcc = newAcc();
  const perModel: Record<string, Acc> = {};
  let n = 0;

  for (const m of matches) {
    const close = odds[matchKey(m.homeNorm, m.awayNorm, m.date)]?.x2?.close;
    if (!close) continue;
    const mkt = trueIP3(close.h, close.d, close.a);
    if (!mkt) continue;
    // 市场无关:不传 marketOdds → 融合仅 poisson+elo(= 引擎下注用的 mw 口径)
    const pp = predictPointInTime(
      allHist,
      allRes,
      m.homeNorm,
      m.awayNorm,
      m.date,
      tuning,
      sosEloOf,
      home,
      undefined,
      marketWeight,
    );
    if (!pp) continue;
    const result: R =
      m.homeGoals > m.awayGoals ? 'H' : m.homeGoals < m.awayGoals ? 'A' : 'D';
    accum(oursAcc, { home: pp.pHome, draw: pp.pDraw, away: pp.pAway }, result);
    accum(mktAcc, { home: mkt.home, draw: mkt.draw, away: mkt.away }, result);
    for (const md of pp.models) {
      const a = (perModel[md.id] ??= newAcc());
      accum(a, { home: md.home, draw: md.draw, away: md.away }, result);
    }
    n += 1;
  }

  const ours = finalize(oursAcc);
  const market = finalize(mktAcc);
  return {
    n,
    ours,
    market,
    gapBrier: +(ours.brier - market.brier).toFixed(4),
    gapLogLoss: +(ours.logLoss - market.logLoss).toFixed(4),
    perModel: Object.fromEntries(
      Object.entries(perModel).map(([k, a]) => [k, finalize(a)]),
    ),
  };
}
