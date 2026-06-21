/**
 * GET /api/worldcup/league/summary?comp=laliga&id=EVENT — 某联赛单场 ESPN 详情
 *   (比分/统计/阵容/近期战绩)。联赛 slug 经注册表解析;纯 ESPN 免费,无 AF 配额。
 */
import { getLeagueEspnProvider } from 'lib/espn/espn';
import { getLeague } from 'lib/predict/leagues';
import { cached } from 'lib/cache';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const comp = u.searchParams.get('comp') ?? '';
    const id = u.searchParams.get('id');
    const league = getLeague(comp);
    if (!league) return fail(`未知联赛 comp=${comp}`, 400);
    if (!id) return fail('缺少 id', 400);
    const espn = getLeagueEspnProvider(
      league.espnSlug,
      new Date().getFullYear(),
    );
    const summary = await cached(
      `league:summary:${comp}:${id}`,
      30_000,
      async () => espn.getMatchSummary(id),
    );
    return ok({ comp, summary });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '联赛详情失败');
  }
}
