/** GET /api/worldcup/matches — 世界杯单场赔率(The Odds API,缓存 120s)+ 配额。 */
import { cached } from 'lib/cache';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { getQuota } from 'lib/odds/quota';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const matches = await cached('odds:matches', 120_000, () => theOddsApiProvider.getMatches());
    return ok({ matches, quota: getQuota() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '赔率获取失败');
  }
}
