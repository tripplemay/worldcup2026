'use client';

/**
 * 世界杯数据 Hooks(基于 SWR)。
 * 公共选项:refreshWhenHidden:false(隐藏暂停)· revalidateOnFocus(回前台刷新)· keepPreviousData(不闪屏)。
 */
import useSWR from 'swr';
import { useEffect, useMemo, useRef } from 'react';
import { fetcher } from './fetcher';
import { normalizeTeam } from 'lib/match/normalize';
import type {
  MatchOdds,
  WinnerMarket,
  QuotaInfo,
  MatchMarkets,
} from 'lib/odds/types';
import type {
  ScheduleMatch,
  GroupStanding,
  Team,
  MatchEvent,
  BracketMatch,
  MatchSummary,
} from 'lib/espn/types';

const ms = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const SCORES_MS = ms(process.env.NEXT_PUBLIC_SCORES_REFRESH_MS, 25_000);
// 赔率低频:变动无需秒级,拉长间隔省 The Odds API 配额
const ODDS_MS = ms(process.env.NEXT_PUBLIC_ODDS_REFRESH_MS, 360_000);
const STANDINGS_MS = ms(process.env.NEXT_PUBLIC_STANDINGS_REFRESH_MS, 300_000);

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
  return { matches: data?.matches ?? [], error, isLoading, refresh: mutate };
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

export type OddsDir = 'up' | 'down' | 'flat';
function dir(prev: number | undefined, cur: number | undefined): OddsDir {
  if (prev == null || cur == null) return 'flat';
  if (cur > prev) return 'up';
  if (cur < prev) return 'down';
  return 'flat';
}
export interface OddsChange {
  home: OddsDir;
  draw: OddsDir;
  away: OddsDir;
}

/** 单场赔率(低频)+ 配额 + 赔率变动方向(对比上次轮询)。 */
export function useMatchOdds() {
  const { data, error, isLoading, mutate } = useSWR<{
    matches: MatchOdds[];
    quota: QuotaInfo;
  }>('/api/worldcup/matches', fetcher, {
    refreshInterval: ODDS_MS,
    ...oddsCommon,
  });
  const matches = data?.matches ?? [];
  const prevRef = useRef<
    Record<string, { home?: number; draw?: number; away?: number }>
  >({});

  const changes = useMemo(() => {
    const out: Record<string, OddsChange> = {};
    for (const m of matches) {
      const p = prevRef.current[m.id];
      out[m.id] = {
        home: dir(p?.home, m.best.home?.price),
        draw: dir(p?.draw, m.best.draw?.price),
        away: dir(p?.away, m.best.away?.price),
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  useEffect(() => {
    const snap: Record<
      string,
      { home?: number; draw?: number; away?: number }
    > = {};
    for (const m of matches) {
      snap[m.id] = {
        home: m.best.home?.price,
        draw: m.best.draw?.price,
        away: m.best.away?.price,
      };
    }
    prevRef.current = snap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  return {
    matches,
    changes,
    quota: data?.quota,
    error,
    isLoading,
    refresh: mutate,
  };
}

/**
 * 赛程页专用:只复用赔率缓存,不主动刷新、不在 stale 时 revalidate。
 * 切换日期/停留/切回 App 都不再请求赔率端点(零额外配额消耗);
 * 一个会话首次无缓存时拉一次,之后全程用缓存。
 */
export function useMatchOddsLite() {
  const { data } = useSWR<{ matches: MatchOdds[]; quota: QuotaInfo }>(
    '/api/worldcup/matches',
    fetcher,
    { ...oddsCommon, refreshInterval: 0, revalidateIfStale: false },
  );
  return { matches: data?.matches ?? [] };
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

/** 单场让球 + 大小球(详情页按需,不自动刷新省配额)。 */
export function useMatchMarkets(oddsEventId?: string) {
  const { data, error, isLoading } = useSWR<{
    markets: MatchMarkets;
    quota: QuotaInfo;
  }>(
    oddsEventId
      ? `/api/worldcup/match-markets?oddsEventId=${oddsEventId}`
      : null,
    fetcher,
    common,
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
