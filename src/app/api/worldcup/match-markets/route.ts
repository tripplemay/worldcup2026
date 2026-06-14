/** GET /api/worldcup/match-markets?oddsEventId=... — 单场让球+大小球(The Odds API event 端点,缓存 300s 省配额)。 */
import { cached } from 'lib/cache';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { getQuota } from 'lib/odds/quota';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('oddsEventId');
  if (!id) return fail('缺少 oddsEventId 参数', 400);
  try {
    const markets = await cached(`odds:markets:${id}`, 300_000, () =>
      theOddsApiProvider.getMatchMarkets(id),
    );
    return ok({ markets, quota: getQuota() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '让球/大小球获取失败');
  }
}
