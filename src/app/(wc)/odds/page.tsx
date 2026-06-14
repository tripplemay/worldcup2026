'use client';

import { useState } from 'react';
import { useMatchOdds, useWinnerOdds, isQuotaLow } from 'lib/hooks/useWorldCup';
import OddsCard from 'components/worldcup/OddsCard';
import WinnerList from 'components/worldcup/WinnerList';

export default function OddsPage() {
  const [tab, setTab] = useState<'match' | 'winner'>('match');
  const { matches, quota, isLoading } = useMatchOdds();
  const { winner } = useWinnerOdds();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-[#0b1437]/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-bold">🎲 赔率 · 夺冠</h1>
        {quota?.remaining != null && (
          <div className={`mt-1 text-xs ${isQuotaLow(quota) ? 'text-amber-400' : 'text-white/40'}`}>
            剩余配额 {quota.remaining}/500{isQuotaLow(quota) ? ' · 已节流' : ''}
          </div>
        )}
        <div className="mt-2 flex rounded-xl bg-white/5 p-1 text-sm">
          <button
            onClick={() => setTab('match')}
            className={`flex-1 rounded-lg py-1.5 ${tab === 'match' ? 'bg-[#4318FF] text-white' : 'text-white/60'}`}
          >
            单场赔率
          </button>
          <button
            onClick={() => setTab('winner')}
            className={`flex-1 rounded-lg py-1.5 ${tab === 'winner' ? 'bg-[#4318FF] text-white' : 'text-white/60'}`}
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
              <div key={i} className="h-28 animate-pulse rounded-[20px] bg-white/5" />
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
