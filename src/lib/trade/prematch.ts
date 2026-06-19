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
} from './config';

export async function runPreMatchBetting(opts?: {
  windowMin?: number;
}): Promise<{ scanned: number; placed: number }> {
  const windowMin =
    opts?.windowMin && opts.windowMin > 0 ? opts.windowMin : BET_WINDOW_MIN;
  const matches = await predictUpcoming(2);
  const eloMap = loadElo();
  const now = Date.now();
  let scanned = 0;
  let placed = 0;

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
    if (!best) continue;

    const sigModels = modelsFromPredictions(m.predictions, m.ensemble);
    // 指令合成(Copilot;含 L3 风控否决 + 分歧分类);不自动扣款,供人工跟单
    emitSignal({
      matchId: m.matchId,
      match: `${m.homeTeam} vs ${m.awayTeam}`,
      best,
      balance: getWallet().currentBalance,
      now,
      models: sigModels,
    });
    // 自动模拟盘:RLM 市场拒绝 → 拦截下注(避免负 CLV)
    if (hasActiveRlm(m.matchId, now)) {
      console.log('[paper] RLM 风控拦截 auto-bet,跳过', m.matchId);
      continue;
    }
    // G1:R1 伪差(错配场泊松对热门欠自信)+ 押市场非热门方(弱方"价值"多为 artifact)→ 否决自动下注
    if (
      best.market === '1X2' &&
      classifyDivergence(sigModels) === 'R1_UNDERCONF'
    ) {
      const mk = sigModels.market;
      const favSide = mk
        ? (['h', 'd', 'a'] as const).reduce((b, k) => (mk[k] > mk[b] ? k : b))
        : null;
      const pickSide =
        best.selection === 'home' ? 'h' : best.selection === 'away' ? 'a' : 'd';
      if (favSide && pickSide !== favSide) {
        console.log(
          '[paper] R1 伪差弱方注,否决自动下注',
          m.matchId,
          best.selection,
        );
        continue;
      }
    }

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
