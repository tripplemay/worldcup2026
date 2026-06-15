/**
 * 预测引擎触发(对应 spec 的 trigger-xg-calc)。需管理员口令。
 *   POST ?days=N → 摄取未来 N 天比赛双方的历史射门数据 + 重算球队评分。
 * 供手动触发与 cron 调用。纯 ESPN,免费,不耗赔率配额。
 */
import { ingestHistory } from 'lib/predict/history';
import { recomputeRatings } from 'lib/predict/ratings';
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
  const days = Number(new URL(req.url).searchParams.get('days') ?? 14);
  try {
    const ingested = await ingestHistory(Number.isFinite(days) ? days : 14);
    const ratings = recomputeRatings();
    return ok({ ingested, ratings });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '引擎计算失败');
  }
}
