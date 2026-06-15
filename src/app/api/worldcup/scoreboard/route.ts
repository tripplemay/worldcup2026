/**
 * GET /api/worldcup/scoreboard?dates=YYYYMMDD — 赛程 + 实时比分(ESPN,缓存 25s)。
 * dates 为 **UTC+8 日期**。ESPN 按其自身日历返回,故多查前后一天,再按 UTC+8 过滤,
 * 确保 UTC 跨夜的比赛(如 UTC 6/14 晚 = UTC+8 6/15 凌晨)归到正确的当地日期。
 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

const CN_OFFSET = 8 * 3600_000;

/** UTC+8 当前日期 YYYYMMDD。 */
function todayCN(): string {
  return new Date(Date.now() + CN_OFFSET).toISOString().slice(0, 10).replace(/-/g, '');
}
/** YYYYMMDD 加减天数。 */
function shiftYmd(ymd: string, days: number): string {
  const dt = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}
/** UTC ISO 时间 → 该时刻的 UTC+8 日期 YYYYMMDD。 */
function utc8Date(iso: string): string {
  return new Date(new Date(iso).getTime() + CN_OFFSET).toISOString().slice(0, 10).replace(/-/g, '');
}

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get('dates') || todayCN();
  try {
    const range = `${shiftYmd(date, -1)}-${shiftYmd(date, 1)}`;
    const all = await cached(`espn:sb:${date}`, 25_000, () => espnProvider.getScoreboard(range));
    const matches = all
      .filter((m) => utc8Date(m.commenceTime) === date)
      .sort((a, b) => a.commenceTime.localeCompare(b.commenceTime));
    return ok({ dates: date, matches });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '赛程/比分获取失败');
  }
}
