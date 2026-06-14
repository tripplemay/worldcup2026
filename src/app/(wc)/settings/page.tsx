'use client';

import Card from 'components/card';
import { useMatchOdds } from 'lib/hooks/useWorldCup';

export default function SettingsPage() {
  const { quota } = useMatchOdds();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <h1 className="text-lg font-bold text-navy-700 dark:text-white">⚙️ 设置</h1>
      </header>

      <div className="space-y-3 text-sm">
        <Card extra="p-4">
          <div className="mb-1 font-medium text-navy-700 dark:text-white">数据源</div>
          <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            赔率:The Odds API
            <br />
            赛程 / 比分 / 积分:ESPN
            <br />
            赔率配额剩余:{quota?.remaining ?? '—'} / 500
          </div>
        </Card>

        <Card extra="p-4">
          <div className="mb-1 font-medium text-navy-700 dark:text-white">刷新间隔</div>
          <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            比分 25s · 赔率 180s · 积分 300s
            <br />
            切到后台自动暂停轮询,回到前台立即刷新
          </div>
        </Card>

        <Card extra="p-4 text-center text-xs text-gray-500 dark:text-gray-400">
          🏆 世界杯 2026 · 实时赔率 · 赛程 · 比分
        </Card>
      </div>
    </div>
  );
}
