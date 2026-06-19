/**
 * 实时赔率看板轮询器(单例,常驻后台)。
 *
 * 每 tick:确保赛事列表新鲜 → 取最近 N 场未结束比赛 → /odds/multi 拉赔率 → 解析胜平负 →
 * 对比上一份快照算涨跌 → 写入内存看板。
 *
 * 配速:按响应头 x-ratelimit-remaining/reset 动态自适应——把剩余额度均摊到本小时重置前,
 * 地板 36s(= 100次/小时上限),并预留 RESERVE 次给详情页按需调用。数学上永不超 100/小时。
 *
 * 单例保证:状态挂在 globalThis 上。Next.js 中 instrumentation 与路由可能各自加载本模块的
 * 不同实例(独立模块注册表),若用模块级变量会跑出多条定时器链(实测 2 条 → 翻倍消耗)。
 * 挂 globalThis 后所有实例共享同一份状态,只有一条定时器链。
 */
import { fetchWcEvents, fetchLiveBoard, hasLiveKey } from './oddsapiio';
import { computeChanges } from './changes';
import type { OddsChangeMap } from './changes';
import { loadLiveOddsSnap, saveLiveOddsSnap } from './snapStore';
import { loadOpeningOdds, saveOpeningOdds } from 'lib/db/store';
import { groupLiveMarkets } from './liveMarketGroups';
import type {
  MatchOdds,
  LiveRate,
  LiveMarket,
  LiveMatchMarkets,
} from './types';

const LIVE_COUNT = Number(process.env.ODDS_API_IO_LIVE_COUNT ?? 10);
const EVENTS_TTL_MS = Number(process.env.ODDS_API_IO_EVENTS_TTL_MS ?? 300_000);
const MIN_INTERVAL_MS = Number(
  process.env.ODDS_API_IO_MIN_INTERVAL_MS ?? 36_000,
);
const MAX_INTERVAL_MS = 120_000;
const RESERVE = 5; // 预留额度(详情页按需 + 安全缓冲)
const HOUR_MS = 3_600_000;

export interface LiveBoard {
  matches: MatchOdds[];
  changes: OddsChangeMap;
  fetchedAt: number;
  rate: LiveRate;
}

const EMPTY_RATE: LiveRate = { limit: null, remaining: null, reset: null };

interface PollerState {
  board: LiveBoard | null;
  // 每场全部市场(服务端内存留存,不随看板下发;供详情展开按需取,0 上游消耗)
  marketsById: Record<string, LiveMarket[]>;
  eventsCache: { ids: number[]; at: number } | null;
  started: boolean;
  inflight: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
}

// 跨模块实例共享的单例状态(见文件头说明)。
const g = globalThis as unknown as { __wcLivePoller?: PollerState };
const state: PollerState = (g.__wcLivePoller ??= {
  board: null,
  marketsById: {},
  eventsCache: null,
  started: false,
  inflight: null,
  timer: null,
});

/** 当前看板(未首拉完成前为 null)。 */
export function getLiveBoard(): LiveBoard | null {
  return state.board;
}

/** 取某场的全部市场(按标签分组);不在当前看板内则返回 null(0 上游调用)。 */
export function getLiveMatchMarkets(id: string): LiveMatchMarkets | null {
  const markets = state.marketsById[id];
  if (!markets?.length) return null;
  const m = state.board?.matches.find((x) => x.id === id);
  return {
    id,
    homeTeam: m?.homeTeam ?? '',
    awayTeam: m?.awayTeam ?? '',
    groups: groupLiveMarkets(markets),
  };
}

/** 取最近 N 场未结束比赛的 id(赛事列表带 TTL 缓存,降低 /events 消耗)。 */
async function nearestIds(
  now: number,
): Promise<{ ids: number[]; rate: LiveRate | null }> {
  const c = state.eventsCache;
  if (c && now - c.at < EVENTS_TTL_MS) return { ids: c.ids, rate: null };
  const { events, rate } = await fetchWcEvents();
  const ids = events.slice(0, LIVE_COUNT).map((e) => e.id);
  state.eventsCache = { ids, at: now };
  return { ids, rate };
}

/** 据限流头算下一 tick 间隔:剩余额度均摊到 reset 前,夹在 [36s, 120s]。 */
function nextDelay(rate: LiveRate): number {
  const { remaining, reset } = rate;
  if (remaining == null) return MIN_INTERVAL_MS;
  const msToReset = reset
    ? Math.max(0, new Date(reset).getTime() - Date.now())
    : HOUR_MS;
  const budget = remaining - RESERVE;
  if (budget <= 0) {
    // 额度见底:等到 reset(+2s 缓冲),夹到 [36s, 1h]
    return Math.min(Math.max(msToReset + 2000, MIN_INTERVAL_MS), HOUR_MS);
  }
  const spread = msToReset / budget;
  return Math.max(MIN_INTERVAL_MS, Math.min(spread, MAX_INTERVAL_MS));
}

/** 初盘自捕获:某场首次出现完整 1X2 最优价时写一次(永不覆盖)。 */
function captureOpening(matches: MatchOdds[], now: number): void {
  const store = loadOpeningOdds();
  let added = false;
  for (const m of matches) {
    if (store[m.id]) continue;
    const h = m.best.home?.price;
    const d = m.best.draw?.price;
    const a = m.best.away?.price;
    if (h != null && d != null && a != null) {
      store[m.id] = { capturedAt: now, home: h, draw: d, away: a };
      added = true;
    }
  }
  if (added) saveOpeningOdds(store);
}

async function doTick(): Promise<void> {
  const now = Date.now();
  let rate: LiveRate = state.board?.rate ?? EMPTY_RATE;
  try {
    const ev = await nearestIds(now);
    if (ev.rate) rate = ev.rate;
    const {
      matches,
      marketsById,
      rate: oddsRate,
    } = await fetchLiveBoard(ev.ids);
    rate = oddsRate;
    const { changes, snap } = computeChanges(loadLiveOddsSnap(), matches, now);
    saveLiveOddsSnap(snap);
    captureOpening(matches, now);
    state.board = { matches, changes, fetchedAt: now, rate };
    state.marketsById = marketsById;
  } catch (e) {
    console.error('[live-odds] tick 失败,保留上一份看板', e);
  } finally {
    if (state.started) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => void tick(), nextDelay(rate));
    }
  }
}

/** 单飞:并发调用(定时器 + 路由兜底)合并为同一次 tick,避免重复消耗额度。 */
function tick(): Promise<void> {
  if (!state.inflight) {
    state.inflight = doTick().finally(() => (state.inflight = null));
  }
  return state.inflight;
}

/** 启动单例轮询(幂等;未配置 key 则不启动)。 */
export function startLivePoller(): void {
  if (state.started || !hasLiveKey()) return;
  state.started = true;
  void tick();
}

/** 路由兜底:确保已启动;若看板尚空则等首拉完成(避免首屏空白)。 */
export async function ensureLiveBoard(): Promise<LiveBoard | null> {
  if (!hasLiveKey()) return null;
  startLivePoller();
  if (!state.board) await tick();
  return state.board;
}
