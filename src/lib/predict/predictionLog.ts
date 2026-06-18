/**
 * 预测存档:把生产当时的真实预测(赛前最终版)持久化,赛后回填结果。
 *  · snapshot:每轮(挂 /trade/run cron)为未开赛比赛存/刷新快照,开赛后冻结
 *  · settle:赛后用 ESPN 终分回填 result/hit
 *  · backfill:用 walk-forward 重建回填已踢比赛(source=reconstructed,幂等)
 *  · modelStats:聚合战绩(命中率/Brier/LogLoss/进球误差)
 */
import { predictUpcoming } from './predict';
import { predictPointInTime } from './backtest';
import { espnProvider } from 'lib/espn/espn';
import { normalizeTeam } from 'lib/match/normalize';
import {
  loadPredictionLog,
  savePredictionLog,
  loadHistorical,
  loadResults,
  type PredictionSnapshot,
} from 'lib/db/store';

const SEASON = process.env.WC_SEASON ?? '2026';
const WC_RANGE = `${SEASON}0611-${SEASON}0719`;

const pickOf = (h: number, d: number, a: number): 'H' | 'D' | 'A' =>
  h >= d && h >= a ? 'H' : a >= d && a >= h ? 'A' : 'D';

/** 为未开赛比赛存/刷新预测快照(生产真实融合预测;开赛后不再覆盖)。 */
export async function snapshotPredictions(): Promise<{ snapped: number }> {
  const matches = await predictUpcoming(2);
  const log = loadPredictionLog();
  let snapped = 0;
  for (const m of matches) {
    if (m.status !== 'pre' || !m.ensemble) continue;
    const e = m.ensemble;
    log[m.matchId] = {
      matchId: m.matchId,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      commenceTime: m.commenceTime,
      snapshotAt: Date.now(),
      source: 'live',
      pHome: e.homeWin,
      pDraw: e.draw,
      pAway: e.awayWin,
      predGoals: +((e.xgHome ?? 0) + (e.xgAway ?? 0)).toFixed(2),
      over25: e.over25,
      btts: e.btts,
      pick: pickOf(e.homeWin, e.draw, e.awayWin),
      settled: false,
    };
    snapped += 1;
  }
  if (snapped) savePredictionLog(log);
  return { snapped };
}

/** 赛后用终分回填 result/hit。 */
export async function settlePredictionLog(): Promise<{ settled: number }> {
  const log = loadPredictionLog();
  const pending = Object.values(log).filter((s) => !s.settled);
  if (!pending.length) return { settled: 0 };
  const board = await espnProvider.getScoreboard(WC_RANGE);
  const byId = new Map(board.map((m) => [m.id, m]));
  let settled = 0;
  for (const s of pending) {
    const m = byId.get(s.matchId);
    if (!m || m.status !== 'post' || m.homeScore == null || m.awayScore == null)
      continue;
    const result =
      m.homeScore > m.awayScore ? 'H' : m.homeScore < m.awayScore ? 'A' : 'D';
    s.homeGoals = m.homeScore;
    s.awayGoals = m.awayScore;
    s.result = result;
    s.hit = s.pick === result;
    s.settled = true;
    settled += 1;
  }
  if (settled) savePredictionLog(log);
  return { settled };
}

/** 用 walk-forward 重建回填已踢比赛(幂等:已存在的不动)。 */
export async function backfillReconstructed(): Promise<{ added: number }> {
  const log = loadPredictionLog();
  const board = await espnProvider.getScoreboard(WC_RANGE);
  const completed = board.filter(
    (m) => m.status === 'post' && m.homeScore != null && m.awayScore != null,
  );
  if (!completed.length) return { added: 0 };
  const allHist = Object.values(loadHistorical());
  const allRes = Object.values(loadResults());
  let added = 0;
  for (const m of completed) {
    if (log[m.id]) continue; // 已有(live 或先前回填)
    const pp = predictPointInTime(
      allHist,
      allRes,
      normalizeTeam(m.homeTeam),
      normalizeTeam(m.awayTeam),
      m.commenceTime,
    );
    if (!pp) continue;
    const gh = m.homeScore as number;
    const ga = m.awayScore as number;
    const result = gh > ga ? 'H' : gh < ga ? 'A' : 'D';
    const pick = pickOf(pp.pHome, pp.pDraw, pp.pAway);
    log[m.id] = {
      matchId: m.id,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      commenceTime: m.commenceTime,
      snapshotAt: Date.now(),
      source: 'reconstructed',
      pHome: pp.pHome,
      pDraw: pp.pDraw,
      pAway: pp.pAway,
      predGoals: +pp.predGoals.toFixed(2),
      over25: pp.over25,
      btts: pp.btts,
      pick,
      settled: true,
      homeGoals: gh,
      awayGoals: ga,
      result,
      hit: pick === result,
    };
    added += 1;
  }
  if (added) savePredictionLog(log);
  return { added };
}

export interface ModelStats {
  total: number;
  live: number;
  reconstructed: number;
  hitRate: number;
  brier: number;
  logLoss: number;
  meanPredGoals: number;
  meanActualGoals: number;
  rows: PredictionSnapshot[];
}

/** 聚合已结算预测的战绩。 */
export function modelStats(): ModelStats {
  const settled = Object.values(loadPredictionLog()).filter(
    (s) => s.settled && s.result,
  );
  let brier = 0,
    ll = 0,
    hits = 0,
    sp = 0,
    sa = 0;
  for (const s of settled) {
    const bH = (s.result === 'H' ? 1 : 0) - s.pHome;
    const bD = (s.result === 'D' ? 1 : 0) - s.pDraw;
    const bA = (s.result === 'A' ? 1 : 0) - s.pAway;
    brier += bH * bH + bD * bD + bA * bA;
    const pact =
      s.result === 'H' ? s.pHome : s.result === 'A' ? s.pAway : s.pDraw;
    ll += -Math.log(Math.max(1e-9, pact));
    hits += s.hit ? 1 : 0;
    sp += s.predGoals;
    sa += (s.homeGoals ?? 0) + (s.awayGoals ?? 0);
  }
  const n = settled.length;
  return {
    total: n,
    live: settled.filter((s) => s.source === 'live').length,
    reconstructed: settled.filter((s) => s.source === 'reconstructed').length,
    hitRate: n ? +(hits / n).toFixed(3) : 0,
    brier: n ? +(brier / n).toFixed(3) : 0,
    logLoss: n ? +(ll / n).toFixed(3) : 0,
    meanPredGoals: n ? +(sp / n).toFixed(2) : 0,
    meanActualGoals: n ? +(sa / n).toFixed(2) : 0,
    rows: settled
      .sort((a, b) => b.commenceTime.localeCompare(a.commenceTime))
      .slice(0, 30),
  };
}
