/**
 * GET /api/worldcup/trade — 模拟盘账户总览 + 交易流水(供仪表盘)。
 */
import { getWallet } from 'lib/trade/ledger';
import { loadTrades } from 'lib/db/store';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const wallet = getWallet();
    const trades = [...loadTrades()].sort((a, b) => b.placedAt - a.placedAt);
    const equity = +(wallet.currentBalance + wallet.lockedBalance).toFixed(2);
    const settled = wallet.wins + wallet.losses;
    const stats = {
      equity,
      roi: +((equity - wallet.initialBalance) / wallet.initialBalance).toFixed(4),
      winRate: settled ? +(wallet.wins / settled).toFixed(4) : 0,
    };
    return ok({ wallet, stats, trades });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '账本获取失败');
  }
}
