/**
 * 模拟盘 dry-run:按赛前真实策略生成草稿单,但不扣款/不落库/不写信号。
 * 前端用于提前选择比赛做分析;真实下注仍只走 prematch.ts 的 cron 管线。
 */
import { predictUpcoming } from 'lib/predict/predict';
import { ensemble } from 'lib/predict/ensemble';
import { buildMatrix } from 'lib/predict/models/poissonCore';
import { loadElo } from 'lib/db/store';
import { normalizeTeam } from 'lib/match/normalize';
import { hasActiveRlm } from 'lib/odds/radar';
import {
  modelsFromPredictions,
  classifyDivergence,
  type Divergence,
} from 'lib/predict/divergence';
import { projectMatchWinner } from './projection';
import { buildCandidates } from './odds';
import { selectBest } from './router';
import { stakeFor } from './ev';
import { getWallet, hasBet } from './ledger';
import {
  BET_WINDOW_MIN,
  KELLY_FRACTION,
  MAX_STAKE_PCT,
  MIN_STAKE,
  COVERAGE_STAKE_PCT,
} from './config';
import type { BetCandidate, Trade } from './types';

export interface DryRunRequest {
  matchIds: string[];
  days?: number;
  windowMin?: number;
}

export type DryRunSkipReason =
  | 'not_found'
  | 'not_pre'
  | 'outside_window'
  | 'already_bet'
  | 'missing_xg'
  | 'no_odds'
  | 'no_candidate'
  | 'stake_too_small';

export interface DryRunSkipped {
  matchId: string;
  homeTeam?: string;
  awayTeam?: string;
  date?: string;
  reason: DryRunSkipReason;
  label: string;
}

export interface DryRunSlip extends Trade {
  dryRun: true;
  generatedAt: number;
  book: string;
  kelly: number;
  balanceBefore: number;
  balanceAfter: number;
  veto?: 'RLM' | 'R1_UNDERCONF';
}

export interface DryRunResponse {
  generatedAt: number;
  request: {
    matchIds: string[];
    days: number;
    windowMin: number;
  };
  balance: {
    start: number;
    end: number;
  };
  summary: {
    requested: number;
    scanned: number;
    generated: number;
    value: number;
    coverage: number;
    skipped: number;
  };
  slips: DryRunSlip[];
  skipped: DryRunSkipped[];
}

interface NormalizedOptions {
  matchIds: string[];
  days: number;
  windowMin: number;
  now: number;
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

function normalizeOptions(
  opts: DryRunRequest & { now?: number },
): NormalizedOptions {
  const ids = [
    ...new Set(
      (opts.matchIds ?? []).map((x) => String(x).trim()).filter(Boolean),
    ),
  ];
  const rawDays = Number(opts.days ?? 14);
  const days = clamp(
    Number.isFinite(rawDays) ? Math.floor(rawDays) : 14,
    1,
    30,
  );
  const rawWindow = Number(opts.windowMin ?? days * 24 * 60);
  const windowMin = clamp(
    Number.isFinite(rawWindow) ? Math.floor(rawWindow) : BET_WINDOW_MIN,
    1,
    30 * 24 * 60,
  );
  return { matchIds: ids, days, windowMin, now: opts.now ?? Date.now() };
}

function skip(
  matchId: string,
  reason: DryRunSkipReason,
  label: string,
  extra?: Pick<DryRunSkipped, 'homeTeam' | 'awayTeam' | 'date'>,
): DryRunSkipped {
  return { matchId, reason, label, ...extra };
}

function tradeIdOf(matchId: string, c: BetCandidate): string {
  const line = c.line == null ? 'na' : String(c.line);
  return `dry_${matchId}_${c.market}_${c.selection}_${line}`.replace(
    /[^a-zA-Z0-9_.-]/g,
    '_',
  );
}

function pickSide(selection?: string): 'h' | 'd' | 'a' | null {
  if (selection === 'home') return 'h';
  if (selection === 'draw') return 'd';
  if (selection === 'away') return 'a';
  return null;
}

function favoriteSide(market?: {
  h: number;
  d: number;
  a: number;
}): 'h' | 'd' | 'a' | null {
  if (!market) return null;
  return (['h', 'd', 'a'] as const).reduce((b, k) =>
    market[k] > market[b] ? k : b,
  );
}

function ensembleFavorite(e: {
  homeWin: number;
  draw: number;
  awayWin: number;
}): 'home' | 'draw' | 'away' {
  return e.homeWin >= e.draw && e.homeWin >= e.awayWin
    ? 'home'
    : e.awayWin >= e.draw && e.awayWin >= e.homeWin
    ? 'away'
    : 'draw';
}

function slipFromCandidate(input: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  candidate: BetCandidate;
  stake: number;
  tier: 'value' | 'coverage';
  generatedAt: number;
  balanceBefore: number;
  balanceAfter: number;
  veto?: 'RLM' | 'R1_UNDERCONF';
}): DryRunSlip {
  const c = input.candidate;
  return {
    tradeId: tradeIdOf(input.matchId, c),
    matchId: input.matchId,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    date: input.date,
    market: c.market,
    selection: c.selection,
    line: c.line,
    odds: c.odds,
    modelProb: c.pWin,
    ev: c.ev,
    stake: input.stake,
    status: 'pending',
    result: null,
    pnl: null,
    placedAt: input.generatedAt,
    tier: input.tier,
    dryRun: true,
    generatedAt: input.generatedAt,
    book: c.book,
    kelly: c.kelly,
    balanceBefore: input.balanceBefore,
    balanceAfter: input.balanceAfter,
    veto: input.veto,
  };
}

/** 只读预生成:复用真实模拟盘策略,返回本机草稿单,不写任何账本/信号文件。 */
export async function dryRunPreMatchBetting(
  opts: DryRunRequest & { now?: number },
): Promise<DryRunResponse> {
  const { matchIds, days, windowMin, now } = normalizeOptions(opts);
  const generatedAt = now;
  const matches = await predictUpcoming(days);
  const byId = new Map(matches.map((m) => [m.matchId, m]));
  const eloMap = loadElo();
  const wallet = getWallet();
  const balanceStart = wallet.currentBalance;
  let simBalance = wallet.currentBalance;
  let scanned = 0;
  const slips: DryRunSlip[] = [];
  const skipped: DryRunSkipped[] = [];

  for (const id of matchIds) {
    if (!byId.has(id)) skipped.push(skip(id, 'not_found', '未找到比赛'));
  }

  // 真实 prematch 管线按 predictUpcoming() 的开赛时间顺序扫描;dry-run 也按时间排序,
  // 避免同一批比赛因前端选择顺序不同而得到不同的模拟余额/注金。
  const requestedMatches = matchIds
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort(
      (a, b) =>
        a.commenceTime.localeCompare(b.commenceTime) ||
        a.matchId.localeCompare(b.matchId),
    );

  for (const m of requestedMatches) {
    const id = m.matchId;
    const base = {
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      date: m.commenceTime,
    };
    if (m.status !== 'pre') {
      skipped.push(skip(id, 'not_pre', '比赛已开赛或已结束', base));
      continue;
    }
    const mins = (Date.parse(m.commenceTime) - now) / 60_000;
    if (!(mins > 0 && mins <= windowMin)) {
      skipped.push(skip(id, 'outside_window', '不在预生成窗口内', base));
      continue;
    }
    if (hasBet(id)) {
      skipped.push(skip(id, 'already_bet', '真实模拟盘已下过该场', base));
      continue;
    }
    const lambda = m.ensemble?.xgHome;
    const mu = m.ensemble?.xgAway;
    if (lambda == null || mu == null) {
      skipped.push(skip(id, 'missing_xg', '缺少 xG 预测', base));
      continue;
    }
    scanned += 1;

    const matrix = buildMatrix(lambda, mu);
    const eh = eloMap[normalizeTeam(m.homeTeam)];
    const ea = eloMap[normalizeTeam(m.awayTeam)];
    const eloDiff =
      Number.isFinite(eh) && Number.isFinite(ea)
        ? Math.abs(eh - ea)
        : undefined;
    const mf = ensemble(
      m.predictions.filter((p) => p.modelId !== 'market'),
      m.matchId,
      eloDiff,
    );
    const mw = mf
      ? { home: mf.homeWin, draw: mf.draw, away: mf.awayWin }
      : projectMatchWinner(matrix);

    let candidates: BetCandidate[] = [];
    try {
      candidates = await buildCandidates({
        home: m.homeTeam,
        away: m.awayTeam,
        commenceTime: m.commenceTime,
        matrix,
        mw,
      });
    } catch {
      candidates = [];
    }
    if (!candidates.length) {
      skipped.push(skip(id, 'no_odds', '暂无可用盘口', base));
      continue;
    }

    const best = selectBest(candidates);
    const sigModels = modelsFromPredictions(m.predictions, m.ensemble);
    const mk = sigModels.market;
    const favSide = favoriteSide(mk);
    const side = pickSide(best?.selection);
    const divergence: Divergence = classifyDivergence(sigModels);
    const r1Veto =
      !!best &&
      (best.market === '1X2' ||
        best.market === 'DNB' ||
        best.market === 'AH') &&
      divergence === 'R1_UNDERCONF' &&
      !!favSide &&
      !!side &&
      side !== favSide;
    const rlmVeto = !!best && hasActiveRlm(m.matchId, now);
    let veto: 'RLM' | 'R1_UNDERCONF' | undefined;
    if (rlmVeto) veto = 'RLM';
    else if (r1Veto) veto = 'R1_UNDERCONF';

    if (best && !rlmVeto && !r1Veto) {
      const stake = stakeFor(best.kelly, simBalance, {
        fraction: KELLY_FRACTION,
        maxPct: MAX_STAKE_PCT,
        minStake: MIN_STAKE,
      });
      if (stake > 0) {
        const before = simBalance;
        simBalance = +(simBalance - stake).toFixed(2);
        slips.push(
          slipFromCandidate({
            matchId: id,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            date: m.commenceTime,
            candidate: best,
            stake,
            tier: 'value',
            generatedAt,
            balanceBefore: before,
            balanceAfter: simBalance,
          }),
        );
        continue;
      }
    }

    const fav = m.ensemble ? ensembleFavorite(m.ensemble) : null;
    const cov = fav
      ? candidates.find((c) => c.market === '1X2' && c.selection === fav)
      : undefined;
    const cstake = +(simBalance * COVERAGE_STAKE_PCT).toFixed(2);
    if (cov && cstake > 0) {
      const before = simBalance;
      simBalance = +(simBalance - cstake).toFixed(2);
      slips.push(
        slipFromCandidate({
          matchId: id,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          date: m.commenceTime,
          candidate: cov,
          stake: cstake,
          tier: 'coverage',
          generatedAt,
          balanceBefore: before,
          balanceAfter: simBalance,
          veto,
        }),
      );
    } else {
      skipped.push(
        skip(
          id,
          best && !rlmVeto && !r1Veto ? 'stake_too_small' : 'no_candidate',
          best && !rlmVeto && !r1Veto ? '注金低于最小额' : '无可用草稿单',
          base,
        ),
      );
    }
  }

  const value = slips.filter((x) => (x.tier ?? 'value') === 'value').length;
  const coverage = slips.filter((x) => x.tier === 'coverage').length;
  return {
    generatedAt,
    request: { matchIds, days, windowMin },
    balance: { start: balanceStart, end: simBalance },
    summary: {
      requested: matchIds.length,
      scanned,
      generated: slips.length,
      value,
      coverage,
      skipped: skipped.length,
    },
    slips,
    skipped,
  };
}
