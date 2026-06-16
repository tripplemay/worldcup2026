'use client';

import { memo, useState } from 'react';
import { MdSchedule } from 'react-icons/md';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import OddsArrow from 'components/worldcup/OddsArrow';
import VsBadge from 'components/worldcup/VsBadge';
import LiveMarketsPanel from 'components/worldcup/LiveMarketsPanel';
import { useTeamLogos } from 'lib/hooks/useWorldCup';
import type { MatchChange, OutcomeChange } from 'lib/odds/changes';
import { normalizeTeam } from 'lib/match/normalize';
import { useLocale } from 'lib/i18n/context';
import type { MatchOdds } from 'lib/odds/types';

/** 比赛时间(北京时间,月/日 时:分)。 */
function fmtTime(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai',
    });
  } catch {
    return iso;
  }
}

function OddBlock({
  label,
  best,
  ch,
}: {
  label: string;
  best?: { price: number; bookmaker: string };
  ch?: OutcomeChange;
}) {
  const dcls =
    ch?.dir === 'up'
      ? 'text-green-500'
      : ch?.dir === 'down'
      ? 'text-red-500'
      : 'text-brand-500 dark:text-white';
  return (
    <div className="flex-1 rounded-xl bg-lightPrimary py-2 text-center dark:bg-navy-700">
      <div className="text-[11px] text-gray-600 dark:text-gray-400">
        {label}
      </div>
      <div className={`text-lg font-bold leading-tight tabular-nums ${dcls}`}>
        {best ? best.price.toFixed(2) : '—'}
      </div>
      <div className="h-3 text-[10px] font-semibold leading-none">
        <OddsArrow ch={ch} withDelta />
      </div>
    </div>
  );
}

/** 一场比赛赔率(Horizon Card):默认胜平负三块,点击展开全部市场(按标签分组,按需加载)。 */
function OddsCard({ m, change }: { m: MatchOdds; change?: MatchChange }) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const logos = useTeamLogos();
  return (
    <Card extra="p-4">
      <div className="mb-2 flex items-center justify-center gap-1 text-[11px] text-gray-400">
        <MdSchedule className="text-xs" />
        {fmtTime(m.commenceTime, locale)}
      </div>
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <TeamBadge
          name={m.homeTeam}
          logo={logos[normalizeTeam(m.homeTeam)]}
          nameFirst
          className="min-w-0 flex-1 font-medium text-navy-700 dark:text-white"
        />
        <VsBadge />
        <TeamBadge
          name={m.awayTeam}
          logo={logos[normalizeTeam(m.awayTeam)]}
          className="min-w-0 flex-1 justify-end text-right font-medium text-navy-700 dark:text-white"
        />
      </div>
      <div className="flex gap-2">
        <OddBlock label={t('odds.home')} best={m.best.home} ch={change?.home} />
        <OddBlock label={t('odds.draw')} best={m.best.draw} ch={change?.draw} />
        <OddBlock label={t('odds.away')} best={m.best.away} ch={change?.away} />
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-2 w-full text-center text-[11px] text-gray-500 active:opacity-70 dark:text-gray-400"
      >
        {open ? `${t('odds.collapse')} ⌃` : `${t('odds.allMarkets')} ⌄`}
      </button>
      {open && (
        <div className="fade-in-up">
          <LiveMarketsPanel matchId={m.id} />
        </div>
      )}
    </Card>
  );
}

export default memo(OddsCard);
