/**
 * GET  /api/worldcup/bettors — 投注人名册(盈亏页归属下拉用)。
 * POST /api/worldcup/bettors {name} — 新增投注人(需管理口令 x-admin-token)。
 */
import { listBettors, addBettor } from 'lib/bets/bettors';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

export async function GET() {
  try {
    return ok({ bettors: listBettors() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '名册获取失败');
  }
}

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('未启用(服务端未设置 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  try {
    const { name } = (await req.json()) as { name?: string };
    if (!name || !name.trim()) return fail('姓名不能为空', 400);
    const b = addBettor(name);
    return b ? ok({ bettor: b }) : fail('添加失败', 400);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '新增投注人失败');
  }
}
