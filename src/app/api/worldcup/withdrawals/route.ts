/**
 * POST   /api/worldcup/withdrawals {bettorId, amount, note?, at?} — 记一笔提款。
 * DELETE /api/worldcup/withdrawals?id= — 删一笔提款。
 * (写操作需管理密码 cookie 或管理口令;读取走 /pnl)
 */
import { addWithdrawal, removeWithdrawal } from 'lib/bets/withdrawals';
import { isAdminAuthed } from 'lib/bets/viewAuth';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

/** 写权限:持管理密码 cookie;或带管理口令(供 API/脚本)。 */
function authorized(req: Request): boolean {
  if (isAdminAuthed(req)) return true;
  const tok = process.env.ADMIN_TOKEN;
  return !!tok && req.headers.get('x-admin-token') === tok;
}

export async function POST(req: Request) {
  if (!authorized(req)) return fail('需要管理密码或管理口令', 401);
  try {
    const { bettorId, amount, note, at } = (await req.json()) as {
      bettorId?: string;
      amount?: number;
      note?: string;
      at?: number;
    };
    if (!bettorId) return fail('缺少投注人', 400);
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0)
      return fail('提款金额需为正数', 400);
    const w = addWithdrawal(bettorId, amount, note, at);
    return w ? ok({ withdrawal: w }) : fail('投注人不存在或金额无效', 400);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '记录提款失败');
  }
}

export async function DELETE(req: Request) {
  if (!authorized(req)) return fail('需要管理密码或管理口令', 401);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return fail('缺少 id', 400);
  return removeWithdrawal(id) ? ok({ id }) : fail('提款记录不存在', 404);
}
