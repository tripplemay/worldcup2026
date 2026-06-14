'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Card from 'components/card';
import { useMatchEvents } from 'lib/hooks/useWorldCup';
import type { ScheduleMatch } from 'lib/espn/types';

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const STATUS: Record<ScheduleMatch['status'], { label: string; cls: string }> = {
  pre: { label: '未开赛', cls: 'bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300' },
  in: { label: '● 进行中', cls: 'bg-red-50 text-red-500 dark:bg-red-500/20 dark:text-red-400 animate-pulse' },
  post: { label: '已结束', cls: 'bg-green-50 text-green-500 dark:bg-green-500/20 dark:text-green-400' },
};

function eventIcon(type: string, scoringPlay?: boolean): string {
  if (scoringPlay || type.includes('Goal')) return '⚽';
  if (type.includes('Red')) return '🟥';
  if (type.includes('Yellow')) return '🟨';
  return '•';
}

function MatchTimeline({ eventId }: { eventId: string }) {
  const { events, isLoading } = useMatchEvents(eventId);
  if (isLoading) return <div className="mt-3 text-center text-xs text-gray-400">加载事件…</div>;
  if (!events.length)
    return <div className="mt-3 text-center text-xs text-gray-400">暂无进球/红黄牌</div>;
  return (
    <div className="mt-3 space-y-1 border-t border-gray-200 pt-2 dark:border-white/10">
      {events.map((e, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span className="w-9 tabular-nums text-gray-400">{e.minute ?? ''}</span>
          <span>{eventIcon(e.type, e.scoringPlay)}</span>
          <span className="flex-1">{e.player ?? e.type}</span>
          <span className="text-gray-400">{e.team}</span>
        </div>
      ))}
    </div>
  );
}

/** 一场比赛卡片(Horizon Card):对阵 + 实时比分 + 状态;点击展开进球时间线。 */
export default function MatchCard({ m }: { m: ScheduleMatch }) {
  const [open, setOpen] = useState(false);
  const s = STATUS[m.status] ?? STATUS.pre;
  const showScore = m.status !== 'pre';
  const expandable = m.status !== 'pre';

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card
        extra={`p-4 ${expandable ? 'cursor-pointer' : ''}`}
        onClick={() => expandable && setOpen((o) => !o)}
      >
        <div className="mb-2 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
          <span>{fmtTime(m.commenceTime)}</span>
          <span className={`rounded-full px-2 py-0.5 ${s.cls}`}>
            {s.label}
            {m.status === 'in' && m.clock ? ` ${m.clock}` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex-1 font-medium text-navy-700 dark:text-white">{m.homeTeam}</span>
          {showScore ? (
            <span className="px-3 text-xl font-bold tabular-nums text-navy-700 dark:text-white">
              {m.homeScore} : {m.awayScore}
            </span>
          ) : (
            <span className="px-3 text-sm text-gray-400">vs</span>
          )}
          <span className="flex-1 text-right font-medium text-navy-700 dark:text-white">{m.awayTeam}</span>
        </div>
        {m.venue && !open && (
          <div className="mt-2 text-center text-[11px] text-gray-500 dark:text-gray-400">{m.venue}</div>
        )}
        {expandable && !open && (
          <div className="mt-1 text-center text-[11px] text-gray-400">点击看进球时间线 ⌄</div>
        )}
        {open && <MatchTimeline eventId={m.id} />}
      </Card>
    </motion.div>
  );
}
