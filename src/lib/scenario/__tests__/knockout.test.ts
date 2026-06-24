import { buildBracketSeed, simulateKnockout } from '../knockout';
import { THIRD_ELIGIBILITY } from '../bracket';
import { GROUP_LETTERS } from '../types';
import type { GroupLetter, GroupRow, GroupPositionsLike, WinnerSlot } from '../types';
import { mulberry32 } from '../rng';

const row = (
  team: string,
  group: GroupLetter,
  rank: 1 | 2 | 3 | 4,
  points: number,
): GroupRow => ({ team, group, points, gf: points, ga: 0, gd: points, rank });

/** 12 组:头名 g1 / 次名 g2 / 第三名 g3。A–H 第三名 4 分(出线),I–L 1 分(淘汰)。 */
function buildPositions(): GroupPositionsLike {
  const winners: Record<string, GroupRow> = {};
  const runners: Record<string, GroupRow> = {};
  const thirds: GroupRow[] = [];
  for (const g of GROUP_LETTERS) {
    winners[g] = row(`${g}1`, g, 1, 7);
    runners[g] = row(`${g}2`, g, 2, 5);
    const thirdPts = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].includes(g) ? 4 : 1;
    thirds.push(row(`${g}3`, g, 3, thirdPts));
  }
  return { winners, runners, thirds };
}

// 强弱:A1 最强(必夺冠),其余按字符串确定性区分
const strengthOf = (team: string): number => {
  if (team === 'A1') return 100000;
  let h = 0;
  for (let i = 0; i < team.length; i++) h = h * 31 + team.charCodeAt(i);
  return (h % 9000) + 1;
};
const play = (home: string, away: string): string =>
  strengthOf(home) >= strengthOf(away) ? home : away;

describe('buildBracketSeed', () => {
  const pos = buildPositions();
  const seed = buildBracketSeed(pos, () => undefined)!;

  it('选出 A–H 8 个第三名出线', () => {
    expect(seed).not.toBeNull();
    expect([...seed.qualifiedThirds].sort()).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
    ]);
  });

  it('8 个头名槽位都填入合法第三名', () => {
    const slots = Object.keys(seed.T3bySlot) as WinnerSlot[];
    expect(slots).toHaveLength(8);
    for (const slot of slots) {
      const team = seed.T3bySlot[slot]!;
      const g = team[0] as GroupLetter; // 'C3' → 'C'
      expect(THIRD_ELIGIBILITY[slot]).toContain(g);
    }
  });

  it('头名/次名种子齐全(各 12)', () => {
    expect(Object.keys(seed.W)).toHaveLength(12);
    expect(Object.keys(seed.R)).toHaveLength(12);
  });
});

describe('simulateKnockout', () => {
  const pos = buildPositions();
  const seed = buildBracketSeed(pos, () => undefined)!;
  const res = simulateKnockout(seed, play, mulberry32(1));

  it('最强队夺冠', () => {
    expect(res.champion).toBe('A1');
    expect(res.stage['A1']).toBe('CHAMPION');
  });

  it('恰好 32 队进入淘汰赛(各有最远阶段与 R32 对手)', () => {
    const participants = Object.keys(res.stage);
    expect(participants).toHaveLength(32);
    expect(Object.keys(res.r32Opponent)).toHaveLength(32);
    for (const p of participants) {
      expect(['R32', 'R16', 'QF', 'SF', 'FINAL', 'CHAMPION']).toContain(
        res.stage[p],
      );
    }
  });

  it('R32 对手关系对称', () => {
    for (const [a, b] of Object.entries(res.r32Opponent)) {
      expect(res.r32Opponent[b]).toBe(a);
    }
  });

  it('决赛负者达到 FINAL', () => {
    const finalLoser = res.loserOf[104];
    expect(res.stage[finalLoser]).toBe('FINAL');
  });
});
