/**
 * 预测服务:把赛程 + 球队评分 + 市场赔率 + 注册的模型组装成多模型预测 + 融合。
 * 预测本体是纯计算;市场赔率复用与赔率页相同的缓存(`odds:matches`),通常已热,无额外配额。
 */
import { espnProvider } from 'lib/espn/espn';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { cached } from 'lib/cache';
import { loadRatings, loadElo, loadAfTeams } from 'lib/db/store';
import { normalizeTeam, findMatch } from 'lib/match/normalize';
import { getModels } from './registry';
import { ensemble } from './ensemble';
import { getIntel } from 'lib/intel/intel';
import { findVenue } from 'lib/data/venues';
import { getHeadToHead, type H2HSummary } from './apifootball';
import './models'; // 副作用:注册所有模型
import type { MatchPrediction, PredictionContext } from './model';
import type { TeamRating } from './types';
import type { TeamIntel } from 'lib/intel/types';
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
  weightMode?: 'gap' | 'even' | 'normal'; // 动态权重模式(实力悬殊/势均/常规)
  homeIntel?: TeamIntel | null; // 主队场外情报(详情页)
  awayIntel?: TeamIntel | null;
  adjusted?: { home: number; draw: number; away: number } | null; // 情报修正后(旁注参考)
  h2h?: H2HSummary | null; // 历史交锋(API-Football)
}

/** 把情报修正量叠加到融合概率(Path B),重归一化;无显著修正返回 null。 */
function applyIntel(
  ens: MatchPrediction | null,
  hi?: TeamIntel | null,
  ai?: TeamIntel | null,
): { home: number; draw: number; away: number } | null {
  if (!ens) return null;
  const mh = hi?.modifier ?? 0;
  const ma = ai?.modifier ?? 0;
  if (Math.abs(mh) < 0.005 && Math.abs(ma) < 0.005) return null;
  const h = Math.max(0.01, ens.homeWin + mh);
  const a = Math.max(0.01, ens.awayWin + ma);
  const d = Math.max(0.01, ens.draw);
  const s = h + d + a;
  return {
    home: +(h / s).toFixed(4),
    draw: +(d / s).toFixed(4),
    away: +(a / s).toFixed(4),
  };
}

/** 承办国(归一化队名 → 场馆国家),用于主场优势判定。 */
const HOST: Record<string, 'USA' | 'Canada' | 'Mexico'> = {
  usa: 'USA',
  canada: 'Canada',
  mexico: 'Mexico',
};

/** Elo 主场优势 H:主队为东道主且在本国比赛 +100;客队为东道主在本国 −100;否则中立 0。 */
function homeAdvantage(
  homeNorm: string,
  awayNorm: string,
  venue?: string,
  city?: string,
): number {
  const country = findVenue(venue, city)?.country;
  if (!country) return 0;
  if (HOST[homeNorm] === country) return 100;
  if (HOST[awayNorm] === country) return -100;
  return 0;
}

/** 联赛基准:全体球队场均创造 xG 的均值(泊松归一化用)。 */
function leagueAverage(ratings: Record<string, TeamRating>): number {
  const vals = Object.values(ratings).map((r) => r.xgFor);
  if (!vals.length) return 1.35;
  return Math.max(0.6, vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** 联赛基准:全体球队场均实际进球均值(进球泊松归一化用)。 */
function leagueAverageGoals(ratings: Record<string, TeamRating>): number {
  const vals = Object.values(ratings).map((r) => r.goalsFor);
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
    | 'id'
    | 'homeTeam'
    | 'awayTeam'
    | 'homeLogo'
    | 'awayLogo'
    | 'commenceTime'
    | 'status'
    | 'venue'
  >,
  ratings: Record<string, TeamRating>,
  eloMap: Record<string, number>,
  leagueAvg: number,
  leagueAvgGoals: number,
  oddsMatches: MatchOdds[],
  city?: string,
): MatchWithPredictions {
  const odds = findMatch(oddsMatches, m.homeTeam, m.awayTeam, m.commenceTime);
  const homeNorm = normalizeTeam(m.homeTeam);
  const awayNorm = normalizeTeam(m.awayTeam);
  const H = homeAdvantage(homeNorm, awayNorm, m.venue, city);
  const ctx: PredictionContext = {
    matchId: m.id,
    homeName: m.homeTeam,
    awayName: m.awayTeam,
    homeNorm,
    awayNorm,
    neutral: H === 0,
    homeAdvantage: H,
    leagueAvg,
    leagueAvgGoals,
    marketOdds: odds
      ? {
          home: odds.best.home?.price,
          draw: odds.best.draw?.price,
          away: odds.best.away?.price,
        }
      : undefined,
    rating: (n) => ratings[n],
    eloOf: (n) => eloMap[n],
  };
  const predictions = getModels()
    .map((model) => model.predict(ctx))
    .filter((p): p is MatchPrediction => p !== null);
  // Elo 差(不含主场优势)→ 动态权重模式
  const eh = eloMap[homeNorm];
  const ea = eloMap[awayNorm];
  const eloDiff =
    Number.isFinite(eh) && Number.isFinite(ea) ? Math.abs(eh - ea) : undefined;
  const weightMode =
    eloDiff == null
      ? undefined
      : eloDiff > 250
      ? 'gap'
      : eloDiff < 50
      ? 'even'
      : 'normal';
  return {
    matchId: m.id,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeLogo: m.homeLogo,
    awayLogo: m.awayLogo,
    commenceTime: m.commenceTime,
    status: m.status,
    predictions,
    ensemble: ensemble(predictions, m.id, eloDiff),
    weightMode,
  };
}

/** 未来 days 天的世界杯比赛预测(各模型 + 融合)。 */
export async function predictUpcoming(
  days = 10,
): Promise<MatchWithPredictions[]> {
  const today = new Date(Date.now() + CN_OFFSET);
  // ESPN scoreboard 按「美东日期」分桶,与北京日期最多差 ~12h:北京跨过午夜进入次日后,
  // 美东仍是当天,直接用北京日期作 range 起点会漏掉"美东今日尚未开打"的早场。
  // 故起点往前推 1 天兜底,再用 status 过滤掉已结束的场次(预测只面向未开打/进行中)。
  const start = new Date(today.getTime() - 86400_000);
  const end = new Date(today.getTime() + days * 86400_000);
  const [fixtures, oddsMatches] = await Promise.all([
    espnProvider.getScoreboard(`${ymd(start)}-${ymd(end)}`),
    loadOdds(),
  ]);
  const ratings = loadRatings();
  const eloMap = loadElo();
  const leagueAvg = leagueAverage(ratings);
  const leagueAvgGoals = leagueAverageGoals(ratings);
  return fixtures
    .filter((f) => f.status !== 'post')
    .map((f) =>
      predictFixture(
        f,
        ratings,
        eloMap,
        leagueAvg,
        leagueAvgGoals,
        oddsMatches,
      ),
    )
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
  const eloMap = loadElo();
  const base = predictFixture(
    {
      id: matchId,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      homeLogo: s.homeLogo,
      awayLogo: s.awayLogo,
      commenceTime: s.commenceTime,
      status: s.status,
      venue: s.venue,
    },
    ratings,
    eloMap,
    leagueAverage(ratings),
    leagueAverageGoals(ratings),
    oddsMatches,
    s.city,
  );
  // 附场外情报(旁注;不改主概率)
  const homeIntel = getIntel(normalizeTeam(s.homeTeam)) ?? null;
  const awayIntel = getIntel(normalizeTeam(s.awayTeam)) ?? null;
  // 历史交锋(API-Football,需两队 id 已缓存)
  const af = loadAfTeams();
  const hid = af[normalizeTeam(s.homeTeam)];
  const aid = af[normalizeTeam(s.awayTeam)];
  const h2h = hid && aid ? await getHeadToHead(hid, aid) : null;
  return {
    ...base,
    homeIntel,
    awayIntel,
    adjusted: applyIntel(base.ensemble, homeIntel, awayIntel),
    h2h,
  };
}
