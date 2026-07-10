/**
 * TMI 杯赛状态动能观测台数据。
 *   GET → 所有已登场球队的 TMI 总分 + 因子裸数据 + 归一化分(按总分降序)。
 *   GET ?asOf=2026-07-05T20:00:00Z → 点位回测:数据截断到该时刻(严格 <),
 *   还原「那一刻的动能榜」(如某场比赛开球前双方的状态动能)。
 * 纯计算(读现有 results/historical/ratings JSON),零上游配额;短缓存吸收重复请求。
 */
import { loadTmiSnapshot } from 'lib/tmi/engine';
import { cached } from 'lib/cache';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

const TTL = 5 * 60_000; // 5 分钟(数据由 engine cron 低频刷新,无需更频繁)

export async function GET(req: Request) {
  try {
    const raw = new URL(req.url).searchParams.get('asOf');
    let asOf: string | undefined;
    if (raw) {
      const t = Date.parse(raw);
      // 合法窗口:开赛月前 ~ 现在+1 天(防拼错日期静默算出空榜)
      if (
        !Number.isFinite(t) ||
        t < Date.parse('2026-06-01T00:00:00Z') ||
        t > Date.now() + 86_400_000
      )
        return fail('asOf 需为赛期内的 ISO 时刻(如 2026-07-05T20:00:00Z)', 400);
      asOf = new Date(t).toISOString();
    }
    const snapshot = await cached(`tmi:snapshot:${asOf ?? 'live'}`, TTL, async () =>
      loadTmiSnapshot(asOf),
    );
    return ok(snapshot);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'TMI 计算失败');
  }
}
