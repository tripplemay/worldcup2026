import { layoutXI } from '../formation';
import type { RosterPlayer } from 'lib/espn/types';

const p = (name: string, position: string): RosterPlayer => ({
  name,
  position,
  starter: true,
});

describe('layoutXI', () => {
  // 真实 ESPN 数据(阿森纳 4-3-3),但按 ESPN 数组顺序「乱序」给入:
  // 数组并非门将→后卫→中场→前锋,中后卫/中场穿插。修复前会按数组顺序分行而错位。
  const arsenal: RosterPlayer[] = [
    p('White', 'RB'),
    p('Raya', 'G'),
    p('Havertz', 'F'),
    p('Saliba', 'CD-R'),
    p('Rice', 'LM'),
    p('Gabriel', 'CD-L'),
    p('Partey', 'CM'),
    p('Tomiyasu', 'LB'),
    p('Odegaard', 'RM'),
    p('Martinelli', 'RF'),
    p('Trossard', 'LF'),
  ];

  const spots = layoutXI('4-3-3', arsenal);
  const byName = Object.fromEntries(spots.map((s) => [s.name, s]));
  const advOf = (name: string) => byName[name].adv;

  it('排满 11 人', () => {
    expect(spots).toHaveLength(11);
  });

  it('门将在最底排(adv=0),且唯一', () => {
    expect(advOf('Raya')).toBe(0);
    expect(spots.filter((s) => s.adv === 0).map((s) => s.name)).toEqual([
      'Raya',
    ]);
  });

  it('四后卫同处一排,中场/前锋未被错分进后卫排', () => {
    const defAdv = 1 / 3;
    const defs = spots
      .filter((s) => s.adv === defAdv)
      .map((s) => s.name)
      .sort();
    expect(defs).toEqual(['Gabriel', 'Saliba', 'Tomiyasu', 'White'].sort());
    // 中场不应混进后卫排
    expect(advOf('Partey')).not.toBe(defAdv);
  });

  it('后卫排从左到右:LB → CD-L → CD-R → RB', () => {
    const defAdv = 1 / 3;
    const leftToRight = spots
      .filter((s) => s.adv === defAdv)
      .sort((a, b) => a.x - b.x)
      .map((s) => s.name);
    expect(leftToRight).toEqual(['Tomiyasu', 'Gabriel', 'Saliba', 'White']);
  });

  it('前锋在最前排(adv=1),中场居中(adv=2/3)', () => {
    expect(advOf('Havertz')).toBe(1);
    expect(advOf('Martinelli')).toBe(1);
    expect(advOf('Trossard')).toBe(1);
    expect(advOf('Partey')).toBeCloseTo(2 / 3);
  });

  it('前锋排从左到右:LF → F → RF', () => {
    const fwd = spots
      .filter((s) => s.adv === 1)
      .sort((a, b) => a.x - b.x)
      .map((s) => s.name);
    expect(fwd).toEqual(['Trossard', 'Havertz', 'Martinelli']);
  });
});
