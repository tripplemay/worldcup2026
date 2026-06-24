import {
  BRACKET,
  R32_MATCHES,
  WINNER_SLOTS,
  THIRD_ELIGIBILITY,
  MATCH_BY_NUM,
} from '../bracket';
import { GROUP_LETTERS } from '../types';
import type { GroupLetter, WinnerSlot } from '../types';

describe('bracket 模板完整性', () => {
  it('恰好 32 场,编号 73–104 连续唯一', () => {
    expect(BRACKET).toHaveLength(32);
    const nums = BRACKET.map((m) => m.match).sort((a, b) => a - b);
    expect(nums[0]).toBe(73);
    expect(nums[nums.length - 1]).toBe(104);
    expect(new Set(nums).size).toBe(32);
    for (let n = 73; n <= 104; n++) expect(MATCH_BY_NUM[n]).toBeDefined();
  });

  it('R32 共 16 场', () => {
    expect(R32_MATCHES).toHaveLength(16);
  });

  it('12 个小组头名在 R32 各作为 W 出现恰好一次', () => {
    const winners: GroupLetter[] = [];
    for (const m of R32_MATCHES)
      for (const ref of [m.home, m.away])
        if (ref.kind === 'W') winners.push(ref.group);
    expect(winners.sort()).toEqual([...GROUP_LETTERS].sort());
  });

  it('12 个小组次名在 R32 各作为 R 出现恰好一次', () => {
    const runners: GroupLetter[] = [];
    for (const m of R32_MATCHES)
      for (const ref of [m.home, m.away])
        if (ref.kind === 'R') runners.push(ref.group);
    expect(runners.sort()).toEqual([...GROUP_LETTERS].sort());
  });

  it('8 个第三名槽位在 R32 各出现一次,且与 WINNER_SLOTS 一致', () => {
    const slots: WinnerSlot[] = [];
    for (const m of R32_MATCHES)
      for (const ref of [m.home, m.away])
        if (ref.kind === 'T3') slots.push(ref.slot);
    expect(slots.sort()).toEqual([...WINNER_SLOTS].sort());
  });

  it('R32 槽位结构:8 头名 vs 第三名 + 4 头名 vs 次名 + 4 次名 vs 次名', () => {
    let wVs3 = 0;
    let wVsR = 0;
    let rVsR = 0;
    for (const m of R32_MATCHES) {
      const kinds = [m.home.kind, m.away.kind].sort().join('+');
      if (kinds === 'T3+W') wVs3++;
      else if (kinds === 'R+W') wVsR++;
      else if (kinds === 'R+R') rVsR++;
    }
    expect(wVs3).toBe(8);
    expect(wVsR).toBe(4);
    expect(rVsR).toBe(4);
  });

  it('淘汰赛连接引用的都是更早编号的有效比赛', () => {
    for (const m of BRACKET) {
      for (const ref of [m.home, m.away]) {
        if (ref.kind === 'WM' || ref.kind === 'LM') {
          expect(ref.match).toBeLessThan(m.match);
          expect(MATCH_BY_NUM[ref.match]).toBeDefined();
        }
      }
    }
  });

  it('每个 WINNER_SLOT 的 eligible 集合恰好 5 个组,且不含本组', () => {
    for (const slot of WINNER_SLOTS) {
      const elig = THIRD_ELIGIBILITY[slot];
      expect(elig).toHaveLength(5);
      const own = slot.slice(1) as GroupLetter; // '1A' → 'A'
      expect(elig).not.toContain(own);
    }
  });
});
