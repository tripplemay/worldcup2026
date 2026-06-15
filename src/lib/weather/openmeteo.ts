/**
 * Open-Meteo 天气适配器(完全免费、无需 API key)。
 * 按坐标 + 日期取当日天气;日期超出预报窗口(约未来 16 天)返回 null。
 */
const BASE = 'https://api.open-meteo.com/v1/forecast';

export interface WeatherInfo {
  date: string; // YYYY-MM-DD(场馆当地)
  tempMax: number | null;
  tempMin: number | null;
  precipProb: number | null; // 降水概率 %
  code: number; // WMO weather code
}

/** 取某坐标某日(场馆当地日期)的天气;无数据返回 null。 */
export async function fetchDailyWeather(
  lat: number,
  lon: number,
  tz: string,
  dateYMD: string,
): Promise<WeatherInfo | null> {
  const url =
    `${BASE}?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&timezone=${encodeURIComponent(tz)}&start_date=${dateYMD}&end_date=${dateYMD}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const d = (await res.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: (number | null)[];
      temperature_2m_min?: (number | null)[];
      precipitation_probability_max?: (number | null)[];
      weather_code?: (number | null)[];
    };
  };
  const day = d.daily;
  if (!day?.time?.length || day.time[0] !== dateYMD) return null;
  return {
    date: dateYMD,
    tempMax: day.temperature_2m_max?.[0] ?? null,
    tempMin: day.temperature_2m_min?.[0] ?? null,
    precipProb: day.precipitation_probability_max?.[0] ?? null,
    code: day.weather_code?.[0] ?? 0,
  };
}

/** WMO weather code → 状况分组键(用于 i18n + emoji)。 */
export function weatherCondition(code: number): string {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partlyCloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'thunder';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain'; // 51-67 drizzle/rain, 80-82 showers
  return 'cloudy';
}

const EMOJI: Record<string, string> = {
  clear: '☀️',
  partlyCloudy: '⛅',
  cloudy: '☁️',
  fog: '🌫️',
  rain: '🌧️',
  snow: '❄️',
  thunder: '⛈️',
};

export function weatherEmoji(code: number): string {
  return EMOJI[weatherCondition(code)] ?? '🌡️';
}
