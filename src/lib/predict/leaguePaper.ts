/**
 * 联赛模拟盘回测(Phase 2 收益估算):把生产模拟盘的逻辑 walk-forward 跑在联赛历史上,
 * **对手是 football-data 闭盘价**(我们入库的 1X2 收盘线,市场最锐 → 最保守的检验)。
 *
 * 复刻 prematch.ts 的下注管线:
 *  - 市场无关 1X2(poisson+elo,去掉 market 重归一)+ 泊松矩阵(λ/μ)
 *  - candidatesFromSnapshot(仅 1X2,闭盘价做盘口)→ selectBest(MIN_PROB/MIN_EV/MAX_EV)
 *  - G1 否决:R1 错配场押市场非热门方 → 弃(弱方"价值"多为 artifact)
 *  - value 注按四分之一凯利;无 value 注则对融合热门方下覆盖小注
 *  - 复利:每场按时间顺序结算回款,凯利按当前余额
 *
 * 注:闭盘价库只有 1X2(无 O/U/亚盘),故仅模拟 1X2;且对手是收盘线 → 结果是**下界**
 * (实盘赛前下单可吃 CLV,通常更好)。
 */
import { predictPointInTime } from './backtest';
import {
  loadLeagueHistorical,
  loadLeagueResults,
  loadLeagueOdds,
} from 'lib/db/store';
import { matchKey } from 'lib/match/normalize';
import { getCompetitionConfigByKey } from './leagues';
import { buildMatrix } from './models/poissonCore';
import { ensemble } from './ensemble';
import { projectMatchWinner } from 'lib/trade/projection';
import { candidatesFromSnapshot } from 'lib/trade/odds';
import { selectBest } from 'lib/trade/router';
import { stakeFor } from 'lib/trade/ev';
import { outcome, pnlFor } from 'lib/trade/settle';
import { modelsFromPredictions, classifyDivergence } from './divergence';
import {
  INITIAL_BALANCE,
  KELLY_FRACTION,
  MAX_STAKE_PCT,
  MIN_STAKE,
  COVERAGE_STAKE_PCT,
} from 'lib/trade/config';
import type { MarketSnapshot, BetCandidate, Trade } from 'lib/trade/types';

const dateKey = (iso: string) => iso.slice(0, 10);

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
  staked: +t.staked.toFixed(0),
  pnl: +t.pnl.toFixed(0),
  roi: t.staked ? +(t.pnl / t.staked).toFixed(4) : 0,
  winRate: t.bets ? +(t.wins / t.bets).toFixed(3) : 0,
  record: `${t.wins}-${t.losses}-${t.voids}`,
});

export interface LeaguePaperResult {
  key: string;
  from?: string;
  to?: string;
  config: { shrinkEloScale: number; hfaElo: number; hfaMult: number; marketWeight: number };
  matches: number; // 有预测+闭盘的评估场次
  bankrollStart: number;
  bankrollEnd: number;
  roiCompound: number; // 复利总回报
  value: ReturnType<typeof tierOut>;
  coverage: ReturnType<typeof tierOut>;
  combined: ReturnType<typeof tierOut>;
  g1Vetoed: number; // 被 G1 否决的弱方"价值"注
  pickDist: { home: number; draw: number; away: number };
}

export function runLeaguePaperBacktest(opts: {
  key: string;
  from?: string;
  to?: string;
}): LeaguePaperResult {
  const cfg = getCompetitionConfigByKey(opts.key);
  const allHist = Object.values(loadLeagueHistorical(opts.key));
  const allRes = Object.values(loadLeagueResults(opts.key));
  const oddsMap = loadLeagueOdds(opts.key);
  const matches = allRes
    .filter(
      (r) =>
        (!opts.from || dateKey(r.date) >= opts.from) &&
        (!opts.to || dateKey(r.date) <= opts.to),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const tuning = {
    goalShrink: cfg.goalShrink,
    shrinkEloScale: cfg.shrinkEloScale,
    dcRho: cfg.dcRho,
  };
  const home =
    cfg.hfaElo || cfg.hfaMult !== 1
      ? { eloBonus: cfg.hfaElo, goalMult: cfg.hfaMult }
      : undefined;

  let balance = INITIAL_BALANCE;
  const value = newTier();
  const coverage = newTier();
  let evaluated = 0;
  let g1Vetoed = 0;
  const pickDist = { home: 0, draw: 0, away: 0 };

  const settle = (cand: BetCandidate, stake: number, t: Tier): boolean => {
    const trade = {
      market: cand.market,
      selection: cand.selection,
      line: cand.line,
      odds: cand.odds,
      stake,
    } as Trade;
    // 注:回测里下注与结算同场(已知赛果);复利按时间顺序
    const m = curMatch!;
    const res = outcome(trade, m.homeGoals, m.awayGoals);
    const pnl = pnlFor(trade, res);
    balance += pnl;
    t.bets += 1;
    t.staked += stake;
    t.pnl += pnl;
    if (res === 'won') t.wins += 1;
    else if (res === 'lost') t.losses += 1;
    else t.voids += 1;
    return true;
  };

  let curMatch: (typeof matches)[number] | null = null;
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
      undefined,
      home,
      { home: o.h, draw: o.d, away: o.a },
      cfg.marketWeight,
    );
    if (!pp || !pp.preds) continue;
    const poisson = pp.preds.find((p) => p.modelId === 'poisson-xg');
    if (!poisson || poisson.xgHome == null || poisson.xgAway == null) continue;
    evaluated += 1;
    curMatch = m;

    const matrix = buildMatrix(poisson.xgHome, poisson.xgAway, cfg.dcRho);
    // 市场无关 1X2(去掉 market 重归一)
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
    const best = selectBest(candidates);

    // G1:R1 错配场押市场非热门方 → 否决
    const sigModels = modelsFromPredictions(pp.preds, pp.ens ?? null);
    const mk = sigModels.market;
    const favSide = mk
      ? (['h', 'd', 'a'] as const).reduce((b, k) => (mk[k] > mk[b] ? k : b))
      : null;
    const pickSide =
      best?.selection === 'home'
        ? 'h'
        : best?.selection === 'away'
        ? 'a'
        : best?.selection === 'draw'
        ? 'd'
        : null;
    const r1Veto =
      !!best &&
      best.market === '1X2' &&
      classifyDivergence(sigModels) === 'R1_UNDERCONF' &&
      !!favSide &&
      !!pickSide &&
      pickSide !== favSide;
    if (r1Veto) g1Vetoed += 1;

    let placedValue = false;
    if (best && !r1Veto) {
      const stake = stakeFor(best.kelly, balance, {
        fraction: KELLY_FRACTION,
        maxPct: MAX_STAKE_PCT,
        minStake: MIN_STAKE,
      });
      if (stake > 0) {
        placedValue = settle(best, stake, value);
        if (best.selection === 'home' || best.selection === 'away' || best.selection === 'draw')
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
      const cstake = +(balance * COVERAGE_STAKE_PCT).toFixed(2);
      if (cov && cstake > 0) settle(cov, cstake, coverage);
    }
  }

  const combined: Tier = {
    bets: value.bets + coverage.bets,
    staked: value.staked + coverage.staked,
    pnl: value.pnl + coverage.pnl,
    wins: value.wins + coverage.wins,
    losses: value.losses + coverage.losses,
    voids: value.voids + coverage.voids,
  };

  return {
    key: opts.key,
    from: opts.from,
    to: opts.to,
    config: {
      shrinkEloScale: cfg.shrinkEloScale,
      hfaElo: cfg.hfaElo,
      hfaMult: cfg.hfaMult,
      marketWeight: cfg.marketWeight,
    },
    matches: evaluated,
    bankrollStart: INITIAL_BALANCE,
    bankrollEnd: +balance.toFixed(0),
    roiCompound: +((balance - INITIAL_BALANCE) / INITIAL_BALANCE).toFixed(4),
    value: tierOut(value),
    coverage: tierOut(coverage),
    combined: tierOut(combined),
    g1Vetoed,
    pickDist,
  };
}
