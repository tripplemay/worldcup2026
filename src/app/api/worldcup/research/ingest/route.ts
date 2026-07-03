/**
 * POST /api/worldcup/research/ingest —— football-data 增量摄取(管理员;x-admin-token)。
 * v2 多联赛:缺省 = 全部注册联赛 × 当前赛季(cron 每日 4:35);?league=e1&seasons=1920,2021
 * 可对单联赛做历史回填。赛果/代理xG 按 matchKey 去重(既有条目优先,EPL 的 AF 真 xG 不被覆盖),
 * oddsx 幂等合并。数据变化达阈值 → 进化 exhausted 自动复活。
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
import { LEAGUES, leagueOf } from 'research/leagues';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const CSV_URL = (fd: string, ss: string) =>
  `https://www.football-data.co.uk/mmz4281/${ss}/${fd}.csv`;

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
    const leagueParam = url.searchParams.get('league');
    const defs = leagueParam
      ? [leagueOf(leagueParam)].filter((x): x is NonNullable<typeof x> => !!x)
      : LEAGUES;
    if (!defs.length) return fail('未知联赛', 400);
    const seasons = (url.searchParams.get('seasons') ?? currentSeason())
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{4}$/.test(s));
    if (!seasons.length) return fail('无有效赛季码(如 2526)', 400);

    const out: Record<string, unknown>[] = [];
    for (const def of defs) {
      for (const ss of seasons) {
        const res = await fetch(CSV_URL(def.fd, ss), {
          headers: { 'user-agent': 'Mozilla/5.0' },
          cache: 'no-store',
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          out.push({ league: def.key, season: ss, error: `HTTP ${res.status}` });
          continue;
        }
        const csv = await res.text();
        const isCurrent = ss === currentSeason();
        const parsed = parseFootballDataMatches(
          csv,
          def.alias,
          isCurrent ? null : def.expectRows,
        );
        const r = mergeFdMatches(loadLeagueResults(def.key), parsed.results);
        saveLeagueResults(def.key, r.merged);
        const h = mergeFdMatches(loadLeagueHistorical(def.key), parsed.hist);
        saveLeagueHistorical(def.key, h.merged);
        const ox = await ingestFootballDataOddsX(
          def.key,
          CSV_URL(def.fd, ss),
          def.alias,
        );
        out.push({
          league: def.key,
          season: ss,
          rows: parsed.rows,
          addedResults: r.added,
          addedHist: h.added,
          oddsxStored: ox.stored,
          issues: parsed.issues,
        });
      }
    }
    return okLive({ results: out });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '摄取失败');
  }
}
