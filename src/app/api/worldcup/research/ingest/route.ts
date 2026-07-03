/**
 * POST /api/worldcup/research/ingest —— football-data 增量摄取(管理员;x-admin-token)。
 * 拉指定赛季(缺省=当前赛季)的 E0 CSV → 赛果/代理xG历史(matchKey 去重,AF 真 xG 优先)
 * + 开闭盘 oddsx 合并落盘。数据闭环:cron 每日先摄取(4:35),进化循环(4:45)随后消费;
 * 新数据达实质阈值 → 进化 exhausted 自动复活。?seasons=2526,2425 可指定多季。
 */
import { okLive, fail } from 'lib/api/respond';
import {
  loadLeagueHistorical,
  saveLeagueHistorical,
  loadLeagueResults,
  saveLeagueResults,
} from 'lib/db/store';
import {
  parseFootballDataMatches,
  mergeFdMatches,
} from 'lib/predict/fdMatches';
import { ingestFootballDataOddsX } from 'lib/predict/oddsxIngest';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const LEAGUE_KEY = 'epl-2025';
const EPL_ALIAS = {
  'Man City': 'Manchester City',
  'Man United': 'Manchester United',
  "Nott'm Forest": 'Nottingham Forest',
};
const CSV_URL = (ss: string) =>
  `https://www.football-data.co.uk/mmz4281/${ss}/E0.csv`;

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

/** 当前赛季码(7 月起算新赛季):2026-08 → '2627'。 */
function currentSeason(now = new Date()): string {
  const y = now.getUTCFullYear() % 100;
  const startY = now.getUTCMonth() + 1 >= 7 ? y : y - 1;
  return `${String(startY).padStart(2, '0')}${String(startY + 1).padStart(2, '0')}`;
}

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('摄取未启用(缺 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  try {
    const url = new URL(req.url);
    const seasons = (url.searchParams.get('seasons') ?? currentSeason())
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{4}$/.test(s));
    if (!seasons.length) return fail('无有效赛季码(如 2526)', 400);

    const out: Record<string, unknown>[] = [];
    for (const ss of seasons) {
      const res = await fetch(CSV_URL(ss), {
        headers: { 'user-agent': 'Mozilla/5.0' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        out.push({ season: ss, error: `HTTP ${res.status}` });
        continue;
      }
      const csv = await res.text();
      // 当前赛季进行中 → 不做全季场次断言;历史季断言 ≈380
      const isCurrent = ss === currentSeason();
      const parsed = parseFootballDataMatches(csv, EPL_ALIAS, isCurrent ? null : 380);
      // 合并赛果/历史(matchKey 去重,既有 AF 条目优先)
      const r = mergeFdMatches(loadLeagueResults(LEAGUE_KEY), parsed.results);
      saveLeagueResults(LEAGUE_KEY, r.merged);
      const h = mergeFdMatches(loadLeagueHistorical(LEAGUE_KEY), parsed.hist);
      saveLeagueHistorical(LEAGUE_KEY, h.merged);
      // 开闭盘 oddsx(自身按 matchKey 幂等合并)
      const ox = await ingestFootballDataOddsX(LEAGUE_KEY, CSV_URL(ss), EPL_ALIAS);
      out.push({
        season: ss,
        rows: parsed.rows,
        addedResults: r.added,
        addedHist: h.added,
        oddsxStored: ox.stored,
        issues: parsed.issues,
      });
    }
    return okLive({ seasons: out });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '摄取失败');
  }
}
