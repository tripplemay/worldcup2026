/** GET /api/worldcup/clv-report — CLV 真值靶校准(各模型 vs 闭盘价去水概率)。前向积累。 */
import { clvReport } from 'lib/predict/clv';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok(clvReport());
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'CLV 报告生成失败');
  }
}
