/**
 * POST /api/worldcup/trade/reset — 重置模拟盘账本(需管理口令)。
 * 清空流水 + 钱包归零到初始本金。用于修复脏数据后重来。
 */
import { resetLedger } from 'lib/trade/ledger';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

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
    await resetLedger();
    return ok({ reset: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '重置失败');
  }
}
