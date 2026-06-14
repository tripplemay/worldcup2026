'use client';

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import Card from 'components/card';
import type { BookmakerOdds, MatchOdds } from 'lib/odds/types';

const fmt = (v?: number) => (v != null ? v.toFixed(2) : '—');
const col = createColumnHelper<BookmakerOdds>();
const columns = [
  col.accessor('title', { header: '博彩' }),
  col.accessor('home', { header: '主胜', cell: (c) => fmt(c.getValue()) }),
  col.accessor('draw', { header: '平', cell: (c) => fmt(c.getValue()) }),
  col.accessor('away', { header: '客胜', cell: (c) => fmt(c.getValue()) }),
];

/** 各家博彩公司赔率对比表(@tanstack/react-table)。 */
export default function OddsTable({ m }: { m: MatchOdds }) {
  const table = useReactTable({ data: m.bookmakers, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <Card extra="mb-3 p-3">
      <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        各家赔率 · 主胜 / 平 / 客胜
      </div>
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="text-[11px] text-gray-400">
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className={`py-1 font-normal ${h.column.id === 'title' ? 'text-left' : 'w-14 text-center'}`}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t border-gray-100 dark:border-white/5">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={
                    cell.column.id === 'title'
                      ? 'py-1.5 text-gray-600 dark:text-gray-300'
                      : 'text-center tabular-nums text-navy-700 dark:text-white'
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
