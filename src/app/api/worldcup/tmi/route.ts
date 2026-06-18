/**
 * TMI 杯赛状态动能观测台数据。
 *   GET → 所有已登场球队的 TMI 总分 + 因子裸数据 + 归一化分(按总分降序)。
 * 纯计算(读现有 results/historical/ratings JSON),零上游配额;短缓存吸收重复请求。
 */
import { loadTmiSnapshot } from 'lib/tmi/engine';
import { cached } from 'lib/cache';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

const TTL = 5 * 60_000; // 5 分钟(数据由 engine cron 低频刷新,无需更频繁)

export async function GET() {
  try {
    const snapshot = await cached('tmi:snapshot', TTL, async () =>
      loadTmiSnapshot(),
    );
    return ok(snapshot);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'TMI 计算失败');
  }
}
