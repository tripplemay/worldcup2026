/**
 * TheOddsApiProvider — The Odds API 适配器
 *
 * 实测要点(2026-06-14):
 *  - 单场 soccer_fifa_world_cup,markets=h2h,outcomes 顺序不固定且用「队名/Draw」标识
 *    → 按 name 匹配 home_team / away_team / Draw 归位主胜/平/客胜
 *  - 夺冠 soccer_fifa_world_cup_winner,markets=outrights(忽略 outrights_lay)
 *  - 每次请求消耗 1 credit × regions × markets;响应头带配额 → updateQuota
 */
import type { OddsProvider } from './provider';
import type {
  RawOddsEvent,
  MatchOdds,
  BookmakerOdds,
  WinnerMarket,
  OutrightOdds,
  MatchMarkets,
  BookmakerMarkets,
  GroupMarkets,
  MarketGroup,
  AggOuLine,
  AggAhLine,
  BookThreeWay,
  BookTotalsLine,
  PlayerPick,
  PlayerOuPick,
} from './types';
import { updateQuota } from './quota';

const BASE = process.env.ODDS_API_BASE ?? 'https://api.the-odds-api.com/v4';
const REGIONS = process.env.ODDS_API_REGIONS ?? 'eu';
const ODDS_FORMAT = process.env.ODDS_API_ODDS_FORMAT ?? 'decimal';

const SPORT_MATCHES = 'soccer_fifa_world_cup';
const SPORT_WINNER = 'soccer_fifa_world_cup_winner';

function requireKey(): string {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error('ODDS_API_KEY 未配置');
  return key;
}

async function fetchOdds(
  sport: string,
  markets: string,
): Promise<RawOddsEvent[]> {
  const url =
    `${BASE}/sports/${sport}/odds/` +
    `?apiKey=${requireKey()}&regions=${REGIONS}&markets=${markets}&oddsFormat=${ODDS_FORMAT}`;
  const res = await fetch(url, { cache: 'no-store' });
  updateQuota(res.headers);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `The Odds API ${sport} 请求失败: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as RawOddsEvent[];
}

/** 把一场比赛的多家 h2h 赔率归位为主胜/平/客胜 + 计算全场最优(最高赔率)。 */
function parseMatch(ev: RawOddsEvent): MatchOdds {
  const bookmakers: BookmakerOdds[] = [];
  const best: MatchOdds['best'] = {};

  const bump = (
    k: 'home' | 'draw' | 'away',
    price: number | undefined,
    bookmaker: string,
  ) => {
    if (price == null) return;
    if (!best[k] || price > best[k]!.price) best[k] = { price, bookmaker };
  };

  for (const bk of ev.bookmakers) {
    const h2h = bk.markets.find((m) => m.key === 'h2h');
    if (!h2h) continue;
    let home: number | undefined;
    let draw: number | undefined;
    let away: number | undefined;
    for (const oc of h2h.outcomes) {
      if (oc.name === ev.home_team) home = oc.price;
      else if (oc.name === ev.away_team) away = oc.price;
      else if (oc.name.toLowerCase() === 'draw') draw = oc.price;
    }
    bookmakers.push({
      key: bk.key,
      title: bk.title,
      lastUpdate: bk.last_update,
      home,
      draw,
      away,
    });
    bump('home', home, bk.key);
    bump('draw', draw, bk.key);
    bump('away', away, bk.key);
  }

  return {
    id: ev.id,
    homeTeam: ev.home_team,
    awayTeam: ev.away_team,
    commenceTime: ev.commence_time,
    bookmakers,
    best,
  };
}

/** 解析夺冠赔率:取各家最优(最高)赔率,按最被看好(赔率升序)排序。 */
function parseWinner(data: RawOddsEvent[]): WinnerMarket {
  const bestByTeam = new Map<string, { price: number; bookmaker: string }>();
  let lastUpdate = '';

  for (const ev of data) {
    for (const bk of ev.bookmakers) {
      const market = bk.markets.find((m) => m.key === 'outrights'); // 忽略 outrights_lay
      if (!market) continue;
      if (bk.last_update > lastUpdate) lastUpdate = bk.last_update;
      for (const oc of market.outcomes) {
        const cur = bestByTeam.get(oc.name);
        if (!cur || oc.price > cur.price) {
          bestByTeam.set(oc.name, { price: oc.price, bookmaker: bk.key });
        }
      }
    }
  }

  const outrights: OutrightOdds[] = Array.from(bestByTeam.entries())
    .map(([team, { price, bookmaker }]) => ({
      team,
      price,
      bookmaker,
      impliedProbability: price > 0 ? 1 / price : 0,
    }))
    .sort((a, b) => a.price - b.price); // 升序:最被看好在前

  return { lastUpdate, outrights };
}

/** 请求单场 event 的指定市场(event 端点返回单个 event 对象)。 */
async function fetchEventOdds(
  oddsEventId: string,
  markets: string,
): Promise<RawOddsEvent> {
  const url =
    `${BASE}/sports/${SPORT_MATCHES}/events/${oddsEventId}/odds/` +
    `?apiKey=${requireKey()}&regions=${REGIONS}&markets=${markets}&oddsFormat=${ODDS_FORMAT}`;
  const res = await fetch(url, { cache: 'no-store' });
  updateQuota(res.headers);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `The Odds API event odds 失败: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as RawOddsEvent;
}

// ── 富盘口聚合解析(取各家最优价)──────────────────────────
/** 大小球按盘口线聚合,各线取最优大/最优小(alternate_totals_*)。 */
function aggOu(ev: RawOddsEvent, key: string): AggOuLine[] {
  const lines = new Map<number, AggOuLine>();
  for (const bk of ev.bookmakers ?? []) {
    const mk = bk.markets.find((m) => m.key === key);
    if (!mk) continue;
    for (const o of mk.outcomes) {
      const pt = o.point ?? 0;
      const side =
        o.name.toLowerCase() === 'over'
          ? 'over'
          : o.name.toLowerCase() === 'under'
          ? 'under'
          : null;
      if (!side) continue;
      let line = lines.get(pt);
      if (!line) {
        line = { point: pt };
        lines.set(pt, line);
      }
      if (!line[side] || o.price > line[side]!.price) {
        line[side] = { price: o.price, book: bk.title };
      }
    }
  }
  return [...lines.values()].sort((a, b) => a.point - b.point);
}

/** 让球按(队,让分)聚合,取最优价(alternate_spreads_*)。 */
function aggAh(ev: RawOddsEvent, key: string): AggAhLine[] {
  const lines = new Map<string, AggAhLine>();
  for (const bk of ev.bookmakers ?? []) {
    const mk = bk.markets.find((m) => m.key === key);
    if (!mk) continue;
    for (const o of mk.outcomes) {
      const pt = o.point ?? 0;
      const id = `${o.name}|${pt}`;
      const cur = lines.get(id);
      if (!cur || o.price > cur.best.price) {
        lines.set(id, {
          team: o.name,
          point: pt,
          best: { price: o.price, book: bk.title },
        });
      }
    }
  }
  return [...lines.values()].sort(
    (a, b) => a.team.localeCompare(b.team) || a.point - b.point,
  );
}

/** 球员是/否盘(取 "Yes",按 description=球员名 聚合最优价),按赔率升序(最被看好在前)。 */
function aggPlayerYes(ev: RawOddsEvent, key: string): PlayerPick[] {
  const by = new Map<string, PlayerPick>();
  for (const bk of ev.bookmakers ?? []) {
    const mk = bk.markets.find((m) => m.key === key);
    if (!mk) continue;
    for (const o of mk.outcomes) {
      if (o.name.toLowerCase() !== 'yes' || !o.description) continue;
      const cur = by.get(o.description);
      if (!cur || o.price > cur.best.price) {
        by.set(o.description, {
          player: o.description,
          best: { price: o.price, book: bk.title },
        });
      }
    }
  }
  return [...by.values()].sort((a, b) => a.best.price - b.best.price);
}

/**
 * 球员大小盘(取 "Over")。每球员只保留**主线(最低盘口线)**,取该线各家最优价,
 * 按赔率升序(最可能命中在前)。避免同一球员多条 alternate 线刷屏。
 */
function aggPlayerOver(ev: RawOddsEvent, key: string): PlayerOuPick[] {
  // 1) 找每球员的最低盘口线
  const minPt = new Map<string, number>();
  for (const bk of ev.bookmakers ?? []) {
    const mk = bk.markets.find((m) => m.key === key);
    if (!mk) continue;
    for (const o of mk.outcomes) {
      if (o.name.toLowerCase() !== 'over' || !o.description) continue;
      const pt = o.point ?? 0;
      const cur = minPt.get(o.description);
      if (cur == null || pt < cur) minPt.set(o.description, pt);
    }
  }
  // 2) 主线上取各家最优价
  const by = new Map<string, PlayerOuPick>();
  for (const bk of ev.bookmakers ?? []) {
    const mk = bk.markets.find((m) => m.key === key);
    if (!mk) continue;
    for (const o of mk.outcomes) {
      if (o.name.toLowerCase() !== 'over' || !o.description) continue;
      const pt = o.point ?? 0;
      if (pt !== minPt.get(o.description)) continue;
      const cur = by.get(o.description);
      if (!cur || o.price > cur.best.price) {
        by.set(o.description, {
          player: o.description,
          point: pt,
          best: { price: o.price, book: bk.title },
        });
      }
    }
  }
  return [...by.values()].sort((a, b) => a.best.price - b.best.price);
}

/** 上半场胜平负:各家三路赔率归位主胜/平/客胜(h2h_h1)。 */
function bookThreeWay(ev: RawOddsEvent, key: string): BookThreeWay[] {
  const out: BookThreeWay[] = [];
  for (const bk of ev.bookmakers ?? []) {
    const mk = bk.markets.find((m) => m.key === key);
    if (!mk) continue;
    let home: number | undefined;
    let draw: number | undefined;
    let away: number | undefined;
    for (const o of mk.outcomes) {
      if (o.name === ev.home_team) home = o.price;
      else if (o.name === ev.away_team) away = o.price;
      else if (o.name.toLowerCase() === 'draw') draw = o.price;
    }
    if (home != null || draw != null || away != null) {
      out.push({ key: bk.key, title: bk.title, home, draw, away });
    }
  }
  return out;
}

/** 上半场大小球:各家主线 Over/Under(totals_h1)。 */
function bookTotals(ev: RawOddsEvent, key: string): BookTotalsLine[] {
  const out: BookTotalsLine[] = [];
  for (const bk of ev.bookmakers ?? []) {
    const mk = bk.markets.find((m) => m.key === key);
    if (!mk) continue;
    const ov = mk.outcomes.find((o) => o.name.toLowerCase() === 'over');
    const un = mk.outcomes.find((o) => o.name.toLowerCase() === 'under');
    if (ov || un) {
      out.push({
        key: bk.key,
        title: bk.title,
        overPoint: ov?.point,
        over: ov?.price,
        underPoint: un?.point,
        under: un?.price,
      });
    }
  }
  return out;
}

/** 分组键 → 请求的 markets 列表(handicap 走单独路径)。 */
const GROUP_MARKETS: Record<Exclude<MarketGroup, 'handicap'>, string> = {
  firsthalf: 'h2h_h1,totals_h1',
  corners: 'alternate_totals_corners,alternate_spreads_corners',
  cards: 'alternate_totals_cards,alternate_spreads_cards',
  players:
    'player_goal_scorer_anytime,player_shots_on_target,player_to_receive_card',
};

/** 解析单场 event 的让球/大小球(event 端点返回单个 event 对象)。 */
function parseMarkets(ev: RawOddsEvent): MatchMarkets {
  const bookmakers: BookmakerMarkets[] = [];
  for (const bk of ev.bookmakers ?? []) {
    const sp = bk.markets.find((m) => m.key === 'spreads');
    const to = bk.markets.find((m) => m.key === 'totals');
    const spreads = sp?.outcomes.map((o) => ({
      team: o.name,
      point: o.point ?? 0,
      price: o.price,
    }));
    const totals = to?.outcomes.map((o) => ({
      type: o.name,
      point: o.point ?? 0,
      price: o.price,
    }));
    if (spreads?.length || totals?.length) {
      bookmakers.push({ key: bk.key, title: bk.title, spreads, totals });
    }
  }
  return { homeTeam: ev.home_team, awayTeam: ev.away_team, bookmakers };
}

export const theOddsApiProvider: OddsProvider = {
  async getMatches() {
    const data = await fetchOdds(SPORT_MATCHES, 'h2h');
    return data.map(parseMatch);
  },
  async getWinnerOdds() {
    const data = await fetchOdds(SPORT_WINNER, 'outrights');
    return parseWinner(data);
  },
  async getMatchMarkets(oddsEventId: string) {
    const ev = await fetchEventOdds(oddsEventId, 'spreads,totals');
    return parseMarkets(ev);
  },
  async getMatchMarketsGroup(
    oddsEventId: string,
    group: Exclude<MarketGroup, 'handicap'>,
  ): Promise<GroupMarkets> {
    const ev = await fetchEventOdds(oddsEventId, GROUP_MARKETS[group]);
    const base = {
      group,
      homeTeam: ev.home_team,
      awayTeam: ev.away_team,
    };
    switch (group) {
      case 'firsthalf':
        return {
          ...base,
          h1ThreeWay: bookThreeWay(ev, 'h2h_h1'),
          h1Totals: bookTotals(ev, 'totals_h1'),
        };
      case 'corners':
        return {
          ...base,
          cornersTotals: aggOu(ev, 'alternate_totals_corners'),
          cornersSpreads: aggAh(ev, 'alternate_spreads_corners'),
        };
      case 'cards':
        return {
          ...base,
          cardsTotals: aggOu(ev, 'alternate_totals_cards'),
          cardsSpreads: aggAh(ev, 'alternate_spreads_cards'),
        };
      case 'players':
        return {
          ...base,
          goalScorers: aggPlayerYes(ev, 'player_goal_scorer_anytime'),
          shots: aggPlayerOver(ev, 'player_shots_on_target'),
          cardPlayers: aggPlayerYes(ev, 'player_to_receive_card'),
        };
    }
  },
};
