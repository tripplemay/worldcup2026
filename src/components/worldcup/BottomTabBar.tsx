'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MdCalendarMonth,
  MdShowChart,
  MdInsights,
  MdLeaderboard,
  MdSettings,
} from 'react-icons/md';
import { useT } from 'lib/i18n/context';

/** 底部 Tab Bar(Horizon token,拇指热区 + iPhone 安全区)。 */
export default function BottomTabBar() {
  const pathname = usePathname();
  const t = useT();
  const tabs = [
    { href: '/schedule', label: t('nav.schedule'), Icon: MdCalendarMonth },
    { href: '/odds', label: t('nav.odds'), Icon: MdShowChart },
    { href: '/predict', label: t('nav.predict'), Icon: MdInsights },
    { href: '/standings', label: t('nav.standings'), Icon: MdLeaderboard },
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
                <tab.Icon
                  className={`text-2xl transition-transform ${
                    active ? 'scale-110' : ''
                  }`}
                />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
