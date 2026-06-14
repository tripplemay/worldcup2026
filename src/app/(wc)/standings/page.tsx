'use client';

import { useStandings } from 'lib/hooks/useWorldCup';
import { useT } from 'lib/i18n/context';
import StandingsTable from 'components/worldcup/StandingsTable';

export default function StandingsPage() {
  const t = useT();
  const { groups, error, isLoading, refresh } = useStandings();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <h1 className="text-lg font-bold text-navy-700 dark:text-white">{t('standings.title')}</h1>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{t('standings.hint')}</p>
      </header>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-500 dark:bg-red-500/15 dark:text-red-300">
          {t('common.loadFailed')},
          <button onClick={() => refresh()} className="underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      {isLoading && groups.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
          <StandingsTable key={g.group} g={g} />
        ))}
      </div>
    </div>
  );
}
