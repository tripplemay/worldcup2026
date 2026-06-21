/**
 * 联赛历史一次性摄取(Phase 1:大样本模型校准/回测)。
 * 数据源 API-Football:某联赛某赛季全部 FT 比赛 → 赛果(喂 Elo)+ 逐场射门/真 xG(喂评分)。
 * 存到独立的 league-<key>-*.json,完全不碰世界杯数据。下游复用同一套 HistMatch/ResultMatch。
 */
import { normalizeTeam } from 'lib/match/normalize';
import {
  loadLeagueHistorical,
  saveLeagueHistorical,
  loadLeagueResults,
  saveLeagueResults,
} from 'lib/db/store';
import {
  hasApiFootball,
  getLeagueFixtures,
  getFixtureStats,
} from './apifootball';

/** 射门代理 xG(真 expected_goals 缺失时回退):射正×0.3 + 射偏×0.05。 */
function xgProxy(sot: number, shots: number): number {
  const soff = Math.max(0, shots - sot);
  return +(sot * 0.3 + soff * 0.05).toFixed(3);
}

/** limit 个 worker 的简单并发池;单项失败置 null。 */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = null;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/**
 * 摄取某联赛某赛季全部 FT 比赛 → 赛果 + HistMatch(含真 xG)。
 * @param key   存储键(如 'epl-2025')
 * @param league API-Football 联赛 id(英超=39)
 * @param season 赛季起始年(2025-26 → 2025)
 */
export async function ingestLeagueSeason(
  key: string,
  league: number,
  season: number,
): Promise<{ fixtures: number; withStats: number }> {
  if (!hasApiFootball()) return { fixtures: 0, withStats: 0 };

  const fixtures = await getLeagueFixtures(league, season);

  // 1) 赛果(全部 FT)→ 喂 Elo
  const results = loadLeagueResults(key);
  for (const fx of fixtures) {
    results[String(fx.id)] = {
      eventId: String(fx.id),
      date: fx.date,
      homeNorm: normalizeTeam(fx.homeName),
      awayNorm: normalizeTeam(fx.awayName),
      homeGoals: fx.homeGoals,
      awayGoals: fx.awayGoals,
    };
  }
  saveLeagueResults(key, results);

  // 2) 逐场射门/真 xG → HistMatch(喂评分)
  const stats = await pool(
    fixtures.map((f) => f.id),
    5,
    (id) => getFixtureStats(id),
  );
  const store = loadLeagueHistorical(key);
  let withStats = 0;
  fixtures.forEach((fx, i) => {
    const s = stats[i];
    if (!s) return;
    const h = s.get(fx.homeId);
    const a = s.get(fx.awayId);
    if (!h || !a) return;
    if (h.shots === 0 && a.shots === 0 && h.sot === 0 && a.sot === 0) return;
    store[String(fx.id)] = {
      eventId: String(fx.id),
      date: fx.date,
      homeName: fx.homeName,
      awayName: fx.awayName,
      homeNorm: normalizeTeam(fx.homeName),
      awayNorm: normalizeTeam(fx.awayName),
      homeGoals: fx.homeGoals,
      awayGoals: fx.awayGoals,
      homeSoT: h.sot,
      homeShots: h.shots,
      awaySoT: a.sot,
      awayShots: a.shots,
      homeXg: Number.isFinite(h.xg) ? +h.xg.toFixed(3) : xgProxy(h.sot, h.shots),
      awayXg: Number.isFinite(a.xg) ? +a.xg.toFixed(3) : xgProxy(a.sot, a.shots),
      homeGp: Number.isFinite(h.gp) ? +h.gp.toFixed(3) : undefined,
      awayGp: Number.isFinite(a.gp) ? +a.gp.toFixed(3) : undefined,
    };
    withStats++;
  });
  saveLeagueHistorical(key, store);
  return { fixtures: fixtures.length, withStats };
}
