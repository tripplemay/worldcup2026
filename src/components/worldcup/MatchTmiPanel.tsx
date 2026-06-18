'use client';

import Link from 'next/link';
import { MdBolt } from 'react-icons/md';
import Card from 'components/card';
import { useTeamProfile } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import { gradeLetter } from 'lib/team/score';
import type { TeamProfile } from 'lib/team/types';

const gradeCls = (g: number) =>
  g >= 80
    ? 'text-emerald-600 dark:text-emerald-400'
    : g >= 65
    ? 'text-brand-500 dark:text-brand-400'
    : g >= 50
    ? 'text-amber-500'
    : 'text-red-500 dark:text-red-400';

/** 状态分项条(0–100)。 */
function Bar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-7 shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-navy-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums text-gray-600 dark:text-gray-300">
        {Math.round(value)}
      </span>
    </div>
  );
}

function TeamCol({ team, profile }: { team: string; profile: TeamProfile | null }) {
  const { t, tn } = useLocale();
  return (
    <div className="flex-1 space-y-1.5">
      <div className="truncate text-xs font-semibold text-brand-500 dark:text-brand-400">
        {tn(team)}
      </div>
      {profile ? (
        <>
          <div className="flex items-baseline gap-1">
            <span className={`font-mono text-2xl font-extrabold leading-none ${gradeCls(profile.grade)}`}>
              {profile.grade}
            </span>
            <span className={`text-[11px] font-bold ${gradeCls(profile.grade)}`}>
              {gradeLetter(profile.grade)}
            </span>
          </div>
          <div className="space-y-1 pt-0.5">
            <Bar label={t('team.momentum')} value={profile.state.momentum} color="bg-brand-500" />
            <Bar label={t('team.recentForm')} value={profile.state.recentForm} color="bg-emerald-500" />
            <Bar label={t('team.fitness')} value={profile.state.fitness} color="bg-amber-500" />
          </div>
        </>
      ) : (
        <div className="py-2 text-xs text-gray-400">{t('tmi.na')}</div>
      )}
    </div>
  );
}

/** 比赛详情页:两队「状态评分」(0–100,偏当前状态)+ 动能/近期/体能拆解。点标题进完整球队页。 */
export default function MatchTmiPanel({
  homeTeam,
  awayTeam,
  homeId,
  awayId,
}: {
  homeTeam: string;
  awayTeam: string;
  homeId?: string;
  awayId?: string;
}) {
  const { t } = useLocale();
  const { profile: home } = useTeamProfile(homeId);
  const { profile: away } = useTeamProfile(awayId);
  if (!home && !away) return null;

  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-sm font-bold text-navy-700 dark:text-white">
          <MdBolt className="text-brand-500 dark:text-brand-400" />
          {t('team.stateScore')}
        </span>
        <span className="shrink-0 rounded-full bg-gray-200/70 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-navy-700 dark:text-gray-300">
          {t('tmi.tag')}
        </span>
      </div>
      <div className="flex gap-4">
        <TeamCol team={homeTeam} profile={home} />
        <div className="w-px bg-gray-100 dark:bg-white/10" />
        <TeamCol team={awayTeam} profile={away} />
      </div>
    </Card>
  );
}
