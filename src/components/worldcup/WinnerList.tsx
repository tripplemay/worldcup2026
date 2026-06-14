'use client';

import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useTeamLogos } from 'lib/hooks/useWorldCup';
import { normalizeTeam } from 'lib/match/normalize';
import type { WinnerMarket } from 'lib/odds/types';

/** 夺冠赔率榜(Horizon Card 行):排名 + 队徽 + 隐含概率条 + 赔率。 */
export default function WinnerList({ winner }: { winner?: WinnerMarket }) {
  const logos = useTeamLogos();
  const list = winner?.outrights ?? [];
  if (!list.length) return <div className="py-16 text-center text-gray-400">暂无夺冠赔率</div>;
  const max = list[0]?.impliedProbability || 1;
  return (
    <div className="space-y-2">
      {list.map((o, i) => (
        <Card key={o.team} extra="!flex-row items-center gap-3 p-3">
          <span className="w-6 text-center text-sm font-bold text-gray-500 dark:text-gray-400">
            {i === 0 ? '👑' : i + 1}
          </span>
          <TeamBadge
            name={o.team}
            logo={logos[normalizeTeam(o.team)]}
            className="flex-1 font-medium text-navy-700 dark:text-white"
          />
          <div className="w-20">
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-navy-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
                style={{ width: `${Math.max(4, Math.round((100 * o.impliedProbability) / max))}%` }}
              />
            </div>
          </div>
          <span className="w-12 text-right text-sm font-bold tabular-nums text-brand-500 dark:text-white">
            {o.price.toFixed(2)}
          </span>
        </Card>
      ))}
    </div>
  );
}
