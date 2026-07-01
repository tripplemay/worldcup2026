/**
 * POST /api/worldcup/trade/dry-run — 模拟盘赛前预生成。
 * 只读草稿:复用真实赛前策略,但不扣款/不落库/不写交易信号。
 */
import { dryRunPreMatchBetting } from 'lib/trade/dryRun';
import { okLive, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('未启用 dry-run(服务端未设置 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);

  try {
    const body = (await req.json().catch(() => ({}))) as {
      matchIds?: unknown;
      days?: unknown;
      windowMin?: unknown;
    };
    const matchIds = Array.isArray(body.matchIds)
      ? [...new Set(body.matchIds.map((x) => String(x).trim()).filter(Boolean))]
      : [];
    if (!matchIds.length) return fail('请选择比赛', 400);
    if (matchIds.length > 8) return fail('单次最多选择 8 场', 400);

    const rawDays = Number(body.days ?? 14);
    const days = clamp(Number.isFinite(rawDays) ? Math.floor(rawDays) : 14, 1, 30);
    const rawWindow = Number(body.windowMin ?? days * 24 * 60);
    const windowMin = clamp(
      Number.isFinite(rawWindow) ? Math.floor(rawWindow) : days * 24 * 60,
      1,
      30 * 24 * 60,
    );

    const result = await dryRunPreMatchBetting({ matchIds, days, windowMin });
    return okLive(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '模拟盘预生成失败');
  }
}
