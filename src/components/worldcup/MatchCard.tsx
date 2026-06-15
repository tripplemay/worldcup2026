'use client';

import { memo } from 'react';
import Link from 'next/link';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import OddsArrow from 'components/worldcup/OddsArrow';
import { useLocale } from 'lib/i18n/context';
import type { ScheduleMatch } from 'lib/espn/types';
import type { MatchOdds } from 'lib/odds/types';
import type { MatchChange, OutcomeChange } from 'lib/odds/changes';

function fmtTime(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai',
    });
  } catch {
    return iso;
  }
}

const STATUS_CLS: Record<ScheduleMatch['status'], string> = {
  pre: 'bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300',
  in: 'bg-red-50 text-red-500 dark:bg-red-500/20 dark:text-red-400 animate-pulse',
  post: 'bg-green-50 text-green-500 dark:bg-green-500/20 dark:text-green-400',
};

function OddPill({
  label,
  price,
  ch,
}: {
  label: string;
  price?: number;
  ch?: OutcomeChange;
}) {
  return (
    <div className="flex-1 rounded-lg bg-lightPrimary py-1 dark:bg-navy-700">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>{' '}
      <span className="font-bold text-brand-500 dark:text-white">
        {price?.toFixed(2) ?? '—'}
      </span>
      <OddsArrow ch={ch} />
    </div>
  );
}

/** 一场比赛卡片(Horizon Card):队徽 + 比分 + 精简赔率;点击进详情页;进行中红环。 */
function MatchCard({
  m,
  odds,
  change,
}: {
  m: ScheduleMatch;
  odds?: MatchOdds;
  change?: MatchChange;
}) {
  const { locale, t } = useLocale();
  const statusLabel = t(`status.${m.status}`);
  const showScore = m.status !== 'pre';
  const live = m.status === 'in';

  return (
    <div className="fade-in-up">
      <Link href={`/match/${m.id}`}>
        <Card extra={`p-4 ${live ? 'ring-2 ring-red-500/50' : ''}`}>
          <div className="mb-2 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
            <span>{fmtTime(m.commenceTime, locale)}</span>
            <span
              className={`rounded-full px-2 py-0.5 ${
                STATUS_CLS[m.status] ?? STATUS_CLS.pre
              }`}
            >
              {statusLabel}
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
              <span className="px-3 text-sm text-gray-400">
                {t('common.vs')}
              </span>
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
              <OddPill
                label={t('odds.home')}
                price={odds.best.home?.price}
                ch={change?.home}
              />
              <OddPill
                label={t('odds.draw')}
                price={odds.best.draw?.price}
                ch={change?.draw}
              />
              <OddPill
                label={t('odds.away')}
                price={odds.best.away?.price}
                ch={change?.away}
              />
            </div>
          )}
          {m.venue && (
            <div className="mt-2 text-center text-[11px] text-gray-500 dark:text-gray-400">
              {m.venue}
            </div>
          )}
        </Card>
      </Link>
    </div>
  );
}

export default memo(MatchCard);
