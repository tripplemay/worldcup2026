/** GET /api/worldcup/summary?eventId=... — 单场详情(ESPN + 球员中文名 + 近期状态,缓存 25s)。 */
import { cached } from 'lib/cache';
import { espnProvider } from 'lib/espn/espn';
import { cachedNames, ensureNames } from 'lib/lineup/playerNames';
import { attachPlayerForm } from 'lib/lineup/playerForm';
import { loadAfTeams } from 'lib/db/store';
import { normalizeTeam } from 'lib/match/normalize';
import { ok, fail } from 'lib/api/respond';
import type { RosterPlayer } from 'lib/espn/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const eventId = new URL(req.url).searchParams.get('eventId');
  if (!eventId) return fail('缺少 eventId 参数', 400);
  try {
    const summary = await cached(
      `espn:summary:${eventId}`,
      25_000,
      async () => {
        const s = await espnProvider.getMatchSummary(eventId);
        if (!s) return s;
        // 球员中文名:已缓存的即时返回(不阻塞首屏),缺失的后台补译,下次轮询即出
        const names = [...s.homeRoster, ...s.awayRoster].map((p) => p.name);
        ensureNames(names);
        const zh = cachedNames(names);
        const withZh = (arr: RosterPlayer[]) =>
          arr.map((p) => (zh[p.name] ? { ...p, zh: zh[p.name] } : p));
        // 球员近期状态(API-Football,按球衣号匹配;非阻塞,下次轮询即出)
        const af = loadAfTeams();
        const enrich = (arr: RosterPlayer[], team: string) =>
          attachPlayerForm(af[normalizeTeam(team)], withZh(arr));
        return {
          ...s,
          homeRoster: enrich(s.homeRoster, s.homeTeam),
          awayRoster: enrich(s.awayRoster, s.awayTeam),
        };
      },
    );
    return ok({ summary });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '比赛详情获取失败');
  }
}
