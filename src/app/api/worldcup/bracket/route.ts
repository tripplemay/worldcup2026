/**
 * GET /api/worldcup/bracket — 淘汰赛对阵(ESPN,缓存 300s)。
 * matches:扁平真实场次(向后兼容);bracket:缝合后的连通对阵树(模板拓扑 + 真实赛果)。
 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { buildKnockoutBracket } from 'lib/scenario/knockoutBracket';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [matches, standings] = await Promise.all([
      cached('espn:bracket', 300_000, () => espnProvider.getBracket()),
      cached('espn:standings', 300_000, () => espnProvider.getStandings()),
    ]);
    const bracket = buildKnockoutBracket({ standings, matches });
    return ok({ matches, bracket });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '对阵树获取失败');
  }
}
