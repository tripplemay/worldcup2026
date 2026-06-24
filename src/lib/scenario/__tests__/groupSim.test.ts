import { rankGroup, simulateGroups } from '../groupSim';
import type { GroupMatch } from '../types';

const M = (
  home: string,
  away: string,
  hg: number,
  ag: number,
): GroupMatch => ({
  group: 'A',
  home,
  away,
  homeGoals: hg,
  awayGoals: ag,
  played: true,
});

const order = (matches: GroupMatch[], fifa?: (t: string) => number | undefined) =>
  rankGroup(matches, fifa ?? (() => undefined)).map((r) => r.team);

describe('rankGroup — 2026 抢断', () => {
  it('纯积分分出名次', () => {
    const ms = [
      M('t1', 't2', 1, 0),
      M('t1', 't3', 1, 0),
      M('t1', 't4', 1, 0), // t1 全胜 9
      M('t2', 't3', 1, 0),
      M('t2', 't4', 1, 0), // t2 6
      M('t3', 't4', 1, 0), // t3 3, t4 0
    ];
    expect(order(ms)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('同分两队:相互交锋胜者优先(即便总净胜更差)', () => {
    const ms = [
      M('t1', 't2', 1, 0), // t1 H2H 胜 t2
      M('t3', 't1', 3, 0), // t1 总净胜被拉低
      M('t1', 't4', 1, 0),
      M('t2', 't3', 3, 0),
      M('t2', 't4', 3, 0), // t2 总净胜更好(+5)
      M('t3', 't4', 1, 1),
    ];
    // t1=6(GD-1), t2=6(GD+5):相互交锋 t1 胜 → t1 在前
    const ranked = order(ms);
    expect(ranked.slice(0, 2)).toEqual(['t1', 't2']);
  });

  it('同分两队相互交锋平局:回退总净胜球', () => {
    const ms = [
      M('t1', 't2', 0, 0), // H2H 平
      M('t1', 't3', 2, 0),
      M('t4', 't1', 1, 0),
      M('t2', 't3', 1, 0),
      M('t4', 't2', 1, 0),
      M('t4', 't3', 2, 0), // t4 全胜
    ];
    // t4=9; t1=4(GD+1), t2=4(GD0) → t1 在 t2 前
    expect(order(ms)).toEqual(['t4', 't1', 't2', 't3']);
  });

  it('三队同分:相互交锋迷你联赛 + 子集递归', () => {
    const ms = [
      M('t1', 't2', 1, 0), // t1 胜 t2
      M('t3', 't1', 1, 0), // t3 胜 t1
      M('t2', 't3', 2, 1), // t2 胜 t3
      M('t1', 't4', 5, 0),
      M('t2', 't4', 1, 0),
      M('t3', 't4', 1, 0),
    ];
    // t1/t2/t3 各 6 分;迷你联赛三者各 3 分 GD0,进球 t2=t3=2 > t1=1 →
    // 先分出 [t2,t3] 高于 t1;再对 {t2,t3} 递归(直接交锋 t2 胜 t3)→ t2 > t3
    expect(order(ms)).toEqual(['t2', 't3', 't1', 't4']);
  });

  it('全平局:回退 FIFA 排名(小者优先)', () => {
    const ms = [
      M('t1', 't2', 0, 0),
      M('t1', 't3', 0, 0),
      M('t1', 't4', 0, 0),
      M('t2', 't3', 0, 0),
      M('t2', 't4', 0, 0),
      M('t3', 't4', 0, 0),
    ];
    const fifa = (t: string) =>
      ({ t1: 30, t2: 5, t3: 12, t4: 50 } as Record<string, number>)[t];
    expect(order(ms, fifa)).toEqual(['t2', 't3', 't1', 't4']);
  });
});

describe('simulateGroups', () => {
  it('抽出头名/次名/第三名', () => {
    const mk = (g: string): GroupMatch[] =>
      [
        ['x1', 'x2', 3, 0],
        ['x1', 'x3', 3, 0],
        ['x1', 'x4', 3, 0],
        ['x2', 'x3', 3, 0],
        ['x2', 'x4', 3, 0],
        ['x3', 'x4', 3, 0],
      ].map(([h, a, hg, ag]) => ({
        group: g as GroupMatch['group'],
        home: `${g}${h}`,
        away: `${g}${a}`,
        homeGoals: hg as number,
        awayGoals: ag as number,
        played: true,
      }));
    const pos = simulateGroups({ A: mk('A'), B: mk('B') }, () => undefined);
    expect(pos.winners['A'].team).toBe('Ax1');
    expect(pos.runners['A'].team).toBe('Ax2');
    expect(pos.thirds).toHaveLength(2); // 每组一个第三名
    expect(pos.thirds.every((r) => r.rank === 3)).toBe(true);
  });
});
