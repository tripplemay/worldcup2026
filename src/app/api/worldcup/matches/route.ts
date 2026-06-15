/** GET /api/worldcup/matches — 世界杯单场赔率(The Odds API)+ 配额 + 拉取时间戳。 */
import { cached } from 'lib/cache';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { getQuota } from 'lib/odds/quota';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

// 服务端缓存与前端赔率刷新节奏一致(30min):30min 内任何访问都返回同一份数据 + 同一 fetchedAt,
// 既准确反映"赔率上次拉取时间",又避免频繁访问反复拉取消耗配额。
const ODDS_CACHE_MS = 1_800_000;

export async function GET() {
  try {
    const result = await cached('odds:matches', ODDS_CACHE_MS, async () => ({
      matches: await theOddsApiProvider.getMatches(),
      fetchedAt: Date.now(),
    }));
    return ok({ matches: result.matches, quota: getQuota(), fetchedAt: result.fetchedAt });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '赔率获取失败');
  }
}
