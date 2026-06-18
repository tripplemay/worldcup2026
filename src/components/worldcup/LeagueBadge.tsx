'use client';

import { useLocale } from 'lib/i18n/context';
import { leagueLevel } from 'lib/data/leagues';

// 配色以小字号(8px)可读性为先,均满足 WCAG AA 对比度。
const TIER_CLS: Record<1 | 2 | 3, string> = {
  1: 'bg-amber-400 text-black', // 五大联赛:亮金底 + 纯黑字(顶级联赛,对比度最高)
  2: 'bg-sky-700 text-white', // 知名联赛:深蓝底 + 白字
  3: 'bg-gray-200 text-gray-800 dark:bg-navy-600 dark:text-gray-100', // 其他
};

/** 联赛水平徽章(五大金 / 知名蓝 / 其他灰);无 league id 不渲染。 */
export default function LeagueBadge({
  leagueId,
  className = 'text-[8px]',
}: {
  leagueId?: number;
  className?: string;
}) {
  const { locale } = useLocale();
  const lv = leagueLevel(leagueId, locale);
  if (!lv) return null;
  return (
    <span
      className={`shrink-0 rounded px-1 font-bold leading-none ${
        TIER_CLS[lv.tier]
      } ${className}`}
    >
      {lv.label}
    </span>
  );
}
