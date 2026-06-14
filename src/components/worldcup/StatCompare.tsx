'use client';

import Card from 'components/card';
import type { TeamMatchStats } from 'lib/espn/types';

const ROWS: Array<[keyof TeamMatchStats, string, string?]> = [
  ['possessionPct', '控球率', '%'],
  ['totalShots', '射门'],
  ['shotsOnTarget', '射正'],
  ['wonCorners', '角球'],
  ['foulsCommitted', '犯规'],
  ['yellowCards', '黄牌'],
  ['redCards', '红牌'],
  ['saves', '扑救'],
];

/** 比赛统计对比条(主队 brand / 客队 灰)。 */
export default function StatCompare({ home, away }: { home?: TeamMatchStats; away?: TeamMatchStats }) {
  if (!home && !away) return null;
  return (
    <Card extra="mb-3 p-4">
      <div className="mb-3 text-sm font-bold text-navy-700 dark:text-white">比赛统计</div>
      <div className="space-y-2.5">
        {ROWS.map(([k, label, suffix]) => {
          const h = Number(home?.[k] ?? 0);
          const a = Number(away?.[k] ?? 0);
          const tot = h + a || 1;
          return (
            <div key={k}>
              <div className="flex items-center justify-between text-xs">
                <span className="w-12 font-medium text-navy-700 dark:text-white">
                  {home?.[k] ?? '0'}
                  {suffix ?? ''}
                </span>
                <span className="text-gray-500 dark:text-gray-400">{label}</span>
                <span className="w-12 text-right font-medium text-navy-700 dark:text-white">
                  {away?.[k] ?? '0'}
                  {suffix ?? ''}
                </span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full">
                <div className="bg-brand-500" style={{ width: `${(100 * h) / tot}%` }} />
                <div className="bg-gray-300 dark:bg-navy-700" style={{ width: `${(100 * a) / tot}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
