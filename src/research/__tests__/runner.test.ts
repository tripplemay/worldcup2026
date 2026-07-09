/**
 * 后台 Runner 单测:同日幂等 / force 绕过 / 未知联赛报错 / 队列去重与后台消费
 * / P0 止血(exhausted 联赛 era 未变整体跳过)。
 * 重活(真进化)已由 smoke 覆盖;此处用 sc0 最小代数 + 未知联赛走轻路径。
 */
import { runLeagueOnce, enqueueResearch, runnerStatus } from '../runner';
import {
  loadEvolutionState,
  saveEvolutionState,
  loadLeagueKernel,
  saveLeagueKernel,
  loadResearchScoreboard,
  saveResearchScoreboard,
} from 'lib/db/store';
import { datasetHash } from '../governance';
import { loadLeagueDataset } from '../dataset';
import { KERNEL_BASELINE, KERNEL_GRID_VERSION } from '../recalibrate';
import type { RecalResult } from '../recalibrate';

// 全套件共用:内核重校准 stub(防任何用例意外触发真实坐标下降 —— 分钟级)
const stubRecalResult = (
  objective: 'ours' | 'blend' | 'score',
): RecalResult => ({
  objective,
  baseline: KERNEL_BASELINE,
  tuned: KERNEL_BASELINE,
  isGapBaseline: 0.02,
  isGapTuned: 0.015,
  valGapBaseline: 0.02,
  valGapTuned: 0.018,
  evals: 1,
  truncated: false,
});
const stubRecal = async (
  _ds: unknown,
  opts?: { objective?: 'ours' | 'blend' | 'score' },
): Promise<RecalResult> => stubRecalResult(opts?.objective ?? 'ours');
/** 测试后清理:store 无删除 API —— savedKernel 为空时写「毒 era」内核,令下次
 * 真实 run 判过期强刷,stub 假数不会滞留本地 .data(评审 CONFIRMED 的测试污染)。 */
const restoreKernel = (key: string, saved: ReturnType<typeof loadLeagueKernel>) => {
  if (saved) saveLeagueKernel(key, saved);
  else
    saveLeagueKernel(key, {
      ...freshKernel(key),
      dataHash: 'era-test-cleanup',
      gridVersion: 'stale-test-cleanup',
    });
};

/** 与当前数据集同 era、同网格版本的新鲜 kernel(令刷新守卫不触发)。 */
const freshKernel = (key: string) => {
  const ds = loadLeagueDataset(key);
  return {
    at: 0,
    dataHash: datasetHash(ds),
    matchCount: ds.allRes.length,
    gridVersion: KERNEL_GRID_VERSION,
    ours: stubRecalResult('ours'),
    blend: stubRecalResult('blend'),
    score: stubRecalResult('score'),
  };
};

describe('runLeagueOnce', () => {
  it('同日幂等:state.lastRunDay 命中 → skipped;force 绕过', async () => {
    // 前置:smoke/本套件其它用例已让 sc0 有 state;此处用固定 now 构造同日场景
    const st = loadEvolutionState('sc0');
    if (!st?.lastRunDay) {
      // 首次:跑一次立日戳(1 代,快;注入 stub 防真实内核重校准)
      await runLeagueOnce('sc0', true, {
        now: Date.parse('2026-07-03T00:00:00Z'),
        llmPropose: async () => null,
        maxGenerations: 1,
        recalibrate: stubRecal as never,
      });
    }
    const day = loadEvolutionState('sc0')!.lastRunDay!;
    const now = Date.parse(`${day}T10:00:00Z`);
    // 内核过期会合法绕过同日幂等(gridVersion 强刷路径)→ 先钉住同 era 同网格 kernel
    const savedK = loadLeagueKernel('sc0');
    saveLeagueKernel('sc0', freshKernel('sc0'));
    try {
      const r = await runLeagueOnce('sc0', false, {
        now,
        llmPropose: async () => null,
        maxGenerations: 1,
      });
      expect(r.skipped).toBe('already-ran-today');
      expect(r.newEpochs).toBe(0);
    } finally {
      restoreKernel('sc0', savedK);
    }
  }, 300000);

  it('未知联赛 → 抛错', async () => {
    await expect(runLeagueOnce('nope', true)).rejects.toThrow('未知联赛');
  });
});

describe('P0 止血:exhausted/frozen 联赛 era 未变整体跳过', () => {
  const KEY = 'sc0';
  const saved = loadEvolutionState(KEY);
  const savedKernel = loadLeagueKernel(KEY);
  const savedSb = loadResearchScoreboard(KEY);
  beforeAll(() => {
    // 预置同 era 新鲜 kernel:令轴C 刷新守卫不触发,本块专测 P0 跳过语义
    saveLeagueKernel(KEY, freshKernel(KEY));
  });
  afterAll(() => {
    if (saved) saveEvolutionState(KEY, saved);
    restoreKernel(KEY, savedKernel);
    if (savedSb) saveResearchScoreboard(KEY, savedSb);
  });

  it('exhausted + dataHash 未变 → skipped:exhausted-era-unchanged(不重建成绩单/不调分析员)', async () => {
    const dataset = loadLeagueDataset(KEY);
    const st = loadEvolutionState(KEY);
    expect(st).toBeTruthy(); // 前置:本套件其它用例已让 sc0 有 state
    saveEvolutionState(KEY, {
      ...st!,
      status: 'exhausted',
      dataHash: datasetHash(dataset),
      matchCount: dataset.allRes.length,
    });
    const r = await runLeagueOnce(KEY, false, {
      now: Date.parse('2026-08-01T00:00:00Z'),
      llmPropose: async () => null,
      maxGenerations: 1,
      recalibrate: stubRecal as never,
    });
    expect(r.skipped).toBe('exhausted-era-unchanged');
    expect(r.newEpochs).toBe(0);
    expect(r.status).toBe('exhausted');
  }, 120000);

  it('force=1 绕过跳过守卫(evolve 自身短路,状态仍 exhausted)', async () => {
    const dataset = loadLeagueDataset(KEY);
    const st = loadEvolutionState(KEY)!;
    saveEvolutionState(KEY, {
      ...st,
      status: 'exhausted',
      dataHash: datasetHash(dataset),
      matchCount: dataset.allRes.length,
    });
    const r = await runLeagueOnce(KEY, true, {
      now: Date.parse('2026-08-02T00:00:00Z'),
      llmPropose: async () => null,
      recalibrate: stubRecal as never,
      maxGenerations: 1,
    });
    expect(r.skipped).toBeUndefined();
    expect(r.status).toBe('exhausted');
  }, 300000);

  it('dataHash 变化 → 不跳过,交给 evolve 复活协议(未达实质阈值保持 exhausted)', async () => {
    const dataset = loadLeagueDataset(KEY);
    const st = loadEvolutionState(KEY)!;
    saveEvolutionState(KEY, {
      ...st,
      status: 'exhausted',
      dataHash: 'era-deadbeef',
      matchCount: dataset.allRes.length, // grew=0 → 未达复活阈值
    });
    const r = await runLeagueOnce(KEY, false, {
      now: Date.parse('2026-08-03T00:00:00Z'),
      llmPropose: async () => null,
      maxGenerations: 1,
    });
    expect(r.skipped).toBeUndefined();
    expect(r.status).toBe('exhausted');
  }, 300000);
});

describe('轴C:内核重校准的 era 门控刷新', () => {
  const KEY = 'sc0';
  const savedState = loadEvolutionState(KEY);
  const savedKernel = loadLeagueKernel(KEY);
  const savedSb = loadResearchScoreboard(KEY);
  afterAll(() => {
    if (savedState) saveEvolutionState(KEY, savedState);
    restoreKernel(KEY, savedKernel);
    if (savedSb) saveResearchScoreboard(KEY, savedSb);
  });

  const countingRecal =
    (calls: { n: number }) =>
    async (
      _ds: unknown,
      opts?: { objective?: 'ours' | 'blend' | 'score' },
    ): Promise<RecalResult> => {
      calls.n += 1;
      return {
        objective: opts?.objective ?? 'ours',
        baseline: KERNEL_BASELINE,
        tuned: KERNEL_BASELINE,
        isGapBaseline: 0.02,
        isGapTuned: 0.015,
        valGapBaseline: 0.02,
        valGapTuned: 0.018,
        evals: 1,
        truncated: false,
      };
    };

  it('kernel 缺失 → 刷新(双目标各一次)+ 落盘;exhausted 跳过路径也重建带轴C 的成绩单', async () => {
    const dataset = loadLeagueDataset(KEY);
    const st = loadEvolutionState(KEY)!;
    saveEvolutionState(KEY, {
      ...st,
      status: 'exhausted',
      dataHash: datasetHash(dataset),
      matchCount: dataset.allRes.length,
    });
    // 制造 kernel 缺失:写一个 era 不同且 matchCount 相同的旧 kernel 无法模拟"缺失",
    // 但 loadLeagueKernel 无删除 API → 用 dataHash 不同 + 增长≥30 的旧 kernel 触发刷新
    saveLeagueKernel(KEY, {
      at: 0,
      dataHash: 'era-old',
      matchCount: dataset.allRes.length - 100,
      ours: null as unknown as RecalResult,
      blend: null as unknown as RecalResult,
    });
    const calls = { n: 0 };
    const r = await runLeagueOnce(KEY, false, {
      now: Date.parse('2026-08-10T00:00:00Z'),
      llmPropose: async () => null,
      maxGenerations: 1,
      recalibrate: countingRecal(calls) as never,
    });
    expect(calls.n).toBe(3); // ours + blend + score 各一次
    expect(r.skipped).toBe('exhausted-era-unchanged+kernel-refreshed');
    const k = loadLeagueKernel(KEY);
    expect(k?.dataHash).toBe(datasetHash(dataset));
    expect(k?.blend.objective).toBe('blend');
    // 成绩单在跳过路径下也带上了轴C 块
    const sb = loadResearchScoreboard(KEY);
    expect(sb?.axisC).toBeTruthy();
  }, 300000);

  it('scoreOnly 补齐分支已删(被内容哈希版本机制取代):缺 score 的存量 kernel 必然版本过期 → 全量重刷 3 次', async () => {
    const dataset = loadLeagueDataset(KEY);
    const st = loadEvolutionState(KEY)!;
    saveEvolutionState(KEY, {
      ...st,
      status: 'exhausted',
      dataHash: datasetHash(dataset),
      matchCount: dataset.allRes.length,
    });
    // 真实世界里缺 score 的 kernel 只可能产自 v2 之前 → 必缺/错 gridVersion
    const { score: _drop, ...noScore } = freshKernel(KEY);
    saveLeagueKernel(KEY, { ...noScore, gridVersion: 1 } as never);
    const calls = { n: 0 };
    const r = await runLeagueOnce(KEY, false, {
      now: Date.parse('2026-08-12T00:00:00Z'),
      llmPropose: async () => null,
      maxGenerations: 1,
      recalibrate: countingRecal(calls) as never,
    });
    expect(calls.n).toBe(3); // 全量:ours + blend + score
    expect(r.skipped).toBe('exhausted-era-unchanged+kernel-refreshed');
    expect(loadLeagueKernel(KEY)?.score?.objective).toBe('score');
  }, 300000);

  it('kernel 同 era → 不刷新(零调用),跳过原因不带 kernel-refreshed', async () => {
    const dataset = loadLeagueDataset(KEY);
    const calls = { n: 0 };
    const r = await runLeagueOnce(KEY, false, {
      now: Date.parse('2026-08-11T00:00:00Z'),
      llmPropose: async () => null,
      maxGenerations: 1,
      recalibrate: countingRecal(calls) as never,
    });
    expect(calls.n).toBe(0);
    expect(r.skipped).toBe('exhausted-era-unchanged');
    expect(loadLeagueKernel(KEY)?.dataHash).toBe(datasetHash(dataset));
  }, 300000);
});

describe('P0b 进化暂停 + 网格版本强刷(2026-07-09 复盘)', () => {
  const KEY = 'sc0';
  const savedState = loadEvolutionState(KEY);
  const savedKernel = loadLeagueKernel(KEY);
  const savedSb = loadResearchScoreboard(KEY);
  afterAll(() => {
    if (savedState) saveEvolutionState(KEY, savedState);
    restoreKernel(KEY, savedKernel);
    if (savedSb) saveResearchScoreboard(KEY, savedSb);
  });

  it('evolvePaused + era 未变 + 非 exhausted 状态 → 整体跳过(evolve-paused 标记)', async () => {
    const dataset = loadLeagueDataset(KEY);
    const st = loadEvolutionState(KEY)!;
    saveEvolutionState(KEY, {
      ...st,
      status: 'exploring',
      dataHash: datasetHash(dataset),
      matchCount: dataset.allRes.length,
      lastRunDay: '2020-01-01', // 避开同日幂等
    });
    saveLeagueKernel(KEY, freshKernel(KEY));
    const r = await runLeagueOnce(KEY, false, {
      now: Date.parse('2026-08-20T00:00:00Z'),
      llmPropose: async () => null,
      recalibrate: stubRecal as never,
      evolvePaused: true,
    });
    expect(r.skipped).toBe('evolve-paused-era-unchanged');
    expect(r.newEpochs).toBe(0);
  }, 120000);

  it('gridVersion 过期(同 era)→ 全量重校准 + 落盘带新版本', async () => {
    const dataset = loadLeagueDataset(KEY);
    const st = loadEvolutionState(KEY)!;
    saveEvolutionState(KEY, {
      ...st,
      status: 'exhausted',
      dataHash: datasetHash(dataset),
      matchCount: dataset.allRes.length,
      lastRunDay: '2020-01-01',
    });
    const stale = { ...freshKernel(KEY), gridVersion: 1 }; // 同 era,旧网格
    saveLeagueKernel(KEY, stale);
    const calls = { n: 0 };
    const countingRecal = async (
      _ds: unknown,
      opts?: { objective?: 'ours' | 'blend' | 'score' },
    ): Promise<RecalResult> => {
      calls.n += 1;
      return stubRecalResult(opts?.objective ?? 'ours');
    };
    const r = await runLeagueOnce(KEY, false, {
      now: Date.parse('2026-08-21T00:00:00Z'),
      llmPropose: async () => null,
      recalibrate: countingRecal as never,
      evolvePaused: true,
    });
    expect(calls.n).toBe(3); // 网格升级 → ours/blend/score 全量重跑
    expect(r.skipped).toBe('exhausted-era-unchanged+kernel-refreshed');
    expect(loadLeagueKernel(KEY)?.gridVersion).toBe(KERNEL_GRID_VERSION);
  }, 120000);

  it('evolvePaused=false + era 未变 + exploring → 不跳过(走进化编排)', async () => {
    const dataset = loadLeagueDataset(KEY);
    const st = loadEvolutionState(KEY)!;
    saveEvolutionState(KEY, {
      ...st,
      status: 'exploring',
      dataHash: datasetHash(dataset),
      matchCount: dataset.allRes.length,
      lastRunDay: '2020-01-01',
      // 防触发重 gauntlet(promoteCandidate 全量跑)拖慢单测
      lastGauntletHash: st.incumbent?.configHash,
    });
    saveLeagueKernel(KEY, freshKernel(KEY));
    const r = await runLeagueOnce(KEY, false, {
      now: Date.parse('2026-08-22T00:00:00Z'),
      llmPropose: async () => null,
      recalibrate: stubRecal as never,
      evolvePaused: false,
      maxGenerations: 0, // 只验守卫放行,不真跑代
    });
    expect(r.skipped).toBeUndefined();
  }, 300000);
});

describe('enqueueResearch(队列)', () => {
  it('入队去重 + 后台消费记录错误结果', async () => {
    const s1 = enqueueResearch([
      { league: 'nope' as string, force: false },
      { league: 'nope' as string, force: true }, // 重复 → 合并
    ]);
    expect(s1.queued.length + (s1.running ? 1 : 0)).toBeLessThanOrEqual(1);
    // 等后台 drain 消费(未知联赛立即失败)
    await new Promise((r) => setTimeout(r, 200));
    const s2 = runnerStatus();
    expect(s2.lastResults['nope']?.status).toBe('error');
    expect(s2.lastResults['nope']?.error).toContain('未知联赛');
    expect(s2.running).toBeNull();
  });
});
