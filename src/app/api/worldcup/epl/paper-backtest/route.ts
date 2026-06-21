/**
 * GET /api/worldcup/epl/paper-backtest?key=laliga&from=YYYY-MM-DD — 联赛模拟盘回测
 *   (生产模拟盘逻辑 walk-forward 对闭盘价;估算接入联赛后的收益)。只读,无需口令。
 */
import { runLeaguePaperBacktest } from 'lib/predict/leaguePaper';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    return ok(
      runLeaguePaperBacktest({
        key: u.searchParams.get('key') ?? 'epl-2025',
        from: u.searchParams.get('from') ?? undefined,
        to: u.searchParams.get('to') ?? undefined,
      }),
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : '联赛模拟盘回测失败');
  }
}
