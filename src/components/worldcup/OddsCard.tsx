'use client';

import { memo, useState } from 'react';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import OddsArrow from 'components/worldcup/OddsArrow';
import VsBadge from 'components/worldcup/VsBadge';
import LiveMarketsPanel from 'components/worldcup/LiveMarketsPanel';
import LineTrend from 'components/worldcup/LineTrend';
import { useTeamLogos } from 'lib/hooks/useWorldCup';
import type { MatchChange, OutcomeChange } from 'lib/odds/changes';
import { normalizeTeam } from 'lib/match/normalize';
import { useLocale } from 'lib/i18n/context';
import { formatMatchTime } from 'lib/format/matchTime';
import type { MatchOdds } from 'lib/odds/types';

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

/** 初盘单格:显示首见价 + 相对现价的总线移(▲价升 / ▼价降)。 */
function OpenCell({ open, cur }: { open: number; cur?: number }) {
  const dir =
    cur == null ? 'flat' : cur > open ? 'up' : cur < open ? 'down' : 'flat';
  const cls =
    dir === 'up'
      ? 'text-green-500'
      : dir === 'down'
      ? 'text-red-500'
      : 'text-gray-400';
  return (
    <div className="flex-1 rounded-lg bg-lightPrimary/60 py-1 text-center dark:bg-navy-700/40">
      <span className="text-sm font-semibold tabular-nums text-gray-600 dark:text-gray-300">
        {open.toFixed(2)}
      </span>
      {cur != null && dir !== 'flat' && (
        <span className={`ml-1 text-[10px] tabular-nums ${cls}`}>
          {dir === 'up' ? '▲' : '▼'}
          {Math.abs(cur - open).toFixed(2)}
        </span>
      )}
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
      <div className="mb-2 text-xs text-gray-600 dark:text-gray-400">
        {formatMatchTime(m.commenceTime, locale)}
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
      {m.opening && (
        <div className="mt-2">
          <div className="mb-1 text-center text-[10px] text-gray-400">
            {t('odds.opening')}
          </div>
          <div className="flex gap-2">
            <OpenCell open={m.opening.home} cur={m.best.home?.price} />
            <OpenCell open={m.opening.draw} cur={m.best.draw?.price} />
            <OpenCell open={m.opening.away} cur={m.best.away?.price} />
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-2 w-full text-center text-[11px] text-gray-500 active:opacity-70 dark:text-gray-400"
      >
        {open ? `${t('odds.collapse')} ⌃` : `${t('odds.allMarkets')} ⌄`}
      </button>
      {open && (
        <div className="fade-in-up">
          <LineTrend matchId={m.id} />
          <LiveMarketsPanel matchId={m.id} />
        </div>
      )}
    </Card>
  );
}

export default memo(OddsCard);
