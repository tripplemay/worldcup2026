/**
 * Phase 10 · headless 研究引擎(数据 + 参数全注入,确定性,可并发跑数千组配置)。
 *
 * 忠实复用生产已验证的下注管线(predictPointInTime → 市场无关融合 1X2 + 泊松矩阵 →
 * candidatesFromSnapshot → selectBest → 四分之一凯利 → settleOutcome/pnlFor),但:
 *   · 数据从参数注入(不读 store);赛果来自数据集,直接对已知终分结算;
 *   · tuning / 主场 / marketWeight / 全部下注阈值 / 初始资金 均可注入(供 sweep);
 *   · 内存不可变 bankroll(不复用 ledger 的全局 promise chain / 单调 seq);
 *   · 入口硬守卫 PREDICT_WEIGHTS —— 研究进程绝不允许 env 静态权重逃生舱污染每次实验。
 *
 * P2b:赔率改用开盘+闭盘(LeagueMatchOdds 的 x2)——**在开盘价下注、拿闭盘价量 CLV**
 * (CLV = 成交赔率 / 闭盘赔率 − 1;仅在开盘下注且有闭盘时有意义)。无开盘则回退闭盘下注
 * (此时无 CLV)。仍仅 1X2;多市场(亚盘/大小球)待数据填充 ah/totals 后接入。
 */
import { predictPointInTime } from 'lib/predict/backtest';
import { buildMatrix } from 'lib/predict/models/poissonCore';
import { ensemble } from 'lib/predict/ensemble';
import {
  modelsFromPredictions,
  classifyDivergence,
} from 'lib/predict/divergence';
import { matchKey } from 'lib/match/normalize';
import { projectMatchWinner } from 'lib/trade/projection';
import { candidatesFromSnapshot } from 'lib/trade/odds';
import { selectBest } from 'lib/trade/router';
import { stakeFor } from 'lib/trade/ev';
import { settleOutcome, pnlFor } from 'lib/trade/settle';
import type { HistMatch, ResultMatch } from 'lib/predict/types';
import type { Tuning } from 'lib/predict/tuning';
import type {
  X2Odds,
  AhOdds,
  TotalOdds,
  OpenClose,
} from 'lib/predict/oddsTypes';
import type { MarketSnapshot, BetCandidate, Trade } from 'lib/trade/types';

const dateKey = (iso: string) => iso.slice(0, 10);

/** 引擎依赖每场的开/闭盘切片(LeagueMatchOdds 结构上满足):1X2 + 亚盘 + 大小球。 */
export type MatchOddsView = {
  x2?: OpenClose<X2Odds>;
  ah?: OpenClose<AhOdds>[];
  totals?: OpenClose<TotalOdds>[];
};

/** 注入的历史数据集(某联赛某段);均为该联赛内已归一化的记录。 */
export interface EngineDataset {
  allHist: HistMatch[];
  allRes: ResultMatch[];
  odds: Record<string, MatchOddsView>; // matchKey → 开盘+闭盘 1X2
  sosEloOf?: (norm: string) => number | undefined; // 可选权威 Elo(SoS 对手强度)
}

/** 一次实验的完整策略参数(预测 + 下注 + 资金,全可 sweep)。 */
export interface StrategyParams {
  tuning: Tuning; // 完整 Tuning(goalShrink/dcRho/shrinkEloScale 等,勿留 env 回落)
  home?: { eloBonus: number; goalMult: number }; // 主场优势(联赛按 calib;留空=中立)
  marketWeight: number; // ensemble 市场锚定权重
  bet: {
    minProb: number;
    minEv: number;
    maxEv: number;
    kellyFraction: number;
    maxStakePct: number;
    minStake: number;
    coverageStakePct: number;
    initialBalance: number;
    g1Veto?: boolean; // R1 错配场押市场非热门方否决(默认 true,与生产一致)
    slippagePct?: number; // 执行摩擦敏感性:成交赔率按 (odds-1)×(1-x) 折减(默认 0)
    markets?: { ah?: boolean; ou?: boolean; over?: boolean }; // 市场白名单(可进化;缺省 AH/OU 开、Over 关)
  };
  from?: string; // 评估窗起(含);walk-forward 切片
  to?: string; // 评估窗止(含)
}

/** CLV(成交赔率 vs 同选项闭盘赔率):>0 = 买在比闭盘更好的价。无有效闭盘返回 null。 */
export function clvFor(
  selection: string,
  betOdds: number,
  close: X2Odds,
): number | null {
  const co =
    selection === 'home'
      ? close.h
      : selection === 'away'
      ? close.a
      : selection === 'draw'
      ? close.d
      : undefined;
  if (co == null || co <= 1) return null;
  return +(betOdds / co - 1).toFixed(4);
}

/** 泛化 CLV:1X2/OU/AH 的成交价 vs 同市场/选项/线的闭盘价;无可比闭盘返回 null。 */
export function clvForBet(
  cand: BetCandidate,
  mv: MatchOddsView,
): number | null {
  if (cand.market === '1X2')
    return mv.x2?.close ? clvFor(cand.selection, cand.odds, mv.x2.close) : null;
  if (cand.market === 'OU') {
    const c = mv.totals?.[0]?.close;
    if (!c || c.line !== cand.line) return null;
    const co = cand.selection === 'Under' ? c.under : c.over;
    return co > 1 ? +(cand.odds / co - 1).toFixed(4) : null;
  }
  if (cand.market === 'AH') {
    const c = mv.ah?.[0]?.close;
    if (!c) return null;
    // home 注 line=开盘 home 让球;away 注 line=-开盘 home 让球。闭盘 home 让球=c.line。仅同线可比。
    const co =
      cand.selection === 'home'
        ? cand.line === c.line
          ? c.home
          : undefined
        : cand.line === -c.line
        ? c.away
        : undefined;
    return co != null && co > 1 ? +(cand.odds / co - 1).toFixed(4) : null;
  }
  return null;
}

interface Tier {
  bets: number;
  staked: number;
  pnl: number;
  wins: number;
  losses: number;
  voids: number;
}
const newTier = (): Tier => ({
  bets: 0,
  staked: 0,
  pnl: 0,
  wins: 0,
  losses: 0,
  voids: 0,
});
const tierOut = (t: Tier) => ({
  bets: t.bets,
  staked: +t.staked.toFixed(2),
  pnl: +t.pnl.toFixed(2),
  roi: t.staked ? +(t.pnl / t.staked).toFixed(4) : 0,
  winRate: t.bets ? +(t.wins / t.bets).toFixed(3) : 0,
  record: `${t.wins}-${t.losses}-${t.voids}`,
});

/** 一注的精简记录(供 P3 计算 CLV / 分段评价)。 */
export interface BetRecord {
  date: string;
  home: string;
  away: string;
  tier: 'value' | 'coverage';
  betPhase: 'open' | 'close'; // 在开盘还是闭盘价下注(无开盘时回退闭盘)
  market: string;
  selection: string;
  line?: number;
  odds: number;
  stake: number;
  pnl: number;
  result: string;
  clv: number | null; // 仅 value 注 + 开盘下注 + 有闭盘时非空
}

/** CLV 汇总(仅 value 注)。 */
export interface ClvSummary {
  n: number;
  avgClv: number;
  posRate: number;
  tStat: number;
  dropped: number; // 开盘 value 注中因线动(AH/OU 闭盘不同线)无法量 CLV 而丢弃的笔数(选择偏差可见化)
}

export interface StrategyResult {
  matches: number; // 有预测 + 赔率的已评估场次
  bankrollStart: number;
  bankrollEnd: number;
  roiCompound: number;
  value: ReturnType<typeof tierOut>;
  coverage: ReturnType<typeof tierOut>;
  clv: ClvSummary; // value 注 CLV(先行护栏)
  g1Vetoed: number;
  pickDist: { home: number; draw: number; away: number };
  bets: BetRecord[];
}

/**
 * 跑一次策略实验:对注入数据集在 [from,to] 窗内做无泄漏 walk-forward,
 * 逐场 predict → 候选 → 选注 → 内存结算,返回 P&L / CLV / 分层 / 每注记录。
 * 确定性:同 (dataset, params) 恒返回同结果。
 */
export function runStrategy(
  dataset: EngineDataset,
  params: StrategyParams,
): StrategyResult {
  // 硬守卫:研究进程绝不允许 PREDICT_WEIGHTS 静态逃生舱(会静默覆盖动态权重,毒化每次实验)
  if (process.env.PREDICT_WEIGHTS)
    throw new Error(
      '[research] PREDICT_WEIGHTS 必须 unset —— 静态权重逃生舱会毒化 sweep(见 ensemble.ts)',
    );

  const { allHist, allRes, odds, sosEloOf } = dataset;
  const { tuning, home, marketWeight, bet } = params;
  const g1On = bet.g1Veto ?? true;

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

  let balance = bet.initialBalance;
  const value = newTier();
  const coverage = newTier();
  const records: BetRecord[] = [];
  let evaluated = 0;
  let g1Vetoed = 0;
  const pickDist = { home: 0, draw: 0, away: 0 };
  // CLV 累加(仅 value)
  let clvN = 0,
    clvSum = 0,
    clvSum2 = 0,
    clvPos = 0,
    clvDropped = 0;

  const settle = (
    m: ResultMatch,
    cand: BetCandidate,
    stake: number,
    t: Tier,
    tier: 'value' | 'coverage',
    mv: MatchOddsView,
  ): void => {
    const trade = {
      market: cand.market,
      selection: cand.selection,
      line: cand.line,
      odds: cand.odds,
      stake,
    } as Trade;
    const res = settleOutcome(trade, m.homeGoals, m.awayGoals);
    const pnl = pnlFor(trade, res);
    balance += pnl;
    t.bets += 1;
    t.staked += stake;
    t.pnl += pnl;
    if (res === 'won' || res === 'half_won') t.wins += 1;
    else if (res === 'lost' || res === 'half_lost') t.losses += 1;
    else t.voids += 1;
    // 相位由该注赔率来源(cand.book)精确判定;仅开盘下注的 value 注量 CLV(闭盘下注 CLV 无意义)
    const phase: 'open' | 'close' = cand.book === 'open' ? 'open' : 'close';
    const clv =
      tier === 'value' && phase === 'open' ? clvForBet(cand, mv) : null;
    if (
      tier === 'value' &&
      phase === 'open' &&
      clv == null &&
      (cand.market === 'AH' || cand.market === 'OU')
    )
      clvDropped += 1; // 线动 → 同线不可比 → 丢样本(诚实计数,防静默选择偏差)
    if (tier === 'value' && clv != null) {
      clvN += 1;
      clvSum += clv;
      clvSum2 += clv * clv;
      if (clv > 0) clvPos += 1;
    }
    records.push({
      date: m.date,
      home: m.homeNorm,
      away: m.awayNorm,
      tier,
      betPhase: phase,
      market: cand.market,
      selection: cand.selection,
      line: cand.line,
      odds: cand.odds,
      stake: +stake.toFixed(2),
      pnl: +pnl.toFixed(2),
      result: res,
      clv,
    });
  };

  for (const m of matches) {
    const mv = odds[matchKey(m.homeNorm, m.awayNorm, m.date)];
    const x2 = mv?.x2;
    // 在开盘价下注(拿闭盘量 CLV);无开盘则回退闭盘下注(无 CLV)
    const betX2 = x2?.open ?? x2?.close;
    if (!mv || !betX2) continue; // 无任何 1X2 赔率
    const betPhase: 'open' | 'close' = x2?.open ? 'open' : 'close';

    const pp = predictPointInTime(
      allHist,
      allRes,
      m.homeNorm,
      m.awayNorm,
      m.date,
      tuning,
      sosEloOf,
      home,
      { home: betX2.h, draw: betX2.d, away: betX2.a }, // 下注时点可得的市场(开盘)
      marketWeight,
    );
    if (!pp || !pp.preds) continue;
    const poisson = pp.preds.find((p) => p.modelId === 'poisson-xg');
    if (!poisson || poisson.xgHome == null || poisson.xgAway == null) continue;
    evaluated += 1;

    const matrix = buildMatrix(poisson.xgHome, poisson.xgAway, tuning.dcRho);
    // 市场无关 1X2(去掉 market 重归一);融合失败回退泊松矩阵边际
    const mf = ensemble(
      pp.preds.filter((p) => p.modelId !== 'market'),
      'pit',
      pp.eloDiff,
    );
    const mw = mf
      ? { home: mf.homeWin, draw: mf.draw, away: mf.awayWin }
      : projectMatchWinner(matrix);

    // 执行摩擦:成交赔率折减(滑点敏感性;CLV 用折减后成交价 → 压力方向正确)
    const slip = (o: number) => 1 + (o - 1) * (1 - (bet.slippagePct ?? 0));
    const snap: MarketSnapshot = {
      h2h: {
        home: { price: slip(betX2.h), book: betPhase },
        draw: { price: slip(betX2.d), book: betPhase },
        away: { price: slip(betX2.a), book: betPhase },
      },
      totals: [],
      spreads: [],
    };
    // 大小球 2.5(开盘优先;book 记相位供 CLV 门控)
    for (const tv of mv.totals ?? []) {
      const t = tv.open ?? tv.close;
      const ph = tv.open ? 'open' : 'close';
      if (t)
        snap.totals.push({
          point: t.line,
          over: { price: slip(t.over), book: ph },
          under: { price: slip(t.under), book: ph },
        });
    }
    // 亚盘主线:home(让球 line)+ away(-line)两向
    for (const av of mv.ah ?? []) {
      const a = av.open ?? av.close;
      const ph = av.open ? 'open' : 'close';
      if (a) {
        snap.spreads.push({
          side: 'home',
          point: a.line,
          pick: { price: slip(a.home), book: ph },
        });
        snap.spreads.push({
          side: 'away',
          point: -a.line,
          pick: { price: slip(a.away), book: ph },
        });
      }
    }
    const mkts = bet.markets;
    const candidates = candidatesFromSnapshot(matrix, mw, snap, {
      includeOver: mkts?.over === true,
    }).filter((c) =>
      c.market === 'AH'
        ? mkts?.ah ?? true
        : c.market === 'OU'
        ? mkts?.ou ?? true
        : true,
    );
    const best = selectBest(candidates, {
      minProb: bet.minProb,
      minEv: bet.minEv,
      maxEv: bet.maxEv,
    });

    // G1:R1 错配场押市场非热门方 → 否决(弱方"价值"多为 artifact)
    let r1Veto = false;
    if (g1On && best && best.market === '1X2') {
      const sigModels = modelsFromPredictions(pp.preds, pp.ens ?? null);
      const mk = sigModels.market;
      const favSide = mk
        ? (['h', 'd', 'a'] as const).reduce((b, k) => (mk[k] > mk[b] ? k : b))
        : null;
      const pickSide =
        best.selection === 'home'
          ? 'h'
          : best.selection === 'away'
          ? 'a'
          : best.selection === 'draw'
          ? 'd'
          : null;
      r1Veto =
        classifyDivergence(sigModels) === 'R1_UNDERCONF' &&
        !!favSide &&
        !!pickSide &&
        pickSide !== favSide;
    }
    if (r1Veto) g1Vetoed += 1;

    let placedValue = false;
    if (best && !r1Veto) {
      const stake = stakeFor(best.kelly, balance, {
        fraction: bet.kellyFraction,
        maxPct: bet.maxStakePct,
        minStake: bet.minStake,
      });
      if (stake > 0) {
        settle(m, best, stake, value, 'value', mv);
        placedValue = true;
        if (
          best.selection === 'home' ||
          best.selection === 'away' ||
          best.selection === 'draw'
        )
          pickDist[best.selection] += 1;
      }
    }
    // 覆盖注:无 value 注 → 对融合(含市场)热门方下小注
    if (!placedValue) {
      const fav =
        pp.pHome >= pp.pDraw && pp.pHome >= pp.pAway
          ? 'home'
          : pp.pAway >= pp.pDraw && pp.pAway >= pp.pHome
          ? 'away'
          : 'draw';
      const cov = candidates.find(
        (c) => c.market === '1X2' && c.selection === fav,
      );
      const cstake = +(balance * bet.coverageStakePct).toFixed(2);
      if (cov && cstake > 0) settle(m, cov, cstake, coverage, 'coverage', mv);
    }
  }

  const clvMean = clvN ? clvSum / clvN : 0;
  const clvVar =
    clvN > 1
      ? Math.max(0, (clvSum2 - clvN * clvMean * clvMean) / (clvN - 1))
      : 0;
  const clvSd = Math.sqrt(clvVar);
  const clvT = clvN > 1 && clvSd > 0 ? clvMean / (clvSd / Math.sqrt(clvN)) : 0;

  return {
    matches: evaluated,
    bankrollStart: bet.initialBalance,
    bankrollEnd: +balance.toFixed(2),
    roiCompound: +((balance - bet.initialBalance) / bet.initialBalance).toFixed(
      4,
    ),
    value: tierOut(value),
    coverage: tierOut(coverage),
    clv: {
      n: clvN,
      avgClv: +clvMean.toFixed(4),
      posRate: clvN ? +(clvPos / clvN).toFixed(3) : 0,
      tStat: +clvT.toFixed(2),
      dropped: clvDropped,
    },
    g1Vetoed,
    pickDist,
    bets: records,
  };
}
