'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MdCalendarMonth,
  MdShowChart,
  MdInsights,
  MdLeaderboard,
  MdAccountBalanceWallet,
  MdGpsFixed,
} from 'react-icons/md';
import type { IconType } from 'react-icons';
import { useT } from 'lib/i18n/context';
import { useLiveOdds, useSignals } from 'lib/hooks/useWorldCup';

interface Tab {
  href: string;
  label: string;
  Icon: IconType;
  live?: boolean;
  badge?: boolean;
}

/** 新指令红点:有比「上次查看」更新的指令时显示,进入指令台后清除(localStorage + 同标签事件)。 */
function SignalDot() {
  const { signals } = useSignals();
  const maxTs = signals.reduce((m, s) => Math.max(m, s.ts), 0);
  const [seenAt, setSeenAt] = useState(0);
  useEffect(() => {
    const read = () =>
      setSeenAt(Number(localStorage.getItem('wc:signalsSeenAt') || 0));
    read();
    window.addEventListener('wc-signals-seen', read);
    return () => window.removeEventListener('wc-signals-seen', read);
  }, []);
  if (!(maxTs > 0 && maxTs > seenAt)) return null;
  return (
    <span className="pointer-events-none absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-navy-800" />
  );
}

/** 实时更新小圆点:常驻低调绿点,每次实时赔率更新扩散一圈光晕。 */
function LiveDot() {
  const { oddsUpdatedAt } = useLiveOdds();
  const [pulse, setPulse] = useState(0);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    // 首次拿到时间戳不闪(避免进页面就闪),之后每次变化闪一下
    if (oddsUpdatedAt != null) {
      if (prev.current != null && oddsUpdatedAt !== prev.current) {
        setPulse((p) => p + 1);
      }
      prev.current = oddsUpdatedAt;
    }
  }, [oddsUpdatedAt]);
  return (
    <span className="pointer-events-none absolute -right-1.5 -top-0.5 h-1.5 w-1.5">
      <span
        key={pulse}
        className="live-flash absolute inset-0 rounded-full bg-green-500/60"
      />
      <span className="absolute inset-0 rounded-full bg-green-500" />
    </span>
  );
}

/** 底部 Tab Bar(Horizon token,拇指热区 + iPhone 安全区)。 */
export default function BottomTabBar() {
  const pathname = usePathname();
  const t = useT();
  const tabs: Tab[] = [
    { href: '/schedule', label: t('nav.schedule'), Icon: MdCalendarMonth },
    { href: '/odds', label: t('nav.odds'), Icon: MdShowChart, live: true },
    { href: '/predict', label: t('nav.predict'), Icon: MdInsights },
    { href: '/standings', label: t('nav.standings'), Icon: MdLeaderboard },
    { href: '/paper', label: t('nav.paper'), Icon: MdAccountBalanceWallet },
    {
      href: '/signals',
      label: t('nav.signals'),
      Icon: MdGpsFixed,
      badge: true,
    },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/10 dark:bg-navy-800/95">
      <ul className="mx-auto flex max-w-screen-sm">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] transition-colors ${
                  active
                    ? 'text-brand-500 dark:text-brand-400'
                    : 'text-gray-400'
                }`}
              >
                <span className="relative">
                  <tab.Icon
                    className={`text-2xl transition-transform ${
                      active ? 'scale-110' : ''
                    }`}
                  />
                  {tab.live && <LiveDot />}
                  {tab.badge && <SignalDot />}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
