'use client';

import { useState } from 'react';
import Card from 'components/card';
import { useMatchMarkets, useMatchGroup } from 'lib/hooks/useWorldCup';
import { useT, useTn } from 'lib/i18n/context';
import GroupPanel from 'components/worldcup/MarketPanels';
import OddsArrow from 'components/worldcup/OddsArrow';
import BookDivergenceNote from 'components/worldcup/BookDivergenceNote';
import { computeBookDivergence, type Side } from 'lib/odds/bookDivergence';
import type { MatchMarkets, MatchOdds, MarketGroup } from 'lib/odds/types';
import type { MatchChange, OutcomeChange } from 'lib/odds/changes';

const fmt = (v?: number) => (v != null ? v.toFixed(2) : '—');
const pctOf = (p: number) => `${Math.round(p * 100)}%`;
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

/** 一个赔率格:赔率(含涨跌箭头)+ 去水真概率(领跑绿▲ / 滞后红▼ / 普通灰)。 */
function DvCell({
  price,
  ip,
  ch,
  mark,
}: {
  price?: number;
  ip?: number;
  ch?: OutcomeChange;
  mark?: 'lead' | 'lag';
}) {
  const ipCls =
    mark === 'lead'
      ? 'font-semibold text-green-600 dark:text-green-400'
      : mark === 'lag'
      ? 'font-semibold text-red-500 dark:text-red-400'
      : 'text-gray-400';
  return (
    <td className="py-1 text-center tabular-nums">
      <div className="text-navy-700 dark:text-white">
        {fmt(price)}
        <OddsArrow ch={ch} />
      </div>
      {ip != null && (
        <div className={`text-[10px] leading-none ${ipCls}`}>
          {pctOf(ip)}
          {mark === 'lead' ? ' ▲' : mark === 'lag' ? ' ▼' : ''}
        </div>
      )}
    </td>
  );
}

function H2hTable({ m, change }: { m: MatchOdds; change?: MatchChange }) {
  const t = useT();
  // 跨家分歧 + 各家去水真概率(同源多家比较,无需对齐;零额外配额)
  const div = computeBookDivergence(m.bookmakers);
  const ipByKey = new Map(div?.perBook.map((p) => [p.key, p]) ?? []);
  const markOf = (key: string, side: Side): 'lead' | 'lag' | undefined => {
    // 仅在分歧达温和+时才标领跑/滞后(与 BookDivergenceNote 的 level!=='tight' 门控一致;
    // 顺带覆盖各家全等 topRange=0 时 high===low 的退化情形)
    if (!div || div.level === 'tight' || side !== div.topSide) return undefined;
    if (key === div.high.key) return 'lead';
    if (key === div.low.key) return 'lag';
    return undefined;
  };
  return (
    <>
      {div && (
        <div className="mb-2 space-y-1 rounded-lg bg-lightPrimary/60 px-2.5 py-1.5 dark:bg-navy-700/40">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-gray-500 dark:text-gray-400">
              {t('predict.divg.consensus')}
            </span>
            <span className="tabular-nums text-navy-700 dark:text-white">
              {t('odds.home')} {pctOf(div.consensus.home)} · {t('odds.draw')}{' '}
              {pctOf(div.consensus.draw)} · {t('odds.away')}{' '}
              {pctOf(div.consensus.away)}
            </span>
          </div>
          <BookDivergenceNote d={div} />
        </div>
      )}
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
            const ip = ipByKey.get(b.key);
            return (
              <tr
                key={b.key}
                className="border-t border-gray-100 dark:border-white/5"
              >
                <td className="py-1 text-gray-600 dark:text-gray-300">
                  {b.title}
                </td>
                <DvCell
                  price={b.home}
                  ip={ip?.home}
                  ch={cs?.home}
                  mark={markOf(b.key, 'home')}
                />
                <DvCell
                  price={b.draw}
                  ip={ip?.draw}
                  ch={cs?.draw}
                  mark={markOf(b.key, 'draw')}
                />
                <DvCell
                  price={b.away}
                  ip={ip?.away}
                  ch={cs?.away}
                  mark={markOf(b.key, 'away')}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
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
