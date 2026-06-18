'use client';

import { MdSportsSoccer } from 'react-icons/md';
import Card from 'components/card';
import { useLeaders } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';

/** 射手榜(前 8;name + 球队 + 进球·助攻)。无数据不渲染。 */
export default function TopScorers() {
  const { t, tn } = useLocale();
  const { scorers } = useLeaders();
  if (!scorers.length) return null;

  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 flex items-center gap-1 text-sm font-bold text-navy-700 dark:text-white">
        <MdSportsSoccer className="text-brand-500 dark:text-brand-400" />
        {t('leaders.title')}
      </div>
      <div className="space-y-1.5">
        {scorers.slice(0, 8).map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-4 shrink-0 text-center font-mono text-gray-400">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-navy-700 dark:text-white">
              {s.name}
            </span>
            <span className="shrink-0 truncate text-gray-400">{tn(s.team)}</span>
            <span className="shrink-0 font-mono tabular-nums text-navy-700 dark:text-white">
              {s.goals}
              {t('leaders.goals')}
              {s.assists > 0 && (
                <span className="text-gray-400">
                  {' '}
                  {s.assists}
                  {t('leaders.assists')}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
