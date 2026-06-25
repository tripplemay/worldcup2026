/**
 * 同场组合盘(COMBO)判定:各子盘 AND,全中才赢。覆盖 won/lost/unsupported/void。
 */
import { judgeLeg } from '../settle';
import type { ComboPart } from '../types';

const combo = (parts: ComboPart[], gf: number, ga: number) =>
  judgeLeg('COMBO', '', undefined, gf, ga, undefined, parts);

const drawUnder: ComboPart[] = [
  { market: '1X2', selection: 'draw' },
  { market: 'OU', selection: 'Under', line: 2.5 },
];
const homeOver: ComboPart[] = [
  { market: '1X2', selection: 'home' },
  { market: 'OU', selection: 'Over', line: 2.5 },
];

describe('judgeCombo — 同场组合盘 AND', () => {
  it('和局 & 小2.5,1-1 → 全中 won', () => {
    expect(combo(drawUnder, 1, 1)).toBe('won');
  });

  it('和局 & 小2.5,2-1 → 和局未中 → lost', () => {
    expect(combo(drawUnder, 2, 1)).toBe('lost');
  });

  it('和局 & 小2.5,1-1 但总进球超 → 用 3-3 验证小球未中 → lost', () => {
    expect(combo(drawUnder, 3, 3)).toBe('lost'); // 平局中但大球 → 小2.5 输
  });

  it('主胜 & 大2.5,3-1 → won', () => {
    expect(combo(homeOver, 3, 1)).toBe('won');
  });

  it('主胜 & 大2.5,0-1 → 主胜未中 → lost', () => {
    expect(combo(homeOver, 0, 1)).toBe('lost');
  });

  it('含走盘子盘(AH 0 平局)且另一段中 → void(聚合层转人工)', () => {
    const parts: ComboPart[] = [
      { market: 'OU', selection: 'Under', line: 2.5 },
      { market: 'AH', selection: 'home', line: 0 },
    ];
    expect(combo(parts, 1, 1)).toBe('void'); // 小2.5 中、AH0 平局走盘
  });

  it('含无法判定子盘(CS1H 无半场数据)且另一段中 → unsupported', () => {
    const parts: ComboPart[] = [
      { market: '1X2', selection: 'home' },
      { market: 'CS1H', selection: '1-0' }, // 无 ht → unsupported
    ];
    expect(combo(parts, 1, 0)).toBe('unsupported');
  });

  it('确输优先于不支持:一段输 + 一段无法判 → lost', () => {
    const parts: ComboPart[] = [
      { market: '1X2', selection: 'away' }, // 1-0 主胜 → 客输
      { market: 'CS1H', selection: '1-0' }, // 无 ht → unsupported
    ];
    expect(combo(parts, 1, 0)).toBe('lost');
  });

  it('空 / 缺失子盘 → unsupported', () => {
    expect(combo([], 1, 1)).toBe('unsupported');
    expect(judgeLeg('COMBO', '', undefined, 1, 1)).toBe('unsupported');
  });
});
