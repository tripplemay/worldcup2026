/**
 * 预测服务:把赛程 + 球队评分 + 市场赔率 + 注册的模型组装成多模型预测 + 融合。
 * 预测本体是纯计算;市场赔率复用与赔率页相同的缓存(`odds:matches`),通常已热,无额外配额。
 */
import { espnProvider } from 'lib/espn/espn';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { cached } from 'lib/cache';
import { loadRatings } from 'lib/db/store';
import { normalizeTeam, findMatch } from 'lib/match/normalize';
import { getModels } from './registry';
import { ensemble } from './ensemble';
import './models'; // 副作用:注册所有模型
import type { MatchPrediction, PredictionContext } from './model';
import type { TeamRating } from './types';
import type { MatchOdds } from 'lib/odds/types';
import type { ScheduleMatch } from 'lib/espn/types';

const CN_OFFSET = 8 * 3600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const ODDS_CACHE_MS = 1_800_000;

export interface MatchWithPredictions {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  commenceTime: string;
  status: string;
  predictions: MatchPrediction[]; // 各基础模型
  ensemble: MatchPrediction | null; // 融合共识
}

/** 联赛基准:全体球队场均创造 xG 的均值(泊松归一化用)。 */
function leagueAverage(ratings: Record<string, TeamRating>): number {
  const vals = Object.values(ratings).map((r) => r.xgFor);
  if (!vals.length) return 1.35;
  return Math.max(0.6, vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** 取赔率快照(与赔率页共享缓存,通常已热;失败降级为空)。 */
async function loadOdds(): Promise<MatchOdds[]> {
  try {
    const r = await cached('odds:matches', ODDS_CACHE_MS, async () => ({
      matches: await theOddsApiProvider.getMatches(),
      fetchedAt: Date.now(),
    }));
    return r.matches;
  } catch {
    return [];
  }
}

function predictFixture(
  m: Pick<
    ScheduleMatch,
    'id' | 'homeTeam' | 'awayTeam' | 'homeLogo' | 'awayLogo' | 'commenceTime' | 'status'
  >,
  ratings: Record<string, TeamRating>,
  leagueAvg: number,
  oddsMatches: MatchOdds[],
): MatchWithPredictions {
  const odds = findMatch(oddsMatches, m.homeTeam, m.awayTeam, m.commenceTime);
  const ctx: PredictionContext = {
    matchId: m.id,
    homeName: m.homeTeam,
    awayName: m.awayTeam,
    homeNorm: normalizeTeam(m.homeTeam),
    awayNorm: normalizeTeam(m.awayTeam),
    neutral: true,
    leagueAvg,
    marketOdds: odds
      ? { home: odds.best.home?.price, draw: odds.best.draw?.price, away: odds.best.away?.price }
      : undefined,
    rating: (n) => ratings[n],
  };
  const predictions = getModels()
    .map((model) => model.predict(ctx))
    .filter((p): p is MatchPrediction => p !== null);
  return {
    matchId: m.id,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeLogo: m.homeLogo,
    awayLogo: m.awayLogo,
    commenceTime: m.commenceTime,
    status: m.status,
    predictions,
    ensemble: ensemble(predictions, m.id),
  };
}

/** 未来 days 天的世界杯比赛预测(各模型 + 融合)。 */
export async function predictUpcoming(
  days = 10,
): Promise<MatchWithPredictions[]> {
  const today = new Date(Date.now() + CN_OFFSET);
  const end = new Date(today.getTime() + days * 86400_000);
  const [fixtures, oddsMatches] = await Promise.all([
    espnProvider.getScoreboard(`${ymd(today)}-${ymd(end)}`),
    loadOdds(),
  ]);
  const ratings = loadRatings();
  const leagueAvg = leagueAverage(ratings);
  return fixtures
    .map((f) => predictFixture(f, ratings, leagueAvg, oddsMatches))
    .sort((a, b) => a.commenceTime.localeCompare(b.commenceTime));
}

/** 单场比赛预测(各模型 + 融合);用于详情页。 */
export async function predictMatch(
  matchId: string,
): Promise<MatchWithPredictions | null> {
  const [s, oddsMatches] = await Promise.all([
    espnProvider.getMatchSummary(matchId),
    loadOdds(),
  ]);
  if (!s) return null;
  const ratings = loadRatings();
  return predictFixture(
    {
      id: matchId,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      homeLogo: s.homeLogo,
      awayLogo: s.awayLogo,
      commenceTime: s.commenceTime,
      status: s.status,
    },
    ratings,
    leagueAverage(ratings),
    oddsMatches,
  );
}
