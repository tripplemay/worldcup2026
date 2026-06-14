'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import type { ScheduleMatch } from 'lib/espn/types';
import type { MatchOdds } from 'lib/odds/types';

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

function OddPill({ label, price }: { label: string; price?: number }) {
  return (
    <div className="flex-1 rounded-lg bg-lightPrimary py-1 dark:bg-navy-700">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>{' '}
      <span className="font-bold text-brand-500 dark:text-white">{price?.toFixed(2) ?? '—'}</span>
    </div>
  );
}

/** 一场比赛卡片(Horizon Card):队徽 + 比分 + 精简赔率;点击进详情页;进行中红环。 */
export default function MatchCard({ m, odds }: { m: ScheduleMatch; odds?: MatchOdds }) {
  const s = STATUS[m.status] ?? STATUS.pre;
  const showScore = m.status !== 'pre';
  const live = m.status === 'in';

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Link href={`/match/${m.id}`}>
        <Card extra={`p-4 ${live ? 'ring-2 ring-red-500/50' : ''}`}>
          <div className="mb-2 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
            <span>{fmtTime(m.commenceTime)}</span>
            <span className={`rounded-full px-2 py-0.5 ${s.cls}`}>
              {s.label}
              {live && m.clock ? ` ${m.clock}` : ''}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <TeamBadge
              name={m.homeTeam}
              logo={m.homeLogo}
              className="flex-1 font-medium text-navy-700 dark:text-white"
            />
            {showScore ? (
              <span className="px-3 text-xl font-bold tabular-nums text-navy-700 dark:text-white">
                {m.homeScore} : {m.awayScore}
              </span>
            ) : (
              <span className="px-3 text-sm text-gray-400">vs</span>
            )}
            <TeamBadge
              name={m.awayTeam}
              logo={m.awayLogo}
              reverse
              className="flex-1 justify-end text-right font-medium text-navy-700 dark:text-white"
            />
          </div>
          {odds && (
            <div className="mt-2 flex gap-2 text-center text-xs">
              <OddPill label="主" price={odds.best.home?.price} />
              <OddPill label="平" price={odds.best.draw?.price} />
              <OddPill label="客" price={odds.best.away?.price} />
            </div>
          )}
          {m.venue && (
            <div className="mt-2 text-center text-[11px] text-gray-500 dark:text-gray-400">{m.venue}</div>
          )}
        </Card>
      </Link>
    </motion.div>
  );
}
