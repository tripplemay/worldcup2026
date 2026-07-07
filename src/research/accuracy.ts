/**
 * Phase 10 · 精度轴(成功轴 C)测量:gap-to-market,双场景。
 *
 * 对注入数据无泄漏 walk-forward(predictPointInTime,只用该场之前数据),逐场比较:
 *   · ours   = 我们的【市场无关】融合(poisson+elo,不含 market)—— 无赔率场景的产品输出;
 *   · blend  = 【开盘锚融合】(市场模型以 marketWeight 进融合,锚=开盘价)—— 有赔率场景的
 *              产品输出。锚必须用开盘:预测时点闭盘未知,用闭盘当锚 = 拿基准抄基准(泄漏);
 *   · marketOpen = 开盘去水 —— blend 的公平对照(打败它 = 模型携带开盘市场之外的正交信息);
 *   · market = 闭盘去水 —— 公开可得的最准基准(天花板)。
 * blend/marketOpen 只在有开盘价的场次上计,gapBlendClose 用同子集闭盘,严格可比。
 * 另报 ECE 校准(10-bin,三向 outcome 合并)。gapBrier 保持旧口径(市场无关 ours vs
 * 全样本闭盘),下游 search/evolve 选参语义不受本次扩展影响。
 */
import { predictPointInTime } from 'lib/predict/backtest';
import { trueIP3 } from 'lib/odds/trueIP';
import { powerDevig } from './devig';
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
  devig?: 'proportional' | 'power'; // 去水法(敏感性验证;默认比例法)
}

export interface AccuracyResult {
  n: number;
  ours: CalibStat; // 市场无关融合(无赔率场景)
  blend: CalibStat; // 开盘锚融合(有赔率场景;仅有开盘价场次)
  market: CalibStat; // 闭盘去水(基准/天花板,全样本)
  marketOpen: CalibStat; // 开盘去水(blend 的公平对照,与 blend 同子集)
  closeSub: CalibStat; // 闭盘去水限定「有开盘」子集(与 blend 严格同子集,展示对比用)
  gapBrier: number; // ours.brier − market.brier(>0 = 我们更差;旧口径,选参用)
  gapLogLoss: number;
  gapBlendClose: number; // blend − 同子集闭盘去水(≤0 = 融合追平/超越闭盘)
  gapBlendOpen: number; // blend − 开盘去水(<0 = 模型携带开盘之外的正交信息)
  calibration: { ours: number; blend: number | null }; // ECE(10-bin;blend 无样本为 null)
  perModel: Record<string, CalibStat>; // poisson-xg / poisson-goals / elo(市场无关)
  baselines: { baseRateBrier: number }; // 朴素基准:评估窗前的 H/D/A 基率恒定预报(轴 C 下界锚)
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

/** ECE(期望校准误差):三向 outcome 的 (预测概率, 是否发生) 样本合并入 10 等宽桶。 */
function eceOf(samples: { p: number; hit: boolean }[]): number | null {
  if (!samples.length) return null;
  const B = 10;
  const bins = Array.from({ length: B }, () => ({ n: 0, pSum: 0, hits: 0 }));
  for (const s of samples) {
    const b = Math.min(B - 1, Math.floor(s.p * B));
    bins[b].n += 1;
    bins[b].pSum += s.p;
    if (s.hit) bins[b].hits += 1;
  }
  let ece = 0;
  for (const b of bins)
    if (b.n)
      ece += (b.n / samples.length) * Math.abs(b.hits / b.n - b.pSum / b.n);
  return +ece.toFixed(4);
}

const YIELD_EVERY = 32;
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/** 跑一次精度测量:同 (dataset, params) 恒返回同结果。async:每 32 场让出事件循环。 */
export async function runAccuracy(
  dataset: EngineDataset,
  params: AccuracyParams,
): Promise<AccuracyResult> {
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
  const blendAcc = newAcc();
  const mktAcc = newAcc();
  const mktOpenAcc = newAcc();
  const mktCloseSubAcc = newAcc(); // 闭盘去水限定在「有开盘」子集(gapBlendClose 严格可比)
  const baseAcc = newAcc();
  const perModel: Record<string, Acc> = {};
  const oursCalib: { p: number; hit: boolean }[] = [];
  const blendCalib: { p: number; hit: boolean }[] = [];
  let n = 0;

  // 朴素基准:评估窗【之前】的 H/D/A 基率(无 prior 则联赛长期典型 45/27/28)
  const prior = allRes.filter(
    (r) => params.from && dateKey(r.date) < params.from,
  );
  let bH = 0.45,
    bD = 0.27,
    bA = 0.28;
  if (prior.length >= 100) {
    const nH = prior.filter((r) => r.homeGoals > r.awayGoals).length;
    const nD = prior.filter((r) => r.homeGoals === r.awayGoals).length;
    bH = nH / prior.length;
    bD = nD / prior.length;
    bA = 1 - bH - bD;
  }

  let yieldCounter = 0;
  for (const m of matches) {
    if (++yieldCounter % YIELD_EVERY === 0) await breathe();
    const close = odds[matchKey(m.homeNorm, m.awayNorm, m.date)]?.x2?.close;
    if (!close) continue;
    const mkt =
      params.devig === 'power'
        ? powerDevig(close.h, close.d, close.a)
        : trueIP3(close.h, close.d, close.a);
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
    accum(baseAcc, { home: bH, draw: bD, away: bA }, result);
    oursCalib.push(
      { p: pp.pHome, hit: result === 'H' },
      { p: pp.pDraw, hit: result === 'D' },
      { p: pp.pAway, hit: result === 'A' },
    );
    for (const md of pp.models) {
      const a = (perModel[md.id] ??= newAcc());
      accum(a, { home: md.home, draw: md.draw, away: md.away }, result);
    }

    // 有赔率场景:开盘锚融合 vs 开盘去水 vs 同子集闭盘去水(锚只用预测时点可得的开盘)
    const open = odds[matchKey(m.homeNorm, m.awayNorm, m.date)]?.x2?.open;
    if (open) {
      const mktOpen =
        params.devig === 'power'
          ? powerDevig(open.h, open.d, open.a)
          : trueIP3(open.h, open.d, open.a);
      if (mktOpen) {
        const pb = predictPointInTime(
          allHist,
          allRes,
          m.homeNorm,
          m.awayNorm,
          m.date,
          tuning,
          sosEloOf,
          home,
          { home: open.h, draw: open.d, away: open.a },
          marketWeight,
        );
        if (pb) {
          accum(
            blendAcc,
            { home: pb.pHome, draw: pb.pDraw, away: pb.pAway },
            result,
          );
          accum(
            mktOpenAcc,
            { home: mktOpen.home, draw: mktOpen.draw, away: mktOpen.away },
            result,
          );
          accum(
            mktCloseSubAcc,
            { home: mkt.home, draw: mkt.draw, away: mkt.away },
            result,
          );
          blendCalib.push(
            { p: pb.pHome, hit: result === 'H' },
            { p: pb.pDraw, hit: result === 'D' },
            { p: pb.pAway, hit: result === 'A' },
          );
        }
      }
    }
    n += 1;
  }

  const ours = finalize(oursAcc);
  const blend = finalize(blendAcc);
  const market = finalize(mktAcc);
  const marketOpen = finalize(mktOpenAcc);
  const closeSub = finalize(mktCloseSubAcc);
  return {
    n,
    ours,
    blend,
    market,
    marketOpen,
    closeSub,
    gapBrier: +(ours.brier - market.brier).toFixed(4),
    gapLogLoss: +(ours.logLoss - market.logLoss).toFixed(4),
    gapBlendClose: blend.n ? +(blend.brier - closeSub.brier).toFixed(4) : 0,
    gapBlendOpen: blend.n ? +(blend.brier - marketOpen.brier).toFixed(4) : 0,
    calibration: { ours: eceOf(oursCalib) ?? 0, blend: eceOf(blendCalib) },
    perModel: Object.fromEntries(
      Object.entries(perModel).map(([k, a]) => [k, finalize(a)]),
    ),
    baselines: { baseRateBrier: finalize(baseAcc).brier },
  };
}
