/**
 * football-data 比赛解析 + 合并去重 单测(纯函数,脱网)。
 */
import { parseFootballDataMatches, mergeFdMatches } from '../fdMatches';
import type { ResultMatch } from '../types';

const HEAD = 'Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST';
const rows = (extra: string[] = []) =>
  [
    HEAD,
    '09/08/2019,Liverpool,Norwich,4,1,15,12,7,5',
    '10/08/2019,West Ham,Man City,0,5,5,25,2,9',
    ...extra,
  ].join('\n');

describe('parseFootballDataMatches', () => {
  it('赛果 + 代理 xG 历史(eventId=fd:matchKey,alias 生效)', () => {
    const r = parseFootballDataMatches(rows(), { 'Man City': 'Manchester City' }, null);
    expect(Object.keys(r.results)).toHaveLength(2);
    const lv = Object.values(r.results).find((m) => m.homeNorm === 'liverpool')!;
    expect(lv.homeGoals).toBe(4);
    expect(lv.eventId.startsWith('fd:')).toBe(true);
    const wh = Object.values(r.hist).find((m) => m.homeNorm === 'west ham')!;
    expect(wh.awayNorm).toBe('manchester city'); // alias
    expect(wh.homeXg).toBeCloseTo(2 * 0.3 + 3 * 0.05); // HST7? no: west ham HST=2, HS=5 → 2*0.3+3*0.05
    expect(r.issues).toHaveLength(0);
  });

  it('质量校验:比分越域/重复键 → issue 且不入库;全季场次断言', () => {
    const r = parseFootballDataMatches(
      rows([
        '11/08/2019,Burnley,Southampton,99,0,10,10,4,4', // 比分越域
        '09/08/2019,Liverpool,Norwich,4,1,15,12,7,5', // 重复
      ]),
      {},
      380, // 全季期望 → 4 行远低于 380 → issue
    );
    expect(Object.keys(r.results)).toHaveLength(2);
    expect(r.issues.some((i) => i.includes('比分越域'))).toBe(true);
    expect(r.issues.some((i) => i.includes('重复场次'))).toBe(true);
    expect(r.issues.some((i) => i.includes('场次异常'))).toBe(true);
  });

  it('缺射门列 → 只出赛果不出历史', () => {
    const csv = ['Date,HomeTeam,AwayTeam,FTHG,FTAG', '09/08/2019,A,B,1,0'].join('\n');
    const r = parseFootballDataMatches(csv, {}, null);
    expect(Object.keys(r.results)).toHaveLength(1);
    expect(Object.keys(r.hist)).toHaveLength(0);
  });
});

describe('mergeFdMatches(matchKey 去重,既有优先)', () => {
  it('同场次(不同 eventId)不重复;新场次并入', () => {
    const af: Record<string, ResultMatch> = {
      '12345': {
        eventId: '12345',
        date: '2019-08-09T19:00:00+00:00',
        homeNorm: 'liverpool',
        awayNorm: 'norwich',
        homeGoals: 4,
        awayGoals: 1,
      },
    };
    const fd = parseFootballDataMatches(rows(), { 'Man City': 'Manchester City' }, null).results;
    const { merged, added } = mergeFdMatches(af, fd);
    expect(added).toBe(1); // Liverpool 场按 matchKey 命中既有 AF 条目 → 跳过
    expect(Object.keys(merged)).toHaveLength(2);
    expect(merged['12345']).toBeDefined(); // AF 条目保留
  });
});
