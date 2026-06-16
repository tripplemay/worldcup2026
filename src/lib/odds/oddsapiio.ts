/**
 * odds-api.io 适配器 —— 实时赔率看板专用数据源(独立于 the-odds-api 主链路)。
 *
 * 实测要点(2026-06-16):
 *  - 套餐 100 次/小时;每个鉴权端点(/events、/odds、/odds/multi、/leagues)各扣 1。
 *    响应头 x-ratelimit-limit/remaining/reset 实时反馈 → 由 livePoller 据此动态配速。
 *  - /odds/multi 一次最多 10 场、只扣 1 次,返回每场全部市场 × 选中博彩商。
 *  - 世界杯:sport=football,league=international-fifa-world-cup。
 *  - 套餐限 2 家博彩商(当前 Bet365 + Bwin ES);其中 Bwin ES 对世界杯无返回 → 实际 Bet365。
 *  - 返回里有影子键 "Bet365 (no latency)"(只含个别市场)→ 解析时跳过。
 *  - 赔率为字符串小数,需 parseFloat;胜平负市场名为 "ML"(odds[0] = {home,draw,away})。
 */
import type {
  MatchOdds,
  BookmakerOdds,
  LiveRate,
  LiveMarket,
  LiveOddsRow,
} from './types';

const BASE = process.env.ODDS_API_IO_BASE ?? 'https://api.odds-api.io/v3';
const KEY = process.env.ODDS_API_IO_KEY ?? '';
const LEAGUE = process.env.ODDS_API_IO_LEAGUE ?? 'international-fifa-world-cup';
// 套餐限 2 家,且"已选博彩商"可能变动(实测从 Bwin ES 变成 Betano BR);
// Bet365 始终在允许集内且对世界杯覆盖最全(含波胆),故默认只请求 Bet365,最稳。
const BOOKMAKERS = process.env.ODDS_API_IO_BOOKMAKERS ?? 'Bet365';

/** 是否配置了 odds-api.io key(未配置则轮询器不启动,看板优雅留空)。 */
export const hasLiveKey = (): boolean => !!KEY;

const EMPTY_RATE: LiveRate = { limit: null, remaining: null, reset: null };

// ── 原始响应类型 ──────────────────────────
interface IoEvent {
  id: number;
  home: string;
  away: string;
  date: string; // ISO UTC
  status: string; // 'pending' | 'live' | 'settled'
}
interface IoOddsRow {
  label?: string;
  hdp?: number;
  home?: string;
  draw?: string;
  away?: string;
  over?: string;
  under?: string;
  yes?: string;
  no?: string;
  odds?: string;
}
interface IoMarket {
  name: string;
  updatedAt?: string;
  odds: IoOddsRow[];
}
interface IoOddsEvent extends IoEvent {
  bookmakers: Record<string, IoMarket[]>;
}

function rateFrom(h: Headers): LiveRate {
  const n = (v: string | null) => (v == null || v === '' ? null : Number(v));
  return {
    limit: n(h.get('x-ratelimit-limit')),
    remaining: n(h.get('x-ratelimit-remaining')),
    reset: h.get('x-ratelimit-reset'),
  };
}

async function ioFetch(
  path: string,
): Promise<{ json: unknown; rate: LiveRate }> {
  if (!KEY) throw new Error('ODDS_API_IO_KEY 未配置');
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(
    `${BASE}${path}${sep}apiKey=${encodeURIComponent(KEY)}`,
    {
      cache: 'no-store',
    },
  );
  const rate = rateFrom(res.headers);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `odds-api.io 请求失败 ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  return { json: await res.json(), rate };
}

/** 拉取世界杯赛事(过滤已结束),按开赛时间升序。 */
export async function fetchWcEvents(): Promise<{
  events: IoEvent[];
  rate: LiveRate;
}> {
  const { json, rate } = await ioFetch(
    `/events?sport=football&league=${LEAGUE}`,
  );
  const all = Array.isArray(json) ? (json as IoEvent[]) : [];
  const events = all
    .filter((e) => e.status !== 'settled')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { events, rate };
}

const isRealBook = (name: string) => !/no latency/i.test(name);
const num = (v?: string): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** 取该场第一家"真实"博彩商(跳过 "Bet365 (no latency)" 影子键)的市场列表。 */
function realBookMarkets(ev: IoOddsEvent): IoMarket[] {
  for (const [name, markets] of Object.entries(ev.bookmakers ?? {})) {
    if (isRealBook(name) && markets?.length) return markets;
  }
  return [];
}

/** 通用解析单条赔率(价格字符串 → number,保留 label/hdp)。 */
function parseRow(r: IoOddsRow): LiveOddsRow {
  return {
    label: r.label,
    hdp: typeof r.hdp === 'number' ? r.hdp : undefined,
    home: num(r.home),
    draw: num(r.draw),
    away: num(r.away),
    over: num(r.over),
    under: num(r.under),
    yes: num(r.yes),
    no: num(r.no),
    odds: num(r.odds),
  };
}

/** 解析该场全部市场为通用 LiveMarket[](剔除空行)。 */
function parseAllMarkets(markets: IoMarket[]): LiveMarket[] {
  const out: LiveMarket[] = [];
  for (const m of markets) {
    const rows = (m.odds ?? []).map(parseRow).filter((r) => {
      const { label, hdp, ...prices } = r;
      void label;
      void hdp;
      return Object.values(prices).some((v) => v != null);
    });
    if (rows.length) out.push({ name: m.name, rows });
  }
  return out;
}

/** 从全市场里取 ML(胜平负)归位为 MatchOdds(单家 Bet365)。 */
function toMatchOdds(ev: IoOddsEvent, markets: LiveMarket[]): MatchOdds | null {
  const ml = markets.find((m) => m.name === 'ML')?.rows?.[0];
  if (!ml) return null;
  const { home, draw, away } = ml;
  if (home == null && draw == null && away == null) return null;
  const key = 'bet365';
  const bookmakers: BookmakerOdds[] = [
    { key, title: 'Bet365', lastUpdate: '', home, draw, away },
  ];
  const best: MatchOdds['best'] = {};
  if (home != null) best.home = { price: home, bookmaker: key };
  if (draw != null) best.draw = { price: draw, bookmaker: key };
  if (away != null) best.away = { price: away, bookmaker: key };
  return {
    id: String(ev.id),
    homeTeam: ev.home,
    awayTeam: ev.away,
    commenceTime: ev.date,
    bookmakers,
    best,
  };
}

/**
 * /odds/multi:最多 10 场。返回:
 *  - matches:胜平负看板(MatchOdds[],保持入参顺序=开赛时间序)
 *  - marketsById:每场全部市场(供详情展开按标签分组,服务端内存留存)
 */
export async function fetchLiveBoard(eventIds: number[]): Promise<{
  matches: MatchOdds[];
  marketsById: Record<string, LiveMarket[]>;
  rate: LiveRate;
}> {
  if (!eventIds.length) {
    return { matches: [], marketsById: {}, rate: EMPTY_RATE };
  }
  const ids = eventIds.slice(0, 10).join(',');
  const { json, rate } = await ioFetch(
    `/odds/multi?eventIds=${ids}&bookmakers=${encodeURIComponent(BOOKMAKERS)}`,
  );
  const evs = Array.isArray(json) ? (json as IoOddsEvent[]) : [];
  const order = new Map(eventIds.map((id, i) => [String(id), i]));
  const matches: MatchOdds[] = [];
  const marketsById: Record<string, LiveMarket[]> = {};
  for (const ev of evs) {
    const markets = parseAllMarkets(realBookMarkets(ev));
    if (markets.length) marketsById[String(ev.id)] = markets;
    const mo = toMatchOdds(ev, markets);
    if (mo) matches.push(mo);
  }
  matches.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { matches, marketsById, rate };
}
