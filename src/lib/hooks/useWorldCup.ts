'use client';

/**
 * 世界杯数据 Hooks(基于 SWR)。
 * 公共选项:refreshWhenHidden:false(隐藏暂停)· revalidateOnFocus(回前台刷新)· keepPreviousData(不闪屏)。
 */
import useSWR from 'swr';
import { useMemo } from 'react';
import { fetcher } from './fetcher';
import { normalizeTeam } from 'lib/match/normalize';
import type {
  MatchOdds,
  WinnerMarket,
  QuotaInfo,
  MatchMarkets,
  GroupMarkets,
  MarketGroup,
  LiveRate,
  LiveMatchMarkets,
} from 'lib/odds/types';
import type { OddsChangeMap } from 'lib/odds/changes';

// 赔率变动类型在 lib/odds/changes 定义;此处转出,组件统一从 hooks 取。
export type {
  OddsDir,
  OutcomeChange,
  OutcomeChangeSet,
  MatchChange,
  OddsChangeMap,
} from 'lib/odds/changes';
import type {
  ScheduleMatch,
  GroupStanding,
  Team,
  MatchEvent,
  BracketMatch,
  MatchSummary,
} from 'lib/espn/types';
import type { WeatherInfo } from 'lib/weather/openmeteo';
import type { MatchWithPredictions } from 'lib/predict/predict';
import type { TmiSnapshot } from 'lib/tmi/types';
import type { TeamProfile } from 'lib/team/types';
import type { Wallet, Trade } from 'lib/trade/types';

interface TierStat {
  n: number;
  settled: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
}
import type {
  LeadersStore,
  PredictionSnapshot,
  TradingSignal,
} from 'lib/db/store';
import type { AfPrediction } from 'lib/predict/apifootball';
import type { ModelStats } from 'lib/predict/predictionLog';
import type { RadarAlert } from 'lib/odds/radar';

const ms = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const SCORES_MS = ms(process.env.NEXT_PUBLIC_SCORES_REFRESH_MS, 25_000);
// 赔率低频:变动无需秒级,拉长间隔省 The Odds API 配额
const ODDS_MS = ms(process.env.NEXT_PUBLIC_ODDS_REFRESH_MS, 1_800_000);
const STANDINGS_MS = ms(process.env.NEXT_PUBLIC_STANDINGS_REFRESH_MS, 300_000);
// 实时看板:读服务端内存缓存(上游由后台 ~36s 轮询),客户端默认 20s 取一次,几乎零上游消耗
const LIVE_ODDS_MS = ms(process.env.NEXT_PUBLIC_LIVE_ODDS_REFRESH_MS, 20_000);

const common = {
  revalidateOnFocus: true,
  refreshWhenHidden: false,
  keepPreviousData: true,
} as const;

// 赔率类:不在窗口聚焦/重连时自动刷新(赔率变化慢,避免每次切回 App 就消耗 The Odds API 配额)。
const oddsCommon = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  refreshWhenHidden: false,
  keepPreviousData: true,
} as const;

/** 赛程 + 实时比分(快刷新)。 */
export function useScoreboard(dates?: string) {
  const key = `/api/worldcup/scoreboard${dates ? `?dates=${dates}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR<{
    dates: string;
    matches: ScheduleMatch[];
  }>(key, fetcher, { refreshInterval: SCORES_MS, ...common });
  // effectiveDate = 后端实际选中的日期(智能默认:今天全部结束时为下一个比赛日)
  return {
    matches: data?.matches ?? [],
    effectiveDate: data?.dates,
    error,
    isLoading,
    refresh: mutate,
  };
}

/** 12 小组积分榜。 */
export function useStandings() {
  const { data, error, isLoading, mutate } = useSWR<{
    groups: GroupStanding[];
  }>('/api/worldcup/standings', fetcher, {
    refreshInterval: STANDINGS_MS,
    ...common,
  });
  return { groups: data?.groups ?? [], error, isLoading, refresh: mutate };
}

/** 48 强球队。 */
export function useTeams() {
  const { data } = useSWR<{ teams: Team[] }>(
    '/api/worldcup/teams',
    fetcher,
    common,
  );
  return { teams: data?.teams ?? [] };
}

/** 队名(归一化)→ 队徽 logo 映射(给无 logo 的赔率/夺冠数据用)。 */
export function useTeamLogos(): Record<string, string> {
  const { teams } = useTeams();
  return useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teams) if (t.logo) m[normalizeTeam(t.displayName)] = t.logo;
    return m;
  }, [teams]);
}

/** 队名(归一化)→ ESPN 队 id 映射(用于跳转球队页 /team/[id])。 */
export function useTeamIdMap(): Record<string, string> {
  const { teams } = useTeams();
  return useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teams) if (t.id) m[normalizeTeam(t.displayName)] = t.id;
    return m;
  }, [teams]);
}

/** 单场赔率(低频)+ 配额 + 赔率变动(服务端计算,相对上一次刷新)。 */
export function useMatchOdds() {
  const { data, error, isLoading, mutate } = useSWR<{
    matches: MatchOdds[];
    changes?: OddsChangeMap;
    quota: QuotaInfo;
    fetchedAt: number;
  }>('/api/worldcup/matches', fetcher, {
    refreshInterval: ODDS_MS,
    ...oddsCommon,
  });
  return {
    matches: data?.matches ?? [],
    changes: data?.changes ?? {},
    quota: data?.quota,
    oddsUpdatedAt: data?.fetchedAt ?? null,
    nextOddsRefreshAt: data?.fetchedAt ? data.fetchedAt + ODDS_MS : null,
    error,
    isLoading,
    refresh: mutate,
  };
}

/**
 * 实时赔率看板(odds-api.io)。最近 N 场比赛胜平负 + 涨跌 + 拉取时间 + 限流。
 * 上游由后台单例 ~36s 轮询;前端读服务端缓存(默认 20s),回前台/重连刷新(读缓存,不耗上游)。
 */
export function useLiveOdds() {
  const { data, error, isLoading, mutate } = useSWR<{
    matches: MatchOdds[];
    changes?: OddsChangeMap;
    fetchedAt: number | null;
    rate: LiveRate;
  }>('/api/worldcup/live-odds', fetcher, {
    refreshInterval: LIVE_ODDS_MS,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshWhenHidden: false,
    keepPreviousData: true,
  });
  return {
    matches: data?.matches ?? [],
    changes: data?.changes ?? {},
    oddsUpdatedAt: data?.fetchedAt ?? null,
    rate: data?.rate,
    error,
    isLoading,
    refresh: mutate,
  };
}

/** 某场盘口去水真概率时序(读盘:线如何移动;仅传 matchId 时请求,读服务端内存)。 */
export interface OddsSeriesPoint {
  ts: number;
  home: number;
  draw: number;
  away: number;
}
export function useOddsSeries(matchId?: string) {
  const { data, isLoading } = useSWR<{
    id: string;
    n: number;
    open: OddsSeriesPoint | null;
    last: OddsSeriesPoint | null;
    points: OddsSeriesPoint[];
  }>(matchId ? `/api/worldcup/odds-series?id=${matchId}` : null, fetcher, {
    refreshInterval: LIVE_ODDS_MS,
    refreshWhenHidden: false,
    keepPreviousData: true,
  });
  return {
    points: data?.points ?? [],
    open: data?.open ?? null,
    last: data?.last ?? null,
    n: data?.n ?? 0,
    isLoading,
  };
}

/** 微观异动雷达信息流(steam / 关键线击穿 / RLM)。 */
export function useRadar() {
  const { data, isLoading } = useSWR<{ alerts: RadarAlert[] }>(
    '/api/worldcup/radar',
    fetcher,
    { refreshInterval: LIVE_ODDS_MS, ...common },
  );
  return { alerts: data?.alerts ?? [], isLoading };
}

/** 交易指令流(Copilot 指令台)。 */
export function useSignals() {
  const { data, isLoading, mutate } = useSWR<{
    signals: TradingSignal[];
    unread: number;
  }>('/api/worldcup/signals', fetcher, {
    refreshInterval: LIVE_ODDS_MS,
    ...common,
  });
  return {
    signals: data?.signals ?? [],
    unread: data?.unread ?? 0,
    isLoading,
    mutate,
  };
}

/**
 * 单场全部市场(实时赔率页展开按需)。仅在传入 matchId 时请求;
 * 数据取自服务端内存(0 上游),随看板刷新而更新,故跟随实时间隔轻量刷新。
 */
export function useLiveMatchMarkets(matchId?: string) {
  const { data, error, isLoading } = useSWR<{
    markets: LiveMatchMarkets | null;
  }>(
    matchId ? `/api/worldcup/live-odds/markets?id=${matchId}` : null,
    fetcher,
    {
      refreshInterval: LIVE_ODDS_MS,
      revalidateOnFocus: true,
      refreshWhenHidden: false,
      keepPreviousData: true,
    },
  );
  return { markets: data?.markets ?? null, error, isLoading };
}

/**
 * 赛程页专用:只复用赔率缓存,不主动刷新、不在 stale 时 revalidate。
 * 切换日期/停留/切回 App 都不再请求赔率端点(零额外配额消耗);
 * 一个会话首次无缓存时拉一次,之后全程用缓存。
 */
export function useMatchOddsLite() {
  const { data } = useSWR<{
    matches: MatchOdds[];
    changes?: OddsChangeMap;
    quota: QuotaInfo;
  }>('/api/worldcup/matches', fetcher, {
    ...oddsCommon,
    refreshInterval: 0,
    revalidateIfStale: false,
  });
  return { matches: data?.matches ?? [], changes: data?.changes ?? {} };
}

/** 夺冠赔率榜(低频)+ 配额。 */
export function useWinnerOdds() {
  const { data, error, isLoading, mutate } = useSWR<{
    winner: WinnerMarket;
    quota: QuotaInfo;
  }>('/api/worldcup/winner', fetcher, {
    refreshInterval: ODDS_MS,
    ...oddsCommon,
  });
  return {
    winner: data?.winner,
    quota: data?.quota,
    error,
    isLoading,
    refresh: mutate,
  };
}

/** 单场进球/红黄牌时间线(仅在传入 eventId 时请求)。 */
export function useMatchEvents(eventId?: string) {
  const { data, error, isLoading } = useSWR<{
    eventId: string;
    events: MatchEvent[];
  }>(eventId ? `/api/worldcup/events?eventId=${eventId}` : null, fetcher, {
    refreshInterval: 30_000,
    ...common,
  });
  return { events: data?.events ?? [], error, isLoading };
}

/** 淘汰赛对阵树。 */
export function useBracket() {
  const { data, error, isLoading } = useSWR<{ matches: BracketMatch[] }>(
    '/api/worldcup/bracket',
    fetcher,
    { refreshInterval: STANDINGS_MS, ...common },
  );
  return { matches: data?.matches ?? [], error, isLoading };
}

/** 单场比赛详情(比分/统计/阵容/事件,仅在传入 eventId 时请求)。 */
export function useMatchSummary(eventId?: string) {
  const { data, error, isLoading } = useSWR<{ summary: MatchSummary }>(
    eventId ? `/api/worldcup/summary?eventId=${eventId}` : null,
    fetcher,
    { refreshInterval: 30_000, ...common },
  );
  return { summary: data?.summary, error, isLoading };
}

/** 比赛结果预测列表(未来 days 天,各模型;纯计算不耗配额)。 */
export function usePredictions(days = 10) {
  const { data, error, isLoading } = useSWR<{
    matches: MatchWithPredictions[];
  }>(`/api/worldcup/predictions?days=${days}`, fetcher, {
    refreshInterval: STANDINGS_MS,
    ...common,
  });
  return { matches: data?.matches ?? [], error, isLoading };
}

/** 可选竞赛列表(WC + 联赛;供预测页切换器)。 */
export function useCompetitions() {
  const { data } = useSWR<{
    competitions: { comp: string; name: string; kind: 'wc' | 'league' }[];
  }>('/api/worldcup/league/list', fetcher, common);
  return { competitions: data?.competitions ?? [] };
}

/** 某联赛预测列表(comp 为 null/wc 时不请求;走 WC 用 usePredictions)。纯计算不耗 AF 配额。 */
export function useLeaguePredictions(comp: string | null, days = 10) {
  const { data, error, isLoading } = useSWR<{
    comp: string;
    matches: MatchWithPredictions[];
  }>(
    comp && comp !== 'wc'
      ? `/api/worldcup/league/predictions?comp=${comp}&days=${days}`
      : null,
    fetcher,
    { refreshInterval: STANDINGS_MS, ...common },
  );
  return { matches: data?.matches ?? [], error, isLoading };
}

/** 单场联赛预测(详情页;comp+matchId 齐全时请求)。 */
export function useLeagueMatchPrediction(comp?: string, matchId?: string) {
  const { data, isLoading } = useSWR<{
    comp: string;
    match: MatchWithPredictions | null;
  }>(
    comp && matchId
      ? `/api/worldcup/league/predictions?comp=${comp}&matchId=${matchId}`
      : null,
    fetcher,
    { revalidateOnFocus: false, ...common },
  );
  return { prediction: data?.match ?? null, isLoading };
}

/** 单场联赛 ESPN 详情(比分/统计/阵容/近期战绩;comp+id 齐全时请求)。 */
export function useLeagueMatchSummary(comp?: string, id?: string) {
  const { data, error, isLoading } = useSWR<{ summary: MatchSummary }>(
    comp && id ? `/api/worldcup/league/summary?comp=${comp}&id=${id}` : null,
    fetcher,
    { refreshInterval: 30_000, ...common },
  );
  return { summary: data?.summary, error, isLoading };
}

/** TMI 杯赛状态动能榜(纯计算,不耗配额;低频刷新)。 */
export function useTmi() {
  const { data, error, isLoading } = useSWR<TmiSnapshot>(
    '/api/worldcup/tmi',
    fetcher,
    { refreshInterval: STANDINGS_MS, ...common },
  );
  return {
    teams: data?.teams ?? [],
    lastUpdated: data?.lastUpdated,
    wcStart: data?.wcStart,
    error,
    isLoading,
  };
}

/** 世界杯射手榜。 */
export function useLeaders() {
  const { data, isLoading } = useSWR<LeadersStore>(
    '/api/worldcup/leaders',
    fetcher,
    { refreshInterval: STANDINGS_MS, ...common },
  );
  return { scorers: data?.scorers ?? [], isLoading };
}

/** API-Football 现成预测(第三方参考;仅在三参齐全时请求)。 */
export function useAfPredict(home?: string, away?: string, date?: string) {
  const key =
    home && away && date
      ? `/api/worldcup/af-predict?home=${encodeURIComponent(
          home,
        )}&away=${encodeURIComponent(away)}&date=${date}`
      : null;
  const { data } = useSWR<{ prediction: AfPrediction | null }>(key, fetcher, {
    revalidateOnFocus: false,
    ...common,
  });
  return { prediction: data?.prediction ?? null };
}

/** 模拟盘:账户总览 + 交易流水。 */
export function useTrade() {
  const { data, error, isLoading } = useSWR<{
    wallet: Wallet;
    stats: {
      equity: number;
      roi: number;
      winRate: number;
      clv?: { n: number; posRate: number; avgClv: number };
      tiers?: {
        value: TierStat;
        coverage: TierStat;
      };
    };
    trades: Trade[];
  }>('/api/worldcup/trade', fetcher, {
    refreshInterval: STANDINGS_MS,
    ...common,
  });
  return {
    wallet: data?.wallet,
    stats: data?.stats,
    trades: data?.trades ?? [],
    error,
    isLoading,
  };
}

/** 单支球队杯赛档案 + 状态评测(仅在传入 teamId 时请求)。 */
export function useTeamProfile(teamId?: string) {
  const { data, error, isLoading } = useSWR<{ profile: TeamProfile | null }>(
    teamId ? `/api/worldcup/team?id=${teamId}` : null,
    fetcher,
    { refreshInterval: STANDINGS_MS, ...common },
  );
  return { profile: data?.profile ?? null, error, isLoading };
}

/** 单场预测(详情页;仅在传入 matchId 时请求)+ 当时的预测存档(对照用)。 */
export function useMatchPrediction(matchId?: string) {
  const { data, isLoading } = useSWR<{
    match: MatchWithPredictions | null;
    logged: PredictionSnapshot | null;
  }>(matchId ? `/api/worldcup/predictions?matchId=${matchId}` : null, fetcher, {
    revalidateOnFocus: false,
    ...common,
  });
  return {
    prediction: data?.match ?? null,
    logged: data?.logged ?? null,
    isLoading,
  };
}

/** 模型战绩(预测存档聚合)。 */
export function useModelStats() {
  const { data, isLoading } = useSWR<ModelStats>(
    '/api/worldcup/model-stats',
    fetcher,
    { refreshInterval: STANDINGS_MS, ...common },
  );
  return { stats: data, isLoading };
}

/** 比赛当日天气(Open-Meteo,免费;详情页按需,基本不变化故不自动刷新)。 */
export function useWeather(stadium?: string, city?: string, iso?: string) {
  const enabled = !!iso && (!!stadium || !!city);
  const qs = new URLSearchParams();
  if (stadium) qs.set('stadium', stadium);
  if (city) qs.set('city', city);
  if (iso) qs.set('iso', iso);
  const { data, isLoading } = useSWR<{ weather: WeatherInfo | null }>(
    enabled ? `/api/worldcup/weather?${qs.toString()}` : null,
    fetcher,
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
  return { weather: data?.weather ?? null, isLoading };
}

/** 单场让球 + 大小球(详情页按需,不自动刷新省配额)。 */
export function useMatchMarkets(oddsEventId?: string) {
  const { data, error, isLoading } = useSWR<{
    markets: MatchMarkets;
    quota: QuotaInfo;
  }>(
    oddsEventId
      ? `/api/worldcup/match-markets?oddsEventId=${oddsEventId}&group=handicap`
      : null,
    fetcher,
    oddsCommon,
  );
  return { markets: data?.markets, error, isLoading };
}

/**
 * 单场富盘口分组(上半场/角球/红黄牌/球员)。详情页按需:
 * 只在 group 非空(用户点开该 tab)时才请求,按 (event,group) 分缓存,不刷新省配额。
 */
export function useMatchGroup(
  oddsEventId?: string,
  group?: Exclude<MarketGroup, 'handicap'>,
) {
  const { data, error, isLoading } = useSWR<{
    markets: GroupMarkets;
    quota: QuotaInfo;
  }>(
    oddsEventId && group
      ? `/api/worldcup/match-markets?oddsEventId=${oddsEventId}&group=${group}`
      : null,
    fetcher,
    oddsCommon,
  );
  return { markets: data?.markets, error, isLoading };
}

/** 配额是否吃紧(前端据此关闭自动刷新)。 */
export const QUOTA_LOW_THRESHOLD = 50;
export function isQuotaLow(quota?: QuotaInfo): boolean {
  return (
    !!quota && quota.remaining != null && quota.remaining < QUOTA_LOW_THRESHOLD
  );
}
