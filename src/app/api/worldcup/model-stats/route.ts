/** GET /api/worldcup/model-stats — 模型战绩(读预测存档:命中率/Brier/LogLoss/进球误差)。 */
import { modelStats } from 'lib/predict/predictionLog';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok(modelStats());
  } catch (e) {
    return fail(e instanceof Error ? e.message : '模型战绩获取失败');
  }
}
