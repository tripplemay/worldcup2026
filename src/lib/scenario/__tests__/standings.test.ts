import {
  rowToStanding,
  deriveRemaining,
  reachableRankRange,
} from 'lib/scenario/standings';
import type { GroupMatch } from 'lib/scenario/types';
import type { GroupStandingRow } from 'lib/espn/types';

describe('rowToStanding', () => {
  it('字段对齐(goalsFor/Against/Diff → gf/ga/gd),remaining 初始 0', () => {
    const row: GroupStandingRow = {
      team: 'Argentina',
      logo: 'x.png',
      rank: 1,
      played: 2,
      win: 2,
      draw: 0,
      loss: 0,
      goalsFor: 5,
      goalsAgainst: 1,
      goalDiff: 4,
      points: 6,
    };
    expect(rowToStanding(row)).toEqual({
      rank: 1,
      played: 2,
      win: 2,
      draw: 0,
      loss: 0,
      gf: 5,
      ga: 1,
      gd: 4,
      points: 6,
      remaining: 0,
    });
  });
});

describe('deriveRemaining', () => {
  const M = (home: string, away: string, played: boolean): GroupMatch => ({
    group: 'A',
    home,
    away,
    played,
    homeGoals: played ? 1 : undefined,
    awayGoals: played ? 0 : undefined,
  });

  it('只计未赛场次,双方互为剩余对手', () => {
    const rem = deriveRemaining(
      [
        M('a1', 'a2', true), // 已赛,不计
        M('a1', 'a3', false), // 未赛
        M('a2', 'a4', false),
      ],
      (n) => n.toUpperCase(),
    );
    expect(rem['a1']).toEqual([{ norm: 'a3', name: 'A3' }]);
    expect(rem['a3']).toEqual([{ norm: 'a1', name: 'A1' }]);
    expect(rem['a2']).toEqual([{ norm: 'a4', name: 'A4' }]);
    expect(rem['a4']).toEqual([{ norm: 'a2', name: 'A2' }]);
  });

  it('全部已赛 → 无剩余', () => {
    const rem = deriveRemaining([M('a1', 'a2', true)], (n) => n);
    expect(Object.keys(rem)).toHaveLength(0);
  });

  it('一队多场未赛累计', () => {
    const rem = deriveRemaining(
      [M('a1', 'a2', false), M('a1', 'a3', false)],
      (n) => n,
    );
    expect(rem['a1']).toHaveLength(2);
    expect(rem['a1'].map((o) => o.norm).sort()).toEqual(['a2', 'a3']);
  });
});

describe('reachableRankRange', () => {
  // FIFA 排名 a<b<c<d(仅在相互交锋/总成绩都无法区分时兜底)
  const fr = (t: string) => ({ a: 1, b: 2, c: 3, d: 4 }[t] ?? 9);
  const M = (
    home: string,
    away: string,
    hg?: number,
    ag?: number,
  ): GroupMatch => ({
    group: 'A',
    home,
    away,
    homeGoals: hg,
    awayGoals: ag,
    played: hg != null,
  });

  // 两轮已赛:a 6分、b/c 各 3分、d 0分;末轮 a-d、b-c 未赛
  const base: GroupMatch[] = [
    M('a', 'b', 1, 0), // a 胜
    M('c', 'd', 1, 0), // c 胜
    M('a', 'c', 1, 0), // a 胜
    M('b', 'd', 1, 0), // b 胜
    M('a', 'd'), // 未赛
    M('b', 'c'), // 未赛
  ];

  it('a 任何结果都第一 → 已锁头名,区间 1–1', () => {
    const r = reachableRankRange(base, fr)!;
    expect(r['a'].clinchedTop1).toBe(true);
    expect(r['a'].clinchedTop2).toBe(true);
    expect(r['a'].bestRank).toBe(1);
    expect(r['a'].worstRank).toBe(1);
  });

  it('d 任何结果都进不了前二 → 已无缘前二', () => {
    const r = reachableRankRange(base, fr)!;
    expect(r['d'].eliminatedTop2).toBe(true);
    expect(r['d'].clinchedTop2).toBe(false);
    expect(r['d'].bestRank).toBeGreaterThanOrEqual(3);
  });

  it('b 命运未定:可前二也可跌出 → 既非锁定也非出局', () => {
    const r = reachableRankRange(base, fr)!;
    expect(r['b'].clinchedTop2).toBe(false);
    expect(r['b'].eliminatedTop2).toBe(false);
    expect(r['b'].bestRank).toBeLessThanOrEqual(2);
  });

  it('全部已赛(锁定组)→ 区间塌缩为实际名次', () => {
    const done: GroupMatch[] = [
      M('a', 'b', 1, 0),
      M('c', 'd', 1, 0),
      M('a', 'c', 1, 0),
      M('b', 'd', 1, 0),
      M('a', 'd', 1, 0), // a 三战全胜=9分
      M('b', 'c', 1, 0), // b 6分、c 3分、d 0分
    ];
    const r = reachableRankRange(done, fr)!;
    expect(r['a']).toMatchObject({
      bestRank: 1,
      worstRank: 1,
      clinchedTop1: true,
    });
    expect(r['d']).toMatchObject({
      bestRank: 4,
      worstRank: 4,
      eliminatedTop2: true,
    });
  });

  it('剩余场次过多(>5)返回 undefined(初期无信息量)', () => {
    const allUnplayed: GroupMatch[] = [
      M('a', 'b'),
      M('c', 'd'),
      M('a', 'c'),
      M('b', 'd'),
      M('a', 'd'),
      M('b', 'c'),
    ];
    expect(reachableRankRange(allUnplayed, fr)).toBeUndefined();
  });
});
