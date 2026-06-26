/**
 * GET /api/worldcup/pnl — 各投注人盈亏总览 + 注单明细(Phase 9 盈亏页数据源)。
 * 永不返回 ok(null):前端 fetcher 见 data===null 会抛错。
 */
import { loadBets } from 'lib/db/store';
import { listBettors } from 'lib/bets/bettors';
import { listWithdrawals } from 'lib/bets/withdrawals';
import { perUserPnl } from 'lib/bets/bets';
import { isViewAuthed, isAdminAuthed } from 'lib/bets/viewAuth';
import { okLive, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isViewAuthed(req)) return fail('需要浏览密码', 401);
  try {
    const slips = loadBets();
    const bettors = listBettors();
    const withdrawals = listWithdrawals();
    const perUser = perUserPnl(slips, bettors, withdrawals);
    // 去掉仅服务端需要的内部字段(Telegram chat/file id、原始 LLM 转储),减少无谓暴露
    const safe = slips.map(({ recognizedRaw, source, ...rest }) => rest);
    // canEdit:是否持有管理(写)权限,供前端决定是否显示编辑/管理控件
    return okLive({
      bettors,
      slips: safe,
      perUser,
      withdrawals,
      canEdit: isAdminAuthed(req),
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '盈亏数据获取失败');
  }
}
