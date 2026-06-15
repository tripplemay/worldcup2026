'use client';

import { useState } from 'react';
import MiniStatistics from 'components/card/MiniStatistics';
import { useScoreboard, useMatchOdds } from 'lib/hooks/useWorldCup';
import { findMatch } from 'lib/match/normalize';
import { useLocale } from 'lib/i18n/context';
import MatchCard from 'components/worldcup/MatchCard';
import PullToRefresh from 'components/worldcup/PullToRefresh';
import StatusBar from 'components/worldcup/StatusBar';
import OddsRefreshInfo from 'components/worldcup/OddsRefreshInfo';

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
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
  const [dates, setDates] = useState(todayUTC());
  const { matches, error, isLoading, refresh } = useScoreboard(dates);
  const {
    matches: oddsMatches,
    oddsUpdatedAt,
    nextOddsRefreshAt,
  } = useMatchOdds();
  const live = matches.filter((m) => m.status === 'in').length;

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-navy-700 dark:text-white">
            {t('schedule.title')}
          </h1>
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
          <button
            onClick={() => setDates(shiftDate(dates, -1))}
            className={btn}
          >
            {t('schedule.prev')}
          </button>
          <span className="text-sm font-medium text-navy-700 dark:text-white">
            {dateLabel(dates, locale)}
          </span>
          <button onClick={() => setDates(shiftDate(dates, 1))} className={btn}>
            {t('schedule.next')}
          </button>
        </div>
      </header>

      <PullToRefresh onRefresh={refresh}>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <MiniStatistics
            name={t('schedule.todayMatches')}
            value={`${matches.length} ${t('schedule.unit')}`}
            icon={<span>📅</span>}
            iconBg="bg-lightPrimary dark:!bg-navy-700"
          />
          <MiniStatistics
            name={t('schedule.liveNow')}
            value={`${live} ${t('schedule.unit')}`}
            icon={<span>🔴</span>}
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
          {matches.map((m) => (
            <MatchCard
              key={m.id}
              m={m}
              odds={findMatch(
                oddsMatches,
                m.homeTeam,
                m.awayTeam,
                m.commenceTime,
              )}
            />
          ))}
        </div>
      </PullToRefresh>
    </div>
  );
}
