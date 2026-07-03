/**
 * GET /api/worldcup/research —— 读取研究调参时间线(EpochResult[],缓存结果,no-store)。
 * 计算由 research/run(管理 POST)或后续常驻 daemon 完成,本接口只读。
 */
import { okLive, fail } from 'lib/api/respond';
import {
  loadResearchTimeline,
  loadResearchAnalysis,
  loadEvolutionState,
} from 'lib/db/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const st = loadEvolutionState();
    return okLive({
      epochs: loadResearchTimeline(),
      analysis: loadResearchAnalysis(),
      // 进化状态摘要(面板徽章;holdout 数值证据不出面板,只给 pass/fail 级信息)
      evolution: st
        ? {
            status: st.status,
            generation: st.generation,
            noImproveCount: st.noImproveCount,
            insufficientPower: st.insufficientPower,
            holdoutTouches: st.holdoutTouches.length,
            incumbentLabel: st.incumbent?.label ?? null,
          }
        : null,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '研究时间线读取失败');
  }
}
