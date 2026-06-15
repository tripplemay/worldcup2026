/**
 * GET /api/worldcup/weather?stadium=&city=&iso=<commenceTime ISO>
 * 比赛当日天气(Open-Meteo,免费无 key)。按场馆坐标 + 当地日期查询,缓存 3h。
 * 场馆未收录或超出预报窗口时返回 weather:null(前端优雅隐藏)。
 */
import { cached } from 'lib/cache';
import { findVenue } from 'lib/data/venues';
import { fetchDailyWeather } from 'lib/weather/openmeteo';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const stadium = sp.get('stadium') ?? undefined;
  const city = sp.get('city') ?? undefined;
  const iso = sp.get('iso');
  const venue = findVenue(stadium, city);
  if (!venue || !iso) return ok({ weather: null });
  try {
    // 场馆当地日期(YYYY-MM-DD)
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: venue.tz,
    }).format(new Date(iso));
    const weather = await cached(
      `weather:${venue.stadium}:${localDate}`,
      3 * 3600_000,
      () => fetchDailyWeather(venue.lat, venue.lon, venue.tz, localDate),
    );
    return ok({ weather });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '天气获取失败');
  }
}
