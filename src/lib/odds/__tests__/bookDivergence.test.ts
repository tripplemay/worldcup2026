import { computeBookDivergence } from '../bookDivergence';
import type { BookmakerOdds } from '../types';

const bk = (
  key: string,
  home: number,
  draw: number,
  away: number,
): BookmakerOdds => ({ key, title: key, lastUpdate: '', home, draw, away });

describe('computeBookDivergence', () => {
  it('家数 < 3 返回 null(样本太薄)', () => {
    expect(
      computeBookDivergence([bk('a', 1.5, 4, 7), bk('b', 1.55, 4, 6.5)]),
    ).toBeNull();
  });

  it('忽略无效赔率;有效家 < 3 仍返回 null', () => {
    const r = computeBookDivergence([
      bk('a', 1.5, 4, 7),
      bk('b', 1.0, 4, 7), // 无效(<=1)→ 剔除
      bk('c', 1.55, 4, 6.5),
    ]);
    expect(r).toBeNull();
  });

  it('各家几乎一致 → tight,极差很小', () => {
    const r = computeBookDivergence([
      bk('a', 1.5, 4.2, 7.0),
      bk('b', 1.51, 4.2, 6.9),
      bk('c', 1.5, 4.25, 7.0),
    ])!;
    expect(r).not.toBeNull();
    expect(r.books).toBe(3);
    expect(r.level).toBe('tight');
    expect(r.spreadPp).toBeLessThan(3);
    // 共识三项和为 1
    const { home, draw, away } = r.consensus;
    expect(home + draw + away).toBeCloseTo(1, 3);
  });

  it('一家在主胜上明显离群 → wide,topSide=home,领跑/滞后正确', () => {
    const r = computeBookDivergence([
      bk('pinnacle', 1.4, 4.5, 9.0), // 主胜去水概率最高(赔率最低)
      bk('soft', 1.85, 3.8, 4.3), // 主胜去水概率最低
      bk('mid', 1.55, 4.2, 6.5),
      bk('mid2', 1.5, 4.3, 7.0),
    ])!;
    expect(r.topSide).toBe('home');
    expect(r.level).toBe('wide');
    expect(r.spreadPp).toBeGreaterThanOrEqual(6);
    expect(r.high.key).toBe('pinnacle'); // 领跑
    expect(r.low.key).toBe('soft'); // 滞后
    expect(r.high.prob).toBeGreaterThan(r.low.prob);
  });

  it('共识用中位数,对单一离群稳健', () => {
    // 三家紧密 + 一家极端软盘;中位数共识应贴近紧密那群,不被离群拉走
    const r = computeBookDivergence([
      bk('a', 1.5, 4.2, 7.0),
      bk('b', 1.5, 4.2, 7.0),
      bk('c', 1.51, 4.2, 6.9),
      bk('outlier', 2.5, 3.5, 3.0),
    ])!;
    // 紧密群主胜去水 ~0.64;中位数共识应仍在 0.6 以上(均值会被离群压低)
    expect(r.consensus.home).toBeGreaterThan(0.6);
  });

  it('perBook 每家去水三项和为 1', () => {
    const r = computeBookDivergence([
      bk('a', 2.1, 3.4, 3.5),
      bk('b', 2.05, 3.3, 3.7),
      bk('c', 2.2, 3.4, 3.3),
    ])!;
    for (const p of r.perBook) {
      expect(p.home + p.draw + p.away).toBeCloseTo(1, 3);
    }
    expect(r.perBook).toHaveLength(3);
  });
});
