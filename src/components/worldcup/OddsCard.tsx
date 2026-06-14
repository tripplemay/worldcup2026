'use client';

import type { MatchOdds } from 'lib/odds/types';

function OddBlock({ label, best }: { label: string; best?: { price: number; bookmaker: string } }) {
  return (
    <div className="flex-1 rounded-xl bg-white/5 py-2 text-center">
      <div className="text-[11px] text-white/40">{label}</div>
      <div className="text-lg font-bold tabular-nums text-[#868CFF]">
        {best ? best.price.toFixed(2) : '—'}
      </div>
    </div>
  );
}

/** 一场比赛的最优胜平负赔率(三块)。 */
export default function OddsCard({ m }: { m: MatchOdds }) {
  return (
    <div className="rounded-[20px] bg-[#111c44] p-4 shadow-lg shadow-black/20">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <span className="flex-1 font-medium">{m.homeTeam}</span>
        <span className="text-xs text-white/30">vs</span>
        <span className="flex-1 text-right font-medium">{m.awayTeam}</span>
      </div>
      <div className="flex gap-2">
        <OddBlock label="主胜" best={m.best.home} />
        <OddBlock label="平" best={m.best.draw} />
        <OddBlock label="客胜" best={m.best.away} />
      </div>
      <div className="mt-2 text-center text-[11px] text-white/40">
        {m.bookmakers.length} 家博彩 · 最优赔率
      </div>
    </div>
  );
}
