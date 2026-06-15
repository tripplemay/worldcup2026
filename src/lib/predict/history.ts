/**
 * 历史比赛摄取:从 ESPN 洗出每场 xG,写入 historical.json。
 *
 * 来源链:未来 N 天的世界杯赛程 → 每场 summary 的 lastFiveGames(双方近 5 场 event ID)
 *   → 逐场 boxscore 取射正/总射门/进球 → xG = 射正×0.3 + 射偏×0.05。
 * 纯 ESPN,免费,不耗 The Odds API 配额。
 */
import { espnProvider } from 'lib/espn/espn';
import { normalizeTeam } from 'lib/match/normalize';
import { loadHistorical, saveHistorical } from 'lib/db/store';

const CN_OFFSET = 8 * 3600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

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
 * 摄取未来 days 天世界杯比赛双方的近期对阵射门数据。
 * @returns 扫描的赛程数 + 入库历史场数
 */
export async function ingestHistory(
  days = 14,
): Promise<{ fixtures: number; events: number }> {
  const today = new Date(Date.now() + CN_OFFSET);
  const end = new Date(today.getTime() + days * 86400_000);
  const fixtures = await espnProvider.getScoreboard(`${ymd(today)}-${ymd(end)}`);

  // 每场 summary → 双方近期对阵 eventId(去重)
  const summaries = await pool(fixtures, 6, (m) =>
    espnProvider.getMatchSummary(m.id),
  );
  const histIds = new Set<string>();
  for (const s of summaries) {
    if (!s) continue;
    for (const g of [...s.homeForm, ...s.awayForm]) {
      if (g.eventId) histIds.add(g.eventId);
    }
  }

  // 逐场拉 boxscore → HistMatch
  const ids = [...histIds];
  const stats = await pool(ids, 6, (id) => espnProvider.getEventStats(id));
  const store = loadHistorical();
  let added = 0;
  for (const e of stats) {
    if (!e?.eventId) continue;
    // boxscore 缺射门数据的场次跳过(无法洗 xG)
    if (e.homeShots === 0 && e.awayShots === 0 && e.homeSoT === 0 && e.awaySoT === 0) {
      continue;
    }
    store[e.eventId] = {
      eventId: e.eventId,
      date: e.date,
      homeName: e.homeName,
      awayName: e.awayName,
      homeNorm: normalizeTeam(e.homeName),
      awayNorm: normalizeTeam(e.awayName),
      homeGoals: e.homeGoals,
      awayGoals: e.awayGoals,
      homeSoT: e.homeSoT,
      homeShots: e.homeShots,
      awaySoT: e.awaySoT,
      awayShots: e.awayShots,
      homeXg: xg(e.homeSoT, e.homeShots),
      awayXg: xg(e.awaySoT, e.awayShots),
    };
    added++;
  }
  saveHistorical(store);
  return { fixtures: fixtures.length, events: added };
}
