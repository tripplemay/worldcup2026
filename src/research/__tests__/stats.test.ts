/**
 * P3b 多重检验统计单测:normalCdf/Inv、sharpe、DSR(去膨胀+单调)、PBO(手算可验证 case)。
 */
import {
  normalCdf,
  normalInv,
  sharpeRatio,
  deflatedSharpe,
  combinations,
  pbo,
  spaTest,
  stationaryBootstrapIndices,
  mulberry32,
} from '../stats';

describe('正态 CDF / 分位数', () => {
  it('Φ 与 Φ⁻¹ 关键点 + 互逆', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalInv(0.975)).toBeCloseTo(1.96, 2);
    expect(normalInv(0.5)).toBeCloseTo(0, 6);
    expect(normalCdf(normalInv(0.9))).toBeCloseTo(0.9, 4);
  });
});

describe('sharpeRatio', () => {
  it('对称零均值=0、常数=0', () => {
    expect(sharpeRatio([1, -1, 1, -1])).toBeCloseTo(0);
    expect(sharpeRatio([2, 2, 2])).toBe(0);
  });
});

describe('DSR 去膨胀夏普', () => {
  // sr=0.1、T=500、skew=0、kurt=1 的干净序列(交替 +1.1/-0.9)
  const R = Array.from({ length: 500 }, (_, i) => (i % 2 === 0 ? 1.1 : -0.9));

  it('N=1(无多重检验):正 sr 大 T → DSR 高', () => {
    const r = deflatedSharpe(R, 1, 0.01);
    expect(r.sr).toBeCloseTo(0.1, 2);
    expect(r.sr0).toBe(0);
    expect(r.dsr).toBeGreaterThan(0.95);
  });

  it('N=1000(多重检验):同一序列 → DSR 坍塌到很低', () => {
    const r = deflatedSharpe(R, 1000, 0.01);
    expect(r.sr0).toBeGreaterThan(0.2); // 期望最大夏普被抬高
    expect(r.dsr).toBeLessThan(0.1);
  });

  it('DSR 随试验数单调下降', () => {
    const d10 = deflatedSharpe(R, 10, 0.01).dsr;
    const d100 = deflatedSharpe(R, 100, 0.01).dsr;
    const d1000 = deflatedSharpe(R, 1000, 0.01).dsr;
    expect(d10).toBeGreaterThan(d100);
    expect(d100).toBeGreaterThan(d1000);
  });
});

describe('组合 + PBO', () => {
  it('combinations(4,2) = 6 组', () => {
    expect([...combinations([0, 1, 2, 3], 2)]).toHaveLength(6);
  });

  it('PBO 手算:反相关(IS 冠军=OOS 垫底)→ 1.0', () => {
    // 块0 配置0 最好、块1 配置1 最好 → IS 挑的在 OOS 恰垫底
    expect(
      pbo(
        [
          [1, 0],
          [0, 1],
        ],
        2,
      ),
    ).toBe(1);
  });

  it('PBO 手算:配置0 恒最好(真 skill)→ 0', () => {
    expect(
      pbo(
        [
          [1, 0],
          [1, 0],
        ],
        2,
      ),
    ).toBe(0);
  });

  it('PBO:某配置全程最好(N=4,多块)→ ≈0', () => {
    const M = Array.from({ length: 8 }, () => [1, 0.2, 0.3, 0.1]);
    expect(pbo(M, 8)).toBeLessThan(0.05);
  });

  it('PBO:轮流坐庄(纯噪声)→ 明显 > skill', () => {
    // 每块换一个配置最好 → IS 冠军 OOS 表现随机 → PBO 高
    const N = 8;
    const M = Array.from({ length: 16 }, (_, t) =>
      Array.from({ length: N }, (_, k) => (k === t % N ? 1 : 0)),
    );
    expect(pbo(M, 16)).toBeGreaterThan(0.3);
  });
});

describe('SPA / Reality Check', () => {
  const T = 200;
  const alt = (t: number) => (t % 2 === 0 ? 1 : -1); // 均值 0 的 ±1 噪声

  it('平稳自助:返回 T 个 [0,T) 内索引', () => {
    const idx = stationaryBootstrapIndices(T, 14, mulberry32(1));
    expect(idx).toHaveLength(T);
    expect(idx.every((i) => i >= 0 && i < T)).toBe(true);
  });

  it('有信号(策略0 均值 +0.3)→ p 小', () => {
    const F = [
      Array.from({ length: T }, (_, t) => alt(t) + 0.3), // 策略0 正超额
      Array.from({ length: T }, (_, t) => alt(t + 1)),
      Array.from({ length: T }, (_, t) => alt(t)),
      Array.from({ length: T }, (_, t) => alt(t + 1)),
    ];
    expect(spaTest(F, { seed: 7 }).p).toBeLessThan(0.1);
  });

  it('纯噪声(全 ±1 均值 0)→ p 大', () => {
    const F = [0, 1, 2, 3].map((k) =>
      Array.from({ length: T }, (_, t) => alt(t + k)),
    );
    expect(spaTest(F, { seed: 7 }).p).toBeGreaterThan(0.3);
  });

  it('确定性:同 seed 两次相等', () => {
    const F = [Array.from({ length: T }, (_, t) => alt(t) + 0.2)];
    expect(spaTest(F, { seed: 9 })).toEqual(spaTest(F, { seed: 9 }));
  });
});
