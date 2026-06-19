import type { ReactNode } from 'react';
import Link from 'next/link';
import { MdSettings } from 'react-icons/md';
import { SWRConfig } from 'swr';
import { LocaleProvider } from 'lib/i18n/context';
import BottomTabBar from 'components/worldcup/BottomTabBar';

/** 世界杯移动 App 布局:i18n Provider + SWR 全局默认 + Horizon 背景 + 移动容器 + 底部 Tab。
 * 注:仅设安全的全局默认(去重 + 限制重试);各 hook 的 refreshInterval 与
 * odds 类的 revalidateOnFocus:false(配额相关)由 hook 自身覆盖,这里不动。 */
export default function WorldCupLayout({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <SWRConfig
        value={{
          dedupingInterval: 4000,
          errorRetryCount: 2,
          errorRetryInterval: 5000,
        }}
      >
        <div className="min-h-screen bg-lightPrimary text-navy-700 dark:bg-navy-900 dark:text-white">
          <Link
            href="/settings"
            aria-label="Settings"
            className="fixed right-3 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-gray-500 shadow-sm backdrop-blur active:opacity-70 dark:bg-navy-800/70 dark:text-gray-300"
            style={{ top: 'calc(env(safe-area-inset-top) + 10px)' }}
          >
            <MdSettings className="text-xl" />
          </Link>
          <main className="mx-auto max-w-screen-sm px-4 pb-24 pt-[env(safe-area-inset-top)]">
            {children}
          </main>
          <BottomTabBar />
        </div>
      </SWRConfig>
    </LocaleProvider>
  );
}
