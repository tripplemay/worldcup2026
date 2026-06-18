/**
 * 球员出场分钟(体能用):增量摄取已结束世界杯比赛的每人分钟,按队累计。
 * 体能 = 核心 13 人(总出场分钟最高的 13 名)在「近 N 天」累计的分钟负荷:
 * 关键球员连轴转 → 高负荷 → 体能惩罚;轮换休整(核心被雪藏)→ 负荷低 → 不罚。
 * 比「休息天数」更细(能识别"踢了但主力轮休")。纯 ESPN/AF,失败回退休息天数。
 */
import {
  hasApiFootball,
  getWcFinished,
  getFixturePlayerMinutes,
} from './apifootball';
import { normalizeTeam } from 'lib/match/normalize';
import {
  loadPlayerMinutes,
  savePlayerMinutes,
  type PlayerMinutesStore,
} from 'lib/db/store';

const CORE_N = 13; // 核心轮换人数
const WINDOW_DAYS = 8; // 负荷统计窗口
const FULL_MATCH = 11 * 90; // 一场满额(11 人 × 90 分钟)
const STEP = 0.4; // 每超出 1 个满场的惩罚
const MAX_PENALTY = 0.6; // 体能惩罚下限
const DAY = 86_400_000;

type TeamMatches = { date: string; mins: Record<string, number> }[];

/**
 * 核心 13 人近窗口累计分钟 → 体能惩罚(≤0)。无比赛记录返回 null(交由上层回退休息天数)。
 * 1 个满场负荷以内 → 0;每多 1 个满场 −0.4,封顶 −0.6。
 */
export function coreLoadPenalty(
  matches: TeamMatches,
  now: number,
): number | null {
  if (!matches.length) return null;
  // 各球员总分钟 → 选出核心 13 人
  const total = new Map<string, number>();
  for (const m of matches)
    for (const [pid, min] of Object.entries(m.mins))
      total.set(pid, (total.get(pid) ?? 0) + min);
  const core = new Set(
    [...total.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CORE_N)
      .map(([pid]) => pid),
  );
  // 近 WINDOW_DAYS 天内,核心球员累计分钟
  const since = now - WINDOW_DAYS * DAY;
  let load = 0;
  for (const m of matches) {
    if (Date.parse(m.date) < since) continue;
    for (const [pid, min] of Object.entries(m.mins))
      if (core.has(pid)) load += min;
  }
  const equivMatches = load / FULL_MATCH;
  return -Math.min(MAX_PENALTY, Math.max(0, (equivMatches - 1) * STEP));
}

/** 简单并发池。 */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch {
        out[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** 增量摄取已结束世界杯比赛的球员分钟(只抓新结束场次)。 */
export async function ingestPlayerMinutes(): Promise<{
  added: number;
  teams: number;
}> {
  if (!hasApiFootball())
    return { added: 0, teams: 0 };
  const store: PlayerMinutesStore = loadPlayerMinutes();
  const finished = await getWcFinished();
  const fresh = finished.filter((f) => !store.events[String(f.id)]);
  if (!fresh.length) return { added: 0, teams: Object.keys(store.teams).length };

  const mins = await pool(fresh, 5, (f) => getFixturePlayerMinutes(f.id));
  let added = 0;
  fresh.forEach((f, i) => {
    const pm = mins[i];
    if (!pm) return;
    for (const team of pm) {
      const norm = normalizeTeam(team.teamName);
      if (!norm) continue;
      const rec = (store.teams[norm] ??= { matches: [] });
      const m: Record<string, number> = {};
      for (const p of team.players) m[String(p.id)] = p.minutes;
      rec.matches.push({ date: f.date, mins: m });
    }
    store.events[String(f.id)] = true;
    added += 1;
  });
  store.updatedAt = Date.now();
  savePlayerMinutes(store);
  return { added, teams: Object.keys(store.teams).length };
}
