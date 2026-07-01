/**
 * 亚盘四分盘(.25/.75)投影与 EV 单测(P0 修复)。
 * 拆两条相邻半盘(line±0.25:一条整数可走盘、一条 .5 永不走盘),
 * 逐格分桶成 pFullWin/pHalfWin/pHalfLoss/pFullLoss,四类概率和恒为 1。
 */
import { projectAsianHandicapQuarter } from '../projection';
import { expectedValueQuarter, kellyQuarter, expectedValue } from '../ev';

// m[主][客](和为 1);主净胜(主-客)分布:+2=0.3, +1=0.2, 0=0.4, -1=0.1
const M = [
  [0.1, 0.1, 0.0],
  [0.2, 0.3, 0.0],
  [0.3, 0.0, 0.0],
];

const sumOne = (q: {
  pFullWin: number;
  pHalfWin: number;
  pHalfLoss: number;
  pFullLoss: number;
}) => q.pFullWin + q.pHalfWin + q.pHalfLoss + q.pFullLoss;

describe('亚盘四分盘投影(四类概率和=1,边界档精确)', () => {
  it('主 -0.75(low=-1.0 整数可走盘 / high=-0.5 半盘)', () => {
    const q = projectAsianHandicapQuarter(M, -0.75, 'home');
    expect(q.pFullWin).toBeCloseTo(0.3); // 净胜≥2
    expect(q.pHalfWin).toBeCloseTo(0.2); // 净胜=1(-1 走盘 + -0.5 赢)
    expect(q.pHalfLoss).toBeCloseTo(0);
    expect(q.pFullLoss).toBeCloseTo(0.5); // 净胜≤0
    expect(sumOne(q)).toBeCloseTo(1);
  });
  it('主 -0.25(low=-0.5 / high=0 整数,打平=半输)', () => {
    const q = projectAsianHandicapQuarter(M, -0.25, 'home');
    expect(q.pFullWin).toBeCloseTo(0.5); // 净胜≥1
    expect(q.pHalfWin).toBeCloseTo(0);
    expect(q.pHalfLoss).toBeCloseTo(0.4); // 净胜=0(0 走盘 + -0.5 输)
    expect(q.pFullLoss).toBeCloseTo(0.1); // 净胜≤-1
    expect(sumOne(q)).toBeCloseTo(1);
  });
  it('客 +0.75(客视角 base=客-主;low=+0.5 / high=+1.0)', () => {
    const q = projectAsianHandicapQuarter(M, 0.75, 'away');
    // 客净胜 = -(主净胜):-2=0.3, -1=0.2, 0=0.4, +1=0.1
    expect(q.pFullWin).toBeCloseTo(0.5); // 客净胜≥0
    expect(q.pHalfWin).toBeCloseTo(0);
    expect(q.pHalfLoss).toBeCloseTo(0.2); // 客净胜=-1(+1 走盘 + +0.5 输)
    expect(q.pFullLoss).toBeCloseTo(0.3); // 客净胜≤-2
    expect(sumOne(q)).toBeCloseTo(1);
  });
});

describe('亚盘四分盘 EV/Kelly', () => {
  it('EV = pFullWin·b + pHalfWin·(b/2) − pHalfLoss·0.5 − pFullLoss', () => {
    // 主 -0.75 @ odds2(b=1):0.3·1 + 0.2·0.5 − 0 − 0.5 = -0.1
    expect(expectedValueQuarter(0.3, 0.2, 0, 0.5, 2)).toBeCloseTo(-0.1);
    expect(kellyQuarter(0.3, 0.2, 0, 0.5, 2)).toBeCloseTo(-0.1); // EV/b, b=1
  });
  it('证伪旧单线口径:.75 线旧 EV 高估(旧=0 > 新=-0.1)', () => {
    // 旧口径把 -0.75 当单线:homeCover=P(净胜≥1)=0.5、pPush=0 → EV=expectedValue(0.5,2)=0
    expect(expectedValue(0.5, 2)).toBeCloseTo(0);
    // 新四分盘口径更低:旧把半赢档(0.2)整块当全赢,多计 0.2·b/2=0.1
    expect(expectedValueQuarter(0.3, 0.2, 0, 0.5, 2)).toBeLessThan(
      expectedValue(0.5, 2),
    );
  });
});
