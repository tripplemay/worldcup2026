/** 2026 场馆表单测:别名匹配 / 距离量级 / 未知降级。 */
import { lookupWcVenue, haversineKm, WC2026_VENUES } from '../venues2026';

describe('lookupWcVenue', () => {
  it('16 座场馆按城市/场馆名别名均可命中', () => {
    expect(lookupWcVenue('East Rutherford')?.key).toBe('New York/New Jersey');
    expect(lookupWcVenue('Arlington')?.key).toBe('Dallas');
    expect(lookupWcVenue('Ciudad de México')?.key).toBe('Mexico City');
    expect(lookupWcVenue('Estadio Azteca')?.key).toBe('Mexico City');
    expect(lookupWcVenue('Zapopan')?.key).toBe('Guadalajara');
    expect(lookupWcVenue('Foxborough, MA')?.key).toBe('Boston');
    expect(lookupWcVenue('Santa Clara')?.key).toBe('San Francisco Bay');
    expect(lookupWcVenue('Inglewood, California')?.key).toBe('Los Angeles');
  });

  it('未知/空 → null(旅途因子诚实降级)', () => {
    expect(lookupWcVenue('Atlantis')).toBeNull();
    expect(lookupWcVenue(undefined)).toBeNull();
    expect(lookupWcVenue('')).toBeNull();
  });

  it('16 座场馆齐全且时区在赛期夏令时范围', () => {
    expect(WC2026_VENUES).toHaveLength(16);
    for (const v of WC2026_VENUES) {
      expect(v.tz).toBeGreaterThanOrEqual(-7);
      expect(v.tz).toBeLessThanOrEqual(-4);
    }
  });
});

describe('haversineKm', () => {
  it('温哥华→迈阿密 ≈ 4500km(±10%);同点 = 0', () => {
    const van = lookupWcVenue('Vancouver')!;
    const mia = lookupWcVenue('Miami')!;
    const d = haversineKm(van, mia);
    expect(d).toBeGreaterThan(4000);
    expect(d).toBeLessThan(5000);
    expect(haversineKm(van, van)).toBe(0);
  });
});
