/** GET /api/worldcup/matches — 世界杯单场赔率(The Odds API)+ 配额 + 拉取时间戳 + 赔率变动。 */
import { cached } from 'lib/cache';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { getQuota } from 'lib/odds/quota';
import { ok, fail } from 'lib/api/respond';
import { computeChanges } from 'lib/odds/changes';
import { loadOddsSnap, saveOddsSnap } from 'lib/odds/snapStore';

export const dynamic = 'force-dynamic';

// 服务端缓存与前端赔率刷新节奏一致(30min):30min 内任何访问都返回同一份数据 + 同一 fetchedAt,
// 既准确反映"赔率上次拉取时间",又避免频繁访问反复拉取消耗配额。
const ODDS_CACHE_MS = 1_800_000;

export async function GET() {
  try {
    // loader 仅在缓存失效(真正拉取新数据)时执行,此刻对比上一份快照算变动并持久化,
    // 因此变动方向恒为"相对上一次赔率刷新",且整个 30min 窗口内所有客户端拿到同一份。
    const result = await cached('odds:matches', ODDS_CACHE_MS, async () => {
      const matches = await theOddsApiProvider.getMatches();
      const now = Date.now();
      const { changes, snap } = computeChanges(loadOddsSnap(), matches, now);
      saveOddsSnap(snap);
      return { matches, changes, fetchedAt: now };
    });
    return ok({
      matches: result.matches,
      changes: result.changes,
      quota: getQuota(),
      fetchedAt: result.fetchedAt,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '赔率获取失败');
  }
}
