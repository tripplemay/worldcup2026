/** GET /api/worldcup/summary?eventId=... — 单场详情(ESPN summary,缓存 25s)。 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get('eventId');
  if (!eventId) return fail('缺少 eventId 参数', 400);
  try {
    const summary = await cached(`espn:summary:${eventId}`, 25_000, () =>
      espnProvider.getMatchSummary(eventId),
    );
    return ok({ summary });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '比赛详情获取失败');
  }
}
