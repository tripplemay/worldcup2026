/** GET /api/worldcup/events?eventId=... — 单场进球/红黄牌时间线(ESPN,缓存 30s)。 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get('eventId');
  if (!eventId) return fail('缺少 eventId 参数', 400);
  try {
    const events = await cached(`espn:events:${eventId}`, 30_000, () =>
      espnProvider.getMatchEvents(eventId),
    );
    return ok({ eventId, events });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '比赛事件获取失败');
  }
}
