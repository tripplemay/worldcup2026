'use client';

import { useState } from 'react';
import Card from 'components/card';
import { useMatchMarkets, useMatchGroup } from 'lib/hooks/useWorldCup';
import { useT, useTn } from 'lib/i18n/context';
import GroupPanel from 'components/worldcup/MarketPanels';
import OddsArrow from 'components/worldcup/OddsArrow';
import type { MatchMarkets, MatchOdds, MarketGroup } from 'lib/odds/types';
import type { MatchChange } from 'lib/odds/changes';

const fmt = (v?: number) => (v != null ? v.toFixed(2) : '—');
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

type Tab = MarketGroup; // 'handicap' 复用为让球大小;另加 firsthalf/corners/cards/players
const GROUP_TABS: Exclude<MarketGroup, 'handicap'>[] = [
  'firsthalf',
  'corners',
  'cards',
  'players',
];

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
      className={`whitespace-nowrap rounded-md px-2.5 py-1 ${
        active ? 'bg-brand-500 text-white' : 'text-gray-600 dark:text-gray-400'
      }`}
    >
      {children}
    </button>
  );
}

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return (
    <th className={`py-1 font-normal ${left ? 'text-left' : 'text-center'}`}>
      {children}
    </th>
  );
}

function H2hTable({ m, change }: { m: MatchOdds; change?: MatchChange }) {
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
        {m.bookmakers.map((b) => {
          const cs = change?.books?.[b.key];
          return (
            <tr
              key={b.key}
              className="border-t border-gray-100 dark:border-white/5"
            >
              <td className="py-1.5 text-gray-600 dark:text-gray-300">
                {b.title}
              </td>
              <td className="text-center tabular-nums text-navy-700 dark:text-white">
                {fmt(b.home)}
                <OddsArrow ch={cs?.home} />
              </td>
              <td className="text-center tabular-nums text-navy-700 dark:text-white">
                {fmt(b.draw)}
                <OddsArrow ch={cs?.draw} />
              </td>
              <td className="text-center tabular-nums text-navy-700 dark:text-white">
                {fmt(b.away)}
                <OddsArrow ch={cs?.away} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SpreadsTable({ markets }: { markets: MatchMarkets }) {
  const t = useT();
  const tn = useTn();
  const rows = markets.bookmakers.filter((b) => b.spreads?.length);
  if (!rows.length)
    return (
      <div className="py-4 text-center text-xs text-gray-400">
        {t('detail.noSpreads')}
      </div>
    );
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-gray-400">
          <Th left>{t('odds.book')}</Th>
          <Th>{tn(markets.homeTeam)}</Th>
          <Th>{tn(markets.awayTeam)}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => {
          const h = b.spreads!.find((s) => s.team === markets.homeTeam);
          const a = b.spreads!.find((s) => s.team === markets.awayTeam);
          return (
            <tr
              key={b.key}
              className="border-t border-gray-100 dark:border-white/5"
            >
              <td className="py-1.5 text-gray-600 dark:text-gray-300">
                {b.title}
              </td>
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
    return (
      <div className="py-4 text-center text-xs text-gray-400">
        {t('detail.noTotals')}
      </div>
    );
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
            <tr
              key={b.key}
              className="border-t border-gray-100 dark:border-white/5"
            >
              <td className="py-1.5 text-gray-600 dark:text-gray-300">
                {b.title}
              </td>
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

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-xs font-semibold text-navy-700 dark:text-white">
      {children}
    </div>
  );
}

/**
 * 各家博彩多市场赔率表(标签切换,横向可滚动):
 *  · 胜平负来自已加载的 matches(0 配额)
 *  · 让球大小 / 上半场 / 角球 / 红黄牌 / 球员 **仅在点击该标签时**才按需拉取
 *    The Odds API event 端点(每有效市场×区域=1 点,缓存 5min,按组分缓存),不看就不扣点。
 */
export default function OddsTable({
  m,
  oddsEventId,
  change,
}: {
  m: MatchOdds;
  oddsEventId?: string;
  change?: MatchChange;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('h2h');

  const handicap = useMatchMarkets(
    tab === 'handicap' ? oddsEventId : undefined,
  );
  const groupTab = GROUP_TABS.includes(tab as never)
    ? (tab as Exclude<MarketGroup, 'handicap'>)
    : undefined;
  const group = useMatchGroup(oddsEventId, groupTab);

  const loading =
    (tab === 'handicap' && handicap.isLoading) ||
    (!!groupTab && group.isLoading);

  const tabLabel: Record<Tab, string> = {
    h2h: t('detail.tabH2h'),
    handicap: t('detail.tabHandicap'),
    firsthalf: t('detail.tabFirstHalf'),
    corners: t('detail.tabCorners'),
    cards: t('detail.tabCards'),
    players: t('detail.tabPlayers'),
  };
  const tabs: Tab[] = [
    'h2h',
    'handicap',
    'firsthalf',
    'corners',
    'cards',
    'players',
  ];

  return (
    <Card extra="mb-3 p-3">
      <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        {t('detail.oddsTitle')}
      </div>
      <div className="-mx-1 mb-3 overflow-x-auto px-1">
        <div className="flex w-max gap-0.5 rounded-lg bg-lightPrimary p-0.5 text-xs dark:bg-navy-700">
          {tabs.map((k) => (
            <TabBtn key={k} active={tab === k} onClick={() => setTab(k)}>
              {tabLabel[k]}
            </TabBtn>
          ))}
        </div>
      </div>

      {tab === 'h2h' && <H2hTable m={m} change={change} />}

      {loading && (
        <div className="py-6 text-center text-xs text-gray-400">
          {t('detail.loadingOdds')}
        </div>
      )}

      {tab === 'handicap' && !loading && handicap.markets && (
        <>
          <SubHead>{t('detail.tabSpreads')}</SubHead>
          <SpreadsTable markets={handicap.markets} />
          <div className="mt-3">
            <SubHead>{t('detail.tabTotals')}</SubHead>
            <TotalsTable markets={handicap.markets} />
          </div>
        </>
      )}

      {!!groupTab && !loading && group.markets && (
        <GroupPanel markets={group.markets} />
      )}
    </Card>
  );
}
