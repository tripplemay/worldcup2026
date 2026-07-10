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
  getSquad,
} from './apifootball';
import { normalizeTeam } from 'lib/match/normalize';
import {
  loadPlayerMinutes,
  savePlayerMinutes,
  loadAfTeams,
  type PlayerMinutesStore,
} from 'lib/db/store';

const CORE_N = 13; // 核心轮换人数
const WINDOW_DAYS = 8; // 负荷统计窗口
const FULL_MATCH = 11 * 90; // 一场满额(11 人 × 90 分钟)
const STEP = 0.4; // 每超出 1 个满场的惩罚
const MAX_PENALTY = 0.6; // 体能惩罚下限
const DAY = 86_400_000;
// 年龄加权(TMI v2):30+ 恢复更慢 → 同样分钟按更高负荷计;U21 略降。缺龄按 1.0(诚实回退)
const AGE_REF = 29; // 分界:≤29 岁不加权
const AGE_STEP = 0.05; // 每高 1 岁 +5% 等效负荷
const AGE_FACTOR_MAX = 1.3; // 封顶(35 岁及以上按 1.3)
const U21_FACTOR = 0.95; // 21 岁及以下轻微降权

type TeamMatches = { date: string; mins: Record<string, number> }[];

/** 年龄 → 等效负荷系数(缺龄 = 1.0)。 */
export function ageFactor(age?: number): number {
  if (age == null || !Number.isFinite(age)) return 1;
  if (age <= 21) return U21_FACTOR;
  return Math.min(AGE_FACTOR_MAX, 1 + Math.max(0, age - AGE_REF) * AGE_STEP);
}

/**
 * 核心 13 人近窗口累计【等效】分钟 → 体能惩罚(≤0)+ 核心平均年龄。
 * 等效分钟 = 实际分钟 × ageFactor(年龄):同样的连轴转,30+ 阵容比年轻阵容惩罚更重。
 * 无比赛记录返回 penalty=null(交由上层回退休息天数)。
 * 1 个满场负荷以内 → 0;每多 1 个满场 −0.4,封顶 −0.6。
 */
export function coreLoad(
  matches: TeamMatches,
  now: number,
  ages?: Record<string, number>,
): { penalty: number | null; coreAvgAge: number | null } {
  if (!matches.length) return { penalty: null, coreAvgAge: null };
  // 各球员总分钟 → 选出核心 13 人
  const total = new Map<string, number>();
  for (const m of matches)
    for (const [pid, min] of Object.entries(m.mins))
      total.set(pid, (total.get(pid) ?? 0) + min);
  const coreIds = [...total.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CORE_N)
    .map(([pid]) => pid);
  const core = new Set(coreIds);
  const coreAges = coreIds
    .map((pid) => ages?.[pid])
    .filter((a): a is number => a != null && Number.isFinite(a));
  const coreAvgAge = coreAges.length
    ? +(coreAges.reduce((s, a) => s + a, 0) / coreAges.length).toFixed(1)
    : null;
  // 近 WINDOW_DAYS 天内,核心球员累计等效分钟(年龄加权)
  const since = now - WINDOW_DAYS * DAY;
  let load = 0;
  for (const m of matches) {
    if (Date.parse(m.date) < since) continue;
    for (const [pid, min] of Object.entries(m.mins))
      if (core.has(pid)) load += min * ageFactor(ages?.[pid]);
  }
  const equivMatches = load / FULL_MATCH;
  return {
    penalty: -Math.min(MAX_PENALTY, Math.max(0, (equivMatches - 1) * STEP)),
    coreAvgAge,
  };
}

/** 兼容旧签名(等价于 coreLoad(...).penalty,不加年龄权重)。 */
export function coreLoadPenalty(
  matches: TeamMatches,
  now: number,
): number | null {
  return coreLoad(matches, now).penalty;
}

/** 年龄表刷新周期:名单赛期内基本不变,14 天足够。 */
const AGES_TTL = 14 * DAY;

/**
 * 摄取球员年龄(AF squads,playerId 与分钟数据同一 id 空间):
 * 只为已有分钟记录的球队拉名单;14 天内已刷过则跳过(幂等,省配额)。
 */
export async function ingestPlayerAges(): Promise<{ players: number }> {
  if (!hasApiFootball()) return { players: 0 };
  const store = loadPlayerMinutes();
  const teams = Object.keys(store.teams);
  if (!teams.length) return { players: 0 };
  if (store.agesAt && Date.now() - store.agesAt < AGES_TTL)
    return { players: Object.keys(store.ages ?? {}).length };
  const idMap = loadAfTeams();
  const ages: Record<string, number> = { ...(store.ages ?? {}) };
  const targets = teams
    .map((norm) => idMap[norm])
    .filter((x): x is number => !!x);
  const squads = await pool(targets, 5, (id) => getSquad(id));
  for (const squad of squads) {
    if (!squad) continue;
    for (const p of squad) if (p.age != null) ages[String(p.id)] = p.age;
  }
  store.ages = ages;
  store.agesAt = Date.now();
  savePlayerMinutes(store);
  return { players: Object.keys(ages).length };
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
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/** 增量摄取已结束世界杯比赛的球员分钟(只抓新结束场次)。 */
export async function ingestPlayerMinutes(): Promise<{
  added: number;
  teams: number;
}> {
  if (!hasApiFootball()) return { added: 0, teams: 0 };
  const store: PlayerMinutesStore = loadPlayerMinutes();
  const finished = await getWcFinished();
  const fresh = finished.filter((f) => !store.events[String(f.id)]);
  if (!fresh.length)
    return { added: 0, teams: Object.keys(store.teams).length };

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
