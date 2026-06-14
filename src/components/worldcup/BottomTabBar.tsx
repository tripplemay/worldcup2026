'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/schedule', label: '赛程', icon: '📅' },
  { href: '/odds', label: '赔率', icon: '🎲' },
  { href: '/standings', label: '积分', icon: '📊' },
  { href: '/settings', label: '设置', icon: '⚙️' },
];

/** 底部 Tab Bar(Horizon token,拇指热区 + iPhone 安全区)。 */
export default function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/10 dark:bg-navy-800/95">
      <ul className="mx-auto flex max-w-screen-sm">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] transition-colors ${
                  active ? 'text-brand-500 dark:text-brand-400' : 'text-gray-400'
                }`}
              >
                <span className={`text-xl transition-transform ${active ? 'scale-110' : ''}`}>
                  {t.icon}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
