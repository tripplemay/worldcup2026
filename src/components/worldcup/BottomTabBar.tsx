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
  MdBolt,
  MdSettings,
} from 'react-icons/md';
import type { IconType } from 'react-icons';
import { useT } from 'lib/i18n/context';
import { useLiveOdds } from 'lib/hooks/useWorldCup';

interface Tab {
  href: string;
  label: string;
  Icon: IconType;
  live?: boolean;
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
    { href: '/radar', label: t('nav.radar'), Icon: MdBolt },
    { href: '/settings', label: t('nav.settings'), Icon: MdSettings },
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
