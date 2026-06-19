/**
 * API-Football 赔率适配:把 ESPN 对阵解析到 AF fixtureId → 拉取并归一化盘口快照。
 * Pro 套餐自带(7500/天),含胜平负/亚盘/大小球;按日期与 fixture 缓存,窗口内去重。
 */
import { cached } from 'lib/cache';
import { normalizeTeam } from 'lib/match/normalize';
import {
  hasApiFootball,
  getWcFixtures,
  getFixtureOdds,
} from 'lib/predict/apifootball';
import { ODDS_TTL_MS } from './config';
import type { MarketSnapshot } from './types';

/** 解析某场 ESPN 对阵对应的 AF fixtureId(按日期赛程 + 归一化队名匹配)。 */
async function resolveFixtureId(
  home: string,
  away: string,
  commenceTime: string,
): Promise<number | null> {
  const date = commenceTime.slice(0, 10);
  const fixtures = await cached(`af:wcfixtures:${date}`, 3_600_000, () =>
    getWcFixtures(date),
  );
  const hN = normalizeTeam(home);
  const aN = normalizeTeam(away);
  const f = fixtures.find(
    (x) => normalizeTeam(x.home) === hN && normalizeTeam(x.away) === aN,
  );
  return f?.id ?? null;
}

/** 该场 AF 归一化盘口快照;无 key / 无对应赛事 / 无赔率 → null(交由上层回退)。 */
export async function afMarketSnapshot(
  home: string,
  away: string,
  commenceTime: string,
): Promise<MarketSnapshot | null> {
  if (!hasApiFootball()) return null;
  const fid = await resolveFixtureId(home, away, commenceTime);
  if (!fid) return null;
  const odds = await cached(`af:odds:${fid}`, ODDS_TTL_MS, () =>
    getFixtureOdds(fid),
  );
  if (!odds) return null;
  return {
    h2h: odds.h2h,
    totals: odds.totals,
    spreads: odds.spreads,
    btts: odds.btts,
  };
}
