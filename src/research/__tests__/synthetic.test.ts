/**
 * 合成注入器单测:确定性 / 比例 / 只动开盘主胜 / 不可变 / 无开盘不注入。
 */
import { injectEdge, makeNullControl } from '../synthetic';
import type { EngineDataset, MatchOddsView } from '../engine';

const mkDs = (n: number, withOpen = true): EngineDataset => {
  const odds: Record<string, MatchOddsView> = {};
  for (let i = 0; i < n; i++)
    odds[`m${i}`] = {
      x2: {
        ...(withOpen ? { open: { h: 2.0, d: 3.4, a: 3.8 } } : {}),
        close: { h: 1.95, d: 3.45, a: 3.9 },
      },
    };
  return { allHist: [], allRes: [], odds };
};

describe('injectEdge', () => {
  it('确定性:同种子同数据 → 相同注入集;不同种子 → 不同', () => {
    const ds = mkDs(200);
    const a = injectEdge(ds, { seed: 's1' });
    const b = injectEdge(ds, { seed: 's1' });
    const c = injectEdge(ds, { seed: 's2' });
    expect(a.injected).toEqual(b.injected);
    expect(a.injected).not.toEqual(c.injected);
  });

  it('比例近似 rate;注入 = 开盘 h/d/a 三向同抬 ×(1+lift);闭盘不动', () => {
    const ds = mkDs(1000);
    const r = injectEdge(ds, { rate: 0.4, liftPct: 0.025 });
    expect(r.injected.length).toBeGreaterThan(320);
    expect(r.injected.length).toBeLessThan(480);
    for (const k of r.injected) {
      const mv = r.dataset.odds[k];
      expect(mv.x2!.open!.h).toBeCloseTo(2.0 * 1.025, 4);
      expect(mv.x2!.open!.d).toBeCloseTo(3.4 * 1.025, 4);
      expect(mv.x2!.open!.a).toBeCloseTo(3.8 * 1.025, 4);
      expect(mv.x2!.close).toEqual({ h: 1.95, d: 3.45, a: 3.9 });
    }
    // 未注入的完全不动
    const untouched = Object.keys(ds.odds).filter(
      (k) => !r.injected.includes(k),
    );
    for (const k of untouched.slice(0, 20))
      expect(r.dataset.odds[k]).toBe(ds.odds[k]);
  });

  it('makeNullControl:开盘 = 闭盘×(1±noise),真 CLV 按构造零均值;确定性', () => {
    const ds = mkDs(500);
    const a = makeNullControl(ds, { noisePct: 0.01, seed: 'n1' });
    const b = makeNullControl(ds, { noisePct: 0.01, seed: 'n1' });
    expect(a.odds).toEqual(b.odds); // 确定性
    let sumClv = 0;
    let n = 0;
    for (const k of Object.keys(a.odds)) {
      const mv = a.odds[k];
      const clvH = mv.x2!.open!.h / mv.x2!.close!.h - 1;
      expect(Math.abs(clvH)).toBeLessThanOrEqual(0.0101); // |噪声| ≤ noisePct(+舍入)
      sumClv += clvH;
      n++;
    }
    expect(Math.abs(sumClv / n)).toBeLessThan(0.002); // 均值 ≈ 0
    expect(ds.odds['m0'].x2!.open!.h).toBe(2.0); // 原数据不可变
  });

  it('不可变:原数据集对象零变化', () => {
    const ds = mkDs(50);
    const before = JSON.stringify(ds.odds);
    injectEdge(ds, { rate: 1 });
    expect(JSON.stringify(ds.odds)).toBe(before);
  });

  it('无开盘价的比赛不注入(回退闭盘下注无 CLV,对检出无贡献)', () => {
    const ds = mkDs(100, false);
    const r = injectEdge(ds, { rate: 1 });
    expect(r.injected).toHaveLength(0);
  });
});
