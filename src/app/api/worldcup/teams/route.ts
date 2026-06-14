/** GET /api/worldcup/teams — 48 强球队(ESPN,缓存 6h,基本不变)。 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const teams = await cached('espn:teams', 21_600_000, () => espnProvider.getTeams());
    return ok({ teams });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '球队获取失败');
  }
}
