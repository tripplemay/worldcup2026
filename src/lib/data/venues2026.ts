/**
 * 2026 世界杯 16 座场馆的坐标与时区(静态表,TMI 旅途因子用)。
 * 匹配策略:按 API-Football 的 venue 城市字段(小写包含匹配,含常见别名/都会区写法)。
 * 时区取赛期(6-7 月,夏令时)UTC 偏移。未命中返回 null(旅途因子诚实降级为不计)。
 */

export interface WcVenueGeo {
  key: string; // 规范城市名(展示/去重用)
  lat: number;
  lon: number;
  tz: number; // 赛期 UTC 偏移(夏令时)
  aliases: string[]; // 小写包含匹配关键词(城市/都会区/场馆名)
}

export const WC2026_VENUES: WcVenueGeo[] = [
  // 美东(UTC−4)
  { key: 'New York/New Jersey', lat: 40.813, lon: -74.074, tz: -4, aliases: ['east rutherford', 'new jersey', 'new york', 'metlife'] },
  { key: 'Philadelphia', lat: 39.901, lon: -75.168, tz: -4, aliases: ['philadelphia', 'lincoln financial'] },
  { key: 'Boston', lat: 42.091, lon: -71.264, tz: -4, aliases: ['foxborough', 'boston', 'gillette'] },
  { key: 'Atlanta', lat: 33.755, lon: -84.401, tz: -4, aliases: ['atlanta', 'mercedes-benz'] },
  { key: 'Miami', lat: 25.958, lon: -80.239, tz: -4, aliases: ['miami', 'hard rock'] },
  { key: 'Toronto', lat: 43.633, lon: -79.419, tz: -4, aliases: ['toronto', 'bmo field'] },
  // 美中(UTC−5)
  { key: 'Dallas', lat: 32.748, lon: -97.093, tz: -5, aliases: ['arlington', 'dallas', 'at&t stadium'] },
  { key: 'Houston', lat: 29.685, lon: -95.411, tz: -5, aliases: ['houston', 'nrg'] },
  { key: 'Kansas City', lat: 39.049, lon: -94.484, tz: -5, aliases: ['kansas city', 'arrowhead'] },
  // 墨西哥(UTC−6)
  { key: 'Mexico City', lat: 19.303, lon: -99.15, tz: -6, aliases: ['mexico city', 'ciudad de mexico', 'ciudad de méxico', 'azteca', 'banorte'] },
  { key: 'Guadalajara', lat: 20.682, lon: -103.463, tz: -6, aliases: ['guadalajara', 'zapopan', 'akron'] },
  { key: 'Monterrey', lat: 25.669, lon: -100.244, tz: -6, aliases: ['monterrey', 'guadalupe', 'bbva'] },
  // 美西/加西(UTC−7)
  { key: 'Seattle', lat: 47.595, lon: -122.332, tz: -7, aliases: ['seattle', 'lumen'] },
  { key: 'San Francisco Bay', lat: 37.403, lon: -121.97, tz: -7, aliases: ['santa clara', 'san francisco', "levi's", 'levis'] },
  { key: 'Los Angeles', lat: 33.953, lon: -118.339, tz: -7, aliases: ['inglewood', 'los angeles', 'sofi'] },
  { key: 'Vancouver', lat: 49.277, lon: -123.112, tz: -7, aliases: ['vancouver', 'bc place'] },
];

/** 城市/场馆字符串 → 场馆地理信息(小写包含匹配;未命中 null)。 */
export function lookupWcVenue(cityOrName?: string | null): WcVenueGeo | null {
  if (!cityOrName) return null;
  const s = cityOrName.toLowerCase();
  for (const v of WC2026_VENUES)
    if (v.aliases.some((a) => s.includes(a))) return v;
  return null;
}

const R_EARTH_KM = 6371;
/** 两点大圆距离(km,haversine)。 */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R_EARTH_KM * Math.asin(Math.sqrt(s)));
}
