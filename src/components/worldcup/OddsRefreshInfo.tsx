'use client';

import { MdShowChart } from 'react-icons/md';
import { useLocale } from 'lib/i18n/context';

function fmt(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  });
}

/** 赔率刷新节奏:上次更新时间 · 下次刷新时间(30min 间隔)。 */
export default function OddsRefreshInfo({
  updatedAt,
  nextAt,
}: {
  updatedAt: number | null;
  nextAt: number | null;
}) {
  const { locale, t } = useLocale();
  if (!updatedAt) return null;
  return (
    <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
      <MdShowChart className="shrink-0" />
      <span>
        {t('odds.refreshAt')} {fmt(updatedAt, locale)}
        {nextAt ? ` · ${t('odds.nextAt')} ${fmt(nextAt, locale)}` : ''}
      </span>
    </div>
  );
}
