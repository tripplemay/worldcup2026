/**
 * GET /api/worldcup/research —— 读取研究调参时间线(EpochResult[],缓存结果,no-store)。
 * 计算由 research/run(管理 POST)或后续常驻 daemon 完成,本接口只读。
 */
import { okLive, fail } from 'lib/api/respond';
import { loadResearchTimeline } from 'lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return okLive({ epochs: loadResearchTimeline() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '研究时间线读取失败');
  }
}
