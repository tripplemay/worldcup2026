'use client';

import { useState } from 'react';
import MiniStatistics from 'components/card/MiniStatistics';
import { useScoreboard } from 'lib/hooks/useWorldCup';
import MatchCard from 'components/worldcup/MatchCard';
import PullToRefresh from 'components/worldcup/PullToRefresh';

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
function label(yyyymmdd: string): string {
  return `${+yyyymmdd.slice(4, 6)} 月 ${+yyyymmdd.slice(6, 8)} 日`;
}

const btn =
  'rounded-lg bg-white px-3 py-1 text-sm shadow-sm active:scale-95 dark:bg-navy-800 dark:text-gray-300';

export default function SchedulePage() {
  const [dates, setDates] = useState(todayUTC());
  const { matches, error, isLoading, refresh } = useScoreboard(dates);
  const live = matches.filter((m) => m.status === 'in').length;

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-navy-700 dark:text-white">🏆 世界杯赛程 · 比分</h1>
          <a
            href="/bracket"
            className="rounded-lg bg-white px-2.5 py-1 text-xs shadow-sm active:scale-95 dark:bg-navy-800 dark:text-gray-300"
          >
            淘汰赛 ›
          </a>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button onClick={() => setDates(shiftDate(dates, -1))} className={btn}>
            ‹ 前一天
          </button>
          <span className="text-sm font-medium text-navy-700 dark:text-white">{label(dates)}</span>
          <button onClick={() => setDates(shiftDate(dates, 1))} className={btn}>
            后一天 ›
          </button>
        </div>
      </header>

      <PullToRefresh onRefresh={refresh}>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <MiniStatistics
            name="当日比赛"
            value={`${matches.length} 场`}
            icon={<span>📅</span>}
            iconBg="bg-lightPrimary dark:!bg-navy-700"
          />
          <MiniStatistics
            name="进行中"
            value={`${live} 场`}
            icon={<span>🔴</span>}
            iconBg="bg-lightPrimary dark:!bg-navy-700"
          />
        </div>

        {error && (
          <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-500 dark:bg-red-500/15 dark:text-red-300">
            加载失败,
            <button onClick={() => refresh()} className="underline">
              重试
            </button>
          </div>
        )}

        {isLoading && matches.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
            ))}
          </div>
        )}

        {!isLoading && matches.length === 0 && !error && (
          <div className="py-16 text-center text-gray-400">当日暂无比赛</div>
        )}

        <div className="space-y-3">
          {matches.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      </PullToRefresh>
    </div>
  );
}
