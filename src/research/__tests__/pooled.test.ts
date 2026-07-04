/**
 * pooled CLV 聚合单测:合并统计/自助 CI/确定性/空样本。
 */
import { poolClvStats } from '../pooled';

describe('poolClvStats', () => {
  it('合并 n/均值/t/posRate 正确;CI 含真均值;确定性', () => {
    const mk = (n: number, mean: number, amp: number, league: string) => ({
      league,
      clvs: Array.from(
        { length: n },
        (_, i) => mean + amp * Math.sin(i * 2.399),
      ),
    });
    const samples = [mk(400, 0.01, 0.03, 'a'), mk(600, 0.01, 0.03, 'b')];
    const r = poolClvStats(samples);
    expect(r.n).toBe(1000);
    expect(r.avgClv).toBeCloseTo(0.01, 3);
    expect(r.tStat).toBeGreaterThan(2); // 0.01 均值 / (0.021/√1000) ≈ 15
    expect(r.ci95[0]).toBeLessThan(0.01);
    expect(r.ci95[1]).toBeGreaterThan(0.01);
    expect(r.perLeague).toHaveLength(2);
    expect(r.perLeague[0].n).toBe(400);
    const r2 = poolClvStats(samples);
    expect(r2).toEqual(r); // 种子自助确定性
  });

  it('零均值噪声 → t≈0 且 CI 跨 0', () => {
    const clvs = Array.from({ length: 800 }, (_, i) => 0.02 * Math.sin(i));
    const r = poolClvStats([{ league: 'x', clvs }]);
    expect(Math.abs(r.tStat)).toBeLessThan(1);
    expect(r.ci95[0]).toBeLessThan(0);
    expect(r.ci95[1]).toBeGreaterThan(0);
  });

  it('空样本安全', () => {
    const r = poolClvStats([{ league: 'x', clvs: [] }]);
    expect(r.n).toBe(0);
    expect(r.tStat).toBe(0);
  });
});
