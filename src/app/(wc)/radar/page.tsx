'use client';

import { MdBolt } from 'react-icons/md';
import PageHeading from 'components/worldcup/PageHeading';
import RadarFeed from 'components/worldcup/RadarFeed';
import { useLocale } from 'lib/i18n/context';

export default function RadarPage() {
  const { t } = useLocale();
  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <PageHeading Icon={MdBolt}>{t('radar.title')}</PageHeading>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('radar.subtitle')}
        </p>
      </header>
      <RadarFeed />
    </div>
  );
}
