/**
 * 历史比赛摄取(数据源:API-Football,付费 Pro)。
 *
 * 链路:未来 N 天世界杯赛程(ESPN 拿涉及球队)→ 解析各队 API-Football id(缓存)
 *   → 每队最近 RECENT 场(含赛果,喂 Elo)→ 逐场射门统计(喂 xG)→ historical.json。
 * xG 优先取 API-Football 真实 expected_goals,缺失才回退射门代理(射正×0.3+射偏×0.05);
 * 另存 goals_prevented(门将扑救价值)。HistMatch 结构与原管道兼容,下游评分/Elo 不变。
 */
import { espnProvider } from 'lib/espn/espn';
import { normalizeTeam } from 'lib/match/normalize';
import {
  loadHistorical,
  saveHistorical,
  loadResults,
  saveResults,
  loadAfTeams,
  saveAfTeams,
} from 'lib/db/store';
import {
  hasApiFootball,
  resolveTeamId,
  getRecentFixtures,
  getFixtureStats,
  type AfFixture,
} from './apifootball';

const CN_OFFSET = 8 * 3600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const RECENT_RESULTS = 40; // 每队取最近 N 场赛果(喂 Elo,深度够)
const RECENT_STATS = 15; // 其中最近 N 场取射门统计(喂 xG,控配额)

/** 单场 xG:射正×0.3 + 射偏×0.05(射偏 = 总射门 − 射正,clamp≥0)。 */
function xg(sot: number, shots: number): number {
  const soff = Math.max(0, shots - sot);
  return +(sot * 0.3 + soff * 0.05).toFixed(3);
}

/** 简单并发池:limit 个 worker 跑完所有 item,单项失败置 null。 */
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
 * 摄取未来 days 天世界杯比赛各队的近期比赛(赛果 + 射门)。
 * @returns 涉及球队数 + 入库历史场数
 */
export async function ingestHistory(
  days = 14,
): Promise<{ teams: number; events: number }> {
  if (!hasApiFootball()) return { teams: 0, events: 0 };

  // 1) 未来窗口的世界杯赛程(ESPN)→ 涉及的球队名
  const today = new Date(Date.now() + CN_OFFSET);
  const end = new Date(today.getTime() + days * 86400_000);
  const fixtures = await espnProvider.getScoreboard(
    `${ymd(today)}-${ymd(end)}`,
  );
  const names = new Set<string>();
  for (const f of fixtures) {
    if (f.homeTeam) names.add(f.homeTeam);
    if (f.awayTeam) names.add(f.awayTeam);
  }

  // 2) 解析各队 API-Football id(缓存,未知才查)
  const idMap = loadAfTeams();
  for (const name of names) {
    const norm = normalizeTeam(name);
    if (idMap[norm] == null) {
      const id = await resolveTeamId(name);
      if (id) idMap[norm] = id;
    }
  }
  saveAfTeams(idMap);

  // 3) 每队近 40 场 → 全部入 results.json(喂 Elo);最近 15 场标记取射门(喂 xG)
  const teamIds = [...names]
    .map((n) => idMap[normalizeTeam(n)])
    .filter((x): x is number => !!x);
  const lists = await pool(teamIds, 5, (id) =>
    getRecentFixtures(id, RECENT_RESULTS),
  );
  const results = loadResults();
  const uniq = new Map<number, AfFixture>();
  const statsTargets = new Set<number>();
  for (const list of lists) {
    if (!list) continue;
    list.forEach((fx, i) => {
      // 列表按最近优先;全部存赛果,前 15 场取射门统计
      uniq.set(fx.id, fx);
      results[String(fx.id)] = {
        eventId: String(fx.id),
        date: fx.date,
        homeNorm: normalizeTeam(fx.homeName),
        awayNorm: normalizeTeam(fx.awayName),
        homeGoals: fx.homeGoals,
        awayGoals: fx.awayGoals,
        ...(fx.venueCity ? { venueCity: fx.venueCity } : {}),
      };
      if (i < RECENT_STATS) statsTargets.add(fx.id);
    });
  }
  saveResults(results);

  // 4) 逐场射门统计 → HistMatch(有射门数据才入库)
  const ids = [...statsTargets];
  const stats = await pool(ids, 5, (id) => getFixtureStats(id));
  const store = loadHistorical();
  let added = 0;
  ids.forEach((fid, i) => {
    const s = stats[i];
    const fx = uniq.get(fid);
    if (!s || !fx) return;
    const h = s.get(fx.homeId);
    const a = s.get(fx.awayId);
    if (!h || !a) return;
    if (h.shots === 0 && a.shots === 0 && h.sot === 0 && a.sot === 0) return;
    store[String(fid)] = {
      eventId: String(fid),
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
      // 优先真实 xG,缺失回退射门代理
      homeXg: Number.isFinite(h.xg) ? +h.xg.toFixed(3) : xg(h.sot, h.shots),
      awayXg: Number.isFinite(a.xg) ? +a.xg.toFixed(3) : xg(a.sot, a.shots),
      homeGp: Number.isFinite(h.gp) ? +h.gp.toFixed(3) : undefined,
      awayGp: Number.isFinite(a.gp) ? +a.gp.toFixed(3) : undefined,
    };
    added++;
  });
  saveHistorical(store);
  return { teams: teamIds.length, events: added };
}
