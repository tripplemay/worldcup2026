/**
 * EspnProvider 实现 — ESPN 隐藏 API 适配器
 *
 * 实测端点(2026-06-14):
 *  - 赛程+比分:site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD[-YYYYMMDD]
 *  - 积分榜:    v2/sports/soccer/fifa.world/standings?season=2026(children[]=12 小组)
 *  - 球队:      site/v2/sports/soccer/fifa.world/teams(48 强)
 *  - 单场事件:  site/v2/sports/soccer/fifa.world/summary?event={id}
 *
 * 防御式解析:ESPN 结构庞杂且非官方,所有字段安全取值,缺失即降级。
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
} from './types';

const BASE = process.env.ESPN_BASE ?? 'https://site.api.espn.com/apis';
const LEAGUE = 'soccer/fifa.world';
const SEASON = 2026;

// ── 安全取值辅助 ──────────────────────────────────────
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const numOr = (v: unknown, d = 0): number => {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : d;
};

async function getJSON(url: string): Promise<Json> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESPN 请求失败: ${res.status} ${url}`);
  return obj(await res.json());
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
  const teamName = (c: Json) => str(obj(c.team).displayName) ?? str(obj(c.team).name) ?? '';
  const score = (c: Json) => (state === 'pre' ? undefined : numOr(c.score, 0));

  return {
    id: str(ev.id) ?? '',
    homeTeam: teamName(homeC),
    awayTeam: teamName(awayC),
    commenceTime: str(ev.date) ?? '',
    stage: str(obj(ev.season).slug) ?? 'group-stage',
    venue: str(obj(comp.venue).fullName),
    status: state,
    statusDetail: str(status.detail) ?? str(status.shortDetail),
    clock: str(obj(comp.status).displayClock) ?? str(obj(ev.status).displayClock),
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

export const espnProvider: EspnProvider = {
  async getScoreboard(dates: string) {
    const data = await getJSON(`${BASE}/site/v2/sports/${LEAGUE}/scoreboard?dates=${dates}&limit=400`);
    return arr(data.events)
      .map((e) => parseEvent(obj(e)))
      .filter((m): m is ScheduleMatch => m !== null);
  },

  async getStandings() {
    const data = await getJSON(`${BASE}/v2/sports/${LEAGUE}/standings?season=${SEASON}`);
    const groups: GroupStanding[] = [];
    for (const child of arr(data.children).map(obj)) {
      const entries = arr(obj(child.standings).entries).map(obj);
      if (!entries.length) continue;
      groups.push({
        group: str(child.name) ?? str(child.abbreviation) ?? '',
        rows: entries.map(parseStandingRow).sort((a, b) => a.rank - b.rank || b.points - a.points),
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
      };
    });
  },

  async getMatchEvents(eventId: string) {
    const data = await getJSON(`${BASE}/site/v2/sports/${LEAGUE}/summary?event=${eventId}`);
    // 进球/牌事件:优先 keyEvents,回退 scoringPlays
    const raw = arr(data.keyEvents).length ? arr(data.keyEvents) : arr(data.scoringPlays);
    return raw.map(obj).map((e): MatchEvent => {
      const type = obj(e.type);
      const players = arr(e.athletesInvolved).map(obj);
      return {
        minute: str(obj(e.clock).displayValue),
        type: str(type.text) ?? 'Event',
        team: str(obj(e.team).displayName) ?? str(obj(e.team).abbreviation),
        player: str(players[0]?.displayName),
        scoringPlay: typeof e.scoringPlay === 'boolean' ? (e.scoringPlay as boolean) : undefined,
      };
    });
  },

  async getBracket() {
    // 整届范围拉取,取非小组赛阶段
    const data = await getJSON(
      `${BASE}/site/v2/sports/${LEAGUE}/scoreboard?dates=${SEASON}0611-${SEASON}0719&limit=400`,
    );
    return arr(data.events)
      .map((e) => parseEvent(obj(e)))
      .filter((m): m is ScheduleMatch => m !== null && m.stage !== 'group-stage')
      .map(
        (m): BracketMatch => ({
          id: m.id,
          stage: m.stage,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          commenceTime: m.commenceTime,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          status: m.status,
        }),
      );
  },
};
