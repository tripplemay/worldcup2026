'use client';

import { useEffect, useMemo, useState } from 'react';
import { MdCalendarMonth, MdCircle } from 'react-icons/md';
import MiniStatistics from 'components/card/MiniStatistics';
import PageHeading from 'components/worldcup/PageHeading';
import {
  useScoreboard,
  useMatchOdds,
  useLiveOdds,
} from 'lib/hooks/useWorldCup';
import { useRefreshOnVisible } from 'lib/hooks/useRefreshOnVisible';
import { matchKey } from 'lib/match/normalize';
import { useLocale } from 'lib/i18n/context';
import MatchCard from 'components/worldcup/MatchCard';
import PullToRefresh from 'components/worldcup/PullToRefresh';
import StatusBar from 'components/worldcup/StatusBar';
import OddsRefreshInfo from 'components/worldcup/OddsRefreshInfo';

function todayCN(): string {
  // UTC+8 当前日期
  return new Date(Date.now() + 8 * 3600_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
}
function shiftDate(yyyymmdd: string, days: number): string {
  const y = +yyyymmdd.slice(0, 4);
  const m = +yyyymmdd.slice(4, 6) - 1;
  const d = +yyyymmdd.slice(6, 8);
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}
function dateLabel(yyyymmdd: string, locale: string): string {
  const dt = new Date(
    Date.UTC(
      +yyyymmdd.slice(0, 4),
      +yyyymmdd.slice(4, 6) - 1,
      +yyyymmdd.slice(6, 8),
    ),
  );
  return dt.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const btn =
  'rounded-lg bg-white px-3 py-1 text-sm shadow-sm active:scale-95 dark:bg-navy-800 dark:text-gray-300';

export default function SchedulePage() {
  const { locale, t } = useLocale();
  // dates 为空 → 走后端「智能默认日期」(今天比赛全部结束时自动跳到下一个比赛日);
  // 用户翻页后变成具体日期,并同步到 URL(?d=),这样从详情页返回能回到原来那天。
  const [dates, setDates] = useState('');
  // 挂载时从 URL 恢复日期(详情页 router.back() 返回时携带)
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('d');
    if (d) setDates(d);
  }, []);
  // 切换日期:更新状态 + 同步 URL(replace,不堆历史)
  const go = (d: string) => {
    setDates(d);
    window.history.replaceState(null, '', d ? `/schedule?d=${d}` : '/schedule');
  };
  const { matches, effectiveDate, error, isLoading, refresh } = useScoreboard(
    dates || undefined,
  );
  const shown = dates || effectiveDate || todayCN();
  const {
    matches: oddsMatches,
    changes,
    oddsUpdatedAt,
    nextOddsRefreshAt,
  } = useMatchOdds();
  // 实时赔率(odds-api.io,最近 10 场,~36s 刷新):优先回填到对应赛程行
  const {
    matches: liveMatches,
    changes: liveChanges,
    refresh: refreshLive,
  } = useLiveOdds();
  // 回前台立即刷新比分 + 实时赔率(补足移动端 SWR focus 刷新不稳定的缺口);
  // 只刷免费/零上游端点(ESPN 比分 + odds-api.io 内存缓存),不动 The Odds API 低频赔率以省配额。
  useRefreshOnVisible([refresh, refreshLive]);
  // 赔率按对阵键建索引,行内 O(1) 取(避免每行对整数组 find;引用稳定利于行 memo)
  const oddsMap = useMemo(() => {
    const map = new Map<string, (typeof oddsMatches)[number]>();
    for (const o of oddsMatches)
      map.set(matchKey(o.homeTeam, o.awayTeam, o.commenceTime), o);
    return map;
  }, [oddsMatches]);
  // 赔率变动同样按对阵键建索引(服务端按 odds.id 给,映射到赛程行的对阵键)
  const changeMap = useMemo(() => {
    const map = new Map<string, (typeof changes)[string]>();
    for (const o of oddsMatches) {
      const ch = changes[o.id];
      if (ch) map.set(matchKey(o.homeTeam, o.awayTeam, o.commenceTime), ch);
    }
    return map;
  }, [oddsMatches, changes]);
  // 实时赔率/变动按对阵键建索引(同源配对:有实时则用实时的赔率+变动)
  const liveOddsMap = useMemo(() => {
    const map = new Map<string, (typeof liveMatches)[number]>();
    for (const o of liveMatches)
      map.set(matchKey(o.homeTeam, o.awayTeam, o.commenceTime), o);
    return map;
  }, [liveMatches]);
  const liveChangeMap = useMemo(() => {
    const map = new Map<string, (typeof liveChanges)[string]>();
    for (const o of liveMatches) {
      const ch = liveChanges[o.id];
      if (ch) map.set(matchKey(o.homeTeam, o.awayTeam, o.commenceTime), ch);
    }
    return map;
  }, [liveMatches, liveChanges]);
  // 取某行赔率:优先实时(odds-api.io),回退 The Odds API;赔率与变动同源配对
  const pickOdds = (key: string) => {
    const live = liveOddsMap.get(key);
    if (live) return { odds: live, change: liveChangeMap.get(key) };
    return { odds: oddsMap.get(key), change: changeMap.get(key) };
  };
  const live = matches.filter((m) => m.status === 'in').length;

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between pr-24">
          <PageHeading Icon={MdCalendarMonth}>
            {t('schedule.title')}
          </PageHeading>
          <a
            href="/bracket"
            className="rounded-lg bg-white px-2.5 py-1 text-xs shadow-sm active:scale-95 dark:bg-navy-800 dark:text-gray-300"
          >
            {t('schedule.bracket')} ›
          </a>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <StatusBar signal={matches} liveCount={live} intervalMs={25_000} />
          <OddsRefreshInfo
            updatedAt={oddsUpdatedAt}
            nextAt={nextOddsRefreshAt}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button onClick={() => go(shiftDate(shown, -1))} className={btn}>
            {t('schedule.prev')}
          </button>
          <span className="text-sm font-medium text-navy-700 dark:text-white">
            {dateLabel(shown, locale)}
          </span>
          <button onClick={() => go(shiftDate(shown, 1))} className={btn}>
            {t('schedule.next')}
          </button>
        </div>
      </header>

      <PullToRefresh onRefresh={refresh}>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <MiniStatistics
            name={t('schedule.todayMatches')}
            value={`${matches.length} ${t('schedule.unit')}`}
            icon={<MdCalendarMonth />}
            iconBg="bg-lightPrimary dark:!bg-navy-700"
          />
          <MiniStatistics
            name={t('schedule.liveNow')}
            value={`${live} ${t('schedule.unit')}`}
            icon={<MdCircle className="text-red-500" />}
            iconBg="bg-lightPrimary dark:!bg-navy-700"
          />
        </div>

        {error && (
          <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-500 dark:bg-red-500/15 dark:text-red-300">
            {t('common.loadFailed')},
            <button onClick={() => refresh()} className="underline">
              {t('common.retry')}
            </button>
          </div>
        )}

        {isLoading && matches.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-[20px] bg-white dark:bg-navy-800"
              />
            ))}
          </div>
        )}

        {!isLoading && matches.length === 0 && !error && (
          <div className="py-16 text-center text-gray-400">
            {t('schedule.empty')}
          </div>
        )}

        <div className="space-y-3">
          {matches.map((m) => {
            const { odds, change } = pickOdds(
              matchKey(m.homeTeam, m.awayTeam, m.commenceTime),
            );
            return <MatchCard key={m.id} m={m} odds={odds} change={change} />;
          })}
        </div>
      </PullToRefresh>
    </div>
  );
}
