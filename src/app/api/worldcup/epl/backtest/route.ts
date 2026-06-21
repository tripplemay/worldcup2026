/**
 * GET /api/worldcup/epl/backtest?key=epl-2025&from=YYYY-MM-DD — 联赛历史 walk-forward 回测报告
 *   (Brier / 各模型 / 平局校准 / 大球偏差)。只读,无需口令。from 用于跳过赛季初冷启动。
 */
import { runLeagueBacktest } from 'lib/predict/leagueBacktest';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const key = u.searchParams.get('key') ?? 'epl-2025';
    const from = u.searchParams.get('from') ?? undefined;
    const to = u.searchParams.get('to') ?? undefined;
    const numOpt = (k: string) => {
      const v = u.searchParams.get(k);
      return v != null ? Number(v) : undefined;
    };
    return ok(
      runLeagueBacktest({
        key,
        from,
        to,
        hfaElo: numOpt('hfaElo'),
        hfaMult: numOpt('hfaMult'),
        goalShrink: numOpt('goalShrink'),
        shrinkEloScale: numOpt('shrinkEloScale'),
        dcRho: numOpt('dcRho'),
        marketWeight: numOpt('marketWeight'),
      }),
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : '联赛回测失败');
  }
}
