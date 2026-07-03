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
import type { EpochResult } from 'research/search';
import type { AnalystReport } from 'research/analyst';

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
import type { LeagueBacktestResult } from 'lib/predict/leagueBacktest';
import type { TmiSnapshot } from 'lib/tmi/types';
import type { TeamProfile } from 'lib/team/types';
import type { Wallet, Trade } from 'lib/trade/types';
import type { DryRunRequest, DryRunResponse } from 'lib/trade/dryRun';
import type { Bettor, BetSlip, Withdrawal } from 'lib/bets/types';
import type { BettorPnl } from 'lib/bets/bets';

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
import type { ScenarioResult, KnockoutBracket } from 'lib/scenario/types';

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

/** 沙盘情景推演(第三轮期望结果 + 整树晋级路径);读后台缓存。 */
export function useScenarios() {
  const { data, error, isLoading, mutate } = useSWR<{
    scenario: ScenarioResult | null;
  }>('/api/worldcup/scenarios', fetcher, {
    refreshInterval: STANDINGS_MS,
    ...common,
  });
  return {
    scenario: data?.scenario ?? null,
    error,
    isLoading,
    refresh: mutate,
  };
}

/** 进化状态摘要(GET research 附带;面板徽章用)。 */
export interface EvolutionSummary {
  status: 'exploring' | 'exhausted' | 'frozen';
  generation: number;
  noImproveCount: number;
  insufficientPower: boolean;
  holdoutTouches: number;
  incumbentLabel: string | null;
}

/** 参数边际响应一行(GET research 附带)。 */
export interface MarginalRow {
  param: string;
  distinct: number;
  bestValue: number | null;
  bestSharpe: number | null;
}
/** 进化日志摘要一行。 */
export interface EvoLogRow {
  generation: number;
  winnerLabel: string;
  improved: boolean;
  pairedT: number;
  llmAccepted: number;
  statusAfter: string;
}
/** gauntlet 台账摘要一行(只给闸门级信息,不含 holdout 数值)。 */
export interface GauntletRow {
  label: string;
  epoch: number;
  blockedAt: string | null;
  passedAll: boolean;
}

/** 研究调参时间线 + LLM 分析报告 + 进化状态 + 深察(边际/日志/台账);读后台落盘。 */
export function useResearch() {
  const { data, error, isLoading, mutate } = useSWR<{
    epochs: EpochResult[];
    analysis: AnalystReport | null;
    evolution: EvolutionSummary | null;
    marginals: MarginalRow[];
    recentLog: EvoLogRow[];
    gauntlet: GauntletRow[];
  }>('/api/worldcup/research', fetcher, {
    refreshInterval: STANDINGS_MS,
    ...common,
  });
  return {
    epochs: data?.epochs ?? [],
    analysis: data?.analysis ?? null,
    evolution: data?.evolution ?? null,
    marginals: data?.marginals ?? [],
    recentLog: data?.recentLog ?? [],
    gauntlet: data?.gauntlet ?? [],
    error,
    isLoading,
    refresh: mutate,
  };
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

/** 淘汰赛对阵树(扁平真实场次 matches + 缝合后的连通树 bracket)。 */
export function useBracket() {
  const { data, error, isLoading } = useSWR<{
    matches: BracketMatch[];
    bracket?: KnockoutBracket;
  }>('/api/worldcup/bracket', fetcher, {
    refreshInterval: STANDINGS_MS,
    ...common,
  });
  return {
    matches: data?.matches ?? [],
    bracket: data?.bracket,
    error,
    isLoading,
  };
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

/** 回测可调参数(undefined = 用该联赛验证后的默认配置)。 */
export interface BacktestParams {
  shrinkEloScale?: number;
  hfaElo?: number;
  hfaMult?: number;
  goalShrink?: number;
  dcRho?: number;
  marketWeight?: number;
  from?: string;
}

/**
 * 联赛历史 walk-forward 回测(调参面板用)。纯计算、零配额(只读已播种的联赛数据)。
 * key = 联赛存储键(epl-2025 / laliga / bundesliga / seriea / ligue1)。
 */
export function useLeagueBacktest(key: string, params: BacktestParams) {
  const qs = new URLSearchParams({ key });
  (
    [
      'shrinkEloScale',
      'hfaElo',
      'hfaMult',
      'goalShrink',
      'dcRho',
      'marketWeight',
    ] as const
  ).forEach((k) => {
    if (params[k] != null) qs.set(k, String(params[k]));
  });
  if (params.from) qs.set('from', params.from);
  const { data, error, isLoading } = useSWR<LeagueBacktestResult>(
    `/api/worldcup/epl/backtest?${qs.toString()}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  return { result: data, error, isLoading };
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

/** 用户触发的模拟盘预生成:POST 只读 dry-run,不走 SWR 自动刷新。 */
export async function generateDryRunSlips(
  input: DryRunRequest,
  token: string,
): Promise<DryRunResponse> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch('/api/worldcup/trade/dry-run', {
      method: 'POST',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-admin-token': token,
      },
      body: JSON.stringify(input),
    });
    const json = (await res.json()) as {
      success: boolean;
      data: DryRunResponse | null;
      error?: string;
    };
    if (!json.success || !json.data) throw new Error(json.error || '生成失败');
    return json.data;
  } finally {
    clearTimeout(id);
  }
}

/** Phase 9 盈亏台:各投注人盈亏总览 + 注单明细 + 名册。enabled=false(未过浏览密码)时不请求。 */
export function usePnl(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<{
    bettors: Bettor[];
    slips: BetSlip[];
    perUser: BettorPnl[];
    withdrawals: Withdrawal[];
    canEdit?: boolean;
  }>(enabled ? '/api/worldcup/pnl' : null, fetcher, {
    refreshInterval: 60_000, // 1min:赛后自动结算后尽快反映到盈亏页
    ...common,
  });
  return {
    bettors: data?.bettors ?? [],
    slips: data?.slips ?? [],
    perUser: data?.perUser ?? [],
    withdrawals: data?.withdrawals ?? [],
    canEdit: data?.canEdit ?? false, // 是否持管理(写)权限 → 决定是否显示编辑控件
    error,
    isLoading,
    mutate,
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
