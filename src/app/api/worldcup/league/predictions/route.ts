/**
 * GET /api/worldcup/league/predictions?comp=laliga[&days=10][&matchId=ID]
 *   — 某联赛的多模型预测 + 融合(应用按 comp 分流的验证配置)。
 *   评分由已摄取联赛数据即时算;赛程/赔率实时(off-season 赛程为空)。零额外 AF 配额。
 */
import { predictLeagueUpcoming, predictLeagueMatch } from 'lib/predict/league';
import { getLeague } from 'lib/predict/leagues';
import { cached } from 'lib/cache';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';
const TTL = 600_000; // 10min

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const comp = u.searchParams.get('comp') ?? '';
    if (!getLeague(comp)) return fail(`未知联赛 comp=${comp}`, 400);
    const matchId = u.searchParams.get('matchId');
    if (matchId) {
      const m = await cached(`league:pred:${comp}:${matchId}`, TTL, async () =>
        predictLeagueMatch(comp, matchId),
      );
      return ok({ comp, match: m });
    }
    const days = Math.min(30, Math.max(1, Number(u.searchParams.get('days') ?? 10)));
    const matches = await cached(`league:pred:${comp}:d${days}`, TTL, async () =>
      predictLeagueUpcoming(comp, days),
    );
    return ok({ comp, matches });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '联赛预测失败');
  }
}
