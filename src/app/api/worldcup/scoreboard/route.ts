/**
 * GET /api/worldcup/scoreboard?dates=YYYYMMDD — 赛程 + 实时比分(ESPN,缓存 25s)。
 * dates 为 **UTC+8 日期**;不传时走「智能默认」:今天还有未结束比赛则今天,
 * 今天比赛全部结束则返回下一个比赛日。响应里的 dates 字段为实际选中的日期。
 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { ok, fail } from 'lib/api/respond';
import type { ScheduleMatch } from 'lib/espn/types';

export const dynamic = 'force-dynamic';
const CN_OFFSET = 8 * 3600_000;

function todayCN(): string {
  return new Date(Date.now() + CN_OFFSET).toISOString().slice(0, 10).replace(/-/g, '');
}
function shiftYmd(ymd: string, days: number): string {
  const dt = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}
function utc8Date(iso: string): string {
  return new Date(new Date(iso).getTime() + CN_OFFSET).toISOString().slice(0, 10).replace(/-/g, '');
}

function groupByDate(all: ScheduleMatch[]): Map<string, ScheduleMatch[]> {
  const m = new Map<string, ScheduleMatch[]>();
  for (const x of all) {
    const d = utc8Date(x.commenceTime);
    if (!m.has(d)) m.set(d, []);
    m.get(d)!.push(x);
  }
  return m;
}

/** 智能默认:今天有未结束比赛→今天;今天比赛全部结束→下一个比赛日;今天无比赛→今天。 */
function pickDefaultDate(byDate: Map<string, ScheduleMatch[]>, today: string): string {
  const todayM = byDate.get(today) ?? [];
  if (todayM.some((m) => m.status !== 'post')) return today;
  if (todayM.length > 0) {
    const future = [...byDate.keys()].filter((d) => d > today).sort();
    for (const d of future) if ((byDate.get(d) ?? []).length) return d;
  }
  return today;
}

export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get('dates');
  const base = param || todayCN();
  try {
    // 指定日期:查前后一天;智能默认:查今天到 +10 天以便找下一个比赛日
    const range = param
      ? `${shiftYmd(base, -1)}-${shiftYmd(base, 1)}`
      : `${shiftYmd(base, -1)}-${shiftYmd(base, 10)}`;
    const cacheKey = param ? `espn:sb:${base}` : `espn:sb:auto:${base}`;
    const all = await cached(cacheKey, 25_000, () => espnProvider.getScoreboard(range));
    const byDate = groupByDate(all);
    const date = param ? base : pickDefaultDate(byDate, base);
    const matches = (byDate.get(date) ?? []).sort((a, b) =>
      a.commenceTime.localeCompare(b.commenceTime),
    );
    return ok({ dates: date, matches });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '赛程/比分获取失败');
  }
}
