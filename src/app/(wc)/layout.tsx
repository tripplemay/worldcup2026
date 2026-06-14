import type { ReactNode } from 'react';
import BottomTabBar from 'components/worldcup/BottomTabBar';

/** 世界杯移动 App 布局:居中移动容器 + 底部 Tab(安全区适配)。 */
export default function WorldCupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0b1437] text-white">
      <main className="mx-auto max-w-screen-sm px-4 pb-24 pt-[env(safe-area-inset-top)]">
        {children}
      </main>
      <BottomTabBar />
    </div>
  );
}
