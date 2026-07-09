/**
 * pooled CLV 聚合单测:合并统计/自助 CI/确定性/空样本。
 */
import { poolClvStats, screenPooled, buildPooledReport } from '../pooled';
import { toStrategyParams, DEFAULT_EVO } from '../evolve';
import { configHash, datasetHash } from '../governance';
import type { EngineDataset } from '../engine';

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

describe('screenPooled(G1 质量 + G2 功效池化筛)', () => {
  const base = {
    n: 3000,
    avgClv: 0.006,
    tStat: 2.5,
    posRate: 0.55,
    ci95: [0.001, 0.011] as [number, number],
    perLeague: [],
  };

  it('全条件达标 → overall=true', () => {
    const s = screenPooled(base);
    expect(s).toEqual({
      nPass: true,
      tPass: true,
      avgPass: true,
      posPass: true,
      ciPass: true,
      overall: true,
    });
  });

  it('功效不足(n<2500)一票拦下', () => {
    const s = screenPooled({ ...base, n: 2000 });
    expect(s.nPass).toBe(false);
    expect(s.overall).toBe(false);
  });

  it('CI 跨零拦下(07-04 家族级证否的读数形态)', () => {
    const s = screenPooled({ ...base, ci95: [-0.0015, 0.003] });
    expect(s.ciPass).toBe(false);
    expect(s.overall).toBe(false);
  });
});

describe('buildPooledReport(接线层)', () => {
  it('数据缺失联赛全部跳过 → 空池结构完整(不抛错;阈值随店下发)', async () => {
    const r = await buildPooledReport({
      leagues: ['x1', 'x2'],
      loadDataset: () => {
        throw new Error('missing');
      },
      loadManifest: () => null,
      loadIncumbentParams: () => null,
      at: 123,
    });
    expect(r.at).toBe(123);
    expect(r.leagues).toEqual([]);
    expect(r.configs).toHaveLength(2);
    expect(r.configs[0].key).toBe('default');
    expect(r.configs[1].key).toBe('incumbents');
    expect(r.configs[0].result.n).toBe(0);
    expect(r.configs[0].screen.overall).toBe(false);
    expect(r.thresholds?.minN).toBe(2500);
  });

  it('逐联赛缓存:era/配置键全中 → 复用样本零引擎重跑', async () => {
    // 最小可哈希数据集(有 allRes + odds 键,能过入池守卫;引擎绝不会被调到)
    const ds: EngineDataset = {
      allHist: [],
      allRes: Array.from({ length: 5 }, (_, i) => ({
        eventId: `e${i}`,
        date: `2025-01-0${i + 1}T15:00:00Z`,
        home: `h${i}`,
        away: `a${i}`,
        homeNorm: `h${i}`,
        awayNorm: `a${i}`,
        homeGoals: 1,
        awayGoals: 0,
      })) as EngineDataset['allRes'],
      odds: { k: {} } as EngineDataset['odds'],
    };
    const defHash = configHash(toStrategyParams(DEFAULT_EVO));
    const prev = {
      at: 1,
      leagues: ['x1'],
      configs: [],
      note: '',
      cache: {
        x1: {
          dataHash: datasetHash(ds),
          holdoutFrom: null,
          defHash,
          defClvs: [0.01, 0.02, 0.03], // 引擎不可能凭 5 场空赔率数据产出 —— n=3 即证明走了缓存
          incHash: null,
          incClvs: null,
        },
      },
    };
    const r = await buildPooledReport({
      leagues: ['x1'],
      loadDataset: () => ds,
      loadManifest: () => null,
      loadIncumbentParams: () => null,
      at: 2,
      prev,
    });
    expect(r.leagues).toEqual(['x1']);
    expect(r.configs[0].result.n).toBe(3);
    expect(r.configs[0].result.avgClv).toBeCloseTo(0.02, 6);
    expect(r.cache?.x1.defClvs).toEqual([0.01, 0.02, 0.03]);
  }, 30000);
});
