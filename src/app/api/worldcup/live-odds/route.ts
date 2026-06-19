/**
 * GET /api/worldcup/live-odds — 实时赔率看板(odds-api.io)。
 * 最近 N 场未结束比赛的胜平负 + 涨跌 + 拉取时间 + 限流状态。
 * 数据由后台单例轮询器维护(~36s/次);本路由只读内存看板,几乎零上游消耗。
 */
import { ensureLiveBoard } from 'lib/odds/livePoller';
import { loadOpeningOdds } from 'lib/db/store';
import { okLive, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const board = await ensureLiveBoard();
    const opening = loadOpeningOdds();
    const matches = (board?.matches ?? []).map((m) =>
      opening[m.id] ? { ...m, opening: opening[m.id] } : m,
    );
    return okLive({
      matches,
      changes: board?.changes ?? {},
      fetchedAt: board?.fetchedAt ?? null,
      rate: board?.rate ?? { limit: null, remaining: null, reset: null },
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '实时赔率获取失败');
  }
}
