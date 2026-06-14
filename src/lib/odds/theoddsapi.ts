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

async function fetchOdds(sport: string, markets: string): Promise<RawOddsEvent[]> {
  const url =
    `${BASE}/sports/${sport}/odds/` +
    `?apiKey=${requireKey()}&regions=${REGIONS}&markets=${markets}&oddsFormat=${ODDS_FORMAT}`;
  const res = await fetch(url, { cache: 'no-store' });
  updateQuota(res.headers);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`The Odds API ${sport} 请求失败: ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as RawOddsEvent[];
}

/** 把一场比赛的多家 h2h 赔率归位为主胜/平/客胜 + 计算全场最优(最高赔率)。 */
function parseMatch(ev: RawOddsEvent): MatchOdds {
  const bookmakers: BookmakerOdds[] = [];
  const best: MatchOdds['best'] = {};

  const bump = (k: 'home' | 'draw' | 'away', price: number | undefined, bookmaker: string) => {
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
    bookmakers.push({ key: bk.key, title: bk.title, lastUpdate: bk.last_update, home, draw, away });
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

export const theOddsApiProvider: OddsProvider = {
  async getMatches() {
    const data = await fetchOdds(SPORT_MATCHES, 'h2h');
    return data.map(parseMatch);
  },
  async getWinnerOdds() {
    const data = await fetchOdds(SPORT_WINNER, 'outrights');
    return parseWinner(data);
  },
};
