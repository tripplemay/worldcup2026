'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from 'lib/i18n/context';

/** 底部 Tab Bar(Horizon token,拇指热区 + iPhone 安全区)。 */
export default function BottomTabBar() {
  const pathname = usePathname();
  const t = useT();
  const tabs = [
    { href: '/schedule', label: t('nav.schedule'), icon: '📅' },
    { href: '/odds', label: t('nav.odds'), icon: '🎲' },
    { href: '/predict', label: t('nav.predict'), icon: '🔮' },
    { href: '/standings', label: t('nav.standings'), icon: '📊' },
    { href: '/settings', label: t('nav.settings'), icon: '⚙️' },
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
                <span
                  className={`text-xl transition-transform ${
                    active ? 'scale-110' : ''
                  }`}
                >
                  {tab.icon}
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
