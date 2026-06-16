'use client';

import { useState } from 'react';
import { useLiveOdds, useWinnerOdds } from 'lib/hooks/useWorldCup';
import { MdShowChart } from 'react-icons/md';
import { useT } from 'lib/i18n/context';
import OddsCard from 'components/worldcup/OddsCard';
import WinnerList from 'components/worldcup/WinnerList';
import QuotaRing from 'components/worldcup/QuotaRing';
import PageHeading from 'components/worldcup/PageHeading';

/** 实时状态条:红点 + "实时 · 更新于 HH:MM:SS"。 */
function LiveStatus({ updatedAt }: { updatedAt: number | null }) {
  const t = useT();
  const clock =
    updatedAt != null
      ? new Date(updatedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : '—';
  return (
    <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      <span className="font-medium text-red-500">{t('odds.live')}</span>
      <span>· {t('odds.updatedAt')} {clock}</span>
    </div>
  );
}

export default function OddsPage() {
  const t = useT();
  const [tab, setTab] = useState<'match' | 'winner'>('match');
  const { matches, changes, oddsUpdatedAt, isLoading } = useLiveOdds();
  const { winner, quota } = useWinnerOdds();

  const tabCls = (active: boolean) =>
    `flex-1 rounded-lg py-1.5 ${
      active ? 'bg-brand-500 text-white' : 'text-gray-600 dark:text-gray-400'
    }`;

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between">
          <PageHeading Icon={MdShowChart}>{t('odds.title')}</PageHeading>
          <QuotaRing quota={quota} />
        </div>
        <div className="mt-2 flex rounded-xl bg-white p-1 text-sm shadow-sm dark:bg-navy-800">
          <button
            onClick={() => setTab('match')}
            className={tabCls(tab === 'match')}
          >
            {t('odds.tabMatch')}
          </button>
          <button
            onClick={() => setTab('winner')}
            className={tabCls(tab === 'winner')}
          >
            {t('odds.tabWinner')}
          </button>
        </div>
      </header>

      {tab === 'match' ? (
        <div className="space-y-3">
          <LiveStatus updatedAt={oddsUpdatedAt} />
          {matches.length > 0 && (
            <div className="text-center text-[11px] text-gray-400">
              {t('odds.changeLegend')}
            </div>
          )}
          {isLoading &&
            matches.length === 0 &&
            [1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-[20px] bg-white dark:bg-navy-800"
              />
            ))}
          {!isLoading && matches.length === 0 && (
            <div className="py-10 text-center text-sm text-gray-400">
              {t('odds.noLive')}
            </div>
          )}
          {matches.map((m) => (
            <OddsCard key={m.id} m={m} change={changes[m.id]} />
          ))}
        </div>
      ) : (
        <WinnerList winner={winner} />
      )}
    </div>
  );
}
