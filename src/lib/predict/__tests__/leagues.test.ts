import {
  getLeague,
  listLeagues,
  fdSeasonCode,
  fdCsvUrl,
} from '../leagues';

describe('leagues registry', () => {
  it('解析已注册联赛', () => {
    const la = getLeague('laliga');
    expect(la?.afId).toBe(140);
    expect(la?.fdCode).toBe('SP1');
    expect(la?.key).toBe('laliga');
    expect(getLeague('epl')?.key).toBe('epl-2025'); // 沿用历史存储键
    expect(getLeague('nope')).toBeUndefined();
  });

  it('注册五大联赛且 afId/fdCode 唯一', () => {
    const all = listLeagues();
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(new Set(all.map((l) => l.afId)).size).toBe(all.length);
    expect(new Set(all.map((l) => l.fdCode)).size).toBe(all.length);
    expect(new Set(all.map((l) => l.key)).size).toBe(all.length);
  });

  it('football-data 赛季代码:起始年 → 两位+两位', () => {
    expect(fdSeasonCode(2024)).toBe('2425');
    expect(fdSeasonCode(2025)).toBe('2526');
    expect(fdSeasonCode(2023)).toBe('2324');
    expect(fdSeasonCode(1999)).toBe('9900'); // 跨世纪边界
  });

  it('拼 football-data CSV URL', () => {
    expect(fdCsvUrl('SP1', 2024)).toBe(
      'https://www.football-data.co.uk/mmz4281/2425/SP1.csv',
    );
    expect(fdCsvUrl('E0', 2025)).toBe(
      'https://www.football-data.co.uk/mmz4281/2526/E0.csv',
    );
  });
});
