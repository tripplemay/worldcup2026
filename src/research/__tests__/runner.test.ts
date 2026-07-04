/**
 * 后台 Runner 单测:同日幂等 / force 绕过 / 未知联赛报错 / 队列去重与后台消费
 * / P0 止血(exhausted 联赛 era 未变整体跳过)。
 * 重活(真进化)已由 smoke 覆盖;此处用 sc0 最小代数 + 未知联赛走轻路径。
 */
import { runLeagueOnce, enqueueResearch, runnerStatus } from '../runner';
import { loadEvolutionState, saveEvolutionState } from 'lib/db/store';
import { datasetHash } from '../governance';
import { loadLeagueDataset } from '../dataset';

describe('runLeagueOnce', () => {
  it('同日幂等:state.lastRunDay 命中 → skipped;force 绕过', async () => {
    // 前置:smoke/本套件其它用例已让 sc0 有 state;此处用固定 now 构造同日场景
    const st = loadEvolutionState('sc0');
    if (!st?.lastRunDay) {
      // 首次:跑一次立日戳(1 代,快)
      await runLeagueOnce('sc0', true, {
        now: Date.parse('2026-07-03T00:00:00Z'),
        llmPropose: async () => null,
        maxGenerations: 1,
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
  afterAll(() => {
    if (saved) saveEvolutionState(KEY, saved);
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
