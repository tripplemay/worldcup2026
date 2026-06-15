'use client';

import Link from 'next/link';
import { MdEmojiEvents } from 'react-icons/md';
import { useBracket } from 'lib/hooks/useWorldCup';
import { useT } from 'lib/i18n/context';
import BracketView from 'components/worldcup/BracketView';
import PageHeading from 'components/worldcup/PageHeading';

export default function BracketPage() {
  const t = useT();
  const { matches, error, isLoading } = useBracket();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 flex items-center gap-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <Link
          href="/schedule"
          className="text-sm text-gray-500 dark:text-gray-400"
        >
          ‹ {t('common.back')}
        </Link>
        <PageHeading Icon={MdEmojiEvents}>{t('bracket.title')}</PageHeading>
      </header>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-500 dark:bg-red-500/15 dark:text-red-300">
          {t('bracket.failed')}
        </div>
      )}

      {isLoading && matches.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl bg-white dark:bg-navy-800"
            />
          ))}
        </div>
      )}

      {!isLoading && matches.length === 0 && !error && (
        <div className="py-16 text-center text-gray-400">
          {t('bracket.notStarted')}
        </div>
      )}

      <BracketView matches={matches} />
    </div>
  );
}
