/**
 * Phase 10 · 后台研究 Runner(进程内常驻单例,globalThis 钉住 —— 同 livePoller 模式)。
 *
 * 动机:进化跑在 HTTP handler 里受墙钟约束,多联赛只能分蛋糕。Runner 把执行从 HTTP 生命
 * 周期解出来:cron/API 只是"敲门"(enqueue 立即返回),真正执行在后台队列逐联赛跑——
 * **每联赛独立全额预算(每日代数上限 MAX_GENS_PER_DAY),加联赛不减代数**。
 * 互斥:单队列顺序消费,天然无并发写;per-league 同日幂等(state.lastRunDay,force 绕过)。
 * 崩溃安全:每联赛跑完立刻按固定写序持久化;进程重启丢的只是未开始的队列项(次日 cron 补)。
 */
import {
  loadResearchTimeline,
  saveResearchTimeline,
  loadTrialRegistry,
  saveTrialRegistry,
  loadHoldoutManifest,
  saveHoldoutManifest,
  loadPromotionLedger,
  savePromotionLedger,
  loadEvolutionState,
  saveEvolutionState,
  appendEvolutionLog,
  loadForwardStore,
  saveForwardStore,
  saveResearchScoreboard,
  saveResearchAnalysis,
} from 'lib/db/store';
import { runEvolutionCycle } from './evolve';
import { datasetHash } from './governance';
import { recalibrateKernel } from './recalibrate';
import type { KernelStore } from './recalibrate';
import { loadLeagueKernel, saveLeagueKernel } from 'lib/db/store';
import { buildScoreboard } from './scoreboard';
import { buildAnalystBrief, analyzeResearch, proposeConfigs } from './analyst';
import { loadLeagueDataset } from './dataset';
import { leagueOf } from './leagues';
import type { EngineDataset } from './engine';

export const MAX_GENS_PER_DAY = 8; // 每联赛每日代数上限(≈原 EPL 独占额度)
const MAX_TIMELINE = 40;
const LEAGUE_WALL_MS = 15 * 60_000; // 每联赛后台安全墙钟(防意外死循环,非预算)

export interface QueueItem {
  league: string;
  force: boolean;
}
export interface LeagueRunSummary {
  league: string;
  at: number;
  status: string;
  generation: number;
  newEpochs: number;
  note: string;
  skipped?: string;
  error?: string;
}
interface RunnerState {
  running: string | null; // 正在跑的联赛 key
  queue: QueueItem[];
  lastResults: Record<string, LeagueRunSummary>;
  startedAt: number | null;
}
const G = globalThis as { __wcResearchRunner?: RunnerState };
function st(): RunnerState {
  return (G.__wcResearchRunner ??= {
    running: null,
    queue: [],
    lastResults: {},
    startedAt: null,
  });
}

export function runnerStatus() {
  const r = st();
  return {
    running: r.running,
    queued: r.queue.map((q) => q.league),
    startedAt: r.startedAt,
    lastResults: r.lastResults,
  };
}

/** 入队(去重:已在跑/已排队的联赛跳过);空闲则立即开始后台消费。 */
export function enqueueResearch(
  items: QueueItem[],
): ReturnType<typeof runnerStatus> {
  const r = st();
  for (const it of items) {
    if (r.running === it.league) continue;
    const ex = r.queue.find((q) => q.league === it.league);
    if (ex) {
      ex.force = ex.force || it.force;
      continue;
    }
    r.queue.push(it);
  }
  if (!r.running && r.queue.length) void drain();
  return runnerStatus();
}

async function drain(): Promise<void> {
  const r = st();
  let item = r.queue.shift();
  while (item) {
    r.running = item.league;
    r.startedAt = Date.now();
    try {
      r.lastResults[item.league] = await runLeagueOnce(item.league, item.force);
    } catch (e) {
      r.lastResults[item.league] = {
        league: item.league,
        at: Date.now(),
        status: 'error',
        generation: 0,
        newEpochs: 0,
        note: '',
        error: e instanceof Error ? e.message : String(e),
      };
      console.error('[research-runner]', item.league, e);
    }
    r.running = null;
    r.startedAt = null;
    // 联赛间喘息:给站点请求/其它后台任务留窗口
    await new Promise((res) => setTimeout(res, 3000));
    item = r.queue.shift();
  }
}

/** 测试注入口(数据/时钟/LLM/代数可换)。 */
export interface RunDeps {
  loadDataset?: (key: string) => EngineDataset;
  now?: number;
  llmPropose?: (brief: string) => Promise<string | null>;
  maxGenerations?: number;
  recalibrate?: typeof recalibrateKernel; // 轴C 内核重校准(测试注入)
}

/** 轴C 内核刷新阈值(与 evolve 复活协议同一"实质变化"口径)。 */
const KERNEL_REFRESH_MIN_MATCHES = 30;
/** 轴C 内核重校准每目标墙钟(与 LEAGUE_WALL_MS 同为护栏;截断点仍是合法 IS 局部最优)。 */
const KERNEL_WALL_MS = 8 * 60_000;

/** 跑一个联赛的一次完整 run(进化 → 固定写序持久化 → 成绩单 → 分析员)。 */
export async function runLeagueOnce(
  league: string,
  force: boolean,
  deps?: RunDeps,
): Promise<LeagueRunSummary> {
  const def = leagueOf(league);
  if (!def) throw new Error(`未知联赛 ${league}`);
  const now = deps?.now ?? Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const prevState = loadEvolutionState(league);
  if (!force && prevState?.lastRunDay === today)
    return {
      league,
      at: now,
      status: prevState.status,
      generation: prevState.generation,
      newEpochs: 0,
      note: '',
      skipped: 'already-ran-today',
    };
  const dataset = (deps?.loadDataset ?? loadLeagueDataset)(league);
  if (!dataset.allRes.length || !Object.keys(dataset.odds).length)
    throw new Error(`联赛 ${league} 数据缺失(未播种/未摄取)`);

  // 轴C:内核重校准 —— kernel 缺失或数据 era 实质变化才跑(确定性,同 era 重跑零信息)。
  // 必须在 P0 跳过守卫之前:exhausted 联赛首次部署也要补齐 kernel。失败不阻断。
  let kernel = loadLeagueKernel(league);
  let kernelRefreshed = false;
  try {
    const kHash = datasetHash(dataset);
    const grew = dataset.allRes.length - (kernel?.matchCount ?? 0);
    const substantial =
      !kernel ||
      (kernel.dataHash !== kHash &&
        (grew >= KERNEL_REFRESH_MIN_MATCHES ||
          grew / Math.max(1, kernel.matchCount) >= 0.03));
    if (substantial) {
      const recal = deps?.recalibrate ?? recalibrateKernel;
      // 锁定 holdout 必传(防 L3 漂移);首个 run 无 manifest 时自派生,evolve 随即首建持久化
      const mf = loadHoldoutManifest(league);
      const ours = await recal(dataset, {
        objective: 'ours',
        manifest: mf,
        wallClockMs: KERNEL_WALL_MS,
      });
      const blend = await recal(dataset, {
        objective: 'blend',
        manifest: mf,
        wallClockMs: KERNEL_WALL_MS,
      });
      const next: KernelStore = {
        at: now,
        dataHash: kHash,
        matchCount: dataset.allRes.length,
        ours,
        blend,
      };
      saveLeagueKernel(league, next);
      kernel = next;
      kernelRefreshed = true;
    }
  } catch (e) {
    console.error('[research-runner] 轴C 内核重校准失败(不阻断)', league, e);
  }

  // P0 止血:软/硬停联赛在数据 era 未变时整体跳过 —— 进化(evolve 自身会短路)之外,
  // 成绩单重建(全量引擎跑)与 LLM 分析员在同一数据上只会产出逐字节相同的结果,纯烧配额。
  // 数据实质到达 → dataHash 必变 → 正常进入 evolve 复活协议,前向积累不受影响;force 仍可绕过。
  if (
    !force &&
    prevState &&
    (prevState.status === 'exhausted' || prevState.status === 'frozen') &&
    prevState.dataHash === datasetHash(dataset)
  ) {
    // 本次刚补齐 kernel → 顺手重建一次成绩单(带轴C 块),否则面板见不到轴C
    if (kernelRefreshed) {
      try {
        const mf = loadHoldoutManifest(league);
        if (mf) {
          const ledger = loadPromotionLedger(league);
          const sb = await buildScoreboard(
            dataset,
            prevState,
            mf,
            loadForwardStore(league),
            ledger[ledger.length - 1] ?? null,
            kernel,
          );
          saveResearchScoreboard(league, sb);
        }
      } catch {
        /* ignore */
      }
    }
    return {
      league,
      at: now,
      status: prevState.status,
      generation: prevState.generation,
      newEpochs: 0,
      note: '',
      skipped: kernelRefreshed
        ? 'exhausted-era-unchanged+kernel-refreshed'
        : 'exhausted-era-unchanged',
    };
  }

  const timeline = loadResearchTimeline(league);
  const result = await runEvolutionCycle(
    {
      dataset,
      state: prevState,
      registry: loadTrialRegistry(league),
      timeline,
      manifest: loadHoldoutManifest(league),
      forward: loadForwardStore(league),
    },
    {
      now,
      llmPropose: deps?.llmPropose ?? proposeConfigs,
      wallClockBudgetMs: LEAGUE_WALL_MS,
      maxGenerations: deps?.maxGenerations ?? MAX_GENS_PER_DAY,
      leagueName: def.nameZh,
    },
  );

  // 固定写序:registry(宁多计 N)→ timeline → ledger → forward → log → state(最后)
  saveTrialRegistry(league, result.registry);
  const newTimeline = [...timeline, ...result.newEpochs].slice(-MAX_TIMELINE);
  saveResearchTimeline(league, newTimeline);
  let ledger = loadPromotionLedger(league);
  if (result.ledgerAppend.length)
    ledger = [...ledger, ...result.ledgerAppend].slice(-50);
  savePromotionLedger(league, ledger);
  saveForwardStore(league, result.forward);
  appendEvolutionLog(league, result.logs);
  saveHoldoutManifest(league, result.manifest);
  saveEvolutionState(league, { ...result.state, lastRunDay: today });

  // 成绩单(失败不阻断)
  try {
    const sb = await buildScoreboard(
      dataset,
      result.state,
      result.manifest,
      result.forward,
      ledger[ledger.length - 1] ?? null,
      kernel,
    );
    saveResearchScoreboard(league, sb);
  } catch {
    /* ignore */
  }
  // 分析员(失败不阻断)
  try {
    const brief = buildAnalystBrief(newTimeline, ledger, def.nameZh);
    const report = await analyzeResearch(brief);
    if (report) saveResearchAnalysis(league, report);
  } catch {
    /* ignore */
  }

  return {
    league,
    at: now,
    status: result.state.status,
    generation: result.state.generation,
    newEpochs: result.newEpochs.length,
    note: result.note,
  };
}
