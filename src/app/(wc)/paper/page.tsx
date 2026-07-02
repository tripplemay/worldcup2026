'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MdAccountBalanceWallet,
  MdCheckCircle,
  MdCancel,
  MdSchedule,
  MdRemoveCircleOutline,
} from 'react-icons/md';
import Card from 'components/card';
import PageHeading from 'components/worldcup/PageHeading';
import PaperDryRunGenerator from 'components/worldcup/PaperDryRunGenerator';
import { useTrade } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { DryRunResponse } from 'lib/trade/dryRun';
import type { Trade, MarketType } from 'lib/trade/types';

const money = (x: number) => Math.round(x).toLocaleString();
const signMoney = (x: number) => `${x >= 0 ? '+' : '−'}${money(Math.abs(x))}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const posCls = (x: number) =>
  x > 0
    ? 'text-green-600 dark:text-green-400'
    : x < 0
    ? 'text-red-500 dark:text-red-400'
    : 'text-gray-400';

function selectionLabel(t: (k: string) => string, tr: Trade): string {
  if (tr.market === '1X2')
    return tr.selection === 'home'
      ? t('trade.selHome')
      : tr.selection === 'draw'
      ? t('trade.selDraw')
      : t('trade.selAway');
  if (tr.market === 'OU')
    return `${tr.selection === 'Over' ? t('trade.over') : t('trade.under')} ${
      tr.line
    }`;
  if (tr.market === 'BTTS')
    return `${t('trade.btts')} ${
      tr.selection === 'Yes' ? t('trade.yes') : t('trade.no')
    }`;
  if (tr.market === 'DC')
    return `${t('trade.dc')} ${
      tr.selection === '1X'
        ? t('trade.dc1x')
        : tr.selection === '12'
        ? t('trade.dc12')
        : t('trade.dcx2')
    }`;
  if (tr.market === 'DNB')
    return `${t('trade.dnb')} ${
      tr.selection === 'home' ? t('odds.home') : t('odds.away')
    }`;
  const side = tr.selection === 'home' ? t('trade.ahHome') : t('trade.ahAway');
  const p = tr.line ?? 0;
  return `${side} ${p > 0 ? '+' : ''}${p}`;
}

/** 累计盈亏曲线(SVG sparkline);基线=初始本金。 */
function EquityCurve({
  points,
  initial,
}: {
  points: number[];
  initial: number;
}) {
  if (points.length < 2) return null;
  const W = 300;
  const H = 52;
  const pad = 3;
  const lo = Math.min(...points, initial);
  const hi = Math.max(...points, initial);
  const range = hi - lo || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / range) * (H - 2 * pad);
  const path = points
    .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
  const up = points[points.length - 1] >= initial;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-2 h-14 w-full"
      preserveAspectRatio="none"
    >
      <line
        x1={0}
        y1={y(initial)}
        x2={W}
        y2={y(initial)}
        className="stroke-gray-200 dark:stroke-navy-700"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <path
        d={path}
        fill="none"
        className={up ? 'stroke-green-500' : 'stroke-red-400'}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const STATUS: Record<
  Trade['status'],
  {
    accent: string;
    tint: string;
    Icon: typeof MdCheckCircle;
    cls: string;
    badge: string;
  }
> = {
  won: {
    accent: 'border-l-green-500',
    tint: 'bg-green-50/60 dark:bg-green-500/10',
    Icon: MdCheckCircle,
    cls: 'text-green-600 dark:text-green-400',
    badge:
      'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  },
  lost: {
    accent: 'border-l-red-500',
    tint: 'bg-red-50/60 dark:bg-red-500/10',
    Icon: MdCancel,
    cls: 'text-red-500 dark:text-red-400',
    badge: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300',
  },
  pending: {
    accent: 'border-l-brand-400',
    tint: '',
    Icon: MdSchedule,
    cls: 'text-brand-500 dark:text-brand-400',
    badge:
      'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
  },
  void: {
    accent: 'border-l-gray-300 dark:border-l-navy-600',
    tint: '',
    Icon: MdRemoveCircleOutline,
    cls: 'text-gray-400',
    badge: 'bg-gray-200 text-gray-500 dark:bg-navy-700 dark:text-gray-400',
  },
};

function TradeCard({ tr, dryRun = false }: { tr: Trade; dryRun?: boolean }) {
  const { t, tn } = useLocale();
  const s = STATUS[tr.status];
  const label =
    tr.status === 'pending'
      ? t('trade.pending')
      : tr.status === 'won'
      ? t('trade.won')
      : tr.status === 'lost'
      ? t('trade.lost')
      : t('trade.void');
  return (
    <Link href={`/match/${tr.matchId}`} className="block">
      <Card extra={`border-l-4 ${s.accent} ${s.tint} p-3.5`}>
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="min-w-0 truncate">
            {tn(tr.homeTeam)} <span className="text-gray-400">vs</span>{' '}
            {tn(tr.awayTeam)}
          </span>
          <span
            className={`flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.badge}`}
          >
            <s.Icon className="text-xs" />
            {dryRun ? t('trade.dryRunBadge') : label}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-navy-700 dark:text-white">
              {selectionLabel(t, tr)}{' '}
              <span className="font-mono text-sm font-normal text-gray-500 dark:text-gray-400">
                @{tr.odds.toFixed(2)}
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-gray-400">
              {t('trade.model')} {pct(tr.modelProb)} · EV{' '}
              {(tr.ev * 100).toFixed(1)}% · {t('trade.stake')} {money(tr.stake)}
              {dryRun && (
                <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-sans text-[9px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  {t('trade.dryRunNotPersisted')}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            {tr.status === 'pending' ? (
              <span className="font-mono text-xs text-gray-400">
                {t('trade.toWin')} +{money(tr.stake * (tr.odds - 1))}
              </span>
            ) : (
              <span className={`font-mono text-lg font-extrabold ${s.cls}`}>
                {signMoney(tr.pnl ?? 0)}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function Stat({
  label,
  value,
  cls,
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <div>
      <div
        className={`font-mono text-sm font-bold ${
          cls ?? 'text-navy-700 dark:text-white'
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  );
}

type Filter = 'all' | 'pending' | 'won' | 'lost';
const DRY_RUN_KEY = 'wc:dryRunSlips:v1';
const TRADE_STATUSES: Trade['status'][] = ['pending', 'won', 'lost', 'void'];
const TRADE_MARKETS: MarketType[] = ['1X2', 'OU', 'AH', 'BTTS', 'DC', 'DNB'];
const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object';
const isNum = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
function isStoredDryRun(x: unknown): x is DryRunResponse {
  if (!isObj(x) || !Array.isArray(x.slips) || !Array.isArray(x.skipped))
    return false;
  if (!isObj(x.summary) || !isObj(x.balance) || !isNum(x.generatedAt))
    return false;
  return (
    x.slips.every((s) => {
      if (!isObj(s)) return false;
      return (
        s.dryRun === true &&
        isStr(s.tradeId) &&
        isStr(s.matchId) &&
        isStr(s.homeTeam) &&
        isStr(s.awayTeam) &&
        isStr(s.date) &&
        TRADE_STATUSES.includes(s.status as Trade['status']) &&
        TRADE_MARKETS.includes(s.market as MarketType) &&
        isStr(s.selection) &&
        isNum(s.odds) &&
        isNum(s.modelProb) &&
        isNum(s.ev) &&
        isNum(s.stake) &&
        isNum(s.placedAt)
      );
    }) &&
    x.skipped.every(
      (s) => isObj(s) && isStr(s.matchId) && isStr(s.reason) && isStr(s.label),
    )
  );
}

export default function PaperPage() {
  const { t } = useLocale();
  const { wallet, stats, trades, isLoading } = useTrade();
  const [filter, setFilter] = useState<Filter>('all');
  const [tab, setTab] = useState<'book' | 'dryrun'>('book');
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRY_RUN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (isStoredDryRun(parsed)) {
        setDryRunResult(parsed);
      } else {
        try {
          localStorage.removeItem(DRY_RUN_KEY);
        } catch {
          /* ignore */
        }
      }
    } catch {
      try {
        localStorage.removeItem(DRY_RUN_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const saveDryRun = (result: DryRunResponse) => {
    setDryRunResult(result);
    try {
      localStorage.setItem(DRY_RUN_KEY, JSON.stringify(result));
    } catch {
      /* localStorage 不可用时仅当前页可见 */
    }
  };

  const clearDryRun = () => {
    setDryRunResult(null);
    try {
      localStorage.removeItem(DRY_RUN_KEY);
    } catch {
      /* ignore */
    }
  };

  const dryRunSlips = dryRunResult?.slips ?? [];

  const decided = trades.filter(
    (x) => x.status === 'won' || x.status === 'lost',
  );
  // 资金曲线:已结算按时间累加
  const settledByTime = trades
    .filter((x) => x.status !== 'pending')
    .sort((a, b) => (a.settledAt ?? a.placedAt) - (b.settledAt ?? b.placedAt));
  const eqPoints = [wallet?.initialBalance ?? 10000];
  settledByTime.forEach((x) =>
    eqPoints.push(eqPoints[eqPoints.length - 1] + (x.pnl ?? 0)),
  );
  // 进阶统计
  const grossWin = decided
    .filter((x) => (x.pnl ?? 0) > 0)
    .reduce((s, x) => s + (x.pnl ?? 0), 0);
  const grossLoss = Math.abs(
    decided
      .filter((x) => (x.pnl ?? 0) < 0)
      .reduce((s, x) => s + (x.pnl ?? 0), 0),
  );
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const avgOdds = trades.length
    ? trades.reduce((s, x) => s + x.odds, 0) / trades.length
    : 0;
  const avgEv = trades.length
    ? trades.reduce((s, x) => s + x.ev, 0) / trades.length
    : 0;
  const recent = [...decided]
    .sort((a, b) => (b.settledAt ?? b.placedAt) - (a.settledAt ?? a.placedAt))
    .slice(0, 10);
  // 分盘口
  const markets = (['1X2', 'OU', 'AH', 'BTTS', 'DC', 'DNB'] as MarketType[])
    .map((m) => {
      const ms = trades.filter((x) => x.market === m);
      return {
        m,
        bets: ms.length,
        wins: ms.filter((x) => x.status === 'won').length,
        settled: ms.filter((x) => x.status === 'won' || x.status === 'lost')
          .length,
        pnl: ms.reduce((s, x) => s + (x.pnl ?? 0), 0),
      };
    })
    .filter((x) => x.bets > 0);
  const mktLabel: Record<MarketType, string> = {
    '1X2': t('trade.mkt1x2'),
    OU: t('trade.mktOU'),
    AH: t('trade.mktAH'),
    BTTS: t('trade.btts'),
    DC: t('trade.dc'),
    DNB: t('trade.dnb'),
  };

  const shown = trades.filter((x) =>
    filter === 'all' ? true : x.status === filter,
  );
  const profit =
    (stats?.equity ?? wallet?.currentBalance ?? 0) -
    (wallet?.initialBalance ?? 0);

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between gap-2 pr-24">
          <PageHeading Icon={MdAccountBalanceWallet}>
            {t('trade.title')}
          </PageHeading>
          <span className="shrink-0 rounded-full bg-gray-200/70 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-navy-700 dark:text-gray-300">
            {t('trade.tag')}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('trade.subtitle')}
        </p>
      </header>

      {/* 诚实框:读盘校准工具,非盈利策略;看 CLV 而非盈亏 */}
      <Card extra="mb-3 bg-amber-50/60 p-3 dark:bg-amber-500/10">
        <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          ⓘ {t('trade.honesty')}
        </p>
      </Card>

      {/* Tab 切换:模拟盘(原内容)/ 赛前预生成 */}
      <div className="mb-3 flex gap-1.5">
        {(['book', 'dryrun'] as const).map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              tab === x
                ? 'bg-brand-500 text-white'
                : 'bg-white text-gray-500 dark:bg-navy-800 dark:text-gray-400'
            }`}
          >
            {x === 'book' ? t('nav.paper') : t('trade.dryRunTitle')}
          </button>
        ))}
      </div>

      {tab === 'book' && (
        <>
          {wallet && (
            <Card extra="mb-3 p-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[11px] text-gray-400">
                    {t('trade.balance')}
                  </div>
                  <div className="font-mono text-3xl font-extrabold text-navy-700 dark:text-white">
                    {money(stats?.equity ?? wallet.currentBalance)}
                  </div>
                </div>
                <div className={`text-right font-mono ${posCls(profit)}`}>
                  <div className="text-base font-bold">{signMoney(profit)}</div>
                  <div className="text-[11px]">
                    {(stats?.roi ?? 0) >= 0 ? '+' : ''}
                    {pct(stats?.roi ?? 0)}
                  </div>
                </div>
              </div>

              <EquityCurve points={eqPoints} initial={wallet.initialBalance} />

              <div className="mt-2 grid grid-cols-4 gap-2 border-t border-gray-100 pt-2 text-center dark:border-white/5">
                <Stat
                  label={t('trade.available')}
                  value={money(wallet.currentBalance)}
                />
                <Stat
                  label={t('trade.locked')}
                  value={money(wallet.lockedBalance)}
                />
                <Stat
                  label={t('trade.winRate')}
                  value={`${(
                    (wallet.wins + wallet.losses
                      ? wallet.wins / (wallet.wins + wallet.losses)
                      : 0) * 100
                  ).toFixed(0)}%`}
                />
                <Stat label="W-L" value={`${wallet.wins}-${wallet.losses}`} />
              </div>

              {/* CLV 读盘准度(真·记分牌:下注后线是否朝我们走)— 头条提升 */}
              {stats?.clv && stats.clv.n > 0 && (
                <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-white/5">
                  <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                    {t('trade.clvScore')}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span
                      className={`font-mono text-lg font-extrabold ${posCls(
                        stats.clv.avgClv,
                      )}`}
                    >
                      {stats.clv.avgClv >= 0 ? '+' : ''}
                      {(stats.clv.avgClv * 100).toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {t('trade.posClv')} {pct(stats.clv.posRate)} (
                      {stats.clv.n})
                    </span>
                  </span>
                </div>
              )}
            </Card>
          )}

          {decided.length > 0 && (
            <Card extra="mb-3 p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat
                  label={t('trade.profitFactor')}
                  value={pf === Infinity ? '∞' : pf.toFixed(2)}
                  cls={posCls(pf - 1)}
                />
                <Stat label={t('trade.avgOdds')} value={avgOdds.toFixed(2)} />
                <Stat
                  label={t('trade.avgEv')}
                  value={`${(avgEv * 100).toFixed(0)}%`}
                />
              </div>
              {stats?.clv && stats.clv.n > 0 && (
                <div className="mt-2 flex items-center justify-center gap-3 border-t border-gray-100 pt-2 text-xs dark:border-white/5">
                  <span className="text-gray-400">{t('trade.clv')}</span>
                  <span
                    className={`font-mono font-bold ${posCls(
                      stats.clv.avgClv,
                    )}`}
                  >
                    {stats.clv.avgClv >= 0 ? '+' : ''}
                    {(stats.clv.avgClv * 100).toFixed(1)}%
                  </span>
                  <span className="text-gray-400">
                    {t('trade.posClv')} {pct(stats.clv.posRate)} ({stats.clv.n})
                  </span>
                </div>
              )}
              {stats?.tiers &&
                (stats.tiers.value.n > 0 || stats.tiers.coverage.n > 0) && (
                  <div className="mt-2 flex items-center justify-center gap-4 border-t border-gray-100 pt-2 text-xs dark:border-white/5">
                    {(['value', 'coverage'] as const).map((k) => {
                      const ti = stats.tiers![k];
                      return (
                        <span key={k} className="flex items-center gap-1">
                          <span className="text-gray-400">
                            {t(
                              k === 'value'
                                ? 'trade.tierValue'
                                : 'trade.tierCoverage',
                            )}
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {ti.wins}-{ti.losses}
                          </span>
                          <span
                            className={`font-mono font-bold ${posCls(ti.pnl)}`}
                          >
                            {signMoney(ti.pnl)}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}
              {recent.length > 0 && (
                <div className="mt-2 flex items-center gap-1 border-t border-gray-100 pt-2 dark:border-white/5">
                  <span className="mr-1 text-[10px] text-gray-400">
                    {t('trade.streak')}
                  </span>
                  {recent.map((x) => (
                    <span
                      key={x.tradeId}
                      className={`h-2.5 w-2.5 rounded-full ${
                        x.status === 'won' ? 'bg-green-500' : 'bg-red-400'
                      }`}
                    />
                  ))}
                </div>
              )}
              {markets.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 dark:border-white/5">
                  <div className="text-[11px] font-semibold text-navy-700 dark:text-white">
                    {t('trade.byMarket')}
                  </div>
                  {markets.map((mk) => (
                    <div key={mk.m} className="flex items-center gap-2 text-xs">
                      <span className="w-12 shrink-0 text-gray-500 dark:text-gray-400">
                        {mktLabel[mk.m]}
                      </span>
                      <span className="flex-1 text-gray-400">
                        {mk.bets} {t('trade.stake')} ·{' '}
                        {mk.settled
                          ? `${((mk.wins / mk.settled) * 100).toFixed(0)}%`
                          : '—'}
                      </span>
                      <span
                        className={`shrink-0 font-mono font-bold ${posCls(
                          mk.pnl,
                        )}`}
                      >
                        {signMoney(mk.pnl)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {isLoading && trades.length === 0 && (
            <div className="h-24 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
          )}

          {!isLoading && trades.length === 0 && (
            <div className="py-16 text-center text-gray-400">
              {t('trade.empty')}
            </div>
          )}

          {trades.length > 0 && (
            <div className="mb-3 flex gap-1.5">
              {(['all', 'pending', 'won', 'lost'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    filter === f
                      ? 'bg-brand-500 text-white'
                      : 'bg-white text-gray-500 dark:bg-navy-800 dark:text-gray-400'
                  }`}
                >
                  {f === 'all' ? t('trade.all') : t(`trade.${f}`)}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {shown.map((tr) => (
              <TradeCard key={tr.tradeId} tr={tr} />
            ))}
          </div>
        </>
      )}

      {tab === 'dryrun' && (
        <>
          <PaperDryRunGenerator onGenerated={saveDryRun} />

          {dryRunResult && (
            <Card extra="mt-3 p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-navy-700 dark:text-white">
                    {t('trade.dryRunDrafts')}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                    {t('trade.dryRunLocalOnly')} · {dryRunSlips.length}{' '}
                    {t('trade.stake')}
                  </div>
                </div>
                <button
                  onClick={clearDryRun}
                  className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500 active:scale-95 dark:bg-navy-700 dark:text-gray-300"
                >
                  {t('trade.dryRunClear')}
                </button>
              </div>
              {dryRunResult?.skipped.length ? (
                <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  {t('trade.dryRunSkipped')} {dryRunResult.skipped.length}:{' '}
                  {dryRunResult.skipped
                    .slice(0, 3)
                    .map((x) => x.label)
                    .join(' / ')}
                </div>
              ) : null}
              <div className="space-y-3">
                {dryRunSlips.length > 0 ? (
                  dryRunSlips.map((tr) => (
                    <TradeCard key={tr.tradeId} tr={tr} dryRun />
                  ))
                ) : (
                  <div className="rounded-xl bg-lightPrimary px-3 py-4 text-center text-xs text-gray-400 dark:bg-navy-900">
                    {t('trade.dryRunEmptyResult')}
                  </div>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
