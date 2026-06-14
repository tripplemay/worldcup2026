import type { ReactNode } from 'react';
import { LocaleProvider } from 'lib/i18n/context';
import BottomTabBar from 'components/worldcup/BottomTabBar';

/** 世界杯移动 App 布局:i18n Provider + Horizon 背景 + 移动容器 + 底部 Tab。 */
export default function WorldCupLayout({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <div className="min-h-screen bg-lightPrimary text-navy-700 dark:bg-navy-900 dark:text-white">
        <main className="mx-auto max-w-screen-sm px-4 pb-24 pt-[env(safe-area-inset-top)]">
          {children}
        </main>
        <BottomTabBar />
      </div>
    </LocaleProvider>
  );
}
