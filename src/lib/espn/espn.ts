/**
 * EspnProvider 实现 — ESPN 隐藏 API 适配器
 *
 * 端点(2026-06-14 实测):
 *  - 赛程+比分+队徽:site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD[-YYYYMMDD]
 *  - 积分榜:        v2/sports/soccer/fifa.world/standings?season=2026
 *  - 球队:          site/v2/sports/soccer/fifa.world/teams(team.logos 含暗色版)
 *  - 单场详情:      site/v2/sports/soccer/fifa.world/summary?event={id}(boxscore/rosters/keyEvents)
 *
 * 防御式解析:所有字段安全取值,缺失即降级。
 */
import type { EspnProvider } from './provider';
import type {
  ScheduleMatch,
  MatchStatus,
  GroupStanding,
  GroupStandingRow,
  Team,
  MatchEvent,
  BracketMatch,
  MatchSummary,
  TeamMatchStats,
  RosterPlayer,
  RecentGame,
  H2HGame,
} from './types';

const BASE = process.env.ESPN_BASE ?? 'https://site.api.espn.com/apis';
const LEAGUE = 'soccer/fifa.world';
const SEASON = 2026;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;
const numOr = (v: unknown, d = 0): number => {
  const n =
    typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : d;
};

async function getJSON(url: string): Promise<Json> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESPN 请求失败: ${res.status} ${url}`);
  return obj(await res.json());
}

/** team 对象 → 暗色优先的 logo URL。 */
function teamLogo(team: Json): string | undefined {
  if (str(team.logo)) return str(team.logo);
  const logos = arr(team.logos).map(obj);
  const dark = logos.find((l) => arr(l.rel).includes('dark'));
  return str((dark ?? logos[0] ?? {}).href);
}

// ── scoreboard → ScheduleMatch[] ──────────────────────
function parseEvent(ev: Json): ScheduleMatch | null {
  const comp = obj(arr(ev.competitions)[0]);
  const competitors = arr(comp.competitors).map(obj);
  const homeC = competitors.find((c) => str(c.homeAway) === 'home');
  const awayC = competitors.find((c) => str(c.homeAway) === 'away');
  if (!homeC || !awayC) return null;

  const status = obj(obj(comp.status).type ?? obj(ev.status).type);
  const state = (str(status.state) as MatchStatus) ?? 'pre';
  const teamName = (c: Json) =>
    str(obj(c.team).displayName) ?? str(obj(c.team).name) ?? '';
  const score = (c: Json) => (state === 'pre' ? undefined : numOr(c.score, 0));

  return {
    id: str(ev.id) ?? '',
    homeTeam: teamName(homeC),
    awayTeam: teamName(awayC),
    homeLogo: teamLogo(obj(homeC.team)),
    awayLogo: teamLogo(obj(awayC.team)),
    commenceTime: str(ev.date) ?? '',
    stage: str(obj(ev.season).slug) ?? 'group-stage',
    venue: str(obj(comp.venue).fullName),
    status: state,
    statusDetail: str(status.detail) ?? str(status.shortDetail),
    clock:
      str(obj(comp.status).displayClock) ?? str(obj(ev.status).displayClock),
    homeScore: score(homeC),
    awayScore: score(awayC),
  };
}

// ── standings → GroupStanding[] ───────────────────────
function statMap(entry: Json): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of arr(entry.stats).map(obj)) {
    const key = str(s.abbreviation) ?? str(s.name);
    if (key) out[key] = numOr(s.value ?? s.displayValue, 0);
  }
  return out;
}

function parseStandingRow(entry: Json): GroupStandingRow {
  const m = statMap(entry);
  return {
    team: str(obj(entry.team).displayName) ?? str(obj(entry.team).name) ?? '',
    logo: teamLogo(obj(entry.team)),
    rank: m.R ?? 0,
    played: m.GP ?? 0,
    win: m.W ?? 0,
    draw: m.D ?? 0,
    loss: m.L ?? 0,
    goalsFor: m.F ?? 0,
    goalsAgainst: m.A ?? 0,
    goalDiff: m.GD ?? 0,
    points: m.P ?? 0,
  };
}

// ── 事件(keyEvents / scoringPlays)解析 ────────────────
function parseEvents(data: Json): MatchEvent[] {
  const raw = arr(data.keyEvents).length
    ? arr(data.keyEvents)
    : arr(data.scoringPlays);
  return raw
    .map(obj)
    .map((e): MatchEvent => {
      const type = obj(e.type);
      const players = arr(e.athletesInvolved).map(obj);
      return {
        minute: str(obj(e.clock).displayValue),
        type: str(type.text) ?? 'Event',
        team: str(obj(e.team).displayName) ?? str(obj(e.team).abbreviation),
        player: str(players[0]?.displayName),
        scoringPlay:
          typeof e.scoringPlay === 'boolean'
            ? (e.scoringPlay as boolean)
            : undefined,
      };
    })
    .filter((e) => /goal|card|substitution|penalty/i.test(e.type));
}

// ── 近期战绩(lastFiveGames)→ 按 team id 索引 ──────────
function parseRecentForm(data: Json): Map<string, RecentGame[]> {
  const out = new Map<string, RecentGame[]>();
  for (const block of arr(data.lastFiveGames).map(obj)) {
    const tid = str(obj(block.team).id);
    if (!tid) continue;
    const games = arr(block.events)
      .map(obj)
      .map((e): RecentGame => {
        const r = str(e.gameResult)?.toUpperCase();
        return {
          date: str(e.gameDate) ?? '',
          result: r === 'W' || r === 'D' || r === 'L' ? r : '',
          score: str(e.score) ?? '',
          opponent: str(obj(e.opponent).displayName) ?? str(e.opponent) ?? '',
          opponentLogo: str(e.opponentLogo) ?? str(obj(e.opponent).logo),
          home: str(e.atVs) === 'vs',
          competition: str(e.competitionName) ?? str(e.leagueName),
        };
      });
    out.set(tid, games);
  }
  return out;
}

// ── 历史交锋(headToHeadGames,常为空)────────────────
function parseH2H(data: Json): H2HGame[] {
  const seen = new Set<string>();
  const out: H2HGame[] = [];
  for (const block of arr(data.headToHeadGames).map(obj)) {
    for (const e of arr(block.events).map(obj)) {
      const id = str(e.id) ?? `${str(e.gameDate)}-${str(e.score)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        date: str(e.gameDate) ?? '',
        homeTeam: str(e.homeTeamName) ?? str(obj(e.homeTeam).displayName) ?? '',
        awayTeam: str(e.awayTeamName) ?? str(obj(e.awayTeam).displayName) ?? '',
        homeScore: str(e.homeTeamScore) ?? '',
        awayScore: str(e.awayTeamScore) ?? '',
        competition: str(e.competitionName) ?? str(e.leagueName),
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const STAT_KEYS = [
  'possessionPct',
  'totalShots',
  'shotsOnTarget',
  'wonCorners',
  'foulsCommitted',
  'yellowCards',
  'redCards',
  'saves',
  'offsides',
];

export const espnProvider: EspnProvider = {
  async getScoreboard(dates: string) {
    const data = await getJSON(
      `${BASE}/site/v2/sports/${LEAGUE}/scoreboard?dates=${dates}&limit=400`,
    );
    return arr(data.events)
      .map((e) => parseEvent(obj(e)))
      .filter((m): m is ScheduleMatch => m !== null);
  },

  async getStandings() {
    const data = await getJSON(
      `${BASE}/v2/sports/${LEAGUE}/standings?season=${SEASON}`,
    );
    const groups: GroupStanding[] = [];
    for (const child of arr(data.children).map(obj)) {
      const entries = arr(obj(child.standings).entries).map(obj);
      if (!entries.length) continue;
      groups.push({
        group: str(child.name) ?? str(child.abbreviation) ?? '',
        rows: entries
          .map(parseStandingRow)
          .sort((a, b) => a.rank - b.rank || b.points - a.points),
      });
    }
    return groups;
  },

  async getTeams() {
    const data = await getJSON(`${BASE}/site/v2/sports/${LEAGUE}/teams`);
    const sports = arr(data.sports).map(obj);
    const leagues = arr(obj(sports[0]).leagues).map(obj);
    const teams = arr(obj(leagues[0]).teams).map(obj);
    return teams.map((t): Team => {
      const team = obj(t.team);
      return {
        id: str(team.id) ?? '',
        name: str(team.name) ?? str(team.displayName) ?? '',
        displayName: str(team.displayName) ?? str(team.name) ?? '',
        abbreviation: str(team.abbreviation),
        logo: teamLogo(team),
      };
    });
  },

  async getMatchEvents(eventId: string) {
    const data = await getJSON(
      `${BASE}/site/v2/sports/${LEAGUE}/summary?event=${eventId}`,
    );
    return parseEvents(data);
  },

  async getBracket() {
    const data = await getJSON(
      `${BASE}/site/v2/sports/${LEAGUE}/scoreboard?dates=${SEASON}0611-${SEASON}0719&limit=400`,
    );
    return arr(data.events)
      .map((e) => parseEvent(obj(e)))
      .filter(
        (m): m is ScheduleMatch => m !== null && m.stage !== 'group-stage',
      )
      .map(
        (m): BracketMatch => ({
          id: m.id,
          stage: m.stage,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeLogo: m.homeLogo,
          awayLogo: m.awayLogo,
          commenceTime: m.commenceTime,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          status: m.status,
        }),
      );
  },

  async getMatchSummary(eventId: string) {
    const data = await getJSON(
      `${BASE}/site/v2/sports/${LEAGUE}/summary?event=${eventId}`,
    );
    const recentForm = parseRecentForm(data);
    const giVenue = obj(obj(data.gameInfo).venue); // summary 的场馆在 gameInfo.venue
    const header = obj(data.header);
    const comp = obj(arr(header.competitions)[0]);
    const competitors = arr(comp.competitors).map(obj);
    const homeC =
      competitors.find((c) => str(c.homeAway) === 'home') ??
      obj(competitors[0]);
    const awayC =
      competitors.find((c) => str(c.homeAway) === 'away') ??
      obj(competitors[1]);
    const statusType = obj(obj(comp.status).type);
    const state = (str(statusType.state) as MatchStatus) ?? 'pre';

    const teamName = (c: Json) =>
      str(obj(c.team).displayName) ?? str(obj(c.team).name) ?? '';
    const teamId = (c: Json) => str(obj(c.team).id);
    const score = (c: Json) =>
      state === 'pre' ? undefined : numOr(c.score, 0);

    const bsTeams = arr(obj(data.boxscore).teams).map(obj);
    const statsForTeam = (tid?: string): TeamMatchStats | undefined => {
      const t = bsTeams.find((x) => str(obj(x.team).id) === tid);
      if (!t) return undefined;
      const out: Record<string, string> = {};
      for (const s of arr(t.statistics).map(obj)) {
        const k = str(s.name);
        if (k && STAT_KEYS.includes(k)) out[k] = str(s.displayValue) ?? '';
      }
      return out;
    };

    const rosters = arr(data.rosters).map(obj);
    const rosterFor = (ha: string): RosterPlayer[] => {
      const r = obj(rosters.find((x) => str(x.homeAway) === ha));
      return arr(r.roster)
        .map(obj)
        .map((p) => ({
          name: str(obj(p.athlete).displayName) ?? '',
          position: str(obj(p.position).abbreviation),
          starter: p.starter === true,
        }))
        .filter((p) => p.name);
    };

    return {
      id: eventId,
      commenceTime: str(comp.date) ?? '',
      homeTeam: teamName(homeC),
      awayTeam: teamName(awayC),
      homeLogo: teamLogo(obj(homeC.team)),
      awayLogo: teamLogo(obj(awayC.team)),
      homeScore: score(homeC),
      awayScore: score(awayC),
      status: state,
      statusDetail: str(statusType.detail) ?? str(statusType.shortDetail),
      venue: str(giVenue.fullName) ?? str(obj(comp.venue).fullName),
      city: str(obj(giVenue.address).city),
      homeStats: statsForTeam(teamId(homeC)),
      awayStats: statsForTeam(teamId(awayC)),
      events: parseEvents(data),
      homeRoster: rosterFor('home'),
      awayRoster: rosterFor('away'),
      homeForm: recentForm.get(teamId(homeC) ?? '') ?? [],
      awayForm: recentForm.get(teamId(awayC) ?? '') ?? [],
      h2h: parseH2H(data),
    };
  },
};
