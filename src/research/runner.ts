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
import { runEvolutionCycle, toStrategyParams } from './evolve';
import { datasetHash } from './governance';
import { recalibrateKernel, KERNEL_GRID_VERSION } from './recalibrate';
import type { KernelStore } from './recalibrate';
import {
  loadLeagueKernel,
  saveLeagueKernel,
  loadResearchPooled,
  saveResearchPooled,
} from 'lib/db/store';
import { buildScoreboard } from './scoreboard';
import { buildAnalystBrief, analyzeResearch, proposeConfigs } from './analyst';
import { buildPooledReport } from './pooled';
import { loadLeagueDataset } from './dataset';
import { leagueOf, LEAGUES } from './leagues';
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
  kernelRefreshed?: boolean; // 结构化标志(勿从 skipped 展示文案反解)
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
  let didWork = false; // 本轮有联赛真跑过(含内核网格升级首刷)→ 队列排空后刷池化
  for (;;) {
    const item = r.queue.shift();
    if (item) {
      r.running = item.league;
      r.startedAt = Date.now();
      try {
        const summary = await runLeagueOnce(item.league, item.force);
        r.lastResults[item.league] = summary;
        if (!summary.skipped || summary.kernelRefreshed) didWork = true;
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
      continue;
    }
    if (!didWork) break;
    // 跨联赛池化功效检验(分钟级):必须占住 running 哨兵 —— 否则此窗口里
    // enqueueResearch 会看到「空闲」再起第二个并发 drain,打破「单队列顺序消费、
    // 天然无并发写」的单例不变量(代码评审 CONFIRMED 的并发缺陷)。
    // 不做"缺失即建":纯错误/幂等轮次不该拖起 9 联赛引擎跑(首刷由 gridVersion 触发)。
    r.running = '__pooled__';
    r.startedAt = Date.now();
    didWork = false;
    try {
      await refreshPooled();
    } catch (e) {
      console.error('[research-runner] 池化检验刷新失败(不阻断)', e);
    }
    r.running = null;
    r.startedAt = null;
    // 池化期间新入队的联赛由本循环继续消费(彼时 running 非空,不会有新 drain 接手)
    if (!r.queue.length) break;
  }
}

/** 家族级池化 CLV 功效检验(P2b):9 联赛 val 注合并,给 research 面板与闸门参考。 */
async function refreshPooled(): Promise<void> {
  const report = await buildPooledReport({
    leagues: LEAGUES.map((l) => l.key),
    loadDataset: loadLeagueDataset,
    loadManifest: loadHoldoutManifest,
    loadIncumbentParams: (key) => {
      const es = loadEvolutionState(key);
      return es?.incumbent ? toStrategyParams(es.incumbent.evo) : null;
    },
    at: Date.now(),
    prev: loadResearchPooled(), // 逐联赛缓存:era/配置未变的联赛零重算
  });
  saveResearchPooled(report);
}

/** 测试注入口(数据/时钟/LLM/代数可换)。 */
export interface RunDeps {
  loadDataset?: (key: string) => EngineDataset;
  now?: number;
  llmPropose?: (brief: string) => Promise<string | null>;
  maxGenerations?: number;
  recalibrate?: typeof recalibrateKernel; // 轴C 内核重校准(测试注入)
  evolvePaused?: boolean; // 进化线暂停开关(测试注入;缺省读 RESEARCH_EVOLVE env)
}

/**
 * 进化线暂停(2026-07-09 复盘 P0b,默认暂停):9/9 联赛已 exhausted 且参数面证平
 * (isGap 代际全距 ≤2×选优容差、marginals 单点垄断、三筛零通过)—— 继续搜索只产噪声,
 * era 复活后的自动重跑同样停(新数据不会改变平坦的目标面)。保留:内核重校准(score
 * 线,唯一 val 可外推)、成绩单、前向积累、数据摄取。显式重开:env RESEARCH_EVOLVE=1。
 */
const evolvePausedByEnv = () => process.env.RESEARCH_EVOLVE !== '1';

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
  // 内核缺失或网格版本过期(内容哈希派生)→ 不受同日幂等约束:部署当天 cron 已跑过
  // 也要立即强刷。评审修正:此前靠部署 curl 带 force=1 达成,但那会让每次日常部署
  // 都全量重跑 —— 把过期检查放进幂等守卫才是正确深度。
  let kernel = loadLeagueKernel(league);
  const kernelStale =
    !kernel || (kernel.gridVersion ?? 1) !== KERNEL_GRID_VERSION;
  if (!force && !kernelStale && prevState?.lastRunDay === today)
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
  const dsHash = datasetHash(dataset); // 全量排序+规范化哈希,单次计算全程复用

  // 轴C:内核重校准 —— kernel 缺失、网格版本过期、或数据 era 实质变化才跑
  // (确定性,同 era 同网格重跑零信息)。旧的「同 era 只补 score」分支已被
  // 内容哈希版本机制取代:缺 score 的存量 kernel 必然版本过期 → 走全量刷新。
  // 必须在 P0 跳过守卫之前:exhausted 联赛首次部署也要补齐 kernel。失败不阻断。
  let kernelRefreshed = false;
  try {
    const grew = dataset.allRes.length - (kernel?.matchCount ?? 0);
    const eraChanged =
      kernelStale ||
      (kernel!.dataHash !== dsHash &&
        (grew >= KERNEL_REFRESH_MIN_MATCHES ||
          grew / Math.max(1, kernel!.matchCount) >= 0.03));
    if (eraChanged) {
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
      const score = await recal(dataset, {
        objective: 'score',
        manifest: mf,
        wallClockMs: KERNEL_WALL_MS,
      });
      const next: KernelStore = {
        at: now,
        dataHash: dsHash,
        matchCount: dataset.allRes.length,
        gridVersion: KERNEL_GRID_VERSION,
        ours,
        blend,
        score,
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
  // 进化暂停时(P0b)任何状态在 era 未变都跳过:数据没变,前向/成绩单/内核全无新信息。
  // 新联赛豁免暂停(prevState 为空 = 从未搜索过):播种新联赛是显式人为动作,
  // 首个 campaign 照常自举;暂停针对的是「已证平坦的存量联赛 + era 复活重跑」。
  const evolvePaused =
    (deps?.evolvePaused ?? evolvePausedByEnv()) && prevState != null;
  if (
    !force &&
    prevState &&
    (prevState.status === 'exhausted' ||
      prevState.status === 'frozen' ||
      evolvePaused) &&
    prevState.dataHash === dsHash
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
    const skipBase =
      prevState.status === 'exhausted' || prevState.status === 'frozen'
        ? 'exhausted-era-unchanged'
        : 'evolve-paused-era-unchanged';
    return {
      league,
      at: now,
      status: prevState.status,
      generation: prevState.generation,
      newEpochs: 0,
      note: '',
      skipped: kernelRefreshed ? `${skipBase}+kernel-refreshed` : skipBase,
      kernelRefreshed,
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
      // 进化暂停:maxGenerations=0 —— 不产生任何新代/新试验,但保留 era 复活时的
      // incumbent 重评、前向积累(updateForwardLog)与状态推进(全在 cycle 内部)
      maxGenerations:
        deps?.maxGenerations ?? (evolvePaused ? 0 : MAX_GENS_PER_DAY),
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
  // 分析员(失败不阻断)。触发条件 = 有新代 或 数据 era 推进:同一输入只会产出
  // 重复报告(省 LLM 配额);暂停下 newEpochs 恒 0,若只看新代会把分析员永久关停,
  // 新赛季数据到达时成绩单已更新而报告钉死在旧 epoch —— 评审 CONFIRMED 的缺陷。
  const eraAdvanced = !prevState || prevState.dataHash !== dsHash;
  if (result.newEpochs.length > 0 || eraAdvanced) {
    try {
      const brief = buildAnalystBrief(newTimeline, ledger, def.nameZh);
      const report = await analyzeResearch(brief);
      if (report) saveResearchAnalysis(league, report);
    } catch {
      /* ignore */
    }
  }

  return {
    league,
    at: now,
    status: result.state.status,
    generation: result.state.generation,
    newEpochs: result.newEpochs.length,
    note: evolvePaused ? `evolve-paused;${result.note}` : result.note,
    kernelRefreshed,
  };
}
