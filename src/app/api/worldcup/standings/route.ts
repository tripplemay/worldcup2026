/** GET /api/worldcup/standings — 12 小组积分榜(ESPN,缓存 300s)。 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const groups = await cached('espn:standings', 300_000, () => espnProvider.getStandings());
    return ok({ groups });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '积分榜获取失败');
  }
}
