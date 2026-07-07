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
} from 'lib/db/store';
import { datasetHash } from '../governance';
import { loadLeagueDataset } from '../dataset';
import { KERNEL_BASELINE } from '../recalibrate';
import type { RecalResult } from '../recalibrate';

// 全套件共用:内核重校准 stub(防任何用例意外触发真实坐标下降 —— 分钟级)
const stubRecalResult = (objective: 'ours' | 'blend'): RecalResult => ({
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
  opts?: { objective?: 'ours' | 'blend' },
): Promise<RecalResult> => stubRecalResult(opts?.objective ?? 'ours');
/** 与当前数据集同 era 的新鲜 kernel(令刷新守卫不触发)。 */
const freshKernel = (key: string) => {
  const ds = loadLeagueDataset(key);
  return {
    at: 0,
    dataHash: datasetHash(ds),
    matchCount: ds.allRes.length,
    ours: stubRecalResult('ours'),
    blend: stubRecalResult('blend'),
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
    const r = await runLeagueOnce('sc0', false, {
      now,
      llmPropose: async () => null,
      maxGenerations: 1,
    });
    expect(r.skipped).toBe('already-ran-today');
    expect(r.newEpochs).toBe(0);
  }, 300000);

  it('未知联赛 → 抛错', async () => {
    await expect(runLeagueOnce('nope', true)).rejects.toThrow('未知联赛');
  });
});

describe('P0 止血:exhausted/frozen 联赛 era 未变整体跳过', () => {
  const KEY = 'sc0';
  const saved = loadEvolutionState(KEY);
  const savedKernel = loadLeagueKernel(KEY);
  beforeAll(() => {
    // 预置同 era 新鲜 kernel:令轴C 刷新守卫不触发,本块专测 P0 跳过语义
    saveLeagueKernel(KEY, freshKernel(KEY));
  });
  afterAll(() => {
    if (saved) saveEvolutionState(KEY, saved);
    if (savedKernel) saveLeagueKernel(KEY, savedKernel);
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
  afterAll(() => {
    if (savedState) saveEvolutionState(KEY, savedState);
    if (savedKernel) saveLeagueKernel(KEY, savedKernel);
  });

  const countingRecal =
    (calls: { n: number }) =>
    async (
      _ds: unknown,
      opts?: { objective?: 'ours' | 'blend' },
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
    expect(calls.n).toBe(2); // ours + blend 各一次
    expect(r.skipped).toBe('exhausted-era-unchanged+kernel-refreshed');
    const k = loadLeagueKernel(KEY);
    expect(k?.dataHash).toBe(datasetHash(dataset));
    expect(k?.blend.objective).toBe('blend');
    // 成绩单在跳过路径下也带上了轴C 块
    const sb = loadResearchScoreboard(KEY);
    expect(sb?.axisC).toBeTruthy();
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
