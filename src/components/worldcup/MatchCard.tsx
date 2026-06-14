'use client';

import { useState } from 'react';
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
  pre: { label: '未开赛', cls: 'bg-white/10 text-white/60' },
  in: { label: '● 进行中', cls: 'bg-red-500/20 text-red-400 animate-pulse' },
  post: { label: '已结束', cls: 'bg-emerald-500/20 text-emerald-400' },
};

function eventIcon(type: string, scoringPlay?: boolean): string {
  if (scoringPlay || type.includes('Goal')) return '⚽';
  if (type.includes('Red')) return '🟥';
  if (type.includes('Yellow')) return '🟨';
  return '•';
}

/** 展开后的进球/红黄牌时间线(仅展开时请求)。 */
function MatchTimeline({ eventId }: { eventId: string }) {
  const { events, isLoading } = useMatchEvents(eventId);
  if (isLoading) return <div className="mt-3 text-center text-xs text-white/30">加载事件…</div>;
  if (!events.length)
    return <div className="mt-3 text-center text-xs text-white/30">暂无进球/红黄牌</div>;
  return (
    <div className="mt-3 space-y-1 border-t border-white/5 pt-2">
      {events.map((e, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-white/60">
          <span className="w-9 tabular-nums text-white/40">{e.minute ?? ''}</span>
          <span>{eventIcon(e.type, e.scoringPlay)}</span>
          <span className="flex-1">{e.player ?? e.type}</span>
          <span className="text-white/30">{e.team}</span>
        </div>
      ))}
    </div>
  );
}

/** 一场比赛卡片:对阵 + 实时比分 + 状态;点击展开进球时间线。 */
export default function MatchCard({ m }: { m: ScheduleMatch }) {
  const [open, setOpen] = useState(false);
  const s = STATUS[m.status] ?? STATUS.pre;
  const showScore = m.status !== 'pre';
  const expandable = m.status !== 'pre';

  return (
    <div
      className="rounded-[20px] bg-[#111c44] p-4 shadow-lg shadow-black/20"
      onClick={() => expandable && setOpen((o) => !o)}
    >
      <div className="mb-2 flex items-center justify-between text-xs text-white/50">
        <span>{fmtTime(m.commenceTime)}</span>
        <span className={`rounded-full px-2 py-0.5 ${s.cls}`}>
          {s.label}
          {m.status === 'in' && m.clock ? ` ${m.clock}` : ''}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex-1 font-medium">{m.homeTeam}</span>
        {showScore ? (
          <span className="px-3 text-xl font-bold tabular-nums">
            {m.homeScore} : {m.awayScore}
          </span>
        ) : (
          <span className="px-3 text-sm text-white/30">vs</span>
        )}
        <span className="flex-1 text-right font-medium">{m.awayTeam}</span>
      </div>
      {m.venue && !open && (
        <div className="mt-2 text-center text-[11px] text-white/40">{m.venue}</div>
      )}
      {expandable && !open && (
        <div className="mt-1 text-center text-[11px] text-white/25">点击看进球时间线 ⌄</div>
      )}
      {open && <MatchTimeline eventId={m.id} />}
    </div>
  );
}
