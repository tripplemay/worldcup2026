'use client';

import Card from 'components/card';
import type { MatchOdds } from 'lib/odds/types';

function OddBlock({ label, best }: { label: string; best?: { price: number; bookmaker: string } }) {
  return (
    <div className="flex-1 rounded-xl bg-lightPrimary py-2 text-center dark:bg-navy-700">
      <div className="text-[11px] text-gray-600 dark:text-gray-400">{label}</div>
      <div className="text-lg font-bold tabular-nums text-brand-500 dark:text-white">
        {best ? best.price.toFixed(2) : '—'}
      </div>
    </div>
  );
}

/** 一场比赛的最优胜平负赔率(Horizon Card,三块)。 */
export default function OddsCard({ m }: { m: MatchOdds }) {
  return (
    <Card extra="p-4">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <span className="flex-1 font-medium text-navy-700 dark:text-white">{m.homeTeam}</span>
        <span className="text-xs text-gray-400">vs</span>
        <span className="flex-1 text-right font-medium text-navy-700 dark:text-white">{m.awayTeam}</span>
      </div>
      <div className="flex gap-2">
        <OddBlock label="主胜" best={m.best.home} />
        <OddBlock label="平" best={m.best.draw} />
        <OddBlock label="客胜" best={m.best.away} />
      </div>
      <div className="mt-2 text-center text-[11px] text-gray-500 dark:text-gray-400">
        {m.bookmakers.length} 家博彩 · 最优赔率
      </div>
    </Card>
  );
}
