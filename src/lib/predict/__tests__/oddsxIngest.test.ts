/**
 * football-data 开盘+闭盘 1X2 解析器单测(纯函数,脱网)。
 * 覆盖:开/闭盘列优先级(Pinnacle→Bet365/平均)、只开或只闭、全空跳过、alias、matchKey 对齐、
 * toLeagueClosing 向后兼容投影。
 */
import { parseFootballDataOddsX } from '../oddsxIngest';
import { toLeagueClosing } from '../oddsTypes';
import { normalizeTeam, matchKey } from 'lib/match/normalize';

// 列序:Date,HomeTeam,AwayTeam, B365(开) PS(开) B365C(闭) AvgC(闭) PSC(闭)
const HEAD =
  'Date,HomeTeam,AwayTeam,B365H,B365D,B365A,PSH,PSD,PSA,B365CH,B365CD,B365CA,AvgCH,AvgCD,AvgCA,PSCH,PSCD,PSCA';
const CSV = [
  HEAD,
  // Arsenal-Chelsea:PS 开(优于 B365)+ PSC 闭(优于 Avg/B365C)
  '09/08/2025,Arsenal,Chelsea,1.95,3.50,4.00,1.90,3.60,4.20,1.88,3.60,4.30,1.87,3.65,4.35,1.85,3.70,4.40',
  // Liverpool-Everton:PS/PSC 空 → 开取 B365、闭取 AvgC
  '10/08/2025,Liverpool,Everton,1.40,5.00,8.00,,,,,,,1.38,5.20,8.50,,,',
  // Man City(alias→Manchester City)-Tottenham:PS 开 + PSC 闭
  '11/08/2025,Man City,Tottenham,1.30,5.50,9.00,1.28,5.60,9.50,1.29,5.55,9.20,,,,1.27,5.65,9.60',
  // Brighton-Fulham:全空 → 跳过
  '12/08/2025,Brighton,Fulham,,,,,,,,,,,,,,,,',
].join('\n');

const key = (h: string, a: string, iso: string) =>
  matchKey(normalizeTeam(h), normalizeTeam(a), iso);

describe('parseFootballDataOddsX(开盘+闭盘 1X2)', () => {
  const parsed = parseFootballDataOddsX(CSV, { 'Man City': 'Manchester City' }, 111);

  it('全空行跳过,其余 3 场入库', () => {
    expect(Object.keys(parsed)).toHaveLength(3);
    expect(parsed[key('Brighton', 'Fulham', '2025-08-12T12:00:00Z')]).toBeUndefined();
  });

  it('开取 Pinnacle、闭取 Pinnacle(优于 Bet365/平均)', () => {
    const m = parsed[key('Arsenal', 'Chelsea', '2025-08-09T12:00:00Z')];
    expect(m.x2?.open).toEqual({ h: 1.9, d: 3.6, a: 4.2 }); // PS 而非 B365 1.95
    expect(m.x2?.close).toEqual({ h: 1.85, d: 3.7, a: 4.4 }); // PSC 而非 Avg/B365C
    expect(m.source).toBe('football-data');
    expect(m.homeNorm).toBe('arsenal');
    expect(m.awayNorm).toBe('chelsea');
    expect(m.ingestedAt).toBe(111);
  });

  it('Pinnacle 缺失 → 开回退 Bet365、闭回退平均', () => {
    const m = parsed[key('Liverpool', 'Everton', '2025-08-10T12:00:00Z')];
    expect(m.x2?.open).toEqual({ h: 1.4, d: 5.0, a: 8.0 }); // B365 开
    expect(m.x2?.close).toEqual({ h: 1.38, d: 5.2, a: 8.5 }); // AvgC 闭
  });

  it('alias 归一化后入键(Man City→Manchester City)', () => {
    const m = parsed[key('Manchester City', 'Tottenham', '2025-08-11T12:00:00Z')];
    expect(m).toBeDefined();
    expect(m.homeNorm).toBe('manchester city');
    expect(m.x2?.open).toEqual({ h: 1.28, d: 5.6, a: 9.5 });
  });

  it('toLeagueClosing 向后兼容投影 = 闭盘 1X2', () => {
    const m = parsed[key('Arsenal', 'Chelsea', '2025-08-09T12:00:00Z')];
    expect(toLeagueClosing(m)).toEqual({ h: 1.85, d: 3.7, a: 4.4 });
  });
});
