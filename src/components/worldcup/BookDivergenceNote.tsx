'use client';

import { MdBalance } from 'react-icons/md';
import { useLocale } from 'lib/i18n/context';
import type { BookDivergence, DivergenceLevel } from 'lib/odds/bookDivergence';

const LV_CLS: Record<DivergenceLevel, string> = {
  tight: 'text-gray-500 dark:text-gray-400',
  moderate: 'text-amber-600 dark:text-amber-400',
  wide: 'text-red-500 dark:text-red-400',
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * 跨家盘口分歧旁注:头条一行(分歧 X pp(某路)· 分级),非紧凑模式再加领跑/滞后家。
 * 纯读盘展示,不构成下注建议。
 */
export default function BookDivergenceNote({
  d,
  compact = false,
}: {
  d: BookDivergence;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const lvCls = LV_CLS[d.level];
  const sideLabel =
    d.topSide === 'home'
      ? t('odds.home')
      : d.topSide === 'away'
      ? t('odds.away')
      : t('odds.draw');

  return (
    <div className="text-[11px] leading-tight">
      <div className="flex flex-wrap items-center gap-x-1">
        <MdBalance className={`shrink-0 ${lvCls}`} />
        <span className="text-gray-600 dark:text-gray-300">
          {t('predict.divg.label')}
        </span>
        <span className={`font-semibold tabular-nums ${lvCls}`}>
          {d.spreadPp}pp
        </span>
        <span className="text-gray-400">({sideLabel})</span>
        <span className={lvCls}>· {t(`predict.divg.${d.level}`)}</span>
      </div>
      {!compact && d.level !== 'tight' && (
        <div className="mt-0.5 text-gray-500 dark:text-gray-400">
          {t('predict.divg.lead')} {d.high.title}{' '}
          <span className="tabular-nums">{pct(d.high.prob)}</span>
          {' · '}
          {t('predict.divg.lag')} {d.low.title}{' '}
          <span className="tabular-nums">{pct(d.low.prob)}</span>
        </div>
      )}
    </div>
  );
}
