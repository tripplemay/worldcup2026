/**
 * 2026 世界杯 16 座承办球场静态资料。
 * ESPN 只给球场名 + 城市,这里补容量/承办国/坐标(坐标供 Open-Meteo 天气查询)。
 * 容量为大致值(世界杯可能临时调整),按需校正。
 */
export interface VenueInfo {
  stadium: string; // 标准球场名(对齐 ESPN venue.fullName)
  city: string;
  country: 'USA' | 'Mexico' | 'Canada';
  capacity: number;
  lat: number;
  lon: number;
  tz: string; // IANA 时区(Open-Meteo 用)
}

export const VENUES: VenueInfo[] = [
  // 美国 11
  { stadium: 'Mercedes-Benz Stadium', city: 'Atlanta', country: 'USA', capacity: 71000, lat: 33.7554, lon: -84.4008, tz: 'America/New_York' },
  { stadium: 'Gillette Stadium', city: 'Foxborough', country: 'USA', capacity: 65000, lat: 42.0909, lon: -71.2643, tz: 'America/New_York' },
  { stadium: 'AT&T Stadium', city: 'Arlington', country: 'USA', capacity: 80000, lat: 32.7473, lon: -97.0945, tz: 'America/Chicago' },
  { stadium: 'NRG Stadium', city: 'Houston', country: 'USA', capacity: 72000, lat: 29.6847, lon: -95.4107, tz: 'America/Chicago' },
  { stadium: 'Arrowhead Stadium', city: 'Kansas City', country: 'USA', capacity: 76000, lat: 39.0489, lon: -94.4839, tz: 'America/Chicago' },
  { stadium: 'SoFi Stadium', city: 'Inglewood', country: 'USA', capacity: 70000, lat: 33.9535, lon: -118.3392, tz: 'America/Los_Angeles' },
  { stadium: 'Hard Rock Stadium', city: 'Miami Gardens', country: 'USA', capacity: 65000, lat: 25.958, lon: -80.2389, tz: 'America/New_York' },
  { stadium: 'MetLife Stadium', city: 'East Rutherford', country: 'USA', capacity: 82500, lat: 40.8135, lon: -74.0745, tz: 'America/New_York' },
  { stadium: 'Lincoln Financial Field', city: 'Philadelphia', country: 'USA', capacity: 69000, lat: 39.9008, lon: -75.1675, tz: 'America/New_York' },
  { stadium: "Levi's Stadium", city: 'Santa Clara', country: 'USA', capacity: 70000, lat: 37.403, lon: -121.97, tz: 'America/Los_Angeles' },
  { stadium: 'Lumen Field', city: 'Seattle', country: 'USA', capacity: 69000, lat: 47.5952, lon: -122.3316, tz: 'America/Los_Angeles' },
  // 墨西哥 3
  { stadium: 'Estadio Akron', city: 'Guadalajara', country: 'Mexico', capacity: 48000, lat: 20.6819, lon: -103.4625, tz: 'America/Mexico_City' },
  { stadium: 'Estadio Azteca', city: 'Mexico City', country: 'Mexico', capacity: 83000, lat: 19.3029, lon: -99.1505, tz: 'America/Mexico_City' },
  { stadium: 'Estadio BBVA', city: 'Monterrey', country: 'Mexico', capacity: 53000, lat: 25.6692, lon: -100.2444, tz: 'America/Monterrey' },
  // 加拿大 2
  { stadium: 'BMO Field', city: 'Toronto', country: 'Canada', capacity: 45000, lat: 43.6332, lon: -79.4185, tz: 'America/Toronto' },
  { stadium: 'BC Place', city: 'Vancouver', country: 'Canada', capacity: 54000, lat: 49.2767, lon: -123.1119, tz: 'America/Vancouver' },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** 按球场名(优先)或城市名匹配承办球场资料;匹配失败返回 undefined。 */
export function findVenue(stadium?: string, city?: string): VenueInfo | undefined {
  if (stadium) {
    const s = norm(stadium);
    const byStadium = VENUES.find((v) => norm(v.stadium) === s);
    if (byStadium) return byStadium;
  }
  if (city) {
    const c = norm(city); // ESPN city 形如 "Atlanta, Georgia" → 含子串匹配
    const byCity = VENUES.find((v) => c.includes(norm(v.city)));
    if (byCity) return byCity;
  }
  return undefined;
}
