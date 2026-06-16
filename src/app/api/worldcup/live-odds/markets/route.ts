/**
 * GET /api/worldcup/live-odds/markets?id=<eventId>
 * 单场全部市场(按标签分组),供实时赔率页展开按需加载。
 * 数据取自后台轮询器的内存留存(当前看板覆盖的 10 场),0 额外上游调用。
 */
import { ensureLiveBoard, getLiveMatchMarkets } from 'lib/odds/livePoller';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return fail('缺少 id 参数', 400);
  try {
    await ensureLiveBoard(); // 幂等:确保轮询器已启动且首拉完成
    const markets = getLiveMatchMarkets(id);
    return ok({ markets });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '全市场获取失败');
  }
}
