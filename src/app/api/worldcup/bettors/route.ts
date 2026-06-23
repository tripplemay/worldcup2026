/**
 * GET  /api/worldcup/bettors — 投注人名册(盈亏页归属下拉用)。
 * POST /api/worldcup/bettors {name} — 新增投注人(需管理口令 x-admin-token)。
 */
import { listBettors, addBettor, removeBettor } from 'lib/bets/bettors';
import { isViewAuthed } from 'lib/bets/viewAuth';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

/** 管理写权限:已过浏览密码(cookie)即可;或带正确管理口令(供 API/脚本)。 */
function authorized(req: Request): boolean {
  if (isViewAuthed(req)) return true;
  const tok = process.env.ADMIN_TOKEN;
  return !!tok && req.headers.get('x-admin-token') === tok;
}

export async function GET() {
  try {
    return ok({ bettors: listBettors() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '名册获取失败');
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) return fail('需要浏览密码或管理口令', 401);
  try {
    const { name } = (await req.json()) as { name?: string };
    if (!name || !name.trim()) return fail('姓名不能为空', 400);
    const b = addBettor(name);
    return b ? ok({ bettor: b }) : fail('添加失败', 400);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '新增投注人失败');
  }
}

export async function DELETE(req: Request) {
  if (!authorized(req)) return fail('需要浏览密码或管理口令', 401);
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return fail('缺少 id', 400);
  return removeBettor(id) ? ok({ id }) : fail('投注人不存在', 404);
}
