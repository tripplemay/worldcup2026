import { rowToStanding, deriveRemaining } from 'lib/scenario/standings';
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
