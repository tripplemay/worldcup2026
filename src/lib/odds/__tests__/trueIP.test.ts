import { trueIP3, trueIP2 } from '../trueIP';

describe('trueIP3 (1X2 比例去水)', () => {
  it('去水后三项和为 1', () => {
    const r = trueIP3(1.5, 4.5, 6.5)!;
    expect(r).not.toBeNull();
    expect(r.home + r.draw + r.away).toBeCloseTo(1, 6);
  });
  it('剥离庄家抽水(主胜真实概率低于原始倒数)', () => {
    // 原始倒数和 >1(含水位);去水后主胜 < 1/1.5
    const r = trueIP3(1.5, 4.5, 6.5)!;
    expect(r.home).toBeLessThan(1 / 1.5);
    expect(r.home).toBeGreaterThan(0.55);
  });
  it('无效赔率(<=1 或缺失)返回 null', () => {
    expect(trueIP3(1.0, 4.5, 6.5)).toBeNull();
    expect(trueIP3(undefined, 4.5, 6.5)).toBeNull();
    expect(trueIP3(1.5, null, 6.5)).toBeNull();
  });
});

describe('trueIP2 (两项去水)', () => {
  it('去水后两项和为 1', () => {
    const r = trueIP2(1.95, 1.85)!;
    expect(r.a + r.b).toBeCloseTo(1, 6);
    expect(r.b).toBeGreaterThan(r.a); // 1.85 更低赔 → 概率更高
  });
  it('无效返回 null', () => {
    expect(trueIP2(1.95, 1)).toBeNull();
  });
});
