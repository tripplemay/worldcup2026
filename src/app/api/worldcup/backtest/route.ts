/**
 * GET /api/worldcup/backtest — 预测回测(walk-forward;每场只用赛前数据重算)。
 * 纯计算(读 historical/results JSON),只读不写;缓存 1h。
 */
import { cached } from 'lib/cache';
import { runBacktest } from 'lib/predict/backtest';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  try {
    const result = await cached('predict:backtest', 3_600_000, async () =>
      runBacktest(),
    );
    return ok(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '回测失败');
  }
}
