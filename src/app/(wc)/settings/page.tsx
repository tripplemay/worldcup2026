'use client';

import { MdSettings } from 'react-icons/md';
import Card from 'components/card';
import { useMatchOdds } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import KeyManager from 'components/worldcup/KeyManager';
import PageHeading from 'components/worldcup/PageHeading';

export default function SettingsPage() {
  const { quota } = useMatchOdds();
  const { locale, setLocale, t } = useLocale();

  const langBtn = (active: boolean) =>
    `flex-1 rounded-lg py-1.5 text-sm ${
      active ? 'bg-brand-500 text-white' : 'text-gray-600 dark:text-gray-400'
    }`;

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <PageHeading Icon={MdSettings}>{t('settings.title')}</PageHeading>
      </header>

      <div className="space-y-3 text-sm">
        <Card extra="p-4">
          <div className="mb-2 font-medium text-navy-700 dark:text-white">
            {t('settings.language')}
          </div>
          <div className="flex gap-1 rounded-xl bg-lightPrimary p-1 dark:bg-navy-700">
            <button
              onClick={() => setLocale('zh')}
              className={langBtn(locale === 'zh')}
            >
              中文
            </button>
            <button
              onClick={() => setLocale('en')}
              className={langBtn(locale === 'en')}
            >
              English
            </button>
          </div>
        </Card>

        <Card extra="p-4">
          <div className="mb-1 font-medium text-navy-700 dark:text-white">
            {t('settings.dataSource')}
          </div>
          <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            {t('settings.oddsSource')}
            <br />
            {t('settings.espnSource')}
            <br />
            {t('settings.quotaRemain')}:{quota?.remaining ?? '—'} /{' '}
            {quota?.total ?? 500}
            {quota?.keyCount && quota.keyCount > 1
              ? ` (${quota.keyCount} key)`
              : ''}
          </div>
        </Card>

        <KeyManager />

        <Card extra="p-4">
          <div className="mb-1 font-medium text-navy-700 dark:text-white">
            {t('settings.refreshTitle')}
          </div>
          <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            {t('settings.refreshDesc')}
            <br />
            {t('settings.refreshDesc2')}
          </div>
        </Card>

        <Card extra="p-4 text-center text-xs text-gray-500 dark:text-gray-400">
          {t('settings.footer')}
        </Card>
      </div>
    </div>
  );
}
