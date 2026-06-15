/**
 * GET /api/worldcup/match-markets?oddsEventId=...&group=...
 * 单场富盘口(The Odds API event 端点,缓存 300s 省配额,按 group 分缓存)。
 * group: handicap(让球+大小,默认)| firsthalf | corners | cards | players。
 * 都为按需:只在用户点开对应 tab 才请求,不看就不扣点。
 */
import { cached } from 'lib/cache';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { getQuota } from 'lib/odds/quota';
import { ok, fail } from 'lib/api/respond';
import type { MarketGroup } from 'lib/odds/types';

export const dynamic = 'force-dynamic';

const GROUPS: MarketGroup[] = [
  'handicap',
  'firsthalf',
  'corners',
  'cards',
  'players',
];

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get('oddsEventId');
  const group = (sp.get('group') ?? 'handicap') as MarketGroup;
  if (!id) return fail('缺少 oddsEventId 参数', 400);
  if (!GROUPS.includes(group)) return fail(`不支持的 group: ${group}`, 400);
  try {
    const markets = await cached(`odds:markets:${id}:${group}`, 300_000, () =>
      group === 'handicap'
        ? theOddsApiProvider.getMatchMarkets(id)
        : theOddsApiProvider.getMatchMarketsGroup(id, group),
    );
    return ok({ markets, group, quota: getQuota() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '盘口获取失败');
  }
}
