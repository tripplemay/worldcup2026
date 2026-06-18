'use client';

import { MdAccountBalanceWallet } from 'react-icons/md';
import Card from 'components/card';
import PageHeading from 'components/worldcup/PageHeading';
import { useTrade } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { Trade } from 'lib/trade/types';

const money = (x: number) => Math.round(x).toLocaleString();
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** 玩法标签(1X2/大小球/亚盘)。 */
function selectionLabel(t: (k: string) => string, tr: Trade): string {
  if (tr.market === '1X2')
    return tr.selection === 'home'
      ? t('trade.selHome')
      : tr.selection === 'draw'
      ? t('trade.selDraw')
      : t('trade.selAway');
  if (tr.market === 'OU')
    return `${tr.selection === 'Over' ? t('trade.over') : t('trade.under')} ${tr.line}`;
  const side = tr.selection === 'home' ? t('trade.ahHome') : t('trade.ahAway');
  const p = tr.line ?? 0;
  return `${side} ${p > 0 ? '+' : ''}${p}`;
}

function TradeCard({ tr }: { tr: Trade }) {
  const { t, tn } = useLocale();
  const border =
    tr.status === 'won'
      ? 'border-emerald-400/60'
      : tr.status === 'lost'
      ? 'border-red-400/60'
      : tr.status === 'void'
      ? 'border-gray-300 dark:border-navy-600'
      : 'border-brand-400/50';
  const pnlColor =
    (tr.pnl ?? 0) > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : (tr.pnl ?? 0) < 0
      ? 'text-red-500 dark:text-red-400'
      : 'text-gray-400';
  const statusLabel =
    tr.status === 'pending'
      ? t('trade.pending')
      : tr.status === 'won'
      ? t('trade.won')
      : tr.status === 'lost'
      ? t('trade.lost')
      : t('trade.void');

  return (
    <Card extra={`border ${border} p-3.5`}>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="min-w-0 truncate">
          {tn(tr.homeTeam)} <span className="text-gray-400">vs</span>{' '}
          {tn(tr.awayTeam)}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            tr.status === 'pending'
              ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400'
              : tr.status === 'won'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
              : tr.status === 'lost'
              ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
              : 'bg-gray-200 text-gray-500 dark:bg-navy-700'
          }`}
        >
          {statusLabel}
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
          </div>
        </div>
        <div className="shrink-0 text-right">
          {tr.status === 'pending' ? (
            <span className="font-mono text-xs text-gray-400">
              {t('trade.toWin')} +{money(tr.stake * (tr.odds - 1))}
            </span>
          ) : (
            <span className={`font-mono text-base font-bold ${pnlColor}`}>
              {(tr.pnl ?? 0) >= 0 ? '+' : ''}
              {money(tr.pnl ?? 0)}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function PaperPage() {
  const { t } = useLocale();
  const { wallet, stats, trades, isLoading } = useTrade();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between gap-2">
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

      {wallet && (
        <Card extra="mb-3 p-4">
          <div className="text-[11px] text-gray-400">{t('trade.balance')}</div>
          <div className="font-mono text-3xl font-extrabold text-navy-700 dark:text-white">
            {money(stats?.equity ?? wallet.currentBalance)}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-xs dark:border-white/5">
            <span className="text-gray-400">
              {t('trade.initial')}{' '}
              <span className="font-mono text-gray-600 dark:text-gray-300">
                {money(wallet.initialBalance)}
              </span>
            </span>
            <span
              className={`font-mono font-bold ${
                (stats?.roi ?? 0) >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-500 dark:text-red-400'
              }`}
            >
              {t('trade.roi')} {(stats?.roi ?? 0) >= 0 ? '+' : ''}
              {pct(stats?.roi ?? 0)}
            </span>
            <span className="text-gray-400">
              {t('trade.winRate')}{' '}
              <span className="font-mono text-gray-600 dark:text-gray-300">
                {pct(stats?.winRate ?? 0)}
              </span>{' '}
              <span className="text-[10px]">
                ({wallet.wins}-{wallet.losses})
              </span>
            </span>
          </div>
        </Card>
      )}

      {isLoading && trades.length === 0 && (
        <div className="h-24 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
      )}

      {!isLoading && trades.length === 0 && (
        <div className="py-16 text-center text-gray-400">{t('trade.empty')}</div>
      )}

      <div className="space-y-3">
        {trades.map((tr) => (
          <TradeCard key={tr.tradeId} tr={tr} />
        ))}
      </div>
    </div>
  );
}
