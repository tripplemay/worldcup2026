/**
 * 赛前下单管线:扫描临近开赛(BET_WINDOW_MIN 内)、未下注过的比赛 →
 * 融合预测 + 泊松投影(市场无关)→ 赛前轻量拉一次盘口 + 算 EV → 智能路由选单注 → 下注。
 * 由高频 cron 触发;幂等(同场只下一次)。
 */
import { predictUpcoming } from 'lib/predict/predict';
import { ensemble } from 'lib/predict/ensemble';
import { buildMatrix } from 'lib/predict/models/poissonCore';
import { loadElo } from 'lib/db/store';
import { normalizeTeam } from 'lib/match/normalize';
import { projectMatchWinner } from './projection';
import { buildCandidates } from './odds';
import { selectBest } from './router';
import { stakeFor } from './ev';
import { getWallet, hasBet, placeBet } from './ledger';
import { hasActiveRlm } from 'lib/odds/radar';
import { emitSignal } from './signals';
import {
  modelsFromPredictions,
  classifyDivergence,
} from 'lib/predict/divergence';
import {
  BET_WINDOW_MIN,
  KELLY_FRACTION,
  MAX_STAKE_PCT,
  MIN_STAKE,
  COVERAGE_STAKE_PCT,
} from './config';

export async function runPreMatchBetting(opts?: {
  windowMin?: number;
}): Promise<{ scanned: number; placed: number; coverage: number }> {
  const windowMin =
    opts?.windowMin && opts.windowMin > 0 ? opts.windowMin : BET_WINDOW_MIN;
  const matches = await predictUpcoming(2);
  const eloMap = loadElo();
  const now = Date.now();
  let scanned = 0;
  let placed = 0;
  let coverage = 0;

  for (const m of matches) {
    if (m.status !== 'pre') continue;
    const mins = (Date.parse(m.commenceTime) - now) / 60_000;
    if (!(mins > 0 && mins <= windowMin)) continue;
    if (hasBet(m.matchId)) continue;
    const lambda = m.ensemble?.xgHome;
    const mu = m.ensemble?.xgAway;
    if (lambda == null || mu == null) continue;
    scanned += 1;

    const matrix = buildMatrix(lambda, mu);
    // 市场无关 1X2:去掉融合里的市场项重新归一
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

    // 取盘口(AF 主源→The Odds API 兜底,内部按需赛前拉一次)→ 投影候选
    const candidates = await buildCandidates({
      home: m.homeTeam,
      away: m.awayTeam,
      commenceTime: m.commenceTime,
      matrix,
      mw,
    });
    const best = selectBest(candidates);
    const sigModels = modelsFromPredictions(m.predictions, m.ensemble);
    // 指令合成(仅在有 +EV 选项时;含 L3 风控否决 + 分歧分类);不自动扣款
    if (best)
      emitSignal({
        matchId: m.matchId,
        match: `${m.homeTeam} vs ${m.awayTeam}`,
        best,
        balance: getWallet().currentBalance,
        now,
        models: sigModels,
      });

    // ── value 注(+EV 精选);RLM / G1(R1 伪差弱方)否决则跳过,落入 coverage ──
    const mk = sigModels.market;
    const favSide = mk
      ? (['h', 'd', 'a'] as const).reduce((b, k) => (mk[k] > mk[b] ? k : b))
      : null;
    // 押方(home/draw/away → h/d/a;其它玩法不参与方向判定)
    const pickSide =
      best?.selection === 'home'
        ? 'h'
        : best?.selection === 'away'
        ? 'a'
        : best?.selection === 'draw'
        ? 'd'
        : null;
    // G1:R1 错配场,押「市场非热门方」(弱方)的 1X2 / DNB / 亚盘 → 否决(弱方"价值"多为 artifact)
    const r1Veto =
      !!best &&
      (best.market === '1X2' ||
        best.market === 'DNB' ||
        best.market === 'AH') &&
      classifyDivergence(sigModels) === 'R1_UNDERCONF' &&
      !!favSide &&
      !!pickSide &&
      pickSide !== favSide;
    let placedValue = false;
    if (best && !hasActiveRlm(m.matchId, now) && !r1Veto) {
      const stake = stakeFor(best.kelly, getWallet().currentBalance, {
        fraction: KELLY_FRACTION,
        maxPct: MAX_STAKE_PCT,
        minStake: MIN_STAKE,
      });
      if (stake > 0) {
        try {
          const trade = await placeBet({
            matchId: m.matchId,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            date: m.commenceTime,
            candidate: best,
            stake,
            tier: 'value',
          });
          if (trade) {
            placed += 1;
            placedValue = true;
          }
        } catch (e) {
          console.error('[paper] value 下注失败', m.matchId, e);
        }
      }
    }

    // ── Direction 1:每场覆盖 — 无 value 注则对融合热门方下固定小注 ──
    if (!placedValue && m.ensemble) {
      const e = m.ensemble;
      const fav =
        e.homeWin >= e.draw && e.homeWin >= e.awayWin
          ? 'home'
          : e.awayWin >= e.draw && e.awayWin >= e.homeWin
          ? 'away'
          : 'draw';
      const cov = candidates.find(
        (c) => c.market === '1X2' && c.selection === fav,
      );
      const cstake = +(getWallet().currentBalance * COVERAGE_STAKE_PCT).toFixed(
        2,
      );
      if (cov && cstake > 0) {
        try {
          const trade = await placeBet({
            matchId: m.matchId,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            date: m.commenceTime,
            candidate: cov,
            stake: cstake,
            tier: 'coverage',
          });
          if (trade) coverage += 1;
        } catch (e2) {
          console.error('[paper] coverage 下注失败', m.matchId, e2);
        }
      }
    }
  }
  return { scanned, placed, coverage };
}
