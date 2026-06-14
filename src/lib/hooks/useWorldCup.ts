'use client';

/**
 * 世界杯数据 Hooks(基于 SWR)。
 * 差异化刷新:比分快、赔率准实时、积分/对阵较慢、球队基本静态。
 * 公共选项:
 *  - refreshWhenHidden:false → 页面切后台自动暂停轮询(省配额/流量)
 *  - revalidateOnFocus      → 回到前台立即刷新
 *  - keepPreviousData       → 刷新时保留旧数据,柔和替换不闪屏
 */
import useSWR from 'swr';
import { fetcher } from './fetcher';
import type { MatchOdds, WinnerMarket, QuotaInfo } from 'lib/odds/types';
import type {
  ScheduleMatch,
  GroupStanding,
  Team,
  MatchEvent,
  BracketMatch,
} from 'lib/espn/types';

const ms = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const SCORES_MS = ms(process.env.NEXT_PUBLIC_SCORES_REFRESH_MS, 25_000);
const ODDS_MS = ms(process.env.NEXT_PUBLIC_ODDS_REFRESH_MS, 180_000);
const STANDINGS_MS = ms(process.env.NEXT_PUBLIC_STANDINGS_REFRESH_MS, 300_000);

const common = {
  revalidateOnFocus: true,
  refreshWhenHidden: false,
  keepPreviousData: true,
} as const;

/** 赛程 + 实时比分(快刷新)。dates:'YYYYMMDD'。 */
export function useScoreboard(dates?: string) {
  const key = `/api/worldcup/scoreboard${dates ? `?dates=${dates}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR<{ dates: string; matches: ScheduleMatch[] }>(
    key,
    fetcher,
    { refreshInterval: SCORES_MS, ...common },
  );
  return { matches: data?.matches ?? [], error, isLoading, refresh: mutate };
}

/** 12 小组积分榜(较慢刷新)。 */
export function useStandings() {
  const { data, error, isLoading, mutate } = useSWR<{ groups: GroupStanding[] }>(
    '/api/worldcup/standings',
    fetcher,
    { refreshInterval: STANDINGS_MS, ...common },
  );
  return { groups: data?.groups ?? [], error, isLoading, refresh: mutate };
}

/** 48 强球队(基本静态,只取首屏)。 */
export function useTeams() {
  const { data } = useSWR<{ teams: Team[] }>('/api/worldcup/teams', fetcher, common);
  return { teams: data?.teams ?? [] };
}

/** 单场赔率(准实时)+ 配额。 */
export function useMatchOdds() {
  const { data, error, isLoading, mutate } = useSWR<{ matches: MatchOdds[]; quota: QuotaInfo }>(
    '/api/worldcup/matches',
    fetcher,
    { refreshInterval: ODDS_MS, ...common },
  );
  return { matches: data?.matches ?? [], quota: data?.quota, error, isLoading, refresh: mutate };
}

/** 夺冠赔率榜(准实时)+ 配额。 */
export function useWinnerOdds() {
  const { data, error, isLoading, mutate } = useSWR<{ winner: WinnerMarket; quota: QuotaInfo }>(
    '/api/worldcup/winner',
    fetcher,
    { refreshInterval: ODDS_MS, ...common },
  );
  return { winner: data?.winner, quota: data?.quota, error, isLoading, refresh: mutate };
}

/** 单场进球/红黄牌时间线(仅在传入 eventId 时请求,如卡片展开时)。 */
export function useMatchEvents(eventId?: string) {
  const { data, error, isLoading } = useSWR<{ eventId: string; events: MatchEvent[] }>(
    eventId ? `/api/worldcup/events?eventId=${eventId}` : null,
    fetcher,
    { refreshInterval: 30_000, ...common },
  );
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

/** 配额是否吃紧(前端据此关闭自动刷新)。 */
export const QUOTA_LOW_THRESHOLD = 50;
export function isQuotaLow(quota?: QuotaInfo): boolean {
  return !!quota && quota.remaining != null && quota.remaining < QUOTA_LOW_THRESHOLD;
}
