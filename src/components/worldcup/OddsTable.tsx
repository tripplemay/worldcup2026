'use client';

import { useState } from 'react';
import Card from 'components/card';
import { useT } from 'lib/i18n/context';
import type { MatchMarkets, MatchOdds } from 'lib/odds/types';

const fmt = (v?: number) => (v != null ? v.toFixed(2) : '—');
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 ${active ? 'bg-brand-500 text-white' : 'text-gray-600 dark:text-gray-400'}`}
    >
      {children}
    </button>
  );
}

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return <th className={`py-1 font-normal ${left ? 'text-left' : 'text-center'}`}>{children}</th>;
}

function H2hTable({ m }: { m: MatchOdds }) {
  const t = useT();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-gray-400">
          <Th left>{t('odds.book')}</Th>
          <Th>{t('odds.home')}</Th>
          <Th>{t('odds.draw')}</Th>
          <Th>{t('odds.away')}</Th>
        </tr>
      </thead>
      <tbody>
        {m.bookmakers.map((b) => (
          <tr key={b.key} className="border-t border-gray-100 dark:border-white/5">
            <td className="py-1.5 text-gray-600 dark:text-gray-300">{b.title}</td>
            <td className="text-center tabular-nums text-navy-700 dark:text-white">{fmt(b.home)}</td>
            <td className="text-center tabular-nums text-navy-700 dark:text-white">{fmt(b.draw)}</td>
            <td className="text-center tabular-nums text-navy-700 dark:text-white">{fmt(b.away)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SpreadsTable({ markets }: { markets: MatchMarkets }) {
  const t = useT();
  const rows = markets.bookmakers.filter((b) => b.spreads?.length);
  if (!rows.length)
    return <div className="py-6 text-center text-xs text-gray-400">{t('detail.noSpreads')}</div>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-gray-400">
          <Th left>{t('odds.book')}</Th>
          <Th>{markets.homeTeam}</Th>
          <Th>{markets.awayTeam}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => {
          const h = b.spreads!.find((s) => s.team === markets.homeTeam);
          const a = b.spreads!.find((s) => s.team === markets.awayTeam);
          return (
            <tr key={b.key} className="border-t border-gray-100 dark:border-white/5">
              <td className="py-1.5 text-gray-600 dark:text-gray-300">{b.title}</td>
              <td className="text-center tabular-nums text-navy-700 dark:text-white">
                {h ? `${sign(h.point)} @${fmt(h.price)}` : '—'}
              </td>
              <td className="text-center tabular-nums text-navy-700 dark:text-white">
                {a ? `${sign(a.point)} @${fmt(a.price)}` : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TotalsTable({ markets }: { markets: MatchMarkets }) {
  const t = useT();
  const rows = markets.bookmakers.filter((b) => b.totals?.length);
  if (!rows.length)
    return <div className="py-6 text-center text-xs text-gray-400">{t('detail.noTotals')}</div>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-gray-400">
          <Th left>{t('odds.book')}</Th>
          <Th>{t('detail.over')}</Th>
          <Th>{t('detail.under')}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => {
          const ov = b.totals!.find((x) => x.type === 'Over');
          const un = b.totals!.find((x) => x.type === 'Under');
          return (
            <tr key={b.key} className="border-t border-gray-100 dark:border-white/5">
              <td className="py-1.5 text-gray-600 dark:text-gray-300">{b.title}</td>
              <td className="text-center tabular-nums text-navy-700 dark:text-white">
                {ov ? `${ov.point} @${fmt(ov.price)}` : '—'}
              </td>
              <td className="text-center tabular-nums text-navy-700 dark:text-white">
                {un ? `${un.point} @${fmt(un.price)}` : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 各家博彩多市场赔率表:胜平负 / 让球 / 大小球(标签切换)。 */
export default function OddsTable({ m, markets }: { m: MatchOdds; markets?: MatchMarkets }) {
  const t = useT();
  const [tab, setTab] = useState<'h2h' | 'spreads' | 'totals'>('h2h');
  const hasSpreads = markets?.bookmakers.some((b) => b.spreads?.length);
  const hasTotals = markets?.bookmakers.some((b) => b.totals?.length);

  return (
    <Card extra="mb-3 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-bold text-navy-700 dark:text-white">{t('detail.oddsTitle')}</div>
        <div className="flex gap-0.5 rounded-lg bg-lightPrimary p-0.5 text-xs dark:bg-navy-700">
          <TabBtn active={tab === 'h2h'} onClick={() => setTab('h2h')}>
            {t('detail.tabH2h')}
          </TabBtn>
          {hasSpreads && (
            <TabBtn active={tab === 'spreads'} onClick={() => setTab('spreads')}>
              {t('detail.tabSpreads')}
            </TabBtn>
          )}
          {hasTotals && (
            <TabBtn active={tab === 'totals'} onClick={() => setTab('totals')}>
              {t('detail.tabTotals')}
            </TabBtn>
          )}
        </div>
      </div>
      {tab === 'h2h' && <H2hTable m={m} />}
      {tab === 'spreads' && markets && <SpreadsTable markets={markets} />}
      {tab === 'totals' && markets && <TotalsTable markets={markets} />}
    </Card>
  );
}
