'use client';

import { useMatchOdds } from 'lib/hooks/useWorldCup';

export default function SettingsPage() {
  const { quota } = useMatchOdds();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-[#0b1437]/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-bold">⚙️ 设置</h1>
      </header>

      <div className="space-y-3 text-sm">
        <section className="rounded-[20px] bg-[#111c44] p-4">
          <div className="mb-1 font-medium">数据源</div>
          <div className="text-xs leading-relaxed text-white/50">
            赔率:The Odds API
            <br />
            赛程 / 比分 / 积分:ESPN
            <br />
            赔率配额剩余:{quota?.remaining ?? '—'} / 500
          </div>
        </section>

        <section className="rounded-[20px] bg-[#111c44] p-4">
          <div className="mb-1 font-medium">刷新间隔</div>
          <div className="text-xs leading-relaxed text-white/50">
            比分 25s · 赔率 180s · 积分 300s
            <br />
            切到后台自动暂停轮询,回到前台立即刷新
          </div>
        </section>

        <section className="rounded-[20px] bg-[#111c44] p-4 text-center text-xs text-white/40">
          🏆 世界杯 2026 · 实时赔率 · 赛程 · 比分
        </section>
      </div>
    </div>
  );
}
