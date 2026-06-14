'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useTeamLogos, type OddsChange, type OddsDir } from 'lib/hooks/useWorldCup';
import { normalizeTeam } from 'lib/match/normalize';
import { useT } from 'lib/i18n/context';
import type { MatchOdds } from 'lib/odds/types';

const fmt = (v?: number) => (v != null ? v.toFixed(2) : '—');

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

function AllBooks({ m }: { m: MatchOdds }) {
  const t = useT();
  const cell = (v?: number, best?: number) =>
    `text-center tabular-nums ${
      v != null && v === best ? 'font-bold text-brand-500 dark:text-brand-400' : 'text-navy-700 dark:text-white'
    }`;
  return (
    <table className="mt-3 w-full border-t border-gray-100 text-xs dark:border-white/10">
      <thead>
        <tr className="text-[11px] text-gray-400">
          <th className="py-1.5 text-left font-normal">{t('odds.book')}</th>
          <th className="w-14 font-normal">{t('odds.home')}</th>
          <th className="w-14 font-normal">{t('odds.draw')}</th>
          <th className="w-14 font-normal">{t('odds.away')}</th>
        </tr>
      </thead>
      <tbody>
        {m.bookmakers.map((b) => (
          <tr key={b.key} className="border-t border-gray-50 dark:border-white/5">
            <td className="py-1.5 text-gray-600 dark:text-gray-300">{b.title}</td>
            <td className={cell(b.home, m.best.home?.price)}>{fmt(b.home)}</td>
            <td className={cell(b.draw, m.best.draw?.price)}>{fmt(b.draw)}</td>
            <td className={cell(b.away, m.best.away?.price)}>{fmt(b.away)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 一场比赛赔率(Horizon Card):默认最优三块,点击展开各家完整赔率。 */
export default function OddsCard({ m, change }: { m: MatchOdds; change?: OddsChange }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const logos = useTeamLogos();
  return (
    <Card extra="p-4">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <TeamBadge
          name={m.homeTeam}
          logo={logos[normalizeTeam(m.homeTeam)]}
          className="flex-1 font-medium text-navy-700 dark:text-white"
        />
        <span className="text-xs text-gray-400">{t('common.vs')}</span>
        <TeamBadge
          name={m.awayTeam}
          logo={logos[normalizeTeam(m.awayTeam)]}
          reverse
          className="flex-1 justify-end text-right font-medium text-navy-700 dark:text-white"
        />
      </div>
      <div className="flex gap-2">
        <OddBlock label={t('odds.home')} best={m.best.home} dir={change?.home} />
        <OddBlock label={t('odds.draw')} best={m.best.draw} dir={change?.draw} />
        <OddBlock label={t('odds.away')} best={m.best.away} dir={change?.away} />
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-2 w-full text-center text-[11px] text-gray-500 active:opacity-70 dark:text-gray-400"
      >
        {m.bookmakers.length}
        {t('odds.bookmakerUnit')} · {open ? `${t('odds.collapse')} ⌃` : `${t('odds.expandAll')} ⌄`}
      </button>
      {open && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          <AllBooks m={m} />
        </motion.div>
      )}
    </Card>
  );
}
