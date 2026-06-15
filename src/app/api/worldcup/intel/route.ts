/**
 * POST /api/worldcup/intel?hours=N — 刷新未来 N 小时内比赛球队的场外情报
 * (抓 RSS → LLM 情感分 → 存)。需管理员口令;供 cron 调用。
 * 未配置 AIGC_API_KEY 或 ADMIN_TOKEN 时优雅禁用。
 */
import { refreshIntel } from 'lib/intel/intel';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('未启用(服务端未设置 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  const hours = Number(new URL(req.url).searchParams.get('hours') ?? 36);
  try {
    const r = await refreshIntel(Number.isFinite(hours) ? hours : 36);
    return ok(r);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '情报刷新失败');
  }
}
