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
 * 当前仅 1X2 闭盘口径(与 leaguePaper 同,对手=闭盘价 → 结果是下界);
 * 多市场 / 开盘吃 CLV 待 P2 的 LeagueOddsX 数据模型接入后开启。
 */
import { predictPointInTime } from 'lib/predict/backtest';
import { buildMatrix } from 'lib/predict/models/poissonCore';
import { ensemble } from 'lib/predict/ensemble';
import { modelsFromPredictions, classifyDivergence } from 'lib/predict/divergence';
import { matchKey } from 'lib/match/normalize';
import { projectMatchWinner } from 'lib/trade/projection';
import { candidatesFromSnapshot } from 'lib/trade/odds';
import { selectBest } from 'lib/trade/router';
import { stakeFor } from 'lib/trade/ev';
import { settleOutcome, pnlFor } from 'lib/trade/settle';
import type { HistMatch, ResultMatch } from 'lib/predict/types';
import type { Tuning } from 'lib/predict/tuning';
import type { LeagueClosing } from 'lib/db/store';
import type { MarketSnapshot, BetCandidate, Trade } from 'lib/trade/types';

const dateKey = (iso: string) => iso.slice(0, 10);

/** 注入的历史数据集(某联赛某段);均为该联赛内已归一化的记录。 */
export interface EngineDataset {
  allHist: HistMatch[];
  allRes: ResultMatch[];
  oddsMap: Record<string, LeagueClosing>; // matchKey → 闭盘 1X2
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
  };
  from?: string; // 评估窗起(含);walk-forward 切片
  to?: string; // 评估窗止(含)
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
  market: string;
  selection: string;
  line?: number;
  odds: number;
  stake: number;
  pnl: number;
  result: string;
}

export interface StrategyResult {
  matches: number; // 有预测 + 闭盘的已评估场次
  bankrollStart: number;
  bankrollEnd: number;
  roiCompound: number;
  value: ReturnType<typeof tierOut>;
  coverage: ReturnType<typeof tierOut>;
  g1Vetoed: number;
  pickDist: { home: number; draw: number; away: number };
  bets: BetRecord[];
}

/**
 * 跑一次策略实验:对注入数据集在 [from,to] 窗内做无泄漏 walk-forward,
 * 逐场 predict → 候选 → 选注 → 内存结算,返回 P&L / 分层 / pickDist / 每注记录。
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

  const { allHist, allRes, oddsMap, sosEloOf } = dataset;
  const { tuning, home, marketWeight, bet } = params;
  const g1On = bet.g1Veto ?? true;

  const matches = allRes
    .filter(
      (r) =>
        (!params.from || dateKey(r.date) >= params.from) &&
        (!params.to || dateKey(r.date) <= params.to),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId));

  let balance = bet.initialBalance;
  const value = newTier();
  const coverage = newTier();
  const records: BetRecord[] = [];
  let evaluated = 0;
  let g1Vetoed = 0;
  const pickDist = { home: 0, draw: 0, away: 0 };

  const settle = (
    m: ResultMatch,
    cand: BetCandidate,
    stake: number,
    t: Tier,
    tier: 'value' | 'coverage',
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
    records.push({
      date: m.date,
      home: m.homeNorm,
      away: m.awayNorm,
      tier,
      market: cand.market,
      selection: cand.selection,
      line: cand.line,
      odds: cand.odds,
      stake: +stake.toFixed(2),
      pnl: +pnl.toFixed(2),
      result: res,
    });
  };

  for (const m of matches) {
    const o = oddsMap[matchKey(m.homeNorm, m.awayNorm, m.date)];
    if (!o) continue; // 需闭盘价做对手
    const pp = predictPointInTime(
      allHist,
      allRes,
      m.homeNorm,
      m.awayNorm,
      m.date,
      tuning,
      sosEloOf,
      home,
      { home: o.h, draw: o.d, away: o.a },
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

    const snap: MarketSnapshot = {
      h2h: {
        home: { price: o.h, book: 'close' },
        draw: { price: o.d, book: 'close' },
        away: { price: o.a, book: 'close' },
      },
      totals: [],
      spreads: [],
    };
    const candidates = candidatesFromSnapshot(matrix, mw, snap);
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
        settle(m, best, stake, value, 'value');
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
      if (cov && cstake > 0) settle(m, cov, cstake, coverage, 'coverage');
    }
  }

  return {
    matches: evaluated,
    bankrollStart: bet.initialBalance,
    bankrollEnd: +balance.toFixed(2),
    roiCompound: +((balance - bet.initialBalance) / bet.initialBalance).toFixed(4),
    value: tierOut(value),
    coverage: tierOut(coverage),
    g1Vetoed,
    pickDist,
    bets: records,
  };
}
