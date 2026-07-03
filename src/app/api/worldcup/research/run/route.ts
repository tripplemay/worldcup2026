/**
 * POST /api/worldcup/research/run —— 跑一轮多 epoch 研究搜索并落盘全部治理产物(管理员;x-admin-token)。
 * 编排:载入历史注册表(钉死累计 N,跨 run 持续增长)→ runSearchLoop(defaultGrids)→
 * 最优候选跑全 gauntlet promoteCandidate → saveResearchTimeline(追加,留最近 20 轮)+
 * saveTrialRegistry + savePromotionLedger + saveHoldoutManifest。
 * 数据优先经 store(部署已播种)读,空则回退 seed/ fs。cron 定时 hit 本接口即"持续运行"。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { okLive, fail } from 'lib/api/respond';
import {
  loadLeagueHistorical,
  loadLeagueResults,
  loadLeagueOddsX,
  loadResearchTimeline,
  saveResearchTimeline,
  loadTrialRegistry,
  saveTrialRegistry,
  loadHoldoutManifest,
  saveHoldoutManifest,
  loadPromotionLedger,
  savePromotionLedger,
  saveResearchAnalysis,
} from 'lib/db/store';
import { runSearchLoop, defaultGrids } from 'research/loop';
import { promoteCandidate } from 'research/promote';
import { buildAnalystBrief, analyzeResearch } from 'research/analyst';
import { sliceDates } from 'research/walkforward';
import { buildHoldoutManifest, configHash } from 'research/governance';
import type { EngineDataset, MatchOddsView } from 'research/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LEAGUE_KEY = 'epl-2025';
const MAX_TIMELINE = 20;
const MAX_LEDGER = 50;

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

/** 优先 store(已播种数据目录);为空则回退 seed/ via fs。 */
function loadDataset(): EngineDataset {
  let allHist = Object.values(loadLeagueHistorical(LEAGUE_KEY));
  let allRes = Object.values(loadLeagueResults(LEAGUE_KEY));
  let odds = loadLeagueOddsX(LEAGUE_KEY) as Record<string, MatchOddsView>;
  if (!allRes.length || !Object.keys(odds).length) {
    try {
      const seed = (n: string) =>
        JSON.parse(
          readFileSync(join(process.cwd(), 'seed/leagues', n), 'utf8'),
        );
      allHist = Object.values(seed(`league-${LEAGUE_KEY}-historical.json`));
      allRes = Object.values(seed(`league-${LEAGUE_KEY}-results.json`));
      odds = seed(`league-${LEAGUE_KEY}-oddsx.json`);
    } catch {
      /* seed 不可读 → 保持 store 结果 */
    }
  }
  return { allHist, allRes, odds };
}

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('研究重算未启用(缺 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  try {
    const dataset = loadDataset();
    if (!dataset.allRes.length || !Object.keys(dataset.odds).length)
      return fail('联赛数据缺失(数据目录未播种且无 seed)', 500);

    const now = Date.now();
    const prior = loadResearchTimeline();
    const startEpoch = (prior[prior.length - 1]?.epoch ?? 0) + 1;

    // 多 epoch 循环:注册表跨 run 累积(钉死分母)
    const loop = runSearchLoop(dataset, defaultGrids(), {
      registry: loadTrialRegistry(),
      startEpoch,
      at: now,
    });

    // 时间线追加(留最近 MAX_TIMELINE 轮)+ 注册表落盘
    const timeline = [...prior, ...loop.epochs].slice(-MAX_TIMELINE);
    saveResearchTimeline(timeline);
    saveTrialRegistry(loop.registry);

    // holdout manifest(首次锁定,之后复用记录)
    const manifest =
      loadHoldoutManifest() ??
      buildHoldoutManifest(dataset, sliceDates(dataset).holdoutFrom, now);
    saveHoldoutManifest(manifest);

    // 最优候选跑全 gauntlet → 追加晋级台账
    let promoted: { label: string; blockedAt: string | null } | null = null;
    if (loop.best) {
      const pr = promoteCandidate(
        dataset,
        loop.best.params,
        { epoch: loop.best.epoch, dsr: loop.best.dsr, pbo: loop.best.pbo },
        { holdoutFrom: manifest.holdoutFrom },
      );
      const ledger = loadPromotionLedger();
      ledger.push({
        at: now,
        epoch: loop.best.epoch,
        configHash: configHash(loop.best.params),
        label: loop.best.label,
        evidence: pr.evidence,
        verdict: pr.verdict,
      });
      savePromotionLedger(ledger.slice(-MAX_LEDGER));
      promoted = { label: loop.best.label, blockedAt: pr.verdict.blockedAt };
    }

    // LLM 分析员(可选;读结果写诊断提假设;失败/未配 key 不影响搜索产物)
    let analyzed = false;
    try {
      const brief = buildAnalystBrief(timeline, loadPromotionLedger());
      const report = await analyzeResearch(brief);
      if (report) {
        saveResearchAnalysis(report);
        analyzed = true;
      }
    } catch {
      /* LLM 失败忽略 */
    }

    return okLive({
      analyzed,
      newEpochs: loop.epochs.length,
      totalEpochs: timeline.length,
      cumulativeTrials: loop.registry.trials.length,
      best: promoted,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '研究重算失败');
  }
}
