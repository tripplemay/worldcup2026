/**
 * POST /api/worldcup/trade/run — 模拟交易主循环(需管理口令)。
 * 先结算已 FT 的 pending,再为临近开赛的比赛下注。供高频 cron 调用。
 * 可选 ?window=N 临时放宽下注窗口(分钟),用于手动补单/测试(仍只下未开赛的比赛)。
 */
import { runSettlement } from 'lib/trade/settle';
import { runPreMatchBetting } from 'lib/trade/prematch';
import {
  snapshotPredictions,
  settlePredictionLog,
  backfillReconstructed,
} from 'lib/predict/predictionLog';
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
    const w = Number(new URL(req.url).searchParams.get('window'));
    const settled = await runSettlement();
    const betting = await runPreMatchBetting(
      Number.isFinite(w) && w > 0 ? { windowMin: w } : undefined,
    );
    // 预测存档:回填已踢(幂等)→ 结算 → 为未开赛比赛存/刷新快照
    const backfilled = await backfillReconstructed();
    const logSettled = await settlePredictionLog();
    const snapped = await snapshotPredictions();
    return ok({
      settled,
      betting,
      predictionLog: { backfilled, logSettled, snapped },
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '模拟交易运行失败');
  }
}
