/**
 * 组装单支球队的杯赛档案(服务端):身份/战绩/逐场/杯赛数据/实力雷达/当前状态/阵容。
 * 数据全部来自已有缓存与 JSON 存储(ESPN scoreboard/standings/summary + historical/elo/tmi/team-stats),
 * 不耗赔率配额;缺失项优雅降级。
 */
import { espnProvider } from 'lib/espn/espn';
import { cached } from 'lib/cache';
import {
  loadHistorical,
  loadElo,
  loadRatings,
  loadAfTeams,
  loadTeamStats,
} from 'lib/db/store';
import { loadTmiSnapshot } from 'lib/tmi/engine';
import { DEFAULT_WC_START } from 'lib/tmi/constants';
import { attachPlayerForm } from 'lib/lineup/playerForm';
import { getTeamStatistics, getCoach } from 'lib/predict/apifootball';
import { leagueLevel } from 'lib/data/leagues';
import { normalizeTeam } from 'lib/match/normalize';
import {
  attackScore,
  defenseScore,
  strengthScore,
  squadScore,
  momentumScore,
  fitnessScore,
  formScore,
  grade,
  teamStyle,
} from './score';
import type {
  TeamProfile,
  TeamFixture,
  TeamStandingInfo,
  CupStats,
  SquadDepth,
  RadarAxis,
} from './types';
import type { RosterPlayer } from 'lib/espn/types';

const SEASON = process.env.WC_SEASON ?? '2026';
const WC_RANGE = `${SEASON}0611-${SEASON}0719`;
const wcStart = () => process.env.WC_START?.trim() || DEFAULT_WC_START;
const dateKey = (iso: string) => iso.slice(0, 10);

const scoreboardWC = () =>
  cached('espn:scoreboard:wc', 300_000, () =>
    espnProvider.getScoreboard(WC_RANGE),
  );
const teamsList = () =>
  cached('espn:teams', 21_600_000, () => espnProvider.getTeams());
const standingsList = () =>
  cached('espn:standings', 300_000, () => espnProvider.getStandings());

/** 该队在小组榜中的战绩。 */
async function findStanding(norm: string): Promise<TeamStandingInfo | null> {
  const groups = await standingsList();
  for (const g of groups) {
    const row = g.rows.find((r) => normalizeTeam(r.team) === norm);
    if (row)
      return {
        group: g.group,
        rank: row.rank,
        played: row.played,
        win: row.win,
        draw: row.draw,
        loss: row.loss,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDiff: row.goalDiff,
        points: row.points,
      };
  }
  return null;
}

/** 该队逐场赛果(世界杯范围内,按日期升序)。 */
async function teamFixtures(norm: string): Promise<TeamFixture[]> {
  const all = await scoreboardWC();
  return all
    .filter((m) =>
      [normalizeTeam(m.homeTeam), normalizeTeam(m.awayTeam)].includes(norm),
    )
    .map((m): TeamFixture => {
      const home = normalizeTeam(m.homeTeam) === norm;
      const gf = home ? m.homeScore : m.awayScore;
      const ga = home ? m.awayScore : m.homeScore;
      let result: TeamFixture['result'] = '';
      if (m.status === 'post' && gf != null && ga != null)
        result = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
      return {
        eventId: m.id,
        date: m.commenceTime,
        opponent: home ? m.awayTeam : m.homeTeam,
        opponentLogo: home ? m.awayLogo : m.homeLogo,
        home,
        gf,
        ga,
        result,
        status: m.status,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 杯赛 xG 攻防 + 进失球 + 门将扑救价值(historical 杯赛场次;样本<2 回退近期 EWMA)。 */
function cupXgGoals(norm: string): {
  xgF: number;
  xgA: number;
  gf: number;
  ga: number;
  gp: number | null; // 场均 goals_prevented(真实;无则 null)
  n: number;
  source: 'cup' | 'season';
} {
  const start = wcStart();
  let xgF = 0,
    xgA = 0,
    gf = 0,
    ga = 0,
    n = 0,
    gpSum = 0,
    gpN = 0;
  for (const h of Object.values(loadHistorical())) {
    if (dateKey(h.date) < start) continue;
    const home = normalizeTeam(h.homeName) === norm;
    const away = normalizeTeam(h.awayName) === norm;
    if (!home && !away) continue;
    xgF += home ? h.homeXg : h.awayXg;
    xgA += home ? h.awayXg : h.homeXg;
    gf += home ? h.homeGoals : h.awayGoals;
    ga += home ? h.awayGoals : h.homeGoals;
    n += 1;
    const gp = home ? h.homeGp : h.awayGp;
    if (gp != null) {
      gpSum += gp;
      gpN += 1;
    }
  }
  if (n >= 2)
    return {
      xgF: xgF / n,
      xgA: xgA / n,
      gf: gf / n,
      ga: ga / n,
      gp: gpN ? gpSum / gpN : null,
      n,
      source: 'cup',
    };
  const r = loadRatings()[norm];
  return {
    xgF: r?.xgFor ?? 0,
    xgA: r?.xgAgainst ?? 0,
    gf: r?.goalsFor ?? 0,
    ga: r?.goalsAgainst ?? 0,
    gp: null,
    n,
    source: 'season',
  };
}

/** 最近一场已结束比赛的首发(含 form)+ 阵型;无则空。 */
async function latestRoster(
  norm: string,
  fixtures: TeamFixture[],
): Promise<{ roster: RosterPlayer[]; formation?: string }> {
  const post = fixtures.filter((f) => f.status === 'post');
  const last = post[post.length - 1];
  if (!last) return { roster: [] };
  const s = await espnProvider.getMatchSummary(last.eventId);
  if (!s) return { roster: [] };
  const home = normalizeTeam(s.homeTeam) === norm;
  const raw = home ? s.homeRoster : s.awayRoster;
  const formation = home ? s.homeFormation : s.awayFormation;
  const afId = loadAfTeams()[norm];
  const withForm = attachPlayerForm(afId, raw);
  return { roster: withForm.filter((p) => p.starter), formation };
}

/** 首发阵容深度:赛季均评分 + 五大联赛占比。 */
function squadDepth(roster: RosterPlayer[]): SquadDepth | null {
  const rated = roster.filter((p) => p.form?.rating != null);
  if (rated.length < 5) return null; // 样本太少不评
  const avgRating =
    rated.reduce((a, p) => a + (p.form!.rating as number), 0) / rated.length;
  const withLeague = roster.filter((p) => p.form?.leagueId != null);
  const top5 = withLeague.filter(
    (p) => leagueLevel(p.form!.leagueId, 'en')?.tier === 1,
  ).length;
  return {
    avgRating: +avgRating.toFixed(2),
    top5Share: withLeague.length ? top5 / withLeague.length : 0,
    count: rated.length,
  };
}

/** 组装球队档案;球队 id 不存在时返回 null。 */
export async function buildTeamProfile(
  espnId: string,
): Promise<TeamProfile | null> {
  const teams = await teamsList();
  const team = teams.find((t) => t.id === espnId);
  if (!team) return null;
  const norm = normalizeTeam(team.displayName);

  const [standing, fixtures] = await Promise.all([
    findStanding(norm),
    teamFixtures(norm),
  ]);
  const { roster, formation } = await latestRoster(norm, fixtures);

  // 赛季统计 + 主教练(API-Football,懒加载缓存;无 key/无 id 则跳过)
  const afId = loadAfTeams()[norm];
  const extras = afId
    ? await cached(`af:team-extras:${afId}`, 21_600_000, async () => ({
        season: await getTeamStatistics(afId),
        coach: await getCoach(afId),
      }))
    : null;

  // 杯赛数据
  const xg = cupXgGoals(norm);
  const stats = loadTeamStats().teams[norm];
  const per = (v: number, g: number) =>
    g > 0 ? +(v / g).toFixed(1) : undefined;
  const cup: CupStats = {
    matchesPlayed: standing?.played ?? xg.n,
    xgForPerMatch: +xg.xgF.toFixed(2),
    xgAgainstPerMatch: +xg.xgA.toFixed(2),
    xgSource: xg.source,
    goalsForPerMatch: +xg.gf.toFixed(2),
    goalsAgainstPerMatch: +xg.ga.toFixed(2),
    shotsPerMatch: stats ? per(stats.shots, stats.games) : undefined,
    sotPerMatch: stats ? per(stats.sot, stats.games) : undefined,
    possessionPct: stats ? per(stats.possession, stats.games) : undefined,
    cornersPerMatch: stats ? per(stats.corners, stats.games) : undefined,
    foulsPerMatch: stats ? per(stats.fouls, stats.games) : undefined,
    yellowPerMatch: stats ? per(stats.yellow, stats.games) : undefined,
    redTotal: stats ? stats.red : undefined,
  };

  // 当前状态(TMI)
  const tmi = loadTmiSnapshot().teams.find((x) => x.teamId === norm) ?? null;
  const formStreak = fixtures
    .filter((f) => f.status === 'post')
    .map((f) => f.result)
    .slice(-5);
  const momentum = momentumScore(tmi?.total ?? 0);
  const fitness = fitnessScore(tmi?.normalized.fatiguePenalty ?? 0);
  const recentForm = formScore(formStreak);

  // 实力档案雷达
  const elo = loadElo()[norm] ?? loadRatings()[norm]?.elo ?? 1500;
  const depth = squadDepth(roster);
  const sq = squadScore(depth);
  const strengthRadar: RadarAxis[] = [
    { key: 'attack', value: +attackScore(xg.xgF).toFixed(0), available: true },
    {
      key: 'defense',
      value: +defenseScore(xg.xgA).toFixed(0),
      available: true,
    },
    { key: 'strength', value: +strengthScore(elo).toFixed(0), available: true },
    { key: 'squad', value: +(sq ?? 50).toFixed(0), available: sq != null },
  ];
  const avail = strengthRadar.filter((a) => a.available);
  const strengthAvg = avail.length
    ? Math.round(avail.reduce((a, x) => a + x.value, 0) / avail.length)
    : 0;

  return {
    id: team.id,
    name: team.displayName,
    normName: norm,
    logo: team.logo,
    standing,
    fixtures,
    cup,
    strengthRadar,
    strengthAvg,
    state: { momentum, fitness, recentForm, formStreak, tmi },
    grade: grade({ momentum, recentForm, fitness }),
    style: teamStyle(xg.xgF, xg.xgA, xg.gf, xg.ga, xg.gp),
    squad: depth,
    roster,
    rosterFormation: formation,
    coach: extras?.coach ?? undefined,
    season: extras?.season ?? undefined,
  };
}
