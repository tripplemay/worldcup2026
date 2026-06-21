/**
 * 联赛预测服务(Phase 2):竞赛感知版 predictUpcoming/predictMatch。
 *
 * - 评分:由该联赛已摄取的 historical(真 xG)/results 即时算(EWMA + 自算 Elo),带缓存。
 * - 配置:按 comp 分流(leagues.ts 的 CompetitionConfig)——R1 shrinkEloScale、联赛 flat 主场
 *   优势(每个主场加 calib.hfaElo / λ×hfaMult)、market 锚定权重。
 * - 赛程/比分:ESPN 联赛 scoreboard(off-season 为空);赔率:The Odds API 联赛 key(in-season)。
 *
 * 数据与世界杯完全隔离(league-<key>-*.json),WC 预测路径不受影响。
 */
import { getLeagueEspnProvider } from 'lib/espn/espn';
import { getLeagueOddsMatches } from 'lib/odds/theoddsapi';
import { cached } from 'lib/cache';
import { loadLeagueHistorical, loadLeagueResults } from 'lib/db/store';
import { normalizeTeam, findMatch } from 'lib/match/normalize';
import { computeElo, ratingsFromHistorical } from './ratings';
import { getModels } from './registry';
import { ensemble } from './ensemble';
import { tiltEnsembleScores } from './models/poissonCore';
import { getLeague, getCompetitionConfig } from './leagues';
import type { CompetitionConfig } from './leagues';
import './models'; // 副作用:注册模型
import type { MatchPrediction, PredictionContext } from './model';
import type { TeamRating } from './types';
import type { MatchOdds } from 'lib/odds/types';
import type { ScheduleMatch } from 'lib/espn/types';
import type { MatchWithPredictions } from './predict';

const CN_OFFSET = 8 * 3600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const ODDS_CACHE_MS = 1_800_000; // 30min(联赛盘前赔率,省配额)
const RATINGS_CACHE_MS = 1_800_000;

interface LeagueRatings {
  ratings: Record<string, TeamRating>;
  elo: Map<string, number>;
  leagueAvg: number;
  leagueAvgGoals: number;
  teams: number;
}

const avg = (xs: number[], floor = 0.6, fallback = 1.35) =>
  xs.length
    ? Math.max(floor, xs.reduce((a, b) => a + b, 0) / xs.length)
    : fallback;

/** 由该联赛已摄取数据即时算评分(EWMA + 自算 Elo);静态数据,带缓存。 */
function buildLeagueRatings(key: string): LeagueRatings {
  const hist = Object.values(loadLeagueHistorical(key));
  const results = Object.values(loadLeagueResults(key));
  const elo = computeElo(results.length ? results : hist);
  const ratings = ratingsFromHistorical(hist, (n) => elo.get(n));
  const vals = Object.values(ratings);
  return {
    ratings,
    elo,
    leagueAvg: avg(vals.map((r) => r.xgFor)),
    leagueAvgGoals: avg(vals.map((r) => r.goalsFor)),
    teams: vals.length,
  };
}

async function leagueRatings(key: string): Promise<LeagueRatings> {
  return cached(`league:ratings:${key}`, RATINGS_CACHE_MS, async () =>
    buildLeagueRatings(key),
  );
}

/** 单场联赛预测(应用 comp 配置:flat 主场 + R1 + market 权重)。 */
function predictLeagueFixture(
  m: Pick<
    ScheduleMatch,
    | 'id'
    | 'homeTeam'
    | 'awayTeam'
    | 'homeLogo'
    | 'awayLogo'
    | 'commenceTime'
    | 'status'
  >,
  data: LeagueRatings,
  cfg: CompetitionConfig,
  oddsMatches: MatchOdds[],
): MatchWithPredictions {
  const homeNorm = normalizeTeam(m.homeTeam);
  const awayNorm = normalizeTeam(m.awayTeam);
  const odds = findMatch(oddsMatches, m.homeTeam, m.awayTeam, m.commenceTime);
  const ctx: PredictionContext = {
    matchId: m.id,
    homeName: m.homeTeam,
    awayName: m.awayTeam,
    homeNorm,
    awayNorm,
    neutral: cfg.hfaElo === 0, // 联赛非中立(意甲 hfaElo=0 → 中立)
    homeAdvantage: cfg.hfaElo, // 联赛 flat:每个主场都加
    homeGoalMult: cfg.hfaMult,
    leagueAvg: data.leagueAvg,
    leagueAvgGoals: data.leagueAvgGoals,
    marketOdds: odds
      ? {
          home: odds.best.home?.price,
          draw: odds.best.draw?.price,
          away: odds.best.away?.price,
        }
      : undefined,
    rating: (n) => data.ratings[n],
    eloOf: (n) => data.elo.get(n),
    tuning: {
      shrinkEloScale: cfg.shrinkEloScale,
      goalShrink: cfg.goalShrink,
      dcRho: cfg.dcRho,
    },
  };
  const predictions = getModels()
    .map((md) => md.predict(ctx))
    .filter((p): p is MatchPrediction => p !== null);
  const eh = data.elo.get(homeNorm);
  const ea = data.elo.get(awayNorm);
  const eloDiff = eh != null && ea != null ? Math.abs(eh - ea) : undefined;
  const weightMode =
    eloDiff == null
      ? undefined
      : eloDiff > 250
      ? 'gap'
      : eloDiff < 50
      ? 'even'
      : 'normal';
  const ens = ensemble(predictions, m.id, eloDiff, cfg.marketWeight);
  const ensTilted = ens ? tiltEnsembleScores(ens, predictions) : null;
  return {
    matchId: m.id,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeLogo: m.homeLogo,
    awayLogo: m.awayLogo,
    commenceTime: m.commenceTime,
    status: m.status,
    predictions,
    // 展示层后验倾斜:比分/大小球向 ensemble 头条对齐(Phase 8.1 Q5)
    ensemble: ensTilted,
    weightMode,
  };
}

/** 某联赛未来 days 天比赛预测(off-season ESPN 无赛程 → 返回空)。 */
export async function predictLeagueUpcoming(
  comp: string,
  days = 10,
): Promise<MatchWithPredictions[]> {
  const league = getLeague(comp);
  if (!league) return [];
  const cfg = getCompetitionConfig(comp);
  const today = new Date(Date.now() + CN_OFFSET);
  const start = new Date(today.getTime() - 86400_000);
  const end = new Date(today.getTime() + days * 86400_000);
  const espn = getLeagueEspnProvider(league.espnSlug, today.getFullYear());
  const [data, fixtures, oddsMatches] = await Promise.all([
    leagueRatings(league.key),
    espn.getScoreboard(`${ymd(start)}-${ymd(end)}`).catch(() => []),
    cached(`league:odds:${comp}`, ODDS_CACHE_MS, async () =>
      getLeagueOddsMatches(league.oddsKey),
    ).catch(() => [] as MatchOdds[]),
  ]);
  return fixtures
    .filter((f) => f.status !== 'post')
    .map((f) => predictLeagueFixture(f, data, cfg, oddsMatches))
    .sort((a, b) => a.commenceTime.localeCompare(b.commenceTime));
}

/** 单场联赛预测(详情页);用 ESPN summary 取对阵。 */
export async function predictLeagueMatch(
  comp: string,
  matchId: string,
): Promise<MatchWithPredictions | null> {
  const league = getLeague(comp);
  if (!league) return null;
  const cfg = getCompetitionConfig(comp);
  const espn = getLeagueEspnProvider(league.espnSlug, new Date().getFullYear());
  const [data, s, oddsMatches] = await Promise.all([
    leagueRatings(league.key),
    espn.getMatchSummary(matchId).catch(() => null),
    cached(`league:odds:${comp}`, ODDS_CACHE_MS, async () =>
      getLeagueOddsMatches(league.oddsKey),
    ).catch(() => [] as MatchOdds[]),
  ]);
  if (!s) return null;
  return predictLeagueFixture(
    {
      id: matchId,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      homeLogo: s.homeLogo,
      awayLogo: s.awayLogo,
      commenceTime: s.commenceTime,
      status: s.status,
    },
    data,
    cfg,
    oddsMatches,
  );
}

/** 联赛当前评分概览(供刷新端点/诊断)。 */
export async function leagueRatingsSummary(comp: string): Promise<{
  comp: string;
  key: string;
  teams: number;
  leagueAvg: number;
} | null> {
  const league = getLeague(comp);
  if (!league) return null;
  const d = await leagueRatings(league.key);
  return { comp, key: league.key, teams: d.teams, leagueAvg: d.leagueAvg };
}
