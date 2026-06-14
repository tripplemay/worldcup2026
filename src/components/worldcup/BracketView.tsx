'use client';

import Card from 'components/card';
import type { BracketMatch } from 'lib/espn/types';

const STAGE_ORDER = [
  'round-of-32',
  'round-of-16',
  'quarterfinals',
  'quarterfinal',
  'semifinals',
  'semifinal',
  'final',
  '3rd-place-game',
];
const STAGE_LABEL: Record<string, string> = {
  'round-of-32': '1/16 决赛(32 强)',
  'round-of-16': '1/8 决赛(16 强)',
  quarterfinals: '1/4 决赛',
  quarterfinal: '1/4 决赛',
  semifinals: '半决赛',
  semifinal: '半决赛',
  final: '决赛',
  '3rd-place-game': '季军赛',
};

/** 淘汰赛对阵树(Horizon Card):按赛段分组。 */
export default function BracketView({ matches }: { matches: BracketMatch[] }) {
  const groups = new Map<string, BracketMatch[]>();
  for (const m of matches) {
    const arr = groups.get(m.stage) ?? [];
    arr.push(m);
    groups.set(m.stage, arr);
  }
  const stages = Array.from(groups.keys()).sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a);
    const ib = STAGE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return (
    <div className="space-y-5">
      {stages.map((stage) => (
        <section key={stage}>
          <h2 className="mb-2 text-sm font-bold text-brand-500 dark:text-brand-400">
            {STAGE_LABEL[stage] ?? stage}
          </h2>
          <div className="space-y-2">
            {groups.get(stage)!.map((m) => (
              <Card key={m.id} extra="p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex-1 text-navy-700 dark:text-white">{m.homeTeam ?? '待定'}</span>
                  {m.status !== 'pre' ? (
                    <span className="px-3 font-bold tabular-nums text-navy-700 dark:text-white">
                      {m.homeScore} : {m.awayScore}
                    </span>
                  ) : (
                    <span className="px-3 text-xs text-gray-400">vs</span>
                  )}
                  <span className="flex-1 text-right text-navy-700 dark:text-white">
                    {m.awayTeam ?? '待定'}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
