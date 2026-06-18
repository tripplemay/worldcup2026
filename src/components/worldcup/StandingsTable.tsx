'use client';

import Link from 'next/link';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useT } from 'lib/i18n/context';
import { useTeamIdMap } from 'lib/hooks/useWorldCup';
import { normalizeTeam } from 'lib/match/normalize';
import type { GroupStanding, GroupStandingRow } from 'lib/espn/types';

const col = createColumnHelper<GroupStandingRow>();

/** 单个小组积分表(Horizon Card + @tanstack/react-table + 队徽)。出线(前2 或最佳第三名)标绿点。 */
export default function StandingsTable({
  g,
  advancing,
}: {
  g: GroupStanding;
  advancing: Set<string>;
}) {
  const t = useT();
  const idMap = useTeamIdMap();
  const columns = [
    col.accessor('team', {
      header: t('standings.team'),
      cell: (c) => {
        const teamId = idMap[normalizeTeam(c.getValue())];
        const badge = (
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                advancing.has(c.getValue()) ? 'bg-green-400' : 'bg-transparent'
              }`}
            />
            <TeamBadge name={c.getValue()} logo={c.row.original.logo} />
          </span>
        );
        return teamId ? (
          <Link href={`/team/${teamId}`} className="hover:opacity-80">
            {badge}
          </Link>
        ) : (
          badge
        );
      },
    }),
    col.accessor('played', { header: t('standings.gp') }),
    col.accessor('win', { header: t('standings.w') }),
    col.accessor('draw', { header: t('standings.d') }),
    col.accessor('loss', { header: t('standings.l') }),
    col.accessor('goalDiff', {
      header: t('standings.gd'),
      cell: (c) => `${c.getValue() > 0 ? '+' : ''}${c.getValue()}`,
    }),
    col.accessor('points', {
      header: t('standings.pts'),
      cell: (c) => (
        <span className="font-bold text-navy-700 dark:text-white">
          {c.getValue()}
        </span>
      ),
    }),
  ];
  const table = useReactTable({
    data: g.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Card extra="p-3">
      <div className="mb-1 px-1 text-sm font-bold text-brand-500 dark:text-brand-400">
        {g.group}
      </div>
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="text-[11px] text-gray-400">
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className={`font-normal ${
                    h.column.id === 'team' ? 'py-1 text-left' : 'w-8'
                  }`}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={`border-t border-gray-100 dark:border-white/5 ${
                advancing.has(row.original.team)
                  ? 'text-navy-700 dark:text-white'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={
                    cell.column.id === 'team'
                      ? 'py-1.5'
                      : 'text-center tabular-nums'
                  }
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
