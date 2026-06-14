'use client';

import type { WinnerMarket } from 'lib/odds/types';

/** 夺冠赔率榜:国旗位省略,队名 + 隐含概率条 + 赔率,按热门排序。 */
export default function WinnerList({ winner }: { winner?: WinnerMarket }) {
  const list = winner?.outrights ?? [];
  if (!list.length) return <div className="py-16 text-center text-white/40">暂无夺冠赔率</div>;
  const max = list[0]?.impliedProbability || 1;
  return (
    <div className="space-y-2">
      {list.map((o, i) => (
        <div key={o.team} className="flex items-center gap-3 rounded-2xl bg-[#111c44] p-3">
          <span className="w-6 text-center text-sm font-bold text-white/50">
            {i === 0 ? '👑' : i + 1}
          </span>
          <span className="flex-1 font-medium">{o.team}</span>
          <div className="w-20">
            <div className="h-1.5 rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#868CFF] to-[#4318FF]"
                style={{ width: `${Math.max(4, Math.round((100 * o.impliedProbability) / max))}%` }}
              />
            </div>
          </div>
          <span className="w-12 text-right text-sm font-bold tabular-nums text-[#868CFF]">
            {o.price.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}
