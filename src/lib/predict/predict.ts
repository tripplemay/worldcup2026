/**
 * 预测服务:把赛程 + 球队评分 + 注册的模型组装成预测结果。
 * 预测是纯计算(基于已持久化的评分),不耗 The Odds API 配额。
 */
import { espnProvider } from 'lib/espn/espn';
import { loadRatings } from 'lib/db/store';
import { normalizeTeam } from 'lib/match/normalize';
import { getModels } from './registry';
import './models'; // 副作用:注册所有模型
import type { MatchPrediction, PredictionContext } from './model';
import type { TeamRating } from './types';
import type { ScheduleMatch } from 'lib/espn/types';

const CN_OFFSET = 8 * 3600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

export interface MatchWithPredictions {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  commenceTime: string;
  status: string;
  predictions: MatchPrediction[];
}

/** 联赛基准:全体球队场均创造 xG 的均值(泊松归一化用)。 */
function leagueAverage(ratings: Record<string, TeamRating>): number {
  const vals = Object.values(ratings).map((r) => r.xgFor);
  if (!vals.length) return 1.35;
  return Math.max(0.6, vals.reduce((a, b) => a + b, 0) / vals.length);
}

function predictFixture(
  m: Pick<
    ScheduleMatch,
    'id' | 'homeTeam' | 'awayTeam' | 'homeLogo' | 'awayLogo' | 'commenceTime' | 'status'
  >,
  ratings: Record<string, TeamRating>,
  leagueAvg: number,
): MatchWithPredictions {
  const ctx: PredictionContext = {
    matchId: m.id,
    homeName: m.homeTeam,
    awayName: m.awayTeam,
    homeNorm: normalizeTeam(m.homeTeam),
    awayNorm: normalizeTeam(m.awayTeam),
    neutral: true,
    leagueAvg,
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
  };
}

/** 未来 days 天的世界杯比赛预测(各模型)。 */
export async function predictUpcoming(
  days = 10,
): Promise<MatchWithPredictions[]> {
  const today = new Date(Date.now() + CN_OFFSET);
  const end = new Date(today.getTime() + days * 86400_000);
  const fixtures = await espnProvider.getScoreboard(`${ymd(today)}-${ymd(end)}`);
  const ratings = loadRatings();
  const leagueAvg = leagueAverage(ratings);
  return fixtures
    .map((f) => predictFixture(f, ratings, leagueAvg))
    .sort((a, b) => a.commenceTime.localeCompare(b.commenceTime));
}

/** 单场比赛预测(各模型);用于详情页。 */
export async function predictMatch(
  matchId: string,
): Promise<MatchWithPredictions | null> {
  const s = await espnProvider.getMatchSummary(matchId);
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
  );
}
