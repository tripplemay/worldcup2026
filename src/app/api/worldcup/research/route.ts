/**
 * GET /api/worldcup/research —— 读取研究调参时间线(EpochResult[],缓存结果,no-store)。
 * 计算由 research/run(管理 POST)或后续常驻 daemon 完成,本接口只读。
 */
import { okLive, fail } from 'lib/api/respond';
import {
  loadResearchTimeline,
  loadResearchAnalysis,
  loadEvolutionState,
  loadTrialRegistry,
  loadEvolutionLog,
  loadPromotionLedger,
  loadForwardStore,
  loadResearchScoreboard,
  saveResearchScoreboard,
  loadHoldoutManifest,
  loadEvolutionState as loadEvoState2,
} from 'lib/db/store';
import { buildScoreboard } from 'research/scoreboard';
import { loadLeagueDataset } from 'research/dataset';
import { PARAM_KEYS, extractEvo } from 'research/evolve';
import { forwardSummary } from 'research/forward';
import { LEAGUES, safeLeagueKey } from 'research/leagues';
import { runnerStatus } from 'research/runner';
import type { StrategyParams } from 'research/engine';

export const dynamic = 'force-dynamic';

/** 参数边际响应:每参 已试档数 + oosSharpe 最优档(取当前 era 有指标的去重试验)。 */
function marginals(league: string, dataHash?: string) {
  const reg = loadTrialRegistry(league);
  const byHash = new Map<string, { evo: ReturnType<typeof extractEvo>; sharpe: number }>();
  for (const t of reg.trials) {
    if (dataHash && t.dataHash !== dataHash) continue;
    if (t.oosSharpe == null) continue;
    try {
      byHash.set(t.configHash, {
        evo: extractEvo(t.params as StrategyParams),
        sharpe: t.oosSharpe,
      });
    } catch {
      /* 旧 shape 忽略 */
    }
  }
  const rows = [...byHash.values()];
  return PARAM_KEYS.map((k) => {
    const vals = new Map<number, { n: number; best: number }>();
    for (const r of rows) {
      const v = r.evo[k];
      const cur = vals.get(v) ?? { n: 0, best: -Infinity };
      vals.set(v, { n: cur.n + 1, best: Math.max(cur.best, r.sharpe) });
    }
    let bestV: number | null = null;
    let bestS = -Infinity;
    for (const [v, x] of vals)
      if (x.best > bestS) {
        bestS = x.best;
        bestV = v;
      }
    return {
      param: k,
      distinct: vals.size,
      bestValue: bestV,
      bestSharpe: Number.isFinite(bestS) ? +bestS.toFixed(4) : null,
    };
  });
}

// 惰性自愈:成绩单缺失但进化状态已在(如刚升级部署)→ 只读端补算一次(~2s,globalThis 防并发)
const G = globalThis as { __wcSbBuilding?: boolean };
async function scoreboardSelfHeal(league: string) {
  let sb = loadResearchScoreboard(league);
  if (sb) return sb;
  const st = loadEvoState2(league);
  const mf = loadHoldoutManifest(league);
  if (!st || !mf || G.__wcSbBuilding) return null;
  G.__wcSbBuilding = true;
  try {
    const ledger = loadPromotionLedger(league);
    sb = await buildScoreboard(
      loadLeagueDataset(league),
      st,
      mf,
      loadForwardStore(league),
      ledger[ledger.length - 1] ?? null,
    );
    saveResearchScoreboard(league, sb);
    return sb;
  } catch {
    return null;
  } finally {
    G.__wcSbBuilding = false;
  }
}

export async function GET(req: Request) {
  try {
    const league = safeLeagueKey(new URL(req.url).searchParams.get('league'));
    const st = loadEvolutionState(league);
    // 联赛切换列表(逐联赛读状态,纯文件读,便宜)
    const leagues = LEAGUES.map((l) => {
      const es = loadEvolutionState(l.key);
      return {
        key: l.key,
        nameZh: l.nameZh,
        status: es?.status ?? null,
        generation: es?.generation ?? 0,
      };
    });
    return okLive({
      league,
      leagues,
      runner: runnerStatus(),
      scoreboard: await scoreboardSelfHeal(league),
      epochs: loadResearchTimeline(league),
      analysis: loadResearchAnalysis(league),
      // 进化状态摘要(面板徽章;holdout 数值证据不出面板,只给 pass/fail 级信息)
      evolution: st
        ? {
            status: st.status,
            generation: st.generation,
            noImproveCount: st.noImproveCount,
            insufficientPower: st.insufficientPower,
            holdoutTouches: st.holdoutTouches.length,
            incumbentLabel: st.incumbent?.label ?? null,
          }
        : null,
      marginals: st ? marginals(league, st.dataHash) : [],
      recentLog: loadEvolutionLog(league)
        .slice(-3)
        .map((l) => ({
          generation: l.generation,
          winnerLabel: l.winnerLabel,
          improved: l.improved,
          pairedT: l.pairedT,
          llmAccepted: l.accepted.filter((a) => a.provenance === 'llm').length,
          statusAfter: l.statusAfter,
        })),
      forward: forwardSummary(loadForwardStore(league)),
      gauntlet: loadPromotionLedger(league)
        .slice(-3)
        .map((g) => ({
          label: g.label,
          epoch: g.epoch,
          blockedAt: g.verdict.blockedAt,
          passedAll: g.verdict.passedAll,
        })),
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '研究时间线读取失败');
  }
}
