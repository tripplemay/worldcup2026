import { normalizeTeam, matchKey, findMatch } from '../normalize';

describe('normalizeTeam', () => {
  it('去除变音符(Curaçao→curacao)', () => {
    expect(normalizeTeam('Curaçao')).toBe('curacao');
  });
  it('别名映射(Türkiye→turkey)', () => {
    expect(normalizeTeam('Türkiye')).toBe('turkey');
  });
  it("Côte d'Ivoire 与 Ivory Coast 归一致", () => {
    expect(normalizeTeam("Côte d'Ivoire")).toBe(normalizeTeam('Ivory Coast'));
  });
  it('Korea Republic→south korea', () => {
    expect(normalizeTeam('Korea Republic')).toBe('south korea');
  });
  it('连字符/大小写归一(Bosnia-Herzegovina)', () => {
    expect(normalizeTeam('Bosnia-Herzegovina')).toBe('bosnia herzegovina');
  });
});

describe('matchKey', () => {
  it('忽略主客顺序', () => {
    expect(matchKey('Germany', 'Curaçao', '2026-06-14T17:00:00Z')).toBe(
      matchKey('Curacao', 'Germany', '2026-06-14T17:00:00Z'),
    );
  });
  it('不同日期键不同', () => {
    expect(matchKey('A', 'B', '2026-06-14T17:00:00Z')).not.toBe(
      matchKey('A', 'B', '2026-06-15T17:00:00Z'),
    );
  });
});

describe('findMatch — 跨源对齐', () => {
  const schedule = [
    { homeTeam: 'Germany', awayTeam: 'Türkiye', commenceTime: '2026-06-14T17:00:00Z', id: 'a' },
    { homeTeam: 'Netherlands', awayTeam: 'Japan', commenceTime: '2026-06-14T20:00:00Z', id: 'b' },
  ];
  it('赔率源 "Turkey" 能匹配赛程源 "Türkiye"', () => {
    const found = findMatch(schedule, 'Germany', 'Turkey', '2026-06-14T17:00:00Z');
    expect(found?.id).toBe('a');
  });
  it('主客互换仍匹配', () => {
    const found = findMatch(schedule, 'Japan', 'Netherlands', '2026-06-14T20:00:00Z');
    expect(found?.id).toBe('b');
  });
  it('无匹配返回 undefined', () => {
    expect(findMatch(schedule, 'Spain', 'Brazil', '2026-06-14T17:00:00Z')).toBeUndefined();
  });
});
