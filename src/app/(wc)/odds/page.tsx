'use client';

import { useState } from 'react';
import { useMatchOdds, useWinnerOdds } from 'lib/hooks/useWorldCup';
import OddsCard from 'components/worldcup/OddsCard';
import WinnerList from 'components/worldcup/WinnerList';
import QuotaRing from 'components/worldcup/QuotaRing';

export default function OddsPage() {
  const [tab, setTab] = useState<'match' | 'winner'>('match');
  const { matches, quota, isLoading } = useMatchOdds();
  const { winner } = useWinnerOdds();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-navy-700 dark:text-white">🎲 赔率 · 夺冠</h1>
          <QuotaRing quota={quota} />
        </div>
        <div className="mt-2 flex rounded-xl bg-white p-1 text-sm shadow-sm dark:bg-navy-800">
          <button
            onClick={() => setTab('match')}
            className={`flex-1 rounded-lg py-1.5 ${tab === 'match' ? 'bg-brand-500 text-white' : 'text-gray-600 dark:text-gray-400'}`}
          >
            单场赔率
          </button>
          <button
            onClick={() => setTab('winner')}
            className={`flex-1 rounded-lg py-1.5 ${tab === 'winner' ? 'bg-brand-500 text-white' : 'text-gray-600 dark:text-gray-400'}`}
          >
            夺冠榜
          </button>
        </div>
      </header>

      {tab === 'match' ? (
        <div className="space-y-3">
          {isLoading &&
            matches.length === 0 &&
            [1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
            ))}
          {matches.map((m) => (
            <OddsCard key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <WinnerList winner={winner} />
      )}
    </div>
  );
}
