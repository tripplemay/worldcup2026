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
import { buildCandidates, ensureMatchMarkets } from './odds';
import { selectBest } from './router';
import { stakeFor } from './ev';
import { getWallet, hasBet, placeBet } from './ledger';
import {
  BET_WINDOW_MIN,
  KELLY_FRACTION,
  MAX_STAKE_PCT,
  MIN_STAKE,
  PREMATCH_FETCH,
} from './config';

export async function runPreMatchBetting(): Promise<{
  scanned: number;
  placed: number;
}> {
  const matches = await predictUpcoming(2);
  const eloMap = loadElo();
  const now = Date.now();
  let scanned = 0;
  let placed = 0;

  for (const m of matches) {
    if (m.status !== 'pre') continue;
    const mins = (Date.parse(m.commenceTime) - now) / 60_000;
    if (!(mins > 0 && mins <= BET_WINDOW_MIN)) continue;
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

    // 赛前轻量拉一次让球/大小球盘口(解锁 O/U/亚盘候选;窗口内 TTL 去重)
    if (PREMATCH_FETCH)
      await ensureMatchMarkets(m.homeTeam, m.awayTeam, m.commenceTime);

    const candidates = buildCandidates({
      home: m.homeTeam,
      away: m.awayTeam,
      commenceTime: m.commenceTime,
      matrix,
      mw,
    });
    const best = selectBest(candidates);
    if (!best) continue;

    const stake = stakeFor(best.kelly, getWallet().currentBalance, {
      fraction: KELLY_FRACTION,
      maxPct: MAX_STAKE_PCT,
      minStake: MIN_STAKE,
    });
    if (stake <= 0) continue;

    try {
      const trade = await placeBet({
        matchId: m.matchId,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        date: m.commenceTime,
        candidate: best,
        stake,
      });
      if (trade) placed += 1;
    } catch (e) {
      console.error('[paper] 下注失败', m.matchId, e);
    }
  }
  return { scanned, placed };
}
