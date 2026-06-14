/** GET /api/worldcup/bracket — 淘汰赛对阵(ESPN,缓存 300s)。 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const matches = await cached('espn:bracket', 300_000, () => espnProvider.getBracket());
    return ok({ matches });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '对阵树获取失败');
  }
}
