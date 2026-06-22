'use client';

import { MdBolt, MdBalance } from 'react-icons/md';
import { useLocale } from 'lib/i18n/context';
import type {
  BookDivergence,
  DivergenceLevel,
  Side,
  SharpGapLevel,
} from 'lib/odds/bookDivergence';

const LV_CLS: Record<DivergenceLevel, string> = {
  tight: 'text-gray-500 dark:text-gray-400',
  moderate: 'text-amber-600 dark:text-amber-400',
  wide: 'text-red-500 dark:text-red-400',
};
const SHARP_CLS: Record<SharpGapLevel, string> = {
  aligned: 'text-gray-500 dark:text-gray-400',
  mild: 'text-amber-600 dark:text-amber-400',
  divergent: 'text-red-500 dark:text-red-400',
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * 跨家盘口读盘旁注。**优先**展示「锐盘 vs 软市场」差(历史校准证实:真正有信息量的是
 * 锐盘相对软市场的位置,而非裸幅度);无锐盘时回退裸幅度(分歧 Xpp + 领跑/滞后)。
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
  const sideLabel = (s: Side) =>
    s === 'home' ? t('odds.home') : s === 'away' ? t('odds.away') : t('odds.draw');

  // ── 校准升级:锐盘 vs 软市场(头条信号)──────────────────
  if (d.sharp) {
    const sh = d.sharp;
    const cls = SHARP_CLS[sh.level];
    const dir =
      sh.level === 'aligned'
        ? t('predict.divg.sharpAligned')
        : sh.gapPp > 0
        ? t('predict.divg.sharpHigh')
        : t('predict.divg.sharpLow');
    return (
      <div className="text-[11px] leading-tight">
        <div className="flex flex-wrap items-center gap-x-1">
          <MdBolt className={`shrink-0 ${cls}`} />
          <span className="text-gray-600 dark:text-gray-300">
            {t('predict.divg.sharp')}
          </span>
          <span className="font-semibold tabular-nums text-navy-700 dark:text-white">
            {sideLabel(sh.gapSide)} {pct(sh.sharpConsensus[sh.gapSide])}
          </span>
          <span className="text-gray-400">{t('predict.divg.softMkt')}</span>
          <span className="tabular-nums text-gray-600 dark:text-gray-300">
            {pct(sh.softConsensus[sh.gapSide])}
          </span>
          <span className={`tabular-nums ${cls}`}>
            ({sh.gapPp > 0 ? '+' : ''}
            {sh.gapPp}pp · {dir})
          </span>
        </div>
        {!compact && (
          <div className="mt-0.5 text-gray-400">
            {t('predict.divg.sharpBooks')} {sh.sharpTitles.join(' · ')}
          </div>
        )}
      </div>
    );
  }

  // ── 回退:无锐盘 → 裸幅度(校准证实信息量低,仅作补充)─────────
  const lvCls = LV_CLS[d.level];
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
        <span className="text-gray-400">({sideLabel(d.topSide)})</span>
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
