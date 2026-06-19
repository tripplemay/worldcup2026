/**
 * POST /api/worldcup/odds/capture-openings — 一次性拉取所有未开赛比赛当前赔率,写入初盘(write-once)。
 * 需管理员口令。为远期比赛尽早建立初盘基准;幂等(已有的不覆盖)。
 */
import { captureAllOpenings } from 'lib/odds/livePoller';
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
    return ok(await captureAllOpenings());
  } catch (e) {
    return fail(e instanceof Error ? e.message : '初盘批量捕获失败');
  }
}
