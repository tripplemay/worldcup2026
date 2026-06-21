/**
 * POST /api/worldcup/epl/ingest?league=39&season=2025&key=epl-2025 — 一次性摄取联赛历史
 *   (赛果 + 逐场真 xG → league-<key>-*.json)。管理口令保护;耗时(每场一次 stats 调用)。
 */
import {
  ingestLeagueSeason,
  ingestFootballDataOdds,
} from 'lib/predict/eplIngest';
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
    const key = u.searchParams.get('key') ?? 'epl-2025';
    // 赔率摄取(football-data.co.uk CSV;AF 不保留历史赔率)
    if (u.searchParams.get('kind') === 'odds') {
      const csv = u.searchParams.get('csv');
      if (!csv) return fail('缺少 csv 参数(football-data CSV URL)', 400);
      const r = await ingestFootballDataOdds(key, csv);
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
