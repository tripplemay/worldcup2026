/**
 * POST /api/worldcup/epl/ingest — 一次性摄取联赛历史(赛果 + 逐场真 xG / 闭盘赔率 → league-<key>-*.json)。
 * 管理口令保护;耗时(每场一次 stats 调用)。
 *
 * 注册表驱动(推荐):?comp=laliga&season=2024[&resultsOnly=1]
 *   - 默认:摄取该联赛该赛季 results + 逐场 xG(comp 解析 AF id / 存储 key)。
 *   - kind=odds:?comp=laliga&season=2024&kind=odds —— 自动拼 football-data CSV URL + 联赛别名摄取闭盘价。
 * 旧式(向后兼容,EPL):?key=epl-2025&league=39&season=2025 / &kind=odds&csv=<url>。
 */
import {
  ingestLeagueSeason,
  ingestFootballDataOdds,
} from 'lib/predict/eplIngest';
import { getLeague, fdCsvUrl } from 'lib/predict/leagues';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authed(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

export async function POST(req: Request) {
  const a = authed(req);
  if (a === null) return fail('未启用(服务端未设置 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  try {
    const u = new URL(req.url);
    const isOdds = u.searchParams.get('kind') === 'odds';
    const comp = u.searchParams.get('comp');

    // ── 注册表驱动:comp 解析联赛(AF id / fd 代码 / 别名 / 存储 key)──
    if (comp) {
      const lg = getLeague(comp);
      if (!lg) return fail(`未知联赛 comp=${comp}`, 400);
      const season = Number(u.searchParams.get('season'));
      if (!Number.isFinite(season) || season < 2000)
        return fail('缺少有效 season(起始年,如 2024)', 400);
      if (isOdds) {
        const csv = u.searchParams.get('csv') ?? fdCsvUrl(lg.fdCode, season);
        const r = await ingestFootballDataOdds(lg.key, csv, lg.fdAlias);
        return ok({ comp, key: lg.key, kind: 'odds', season, csv, ...r });
      }
      const resultsOnly = u.searchParams.get('resultsOnly') === '1';
      const r = await ingestLeagueSeason(lg.key, lg.afId, season, resultsOnly);
      return ok({ comp, key: lg.key, league: lg.afId, season, ...r });
    }

    // ── 旧式(向后兼容):显式 key/league/season/csv ──
    const key = u.searchParams.get('key') ?? 'epl-2025';
    if (isOdds) {
      const csv = u.searchParams.get('csv');
      if (!csv) return fail('缺少 csv 参数(football-data CSV URL)', 400);
      const alias = getLeague('epl')?.fdAlias ?? {};
      const r = await ingestFootballDataOdds(key, csv, alias);
      return ok({ key, kind: 'odds', ...r });
    }
    const league = Number(u.searchParams.get('league') ?? 39);
    const season = Number(u.searchParams.get('season') ?? 2025);
    const resultsOnly = u.searchParams.get('resultsOnly') === '1';
    const r = await ingestLeagueSeason(key, league, season, resultsOnly);
    return ok({ key, league, season, ...r });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '联赛摄取失败');
  }
}
