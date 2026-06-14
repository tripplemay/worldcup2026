import type { ReactNode } from 'react';
import BottomTabBar from 'components/worldcup/BottomTabBar';

/** 世界杯移动 App 布局:Horizon 浅/深背景 + 居中移动容器 + 底部 Tab(安全区)。 */
export default function WorldCupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-lightPrimary text-navy-700 dark:bg-navy-900 dark:text-white">
      <main className="mx-auto max-w-screen-sm px-4 pb-24 pt-[env(safe-area-inset-top)]">
        {children}
      </main>
      <BottomTabBar />
    </div>
  );
}
