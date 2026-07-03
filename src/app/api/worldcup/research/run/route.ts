/**
 * POST /api/worldcup/research/run —— 进化循环一次 run(管理员;x-admin-token)。
 * v2(经对抗评审):runEvolutionCycle 编排(三发生器/配对障碍/状态机/G6 预算),本路由只做
 * 鉴权、互斥、幂等、数据装载与【固定写序】持久化:registry(宁多计 N)→ timeline → ledger
 * → evolution-log → state(最后写)。cron 每日触发;exhausted/frozen 时近乎 no-op。
 * ?force=1 绕过同日幂等(手动补跑)。
 */
import { okLive, fail } from 'lib/api/respond';
import {
  loadResearchTimeline,
  saveResearchTimeline,
  loadTrialRegistry,
  saveTrialRegistry,
  loadHoldoutManifest,
  saveHoldoutManifest,
  loadPromotionLedger,
  savePromotionLedger,
  saveResearchAnalysis,
  loadEvolutionState,
  saveEvolutionState,
  appendEvolutionLog,
  loadForwardStore,
  saveForwardStore,
  saveResearchScoreboard,
} from 'lib/db/store';
import { runEvolutionCycle } from 'research/evolve';
import { buildScoreboard } from 'research/scoreboard';
import { loadLeagueDataset } from 'research/dataset';
import {
  buildAnalystBrief,
  analyzeResearch,
  proposeConfigs,
} from 'research/analyst';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel-only;自托管下真实预算由编排器墙钟护栏(200s)管理

const LEAGUE_KEY = 'epl-2025';
const MAX_TIMELINE = 40; // 烧完式 run 单次可产多代,放宽保留窗

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

// 进程内互斥(钉在 globalThis 防 dev 热重载双链):正在跑 → 409;单 PM2 实例足够
const G = globalThis as { __wcResearchRunning?: boolean };

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('研究重算未启用(缺 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  if (G.__wcResearchRunning) return fail('研究循环运行中,拒绝并发', 409);
  G.__wcResearchRunning = true;
  try {
    const dataset = loadLeagueDataset(LEAGUE_KEY);
    if (!dataset.allRes.length || !Object.keys(dataset.odds).length)
      return fail('联赛数据缺失(数据目录未播种且无 seed)', 500);

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const force = new URL(req.url).searchParams.get('force') === '1';
    const prevState = loadEvolutionState();
    // 同日幂等(cron 与部署预热是两个独立触发源;重复触发返回上次摘要)
    if (!force && prevState?.lastRunDay === today)
      return okLive({
        skipped: 'already-ran-today',
        status: prevState.status,
        generation: prevState.generation,
      });

    const timeline = loadResearchTimeline();
    const result = await runEvolutionCycle(
      {
        dataset,
        state: prevState,
        registry: loadTrialRegistry(),
        timeline,
        manifest: loadHoldoutManifest(),
        forward: loadForwardStore(),
      },
      { now, llmPropose: proposeConfigs },
    );

    // 固定写序:registry(最保守,宁可 N 多计)→ timeline → ledger → log → state(最后)
    saveTrialRegistry(result.registry);
    const newTimeline = [...timeline, ...result.newEpochs].slice(-MAX_TIMELINE);
    saveResearchTimeline(newTimeline);
    let ledger = loadPromotionLedger();
    if (result.ledgerAppend.length)
      ledger = [...ledger, ...result.ledgerAppend].slice(-50);
    savePromotionLedger(ledger);
    saveForwardStore(result.forward);
    appendEvolutionLog(result.logs);
    saveHoldoutManifest(result.manifest);
    saveEvolutionState({ ...result.state, lastRunDay: today });

    // 人话成绩单(观测台顶部;失败不阻断)
    try {
      const sb = await buildScoreboard(
        dataset,
        result.state,
        result.manifest,
        result.forward,
        ledger[ledger.length - 1] ?? null,
      );
      saveResearchScoreboard(sb);
    } catch {
      /* ignore */
    }

    // 分析员(面向人;失败不阻断)
    let analyzed = false;
    try {
      const brief = buildAnalystBrief(newTimeline, ledger);
      const report = await analyzeResearch(brief);
      if (report) {
        saveResearchAnalysis(report);
        analyzed = true;
      }
    } catch {
      /* ignore */
    }

    return okLive({
      status: result.state.status,
      generation: result.state.generation,
      newEpochs: result.newEpochs.length,
      budgetUsedEra: result.logs[result.logs.length - 1]?.budgetUsedEra ?? null,
      incumbent: result.state.incumbent
        ? {
            label: result.state.incumbent.label,
            clvT: result.state.incumbent.clvT,
            clvLcb: result.state.incumbent.clvLcb,
          }
        : null,
      holdoutTouches: result.state.holdoutTouches.length,
      note: result.note,
      analyzed,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '研究进化循环失败');
  } finally {
    G.__wcResearchRunning = false;
  }
}
