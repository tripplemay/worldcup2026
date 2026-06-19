'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MdGpsFixed, MdCheck, MdClose } from 'react-icons/md';
import Card from 'components/card';
import PageHeading from 'components/worldcup/PageHeading';
import RadarFeed from 'components/worldcup/RadarFeed';
import { useSignals } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { TradingSignal, SignalLevel } from 'lib/db/store';

const money = (x: number) => Math.round(x).toLocaleString();
const pct = (x: number) => `${Math.round(x * 100)}%`;

const LEVEL: Record<SignalLevel, { key: string; bar: string; badge: string }> =
  {
    L1: {
      key: 'signals.l1',
      bar: 'border-l-green-500',
      badge:
        'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
    },
    L2: {
      key: 'signals.l2',
      bar: 'border-l-amber-400',
      badge:
        'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    },
    L3: {
      key: 'signals.l3',
      bar: 'border-l-red-500',
      badge: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300',
    },
    L4: {
      key: 'signals.l4',
      bar: 'border-l-brand-400',
      badge:
        'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
    },
  };

function selLabel(t: (k: string) => string, s: TradingSignal): string {
  if (s.market === '1X2')
    return s.selection === 'home'
      ? t('odds.home')
      : s.selection === 'draw'
      ? t('odds.draw')
      : t('odds.away');
  if (s.market === 'OU')
    return `${s.selection === 'Over' ? t('trade.over') : t('trade.under')} ${
      s.line
    }`;
  const side = s.selection === 'home' ? t('trade.ahHome') : t('trade.ahAway');
  const p = s.line ?? 0;
  return `${side} ${p > 0 ? '+' : ''}${p}`;
}

function SignalCard({
  s,
  onMark,
}: {
  s: TradingSignal;
  onMark: (id: string, status: 'EXECUTED' | 'DISMISSED') => void;
}) {
  const { t, tn } = useLocale();
  const lv = LEVEL[s.level];
  const [home, away] = s.match.split(' vs ');
  const action =
    s.level === 'L3'
      ? `${t('signals.pass')}`
      : `${t('signals.buy')} ${selLabel(t, s)} @ ${s.odds.toFixed(2)}`;
  const reason =
    s.level === 'L3'
      ? t('signals.reject')
      : `EV ${(s.ev * 100).toFixed(0)}% · ${t('signals.winrate')} ${pct(
          s.pWin,
        )} · ${s.resonance ? t('signals.resonate') : t('signals.calm')}`;
  return (
    <Card extra={`border-l-4 ${lv.bar} p-4`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${lv.badge}`}
        >
          {t(lv.key)}
        </span>
        <Link
          href={`/match/${s.matchId}`}
          className="truncate text-xs text-gray-500 dark:text-gray-400"
        >
          {tn(home)} vs {tn(away)}
        </Link>
      </div>
      <div
        className={`text-lg font-extrabold ${
          s.level === 'L3'
            ? 'text-red-500 line-through dark:text-red-400'
            : 'text-navy-700 dark:text-white'
        }`}
      >
        {action}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
        {reason}
      </div>
      {s.divergence && DIVK[s.divergence] && s.divergence !== 'CONSENSUS' && (
        <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t(`divergence.${DIVK[s.divergence]}.label`)} —{' '}
          {t(`divergence.${DIVK[s.divergence]}.hint`)}
        </div>
      )}
      {s.level !== 'L3' && (
        <div className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">
          {t('signals.stake')} {money(s.suggestedStake)}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onMark(s.id, 'EXECUTED')}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-green-500 py-2 text-sm font-medium text-white active:opacity-80"
        >
          <MdCheck /> {t('signals.follow')}
        </button>
        <button
          onClick={() => onMark(s.id, 'DISMISSED')}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-gray-200 py-2 text-sm font-medium text-gray-600 active:opacity-80 dark:bg-navy-700 dark:text-gray-300"
        >
          <MdClose /> {t('signals.dismiss')}
        </button>
      </div>
    </Card>
  );
}

const DIVK: Record<string, string> = {
  R1_UNDERCONF: 'r1',
  GOALS_FORM: 'goalsForm',
  SPLIT: 'split',
  CONSENSUS: 'consensus',
};

const LEVEL_RANK: Record<SignalLevel, number> = { L3: 0, L1: 1, L2: 2, L4: 3 };

export default function SignalsPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<'signals' | 'radar'>('signals');
  const { signals, isLoading, mutate } = useSignals();
  // 进入指令台即标记「已查看」→ 清底栏红点(localStorage + 同标签事件)
  useEffect(() => {
    if (signals.length) {
      localStorage.setItem('wc:signalsSeenAt', String(Date.now()));
      window.dispatchEvent(new Event('wc-signals-seen'));
    }
  }, [signals]);
  const unread = signals
    .filter((s) => s.status === 'UNREAD')
    .sort((a, b) =>
      LEVEL_RANK[a.level] !== LEVEL_RANK[b.level]
        ? LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
        : b.ts - a.ts,
    );

  const mark = async (id: string, status: 'EXECUTED' | 'DISMISSED') => {
    // 乐观更新:本地移除,后台提交
    void mutate(
      (cur) =>
        cur
          ? {
              ...cur,
              signals: cur.signals.map((s) =>
                s.id === id ? { ...s, status } : s,
              ),
            }
          : cur,
      { revalidate: false },
    );
    try {
      await fetch('/api/worldcup/signals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
    } finally {
      void mutate();
    }
  };

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <PageHeading Icon={MdGpsFixed}>{t('signals.title')}</PageHeading>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('signals.subtitle')}
        </p>
        <div className="mt-2 flex gap-1.5">
          {(['signals', 'radar'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                tab === k
                  ? 'bg-brand-500 text-white'
                  : 'bg-white text-gray-500 dark:bg-navy-800 dark:text-gray-400'
              }`}
            >
              {t(k === 'signals' ? 'signals.tabSignals' : 'signals.tabRadar')}
              {k === 'signals' && unread.length > 0
                ? ` (${unread.length})`
                : ''}
            </button>
          ))}
        </div>
      </header>

      {tab === 'radar' ? (
        <RadarFeed />
      ) : isLoading && unread.length === 0 ? (
        <div className="h-24 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
      ) : unread.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-400">
          {t('signals.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {unread.map((s) => (
            <SignalCard key={s.id} s={s} onMark={mark} />
          ))}
        </div>
      )}
    </div>
  );
}
