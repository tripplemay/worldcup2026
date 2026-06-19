/**
 * GET /api/worldcup/trade — 模拟盘账户总览 + 交易流水(供仪表盘)。
 */
import { getWallet } from 'lib/trade/ledger';
import { loadTrades } from 'lib/db/store';
import { clvKpi } from 'lib/predict/clv';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const wallet = getWallet();
    const trades = [...loadTrades()].sort((a, b) => b.placedAt - a.placedAt);
    const equity = +(wallet.currentBalance + wallet.lockedBalance).toFixed(2);
    const settled = wallet.wins + wallet.losses;
    const tierStat = (tier: 'value' | 'coverage') => {
      const ts = trades.filter((t) => (t.tier ?? 'value') === tier);
      const set = ts.filter((t) => t.status === 'won' || t.status === 'lost');
      const wins = ts.filter((t) => t.status === 'won').length;
      const pnl = ts.reduce((s, t) => s + (t.pnl ?? 0), 0);
      return {
        n: ts.length,
        settled: set.length,
        wins,
        losses: set.length - wins,
        pnl: +pnl.toFixed(2),
        winRate: set.length ? +(wins / set.length).toFixed(3) : 0,
      };
    };
    const stats = {
      equity,
      roi: +((equity - wallet.initialBalance) / wallet.initialBalance).toFixed(
        4,
      ),
      winRate: settled ? +(wallet.wins / settled).toFixed(4) : 0,
      clv: clvKpi(), // CLV edge 指标(仅 value 注:下注价 vs 闭盘价)
      tiers: { value: tierStat('value'), coverage: tierStat('coverage') },
    };
    return ok({ wallet, stats, trades });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '账本获取失败');
  }
}
