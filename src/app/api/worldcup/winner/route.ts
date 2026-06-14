/** GET /api/worldcup/winner — 夺冠赔率榜(The Odds API,缓存 600s)+ 配额。 */
import { cached } from 'lib/cache';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { getQuota } from 'lib/odds/quota';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const winner = await cached('odds:winner', 600_000, () => theOddsApiProvider.getWinnerOdds());
    return ok({ winner, quota: getQuota() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '夺冠赔率获取失败');
  }
}
