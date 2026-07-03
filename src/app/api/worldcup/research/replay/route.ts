/**
 * POST /api/worldcup/research/replay —— 进化日志重放审计(管理员;x-admin-token)。
 * 对最近 N 条日志:①accepted 配置的 configHash→label 派生一致性(验证器/派生逻辑无漂移);
 * ②对存档的 LLM 原始响应重跑验证器(空去重上下文),日志中 llm-accepted 必须 ⊆ 重放 accepted。
 * 局限(诚实标注):不重放引擎评估(需当时全量数据快照);此审计覆盖"LLM 是唯一非确定源"
 * 的验证/派生链是否可逐比特复现。
 */
import { okLive, fail } from 'lib/api/respond';
import { loadEvolutionLog } from 'lib/db/store';
import { safeLeagueKey } from 'research/leagues';
import { validateProposals, deriveLabel } from 'research/evolve';
import { newRegistry, configHash } from 'research/governance';
import type { StrategyParams } from 'research/engine';

export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('重放审计未启用(缺 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  try {
    const n = Math.min(
      20,
      Number(new URL(req.url).searchParams.get('n') ?? 5) || 5,
    );
    const league = safeLeagueKey(new URL(req.url).searchParams.get('league'));
    const entries = loadEvolutionLog(league).slice(-n);
    const report = entries.map((e) => {
      // ① label 派生一致性
      const labelMismatches = e.accepted.filter((acc) => {
        const src = acc.provenance as 'refine' | 'llm' | 'random' | 'seed';
        if (!['refine', 'llm', 'random', 'seed'].includes(src)) return false;
        return (
          deriveLabel(e.generation, src, acc.params as StrategyParams) !==
          acc.label
        );
      }).length;
      // ② LLM 验证器重放(空上下文 → 重放 accepted 应 ⊇ 日志 llm-accepted)
      let llmSubset = true;
      if (e.llmRaw) {
        const replay = validateProposals(
          e.llmRaw,
          e.generation,
          newRegistry(),
          e.dataHash,
          new Set(),
          8,
        );
        const replayHashes = new Set(
          replay.accepted.map((x) => configHash(x.params)),
        );
        llmSubset = e.accepted
          .filter((x) => x.provenance === 'llm')
          .every((x) => replayHashes.has(configHash(x.params)));
      }
      return {
        generation: e.generation,
        labelMismatches,
        llmSubset,
        ok: labelMismatches === 0 && llmSubset,
      };
    });
    return okLive({
      checked: report.length,
      allOk: report.every((r) => r.ok),
      report,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '重放审计失败');
  }
}
