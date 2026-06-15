import type { ReactNode } from 'react';
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
          <main className="mx-auto max-w-screen-sm px-4 pb-24 pt-[env(safe-area-inset-top)]">
            {children}
          </main>
          <BottomTabBar />
        </div>
      </SWRConfig>
    </LocaleProvider>
  );
}
