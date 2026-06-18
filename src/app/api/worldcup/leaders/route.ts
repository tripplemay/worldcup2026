/** GET /api/worldcup/leaders — 世界杯射手榜(engine cron 刷新的静态数据)。 */
import { loadLeaders } from 'lib/db/store';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok(loadLeaders());
  } catch (e) {
    return fail(e instanceof Error ? e.message : '射手榜获取失败');
  }
}
