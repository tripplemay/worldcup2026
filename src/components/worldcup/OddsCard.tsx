'use client';

import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useTeamLogos, type OddsChange, type OddsDir } from 'lib/hooks/useWorldCup';
import { normalizeTeam } from 'lib/match/normalize';
import type { MatchOdds } from 'lib/odds/types';

function OddBlock({
  label,
  best,
  dir,
}: {
  label: string;
  best?: { price: number; bookmaker: string };
  dir?: OddsDir;
}) {
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '';
  const dcls =
    dir === 'up' ? 'text-green-500' : dir === 'down' ? 'text-red-500' : 'text-brand-500 dark:text-white';
  return (
    <div className="flex-1 rounded-xl bg-lightPrimary py-2 text-center dark:bg-navy-700">
      <div className="text-[11px] text-gray-600 dark:text-gray-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${dcls}`}>
        {best ? best.price.toFixed(2) : '—'}
        {arrow && <span className="ml-0.5 text-xs">{arrow}</span>}
      </div>
    </div>
  );
}

/** 一场比赛的最优胜平负赔率(Horizon Card,队徽 + 涨跌箭头)。 */
export default function OddsCard({ m, change }: { m: MatchOdds; change?: OddsChange }) {
  const logos = useTeamLogos();
  return (
    <Card extra="p-4">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <TeamBadge
          name={m.homeTeam}
          logo={logos[normalizeTeam(m.homeTeam)]}
          className="flex-1 font-medium text-navy-700 dark:text-white"
        />
        <span className="text-xs text-gray-400">vs</span>
        <TeamBadge
          name={m.awayTeam}
          logo={logos[normalizeTeam(m.awayTeam)]}
          reverse
          className="flex-1 justify-end text-right font-medium text-navy-700 dark:text-white"
        />
      </div>
      <div className="flex gap-2">
        <OddBlock label="主胜" best={m.best.home} dir={change?.home} />
        <OddBlock label="平" best={m.best.draw} dir={change?.draw} />
        <OddBlock label="客胜" best={m.best.away} dir={change?.away} />
      </div>
      <div className="mt-2 text-center text-[11px] text-gray-500 dark:text-gray-400">
        {m.bookmakers.length} 家博彩 · 最优赔率
      </div>
    </Card>
  );
}
