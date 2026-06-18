/**
 * POST /api/worldcup/trade/run — 模拟交易主循环(需管理口令)。
 * 先结算已 FT 的 pending,再为临近开赛的比赛下注。供高频 cron 调用。
 */
import { runSettlement } from 'lib/trade/settle';
import { runPreMatchBetting } from 'lib/trade/prematch';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('未启用(服务端未设置 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  try {
    const settled = await runSettlement();
    const betting = await runPreMatchBetting();
    return ok({ settled, betting });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '模拟交易运行失败');
  }
}
