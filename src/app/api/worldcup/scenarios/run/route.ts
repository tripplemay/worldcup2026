/**
 * POST /api/worldcup/scenarios/run —— 重算「沙盘」情景推演并落盘(管理鉴权)。
 * cron(第三轮窗口高频)与 settleWatcher 新赛果均会触发;也可手动调用。?sims=N 可覆盖模拟次数。
 */
import { ok, fail } from 'lib/api/respond';
import { computeScenario } from 'lib/scenario/compute';

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
  try {
    const url = new URL(req.url);
    const sims = Number(url.searchParams.get('sims')) || undefined;
    const r = await computeScenario({ sims });
    return ok({
      computedAt: r.computedAt,
      sims: r.sims,
      teams: r.teams.length,
      fixtures: r.fixtures.length,
      groupsLocked: r.groupsLocked,
      groupsPending: r.groupsPending,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '情景推演计算失败');
  }
}
