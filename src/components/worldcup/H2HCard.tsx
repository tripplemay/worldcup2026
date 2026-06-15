'use client';

import Card from 'components/card';
import { useLocale } from 'lib/i18n/context';
import type { H2HGame } from 'lib/espn/types';

function shortDate(iso: string, locale: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(
      locale === 'zh' ? 'zh-CN' : 'en-US',
      { year: 'numeric', month: 'numeric' },
    );
  } catch {
    return '';
  }
}

/** 历史交锋:过往对阵列表(无记录时不渲染)。 */
export default function H2HCard({ h2h }: { h2h: H2HGame[] }) {
  const { locale, t, tn } = useLocale();
  if (!h2h.length) return null;
  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        {t('bg.h2h')}
      </div>
      <div className="space-y-1">
        {h2h.slice(0, 8).map((g, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400"
          >
            <span className="w-12 tabular-nums">
              {shortDate(g.date, locale)}
            </span>
            <span className="flex-1 truncate text-right text-navy-700 dark:text-white">
              {tn(g.homeTeam)}
            </span>
            <span className="tabular-nums font-bold text-navy-700 dark:text-white">
              {g.homeScore}-{g.awayScore}
            </span>
            <span className="flex-1 truncate text-navy-700 dark:text-white">
              {tn(g.awayTeam)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
