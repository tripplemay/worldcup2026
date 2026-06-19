/** GET /api/worldcup/radar — 微观异动雷达信息流(steam / 关键线击穿 / RLM)。 */
import { ensureLiveBoard } from 'lib/odds/livePoller';
import { getRadarAlerts } from 'lib/odds/radar';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureLiveBoard(); // 确保轮询器在跑(雷达靠它喂数据)
    return ok({ alerts: getRadarAlerts() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '异动雷达获取失败');
  }
}
