/**
 * GET /api/worldcup/backtest — 预测回测(walk-forward;每场只用赛前数据重算)。
 * 纯计算(读 historical/results JSON),只读不写;缓存 1h。
 */
import { cached } from 'lib/cache';
import { runBacktest } from 'lib/predict/backtest';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const numParam = (k: string) => {
    const v = Number(sp.get(k));
    return sp.get(k) != null && Number.isFinite(v) ? v : undefined;
  };
  const detail = sp.get('detail') === '1';
  const opts = {
    goalShrink: numParam('shrink'),
    dcRho: numParam('rho'),
    eloDrawScale: numParam('drawscale'),
    kSos: numParam('ksos'),
    sosEloScale: numParam('soscale'),
    shrinkEloScale: numParam('shrinkscale'),
    detail,
  };
  const hasTune =
    opts.goalShrink != null ||
    opts.dcRho != null ||
    opts.eloDrawScale != null ||
    opts.kSos != null ||
    opts.shrinkEloScale != null;
  try {
    // 带调参/明细的请求不缓存;默认配置缓存 1h
    const result =
      hasTune || detail
        ? runBacktest(opts)
        : await cached('predict:backtest', 3_600_000, async () =>
            runBacktest(),
          );
    return ok(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '回测失败');
  }
}
