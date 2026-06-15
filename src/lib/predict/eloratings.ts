/**
 * eloratings.net 权威国家队 Elo(World Football Elo Ratings)。
 * en.teams.tsv:队代码→队名(多别名);World.tsv:col2=代码 col3=当前 Elo。
 * 比自算 Elo 更标准、谱更宽。内存缓存 12h。失败时上游回退自算 Elo。
 */
import { normalizeTeam } from 'lib/match/normalize';

const TEAMS_URL = 'https://www.eloratings.net/en.teams.tsv';
const RATINGS_URL = 'https://www.eloratings.net/World.tsv';
const TTL = 12 * 3600_000;
const UA = 'Mozilla/5.0';

let cache: { at: number; map: Map<string, number> } | null = null;

async function fetchTsv(url: string): Promise<string[][]> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
}

/** 取 eloratings.net 当前 Elo(归一化队名 → 分);失败返回空 Map。 */
export async function fetchEloRatings(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < TTL) return cache.map;
  try {
    const [teams, ratings] = await Promise.all([
      fetchTsv(TEAMS_URL),
      fetchTsv(RATINGS_URL),
    ]);
    // 代码 → 主名(col0=代码,col1=主名)
    const codeToName = new Map<string, string>();
    for (const row of teams) {
      if (row[0] && row[1]) codeToName.set(row[0].trim(), row[1].trim());
    }
    // World.tsv:col2=代码,col3=当前 Elo
    const map = new Map<string, number>();
    for (const row of ratings) {
      const code = (row[2] ?? '').trim();
      const elo = parseInt((row[3] ?? '').trim(), 10);
      if (!code || !Number.isFinite(elo)) continue;
      const name = codeToName.get(code);
      if (!name) continue;
      map.set(normalizeTeam(name), elo);
    }
    if (map.size) cache = { at: Date.now(), map };
    return map.size ? map : (cache?.map ?? new Map());
  } catch {
    return cache?.map ?? new Map();
  }
}
