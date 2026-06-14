'use client';

import { useState } from 'react';
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

export default function SchedulePage() {
  const [dates, setDates] = useState(todayUTC());
  const { matches, error, isLoading, refresh } = useScoreboard(dates);

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-[#0b1437]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">🏆 世界杯赛程 · 比分</h1>
          <a
            href="/bracket"
            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs active:scale-95"
          >
            淘汰赛 ›
          </a>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button
            onClick={() => setDates(shiftDate(dates, -1))}
            className="rounded-lg bg-white/10 px-3 py-1 text-sm active:scale-95"
          >
            ‹ 前一天
          </button>
          <span className="text-sm font-medium">{label(dates)}</span>
          <button
            onClick={() => setDates(shiftDate(dates, 1))}
            className="rounded-lg bg-white/10 px-3 py-1 text-sm active:scale-95"
          >
            后一天 ›
          </button>
        </div>
      </header>

      <PullToRefresh onRefresh={refresh}>
        {error && (
          <div className="mb-3 rounded-xl bg-red-500/15 p-3 text-sm text-red-300">
            加载失败,
            <button onClick={() => refresh()} className="underline">
              重试
            </button>
          </div>
        )}

        {isLoading && matches.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-[20px] bg-white/5"
              />
            ))}
          </div>
        )}

        {!isLoading && matches.length === 0 && !error && (
          <div className="py-16 text-center text-white/40">当日暂无比赛</div>
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
