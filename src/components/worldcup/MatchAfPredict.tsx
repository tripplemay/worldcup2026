'use client';

import Card from 'components/card';
import { useAfPredict } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';

const pct = (p: number | null) => (p == null ? '—' : `${Math.round(p * 100)}%`);

/** API-Football 现成预测(第三方参考;不进我们的融合)。无数据不渲染。 */
export default function MatchAfPredict({
  homeTeam,
  awayTeam,
  commenceTime,
}: {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}) {
  const { t } = useLocale();
  const { prediction } = useAfPredict(
    homeTeam,
    awayTeam,
    commenceTime.slice(0, 10),
  );
  if (!prediction) return null;

  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-navy-700 dark:text-white">
          {t('afp.title')}
        </span>
        <span className="shrink-0 rounded-full bg-gray-200/70 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-navy-700 dark:text-gray-300">
          {t('afp.note')}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-mono tabular-nums text-brand-500 dark:text-brand-400">
          {pct(prediction.home)}
        </span>
        <span className="font-mono tabular-nums text-gray-500 dark:text-gray-400">
          {pct(prediction.draw)}
        </span>
        <span className="font-mono tabular-nums text-red-500 dark:text-red-400">
          {pct(prediction.away)}
        </span>
      </div>
      {prediction.advice && (
        <div className="mt-2 border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-white/5 dark:text-gray-400">
          {prediction.advice}
        </div>
      )}
    </Card>
  );
}
