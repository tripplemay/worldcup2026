'use client';

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

/** 淘汰赛对阵树:按赛段分组展示。 */
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
          <h2 className="mb-2 text-sm font-bold text-[#868CFF]">{STAGE_LABEL[stage] ?? stage}</h2>
          <div className="space-y-2">
            {groups.get(stage)!.map((m) => (
              <div key={m.id} className="rounded-2xl bg-[#111c44] p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex-1">{m.homeTeam ?? '待定'}</span>
                  {m.status !== 'pre' ? (
                    <span className="px-3 font-bold tabular-nums">
                      {m.homeScore} : {m.awayScore}
                    </span>
                  ) : (
                    <span className="px-3 text-xs text-white/30">vs</span>
                  )}
                  <span className="flex-1 text-right">{m.awayTeam ?? '待定'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
