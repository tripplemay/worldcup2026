/**
 * GET /api/worldcup/scenarios —— 读取最新「沙盘」情景推演(缓存结果,no-store)。
 * 计算由后台(settleWatcher 新赛果触发 / cron / 管理 POST run)完成,本接口只读。
 */
import { okLive, fail } from 'lib/api/respond';
import { loadScenario } from 'lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const scenario = loadScenario();
    return okLive({ scenario });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '情景推演读取失败');
  }
}
