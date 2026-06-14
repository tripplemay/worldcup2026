'use client';

import type { GroupStanding } from 'lib/espn/types';

/** 单个小组积分表;前 2 名(出线区)标绿点。 */
export default function StandingsTable({ g }: { g: GroupStanding }) {
  return (
    <div className="rounded-[20px] bg-[#111c44] p-3 shadow-lg shadow-black/20">
      <div className="mb-1 px-1 text-sm font-bold text-[#868CFF]">{g.group}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-white/40">
            <th className="py-1 text-left font-normal">球队</th>
            <th className="w-7 font-normal">赛</th>
            <th className="w-7 font-normal">胜</th>
            <th className="w-7 font-normal">平</th>
            <th className="w-7 font-normal">负</th>
            <th className="w-9 font-normal">净</th>
            <th className="w-7 font-normal">分</th>
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r, i) => (
            <tr key={r.team} className={`border-t border-white/5 ${i < 2 ? '' : 'text-white/60'}`}>
              <td className="py-1.5">
                <span
                  className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${i < 2 ? 'bg-emerald-400' : 'bg-transparent'}`}
                />
                {r.team}
              </td>
              <td className="text-center tabular-nums">{r.played}</td>
              <td className="text-center tabular-nums">{r.win}</td>
              <td className="text-center tabular-nums">{r.draw}</td>
              <td className="text-center tabular-nums">{r.loss}</td>
              <td className="text-center tabular-nums">
                {r.goalDiff > 0 ? '+' : ''}
                {r.goalDiff}
              </td>
              <td className="text-center font-bold tabular-nums text-white">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
