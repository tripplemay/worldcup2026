/**
 * GET /api/worldcup/pnl — 各投注人盈亏总览 + 注单明细(Phase 9 盈亏页数据源)。
 * 永不返回 ok(null):前端 fetcher 见 data===null 会抛错。
 */
import { loadBets } from 'lib/db/store';
import { listBettors } from 'lib/bets/bettors';
import { perUserPnl } from 'lib/bets/bets';
import { okLive, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const slips = loadBets();
    const bettors = listBettors();
    const perUser = perUserPnl(slips, bettors);
    // 去掉仅服务端需要的内部字段(Telegram chat/file id、原始 LLM 转储),减少无谓暴露
    const safe = slips.map(({ recognizedRaw, source, ...rest }) => rest);
    return okLive({ bettors, slips: safe, perUser });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '盈亏数据获取失败');
  }
}
