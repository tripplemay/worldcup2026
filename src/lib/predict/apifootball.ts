/**
 * API-Football(API-Sports)适配器 — 预测数据源(付费 Pro 档)。
 * 提供:球队 id 解析、近期比赛(含赛果)、单场射门统计。
 * 用于喂 xG(射门)+ Elo(赛果);未配置 API_FOOTBALL_KEY 时各函数返回空/undefined。
 */
const BASE =
  process.env.API_FOOTBALL_BASE ?? 'https://v3.football.api-sports.io';

function key(): string | undefined {
  return process.env.API_FOOTBALL_KEY;
}

export function hasApiFootball(): boolean {
  return !!key();
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** 调 API-Football,返回 response 数组(失败返回 [])。 */
async function af(path: string): Promise<unknown[]> {
  const k = key();
  if (!k) return [];
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'x-apisports-key': k },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const data = obj(await res.json());
    return arr(data.response);
  } catch {
    return [];
  }
}

/** 解析国家队 id(优先 national 队);找不到返回 undefined。 */
export async function resolveTeamId(name: string): Promise<number | undefined> {
  const list = (await af(`/teams?search=${encodeURIComponent(name)}`)).map(obj);
  if (!list.length) return undefined;
  const nat = list.find((x) => obj(x.team).national === true) ?? list[0];
  const id = num(obj(nat.team).id);
  return id > 0 ? id : undefined;
}

export interface AfFixture {
  id: number;
  date: string; // ISO
  homeId: number;
  awayId: number;
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
}

/** 某队最近 last 场(仅已结束 FT)。 */
export async function getRecentFixtures(
  teamId: number,
  last = 15,
): Promise<AfFixture[]> {
  const list = (await af(`/fixtures?team=${teamId}&last=${last}`)).map(obj);
  const out: AfFixture[] = [];
  for (const f of list) {
    const fx = obj(f.fixture);
    if (obj(fx.status).short !== 'FT') continue; // 仅取已结束
    const teams = obj(f.teams);
    const goals = obj(f.goals);
    out.push({
      id: num(fx.id),
      date: typeof fx.date === 'string' ? fx.date : '',
      homeId: num(obj(teams.home).id),
      awayId: num(obj(teams.away).id),
      homeName: String(obj(teams.home).name ?? ''),
      awayName: String(obj(teams.away).name ?? ''),
      homeGoals: num(goals.home),
      awayGoals: num(goals.away),
    });
  }
  return out;
}

/** 单场射门统计:teamId → { sot 射正, shots 总射门 };无统计返回 null。 */
export async function getFixtureStats(
  fixtureId: number,
): Promise<Map<number, { sot: number; shots: number }> | null> {
  const list = (await af(`/fixtures/statistics?fixture=${fixtureId}`)).map(obj);
  if (list.length < 2) return null;
  const map = new Map<number, { sot: number; shots: number }>();
  for (const t of list) {
    const tid = num(obj(t.team).id);
    const stats = arr(t.statistics).map(obj);
    const pick = (type: string) =>
      num(stats.find((s) => s.type === type)?.value);
    map.set(tid, {
      sot: pick('Shots on Goal'),
      shots: pick('Total Shots'),
    });
  }
  return map;
}
