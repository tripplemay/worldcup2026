/** GET /api/worldcup/scoreboard?dates=YYYYMMDD — 赛程 + 实时比分(ESPN,缓存 25s)。 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { ok, fail, todayUTC } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const dates = new URL(req.url).searchParams.get('dates') || todayUTC();
  try {
    const matches = await cached(`espn:scoreboard:${dates}`, 25_000, () =>
      espnProvider.getScoreboard(dates),
    );
    return ok({ dates, matches });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '赛程/比分获取失败');
  }
}
