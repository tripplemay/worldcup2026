'use client';

import { useT } from 'lib/i18n/context';

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** 胜平负三段概率条 + 标签(主=brand蓝 / 平=灰 / 客=红)。 */
export default function ProbBar({
  home,
  draw,
  away,
}: {
  home: number;
  draw: number;
  away: number;
}) {
  const t = useT();
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full">
        <span className="bg-brand-500" style={{ width: pct(home) }} />
        <span className="bg-gray-300 dark:bg-navy-600" style={{ width: pct(draw) }} />
        <span className="bg-red-400" style={{ width: pct(away) }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px]">
        <span className="font-medium text-brand-500 dark:text-brand-400">
          {t('odds.home')} {pct(home)}
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          {t('odds.draw')} {pct(draw)}
        </span>
        <span className="font-medium text-red-500 dark:text-red-400">
          {t('odds.away')} {pct(away)}
        </span>
      </div>
    </div>
  );
}
