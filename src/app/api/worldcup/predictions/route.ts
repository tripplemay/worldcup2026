/**
 * GET /api/worldcup/predictions
 *   ?days=N      → 未来 N 天比赛的预测列表(各模型)
 *   ?matchId=X   → 单场比赛预测(详情页用)
 * 纯计算(基于已持久化的球队评分),不耗 The Odds API 配额。缓存 10min。
 */
import { cached } from 'lib/cache';
import { predictUpcoming, predictMatch } from 'lib/predict/predict';
import { loadPredictionLog } from 'lib/db/store';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const matchId = sp.get('matchId');
  try {
    if (matchId) {
      const match = await cached(`predict:m:${matchId}`, 600_000, () =>
        predictMatch(matchId),
      );
      // 当时的预测存档(若有):用于「预测 vs 实际」对照(非现算)
      const logged = loadPredictionLog()[matchId] ?? null;
      return ok({ match, logged });
    }
    const days = Number(sp.get('days') ?? 10);
    const matches = await cached(`predict:up:${days}`, 600_000, () =>
      predictUpcoming(Number.isFinite(days) ? days : 10),
    );
    return ok({ matches });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '预测获取失败');
  }
}
