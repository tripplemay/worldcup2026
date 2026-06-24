import {
  assignThirds,
  rankThirds,
  bestEightThirdGroups,
  comboKey,
} from '../thirdPlace';
import { WINNER_SLOTS, THIRD_ELIGIBILITY } from '../bracket';
import { GROUP_LETTERS } from '../types';
import type { GroupLetter, GroupRow } from '../types';

/** 生成 12 选 8 的全部组合(C(12,8)=495)。 */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const [head, ...rest] = arr;
  const withHead = combinations(rest, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(rest, k);
  return [...withHead, ...withoutHead];
}

const row = (
  group: GroupLetter,
  points: number,
  gd: number,
  gf: number,
): GroupRow => ({
  team: `t${group}`,
  group,
  points,
  gf,
  ga: gf - gd,
  gd,
  rank: 3,
});

describe('assignThirds 二分匹配', () => {
  const allCombos = combinations(GROUP_LETTERS, 8);

  it('全部 495 种组合都能产出合法完美匹配', () => {
    expect(allCombos).toHaveLength(495);
    for (const combo of allCombos) {
      const a = assignThirds(combo);
      expect(a).not.toBeNull();
      const assign = a!;
      // 每个出线组恰好分到一个槽位
      expect(Object.keys(assign).sort()).toEqual([...combo].sort());
      // 槽位无重复 + 都是合法槽位
      const slots = Object.values(assign);
      expect(new Set(slots).size).toBe(8);
      for (const s of slots) expect(WINNER_SLOTS).toContain(s);
      // 每个分配都尊重 eligible 约束
      for (const [g, slot] of Object.entries(assign)) {
        expect(THIRD_ELIGIBILITY[slot]).toContain(g as GroupLetter);
      }
    }
  });

  it('入参非 8 个或有重复返回 null', () => {
    expect(assignThirds(['A', 'B', 'C'] as GroupLetter[])).toBeNull();
    expect(
      assignThirds(['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] as GroupLetter[]),
    ).toBeNull();
  });

  it('K 组第三名只能进 1L、L 组第三名只能进 1K(唯一约束)', () => {
    // 含 K、L 的任意组合,K→1L、L→1K 强制
    const combo: GroupLetter[] = ['A', 'B', 'C', 'D', 'E', 'F', 'K', 'L'];
    const a = assignThirds(combo)!;
    expect(a['K']).toBe('1L');
    expect(a['L']).toBe('1K');
  });

  it('comboKey 与顺序无关', () => {
    expect(comboKey(['C', 'A', 'B'] as GroupLetter[])).toBe(
      comboKey(['B', 'C', 'A'] as GroupLetter[]),
    );
  });

  it('逐行命中官方 Annex C 锚点(非算法可复刻)', () => {
    // 来自研究 workflow 三源交叉验证的官方行
    expect(
      assignThirds(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as GroupLetter[]),
    ).toEqual({
      A: '1G',
      B: '1D',
      C: '1E',
      D: '1K',
      E: '1L',
      F: '1I',
      G: '1B',
      H: '1A',
    });
    expect(
      assignThirds(['B', 'D', 'E', 'F', 'I', 'J', 'K', 'L'] as GroupLetter[]),
    ).toEqual({
      B: '1D',
      D: '1E',
      E: '1A',
      F: '1I',
      I: '1G',
      J: '1B',
      K: '1L',
      L: '1K',
    });
    expect(
      assignThirds(['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as GroupLetter[]),
    ).toEqual({
      E: '1A',
      F: '1E',
      G: '1I',
      H: '1G',
      I: '1D',
      J: '1B',
      K: '1L',
      L: '1K',
    });
  });
});

describe('rankThirds / bestEightThirdGroups', () => {
  const noFifa = () => undefined;

  it('按 积分→净胜→进球 降序排', () => {
    const thirds = [
      row('A', 3, 0, 2),
      row('B', 4, 1, 3),
      row('C', 4, 2, 2),
      row('D', 4, 2, 5),
    ];
    const ranked = rankThirds(thirds, noFifa).map((r) => r.group);
    // B/C/D 同 4 分:D(gd2,gf5) > C(gd2,gf2) > B(gd1);A 3 分垫底
    expect(ranked).toEqual(['D', 'C', 'B', 'A']);
  });

  it('同分同净胜同进球时用 FIFA 排名(小者优先)', () => {
    const thirds = [row('A', 3, 0, 1), row('B', 3, 0, 1)];
    const fifa = (norm: string) => (norm === 'tB' ? 5 : 20);
    const ranked = rankThirds(thirds, fifa).map((r) => r.group);
    expect(ranked).toEqual(['B', 'A']);
  });

  it('取最好的 8 个第三名组', () => {
    const thirds = GROUP_LETTERS.map((g, i) => row(g, 12 - i, 0, 0)); // A 最高分
    const best = bestEightThirdGroups(thirds, noFifa);
    expect(best).toHaveLength(8);
    expect(best.sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });
});
