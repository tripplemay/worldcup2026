'use client';

import Link from 'next/link';
import { MdBolt, MdLocalFireDepartment } from 'react-icons/md';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import PageHeading from 'components/worldcup/PageHeading';
import { useTmi, useTeamLogos, useTeamIdMap } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import { WEIGHT_ELO, WEIGHT_XG } from 'lib/tmi/constants';
import type { TeamTmi } from 'lib/tmi/types';

const BAR_MAX = 0.6; // 三条贡献条共用标尺(战术/体能满贡献 ≈ 0.6)

/** 因子加权贡献条(中线为 0,正向右、负向左)。 */
function FactorBar({
  label,
  value,
  posColor,
}: {
  label: string;
  value: number;
  posColor: string;
}) {
  const w = Math.min(50, (Math.abs(value) / BAR_MAX) * 50);
  const positive = value >= 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <div className="relative h-1.5 flex-1 rounded-full bg-gray-100 dark:bg-navy-700">
        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gray-300 dark:bg-navy-600" />
        <span
          className={`absolute top-0 h-full rounded-full ${
            positive ? posColor : 'bg-red-400'
          }`}
          style={
            positive
              ? { left: '50%', width: `${w}%` }
              : { right: '50%', width: `${w}%` }
          }
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-gray-600 dark:text-gray-300">
        {value >= 0 ? '+' : ''}
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function TmiRow({ team, rank }: { team: TeamTmi; rank: number }) {
  const { t } = useLocale();
  const logos = useTeamLogos();
  const { raw, normalized: nz, total } = team;
  const hot = total > 0.5;
  const totalColor = hot
    ? 'text-green-600 dark:text-green-400'
    : total < 0
    ? 'text-red-500 dark:text-red-400'
    : 'text-navy-700 dark:text-white';

  return (
    <Card extra={`p-3.5 ${hot ? 'ring-1 ring-green-400/40' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="w-5 shrink-0 text-center font-mono text-sm font-semibold text-gray-400">
          {rank}
        </span>
        <TeamBadge
          name={team.teamName}
          logo={logos[team.teamId]}
          className="min-w-0 flex-1 text-sm font-semibold text-navy-700 dark:text-white"
        />
        <div className="flex shrink-0 items-center gap-1">
          {hot && <MdLocalFireDepartment className="text-green-500" />}
          <span
            className={`font-mono text-lg font-bold tabular-nums ${totalColor}`}
          >
            {total >= 0 ? '+' : ''}
            {total.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="mt-2.5 space-y-1">
        <FactorBar
          label={t('tmi.mental')}
          value={+(WEIGHT_ELO * nz.mentalScore).toFixed(3)}
          posColor="bg-brand-500"
        />
        <FactorBar
          label={t('tmi.tactical')}
          value={+(WEIGHT_XG * nz.tacticalScore).toFixed(3)}
          posColor="bg-green-500"
        />
        <FactorBar
          label={t('tmi.fatigue')}
          value={nz.fatiguePenalty}
          posColor="bg-amber-500"
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-gray-500 dark:text-gray-400">
        <span>
          {t('tmi.deltaElo')} {raw.shadowEloDiff >= 0 ? '+' : ''}
          {raw.shadowEloDiff.toFixed(1)}
        </span>
        <span>
          {t('tmi.xgPerMatch')} {raw.xgMomentumPerMatch >= 0 ? '+' : ''}
          {raw.xgMomentumPerMatch.toFixed(2)}
          {team.xgSource === 'season' ? ` (${t('tmi.sourceSeason')})` : ''}
        </span>
        {raw.restDays != null && (
          <span>
            {t('tmi.restDays')} {raw.restDays}
            {t('tmi.daysUnit')}
          </span>
        )}
        <span>
          {t('tmi.played')} {raw.matchesPlayed}
          {t('tmi.matchesUnit')}
        </span>
      </div>
    </Card>
  );
}

export default function TmiPage() {
  const { t } = useLocale();
  const { teams, isLoading } = useTmi();
  const idMap = useTeamIdMap();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between gap-2">
          <PageHeading Icon={MdBolt}>{t('tmi.title')}</PageHeading>
          <span className="shrink-0 rounded-full bg-gray-200/70 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-navy-700 dark:text-gray-300">
            {t('tmi.tag')}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('tmi.subtitle')}
        </p>
      </header>

      {isLoading && teams.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-[20px] bg-white dark:bg-navy-800"
            />
          ))}
        </div>
      )}

      {!isLoading && teams.length === 0 && (
        <div className="py-16 text-center text-gray-400">{t('tmi.empty')}</div>
      )}

      <div className="space-y-3">
        {teams.map((team, i) => {
          const teamId = idMap[team.teamId];
          const row = <TmiRow team={team} rank={i + 1} />;
          return teamId ? (
            <Link key={team.teamId} href={`/team/${teamId}`} className="block">
              {row}
            </Link>
          ) : (
            <div key={team.teamId}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}
