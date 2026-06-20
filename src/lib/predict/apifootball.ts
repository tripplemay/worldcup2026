/**
 * API-Football(API-Sports)适配器 — 预测数据源(付费 Pro 档)。
 * 提供:球队 id 解析、近期比赛(含赛果)、单场射门统计。
 * 用于喂 xG(射门)+ Elo(赛果);未配置 API_FOOTBALL_KEY 时各函数返回空/undefined。
 */
const BASE =
  process.env.API_FOOTBALL_BASE ?? 'https://v3.football.api-sports.io';

function key(): string | undefined {
  return process.env.API_FOOTBALL_KEY;
}

export function hasApiFootball(): boolean {
  return !!key();
}

const WC_LEAGUE = Number(process.env.WC_LEAGUE ?? 1); // API-Football「世界杯」联赛 id
const WC_SEASON = process.env.WC_SEASON ?? '2026';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** 调 API-Football,返回原始 response(对象或数组;失败返回 null)。 */
async function afResponse(path: string): Promise<unknown> {
  const k = key();
  if (!k) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'x-apisports-key': k },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return obj(await res.json()).response;
  } catch {
    return null;
  }
}

/** 调 API-Football,返回 response 数组(失败返回 [])。 */
async function af(path: string): Promise<unknown[]> {
  return arr(await afResponse(path));
}

/** 解析国家队 id(优先 national 队);找不到返回 undefined。 */
export async function resolveTeamId(name: string): Promise<number | undefined> {
  const list = (await af(`/teams?search=${encodeURIComponent(name)}`)).map(obj);
  if (!list.length) return undefined;
  const nat = list.find((x) => obj(x.team).national === true) ?? list[0];
  const id = num(obj(nat.team).id);
  return id > 0 ? id : undefined;
}

export interface AfFixture {
  id: number;
  date: string; // ISO
  homeId: number;
  awayId: number;
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
}

/** 某队最近 last 场(仅已结束 FT)。 */
export async function getRecentFixtures(
  teamId: number,
  last = 15,
): Promise<AfFixture[]> {
  const list = (await af(`/fixtures?team=${teamId}&last=${last}`)).map(obj);
  const out: AfFixture[] = [];
  for (const f of list) {
    const fx = obj(f.fixture);
    if (obj(fx.status).short !== 'FT') continue; // 仅取已结束
    const teams = obj(f.teams);
    const goals = obj(f.goals);
    out.push({
      id: num(fx.id),
      date: typeof fx.date === 'string' ? fx.date : '',
      homeId: num(obj(teams.home).id),
      awayId: num(obj(teams.away).id),
      homeName: String(obj(teams.home).name ?? ''),
      awayName: String(obj(teams.away).name ?? ''),
      homeGoals: num(goals.home),
      awayGoals: num(goals.away),
    });
  }
  return out;
}

export interface H2HSummary {
  played: number;
  homeWins: number; // 以本场主队视角
  draws: number;
  awayWins: number;
  recent: {
    date: string;
    home: string;
    away: string;
    hs: number;
    as: number;
  }[];
}

/** 两队历史交锋(以本场 homeId 视角统计胜平负);需两队 id,无记录返回 null。 */
export async function getHeadToHead(
  homeId: number,
  awayId: number,
  last = 10,
): Promise<H2HSummary | null> {
  const list = (
    await af(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=${last}`)
  ).map(obj);
  const fin = list.filter((f) => obj(obj(f.fixture).status).short === 'FT');
  if (!fin.length) return null;
  let hw = 0;
  let d = 0;
  let aw = 0;
  const recent: H2HSummary['recent'] = [];
  for (const f of fin) {
    const fx = obj(f.fixture);
    const teams = obj(f.teams);
    const goals = obj(f.goals);
    const fhId = num(obj(teams.home).id);
    const fhg = num(goals.home);
    const fag = num(goals.away);
    const hScore = fhId === homeId ? fhg : fag; // 本场主队进球
    const aScore = fhId === homeId ? fag : fhg;
    if (hScore > aScore) hw++;
    else if (hScore === aScore) d++;
    else aw++;
    recent.push({
      date: typeof fx.date === 'string' ? fx.date : '',
      home: String(obj(teams.home).name ?? ''),
      away: String(obj(teams.away).name ?? ''),
      hs: fhg,
      as: fag,
    });
  }
  recent.sort((a, b) => b.date.localeCompare(a.date));
  return {
    played: fin.length,
    homeWins: hw,
    draws: d,
    awayWins: aw,
    recent: recent.slice(0, 6),
  };
}

/** 单场射门统计:teamId → { sot 射正, shots 总射门 };无统计返回 null。 */
export interface FixtureTeamStats {
  sot: number; // 射正
  shots: number; // 总射门
  xg: number; // 真实 expected_goals(缺失 NaN)
  gp: number; // goals_prevented 门将扑救价值(缺失 NaN)
}

export async function getFixtureStats(
  fixtureId: number,
): Promise<Map<number, FixtureTeamStats> | null> {
  const list = (await af(`/fixtures/statistics?fixture=${fixtureId}`)).map(obj);
  if (list.length < 2) return null;
  const map = new Map<number, FixtureTeamStats>();
  for (const t of list) {
    const tid = num(obj(t.team).id);
    const stats = arr(t.statistics).map(obj);
    const find = (type: string) => stats.find((s) => s.type === type)?.value;
    const pickF = (type: string) => {
      const v = find(type);
      return typeof v === 'number'
        ? v
        : typeof v === 'string'
        ? parseFloat(v)
        : NaN; // 缺失 → NaN
    };
    map.set(tid, {
      sot: num(find('Shots on Goal')),
      shots: num(find('Total Shots')),
      xg: pickF('expected_goals'),
      gp: pickF('goals_prevented'),
    });
  }
  return map;
}

// ── 赔率(模拟盘用;Pro 套餐自带,胜平负/亚盘/大小球全)──────
export interface AfOddPick {
  price: number;
  book: string;
}
export interface AfMatchOdds {
  h2h: { home?: AfOddPick; draw?: AfOddPick; away?: AfOddPick };
  totals: { point: number; over?: AfOddPick; under?: AfOddPick }[];
  spreads: { side: 'home' | 'away'; point: number; pick: AfOddPick }[];
  btts?: { yes?: AfOddPick; no?: AfOddPick };
  dc?: { homeDraw?: AfOddPick; homeAway?: AfOddPick; drawAway?: AfOddPick };
  dnb?: { home?: AfOddPick; away?: AfOddPick };
}

const fnum = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;

/** 某日期的世界杯赛程(id + 队名),供按对阵解析 AF fixtureId。 */
export async function getWcFixtures(
  date: string,
): Promise<{ id: number; home: string; away: string }[]> {
  const resp = (
    await af(`/fixtures?league=${WC_LEAGUE}&season=${WC_SEASON}&date=${date}`)
  ).map(obj);
  return resp
    .map((f) => ({
      id: num(obj(f.fixture).id),
      home: String(obj(obj(f.teams).home).name ?? ''),
      away: String(obj(obj(f.teams).away).name ?? ''),
    }))
    .filter((x) => x.id && x.home && x.away);
}

/** 单场各家赔率 → 取各家最优(最高)价的归一化盘口;无数据返回 null。 */
export async function getFixtureOdds(
  fixtureId: number,
): Promise<AfMatchOdds | null> {
  const resp = (await af(`/odds?fixture=${fixtureId}`)).map(obj);
  const books = arr(obj(resp[0]).bookmakers).map(obj);
  if (!books.length) return null;
  const better = (cur: AfOddPick | undefined, price: number, book: string) =>
    !cur || price > cur.price ? { price, book } : cur;
  const h2h: AfMatchOdds['h2h'] = {};
  const totals = new Map<number, { over?: AfOddPick; under?: AfOddPick }>();
  const spreads = new Map<
    string,
    { side: 'home' | 'away'; point: number; pick: AfOddPick }
  >();
  const btts: { yes?: AfOddPick; no?: AfOddPick } = {};
  const dc: AfMatchOdds['dc'] = {};
  const dnb: AfMatchOdds['dnb'] = {};
  for (const b of books) {
    const book = String(b.name ?? '');
    for (const bet of arr(b.bets).map(obj)) {
      const values = arr(bet.values).map(obj);
      for (const v of values) {
        const price = fnum(v.odd);
        if (!Number.isFinite(price)) continue;
        const val = String(v.value);
        if (bet.name === 'Match Winner') {
          const k = val.toLowerCase();
          if (k === 'home') h2h.home = better(h2h.home, price, book);
          else if (k === 'draw') h2h.draw = better(h2h.draw, price, book);
          else if (k === 'away') h2h.away = better(h2h.away, price, book);
        } else if (bet.name === 'Goals Over/Under') {
          const m = val.match(/^(Over|Under)\s+([\d.]+)$/i);
          if (!m) continue;
          const point = parseFloat(m[2]);
          const e = totals.get(point) ?? {};
          if (/^o/i.test(m[1])) e.over = better(e.over, price, book);
          else e.under = better(e.under, price, book);
          totals.set(point, e);
        } else if (bet.name === 'Asian Handicap') {
          const m = val.match(/^(Home|Away)\s+([+-]?[\d.]+)$/i);
          if (!m) continue;
          // AF 的数字是「主队让分线」,Home/Away 只表示下注哪一边。
          // 统一成「该队自身让分」:Home 用 n,Away 取相反线 −n。
          const isHome = /^h/i.test(m[1]);
          const n = parseFloat(m[2]);
          const side: 'home' | 'away' = isHome ? 'home' : 'away';
          const point = isHome ? n : -n;
          const k = `${side}|${point}`;
          const cur = spreads.get(k);
          if (!cur || price > cur.pick.price)
            spreads.set(k, { side, point, pick: { price, book } });
        } else if (bet.name === 'Both Teams Score') {
          const k = val.toLowerCase();
          if (k === 'yes') btts.yes = better(btts.yes, price, book);
          else if (k === 'no') btts.no = better(btts.no, price, book);
        } else if (bet.name === 'Double Chance') {
          // value: Home/Draw | Home/Away | Draw/Away
          if (val === 'Home/Draw')
            dc.homeDraw = better(dc.homeDraw, price, book);
          else if (val === 'Home/Away')
            dc.homeAway = better(dc.homeAway, price, book);
          else if (val === 'Draw/Away')
            dc.drawAway = better(dc.drawAway, price, book);
        } else if (bet.name === 'Home/Away') {
          // 全场胜平负去平(平局退款):value Home | Away
          const k = val.toLowerCase();
          if (k === 'home') dnb.home = better(dnb.home, price, book);
          else if (k === 'away') dnb.away = better(dnb.away, price, book);
        }
      }
    }
  }
  return {
    h2h,
    totals: [...totals.entries()].map(([point, e]) => ({ point, ...e })),
    spreads: [...spreads.values()],
    btts: btts.yes || btts.no ? btts : undefined,
    dc: dc.homeDraw || dc.homeAway || dc.drawAway ? dc : undefined,
    dnb: dnb.home || dnb.away ? dnb : undefined,
  };
}

// ── 球员出场分钟(体能用)────────────────────────────────
/** 已结束的世界杯比赛(id + 日期 + 队名)。 */
export async function getWcFinished(): Promise<
  { id: number; date: string; home: string; away: string }[]
> {
  const resp = (
    await af(`/fixtures?league=${WC_LEAGUE}&season=${WC_SEASON}`)
  ).map(obj);
  return resp
    .filter((f) =>
      /^(FT|AET|PEN)$/.test(String(obj(obj(f.fixture).status).short ?? '')),
    )
    .map((f) => ({
      id: num(obj(f.fixture).id),
      date: String(obj(f.fixture).date ?? ''),
      home: String(obj(obj(f.teams).home).name ?? ''),
      away: String(obj(obj(f.teams).away).name ?? ''),
    }))
    .filter((x) => x.id);
}

/** 单场各队球员出场分钟(未上场记 0)。 */
export async function getFixturePlayerMinutes(
  fixtureId: number,
): Promise<{ teamName: string; players: { id: number; minutes: number }[] }[]> {
  const resp = (await af(`/fixtures/players?fixture=${fixtureId}`)).map(obj);
  return resp.map((t) => ({
    teamName: String(obj(t.team).name ?? ''),
    players: arr(t.players)
      .map(obj)
      .map((p) => {
        const g = obj(obj(arr(p.statistics).map(obj)[0]).games);
        return { id: num(obj(p.player).id), minutes: num(g.minutes) };
      })
      .filter((p) => p.id),
  }));
}

const flt = (v: unknown): number => {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
};

export interface SquadPlayer {
  id: number;
  number: number;
  name: string;
}

/** 球队名单(player id + 号码 + 名);供按球衣号匹配 ESPN 名单解析球员 id。 */
export async function getSquad(teamId: number): Promise<SquadPlayer[]> {
  const list = (await af(`/players/squads?team=${teamId}`)).map(obj);
  const players = arr(list[0]?.players).map(obj);
  return players
    .map((p) => ({
      id: num(p.id),
      number: num(p.number),
      name: String(p.name ?? ''),
    }))
    .filter((p) => p.id > 0);
}

export interface PlayerSeasonForm {
  rating?: number; // 出场加权平均评分
  goals: number;
  assists: number;
  apps: number;
  leagueId?: number; // 主战联赛(出场最多)id
  leagueName?: string;
}

/**
 * 球员某赛季近期状态:汇总各赛事统计行(出场加权平均评分 + 进球/助攻/出场合计),
 * 并取出场最多的联赛作为主战联赛(用于联赛水平标注)。
 * season 用俱乐部当前赛季(如 2025 = 2025-26)。无数据返回 null。
 */
export async function getPlayerSeason(
  playerId: number,
  season: number,
): Promise<PlayerSeasonForm | null> {
  const resp = (await af(`/players?id=${playerId}&season=${season}`)).map(obj);
  const stats = arr(resp[0]?.statistics).map(obj);
  if (!stats.length) return null;
  let apps = 0;
  let goals = 0;
  let assists = 0;
  let wRating = 0;
  let wApps = 0;
  let topApps = -1;
  let leagueId: number | undefined;
  let leagueName: string | undefined;
  for (const s of stats) {
    const g = obj(s.games);
    const a = num(g.appearences);
    apps += a;
    goals += num(obj(s.goals).total);
    assists += num(obj(s.goals).assists);
    const r = flt(g.rating);
    if (Number.isFinite(r) && a > 0) {
      wRating += r * a;
      wApps += a;
    }
    const lg = obj(s.league);
    const lid = num(lg.id);
    if (a > topApps && lid > 0) {
      topApps = a;
      leagueId = lid;
      leagueName = typeof lg.name === 'string' ? lg.name : undefined;
    }
  }
  return {
    rating: wApps > 0 ? +(wRating / wApps).toFixed(2) : undefined,
    goals,
    assists,
    apps,
    leagueId,
    leagueName,
  };
}

// ── 其余增值数据:射手榜 / 球队赛季统计 / 教练 / 现成预测 ──────
const fpct = (s: unknown): number | null => {
  const n = parseFloat(String(s).replace('%', ''));
  return Number.isFinite(n) ? +(n / 100).toFixed(4) : null;
};

export interface TopScorer {
  name: string;
  team: string;
  goals: number;
  assists: number;
}
/** 世界杯射手榜(含助攻)。 */
export async function getTopScorers(): Promise<TopScorer[]> {
  const resp = (
    await af(`/players/topscorers?league=${WC_LEAGUE}&season=${WC_SEASON}`)
  ).map(obj);
  return resp
    .map((p) => {
      const st = obj(arr(p.statistics).map(obj)[0]);
      const g = obj(st.goals);
      return {
        name: String(obj(p.player).name ?? ''),
        team: String(obj(st.team).name ?? ''),
        goals: num(g.total),
        assists: num(g.assists),
      };
    })
    .filter((x) => x.name);
}

export interface TeamSeasonStats {
  form: string;
  cleanSheets: number;
  failedToScore: number;
  goalsByMinute: { range: string; goals: number }[];
}
/** 球队赛季统计(form / 零封 / 零进球 / 进球分时段)。 */
export async function getTeamStatistics(
  teamId: number,
): Promise<TeamSeasonStats | null> {
  const r = obj(
    await afResponse(
      `/teams/statistics?league=${WC_LEAGUE}&season=${WC_SEASON}&team=${teamId}`,
    ),
  );
  if (!Object.keys(r).length) return null;
  const byMin = obj(obj(obj(r.goals).for).minute);
  return {
    form: String(r.form ?? ''),
    cleanSheets: num(obj(r.clean_sheet).total),
    failedToScore: num(obj(r.failed_to_score).total),
    goalsByMinute: Object.entries(byMin).map(([range, v]) => ({
      range,
      goals: num(obj(v).total),
    })),
  };
}

/** 球队现任主教练名(/coachs 取最近一位)。 */
export async function getCoach(teamId: number): Promise<string | null> {
  const resp = (await af(`/coachs?team=${teamId}`)).map(obj);
  const name = resp[0] ? String(obj(resp[0]).name ?? '') : '';
  return name || null;
}

export interface AfPrediction {
  advice: string;
  home: number | null;
  draw: number | null;
  away: number | null;
}
/** 单场现成预测(advice + 胜平负百分比 → 概率)。 */
export async function getPrediction(
  fixtureId: number,
): Promise<AfPrediction | null> {
  const resp = (await af(`/predictions?fixture=${fixtureId}`)).map(obj);
  const p = obj(obj(resp[0]).predictions);
  if (!Object.keys(p).length) return null;
  const advice = String(p.advice ?? '');
  const winner = String(obj(p.winner).name ?? '');
  // AF 对国家队/样本不足的比赛常无可用预测,返回 winner=null + "No predictions available"
  // + 占位 33/33/33;此类一律视为无数据(面板不渲染)。
  if (!winner || /no predictions/i.test(advice)) return null;
  const pc = obj(p.percent);
  return {
    advice,
    home: fpct(pc.home),
    draw: fpct(pc.draw),
    away: fpct(pc.away),
  };
}
