/**
 * 历史比赛摄取(数据源:API-Football,付费 Pro)。
 *
 * 链路:未来 N 天世界杯赛程(ESPN 拿涉及球队)→ 解析各队 API-Football id(缓存)
 *   → 每队最近 RECENT 场(含赛果,喂 Elo)→ 逐场射门统计(喂 xG)→ historical.json。
 * xG = 射正×0.3 + 射偏×0.05;HistMatch 结构与原 ESPN 管道一致,下游评分/Elo 不变。
 */
import { espnProvider } from 'lib/espn/espn';
import { normalizeTeam } from 'lib/match/normalize';
import {
  loadHistorical,
  saveHistorical,
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
const RECENT = 15; // 每队取最近 N 场

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
  const fixtures = await espnProvider.getScoreboard(`${ymd(today)}-${ymd(end)}`);
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

  // 3) 每队近 RECENT 场 → 收集唯一 fixture
  const teamIds = [...names]
    .map((n) => idMap[normalizeTeam(n)])
    .filter((x): x is number => !!x);
  const lists = await pool(teamIds, 5, (id) => getRecentFixtures(id, RECENT));
  const uniq = new Map<number, AfFixture>();
  for (const list of lists) for (const fx of list ?? []) uniq.set(fx.id, fx);

  // 4) 逐场射门统计 → HistMatch(有射门数据才入库)
  const ids = [...uniq.keys()];
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
      homeXg: xg(h.sot, h.shots),
      awayXg: xg(a.sot, a.shots),
    };
    added++;
  });
  saveHistorical(store);
  return { teams: teamIds.length, events: added };
}
