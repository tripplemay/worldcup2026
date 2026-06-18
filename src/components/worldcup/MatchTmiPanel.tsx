'use client';

import Link from 'next/link';
import { MdBolt } from 'react-icons/md';
import Card from 'components/card';
import { useTmi } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import { normalizeTeam } from 'lib/match/normalize';
import { WEIGHT_ELO, WEIGHT_XG } from 'lib/tmi/constants';
import type { TeamTmi } from 'lib/tmi/types';

const signed = (n: number, d = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;

const totalCls = (total: number) =>
  total > 0.5
    ? 'text-emerald-600 dark:text-emerald-400'
    : total < 0
    ? 'text-red-500 dark:text-red-400'
    : 'text-navy-700 dark:text-white';

/** 单因子贡献行(加权后,负值标红)。 */
function FactorLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-400">{label}</span>
      <span
        className={`font-mono tabular-nums ${
          value < 0
            ? 'text-red-500 dark:text-red-400'
            : 'text-navy-700 dark:text-white'
        }`}
      >
        {signed(value)}
      </span>
    </div>
  );
}

function TmiCol({ team, data }: { team: string; data?: TeamTmi }) {
  const { t, tn } = useLocale();
  return (
    <div className="flex-1 space-y-1 text-xs">
      <div className="mb-1 truncate font-semibold text-brand-500 dark:text-brand-400">
        {tn(team)}
      </div>
      {data ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">{t('tmi.total')}</span>
            <span
              className={`font-mono text-base font-bold tabular-nums ${totalCls(
                data.total,
              )}`}
            >
              {signed(data.total)}
            </span>
          </div>
          <FactorLine
            label={t('tmi.mental')}
            value={+(WEIGHT_ELO * data.normalized.mentalScore).toFixed(3)}
          />
          <FactorLine
            label={t('tmi.tactical')}
            value={+(WEIGHT_XG * data.normalized.tacticalScore).toFixed(3)}
          />
          <FactorLine
            label={t('tmi.fatigue')}
            value={data.normalized.fatiguePenalty}
          />
          <div className="pt-0.5 font-mono text-[10px] leading-snug text-gray-400">
            {t('tmi.deltaElo')} {signed(data.raw.shadowEloDiff, 1)} ·{' '}
            {t('tmi.xgPerMatch')} {signed(data.raw.xgMomentumPerMatch)}
            {data.xgSource === 'season' ? ` (${t('tmi.sourceSeason')})` : ''}
            {data.raw.restDays != null
              ? ` · ${t('tmi.restDays')} ${data.raw.restDays}${t('tmi.daysUnit')}`
              : ''}
          </div>
        </>
      ) : (
        <div className="py-2 text-gray-400">{t('tmi.na')}</div>
      )}
    </div>
  );
}

/** 比赛详情页:两队「状态动能(TMI)」对比;固定权重观测,不进胜率。 */
export default function MatchTmiPanel({
  homeTeam,
  awayTeam,
}: {
  homeTeam: string;
  awayTeam: string;
}) {
  const { t } = useLocale();
  const { teams } = useTmi();
  const find = (name: string) =>
    teams.find((x) => x.teamId === normalizeTeam(name));
  const home = find(homeTeam);
  const away = find(awayTeam);
  if (!home && !away) return null; // 两队都还没登场则不渲染

  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-sm font-bold text-navy-700 dark:text-white">
          <MdBolt className="text-brand-500 dark:text-brand-400" />
          {t('tmi.detailTitle')}
        </span>
        <Link
          href="/tmi"
          className="flex shrink-0 items-center gap-0.5 rounded-full bg-gray-200/70 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-navy-700 dark:text-gray-300"
        >
          {t('tmi.tag')} ›
        </Link>
      </div>
      <div className="flex gap-4">
        <TmiCol team={homeTeam} data={home} />
        <div className="w-px bg-gray-100 dark:bg-white/10" />
        <TmiCol team={awayTeam} data={away} />
      </div>
    </Card>
  );
}
