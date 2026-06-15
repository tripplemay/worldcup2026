'use client';

import { useParams, useRouter } from 'next/navigation';
import Card from 'components/card';
import StatCompare from 'components/worldcup/StatCompare';
import OddsTable from 'components/worldcup/OddsTable';
import {
  MatchTeamMeta,
  MatchVenueWeather,
} from 'components/worldcup/MatchBackground';
import RecentForm from 'components/worldcup/RecentForm';
import H2HCard from 'components/worldcup/H2HCard';
import PredictionCard from 'components/worldcup/PredictionCard';
import { useMatchSummary, useMatchOddsLite } from 'lib/hooks/useWorldCup';
import { findMatch } from 'lib/match/normalize';
import { useLocale } from 'lib/i18n/context';
import { eventType, statusText, position } from 'lib/i18n/events';

function eventIcon(type: string, scoringPlay?: boolean): string {
  if (scoringPlay || type.includes('Goal')) return '⚽';
  if (type.includes('Red')) return '🟥';
  if (type.includes('Yellow')) return '🟨';
  if (type.includes('Substitution')) return '🔄';
  return '•';
}

export default function MatchDetailPage() {
  const { locale, t, tn } = useLocale();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  // 返回上一页(来时的列表页,连带恢复其日期与滚动);无历史则回赛程
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1)
      router.back();
    else router.push('/schedule');
  };
  const { summary, isLoading } = useMatchSummary(id);
  const { matches } = useMatchOddsLite();
  const odds = summary
    ? findMatch(
        matches,
        summary.homeTeam,
        summary.awayTeam,
        summary.commenceTime,
      )
    : undefined;
  const showScore = summary && summary.status !== 'pre';

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 flex items-center gap-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <button
          onClick={goBack}
          className="text-sm text-gray-500 dark:text-gray-400"
        >
          ‹ {t('common.back')}
        </button>
        <h1 className="text-lg font-bold text-navy-700 dark:text-white">
          {t('detail.title')}
        </h1>
      </header>

      {isLoading && !summary && (
        <div className="h-40 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
      )}

      {summary && (
        <>
          <Card extra="mb-3 p-4">
            <div className="flex items-center justify-around gap-2">
              <div className="flex flex-1 flex-col items-center gap-1">
                {summary.homeLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={summary.homeLogo}
                    alt=""
                    className="h-12 w-12 object-contain"
                  />
                )}
                <span className="text-center text-sm font-medium text-navy-700 dark:text-white">
                  {tn(summary.homeTeam)}
                </span>
              </div>
              <div className="text-center">
                {showScore ? (
                  <div className="text-3xl font-bold tabular-nums text-navy-700 dark:text-white">
                    {summary.homeScore} : {summary.awayScore}
                  </div>
                ) : (
                  <div className="text-xl text-gray-400">{t('common.vs')}</div>
                )}
                {summary.statusDetail && (
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    {statusText(summary.statusDetail, locale)}
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col items-center gap-1">
                {summary.awayLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={summary.awayLogo}
                    alt=""
                    className="h-12 w-12 object-contain"
                  />
                )}
                <span className="text-center text-sm font-medium text-navy-700 dark:text-white">
                  {tn(summary.awayTeam)}
                </span>
              </div>
            </div>
            {summary.venue && (
              <div className="mt-2 text-center text-[11px] text-gray-400">
                {summary.venue}
              </div>
            )}
          </Card>

          <MatchTeamMeta summary={summary} />

          <PredictionCard
            matchId={id}
            homeTeam={summary.homeTeam}
            awayTeam={summary.awayTeam}
          />

          <RecentForm
            homeTeam={summary.homeTeam}
            awayTeam={summary.awayTeam}
            homeForm={summary.homeForm}
            awayForm={summary.awayForm}
          />

          <MatchVenueWeather summary={summary} />

          <StatCompare home={summary.homeStats} away={summary.awayStats} />

          {odds && <OddsTable m={odds} oddsEventId={odds.id} />}

          <H2HCard h2h={summary.h2h} />

          {summary.events.length > 0 && (
            <Card extra="mb-3 p-4">
              <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
                {t('detail.events')}
              </div>
              <div className="space-y-1">
                {summary.events.map((e, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"
                  >
                    <span className="w-9 tabular-nums text-gray-400">
                      {e.minute ?? ''}
                    </span>
                    <span>{eventIcon(e.type, e.scoringPlay)}</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {eventType(e.type, locale)}
                    </span>
                    <span className="flex-1">{e.player ?? ''}</span>
                    <span className="text-gray-400">{tn(e.team ?? '')}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {(summary.homeRoster.length > 0 || summary.awayRoster.length > 0) && (
            <Card extra="mb-3 p-4">
              <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
                {t('detail.lineup')}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { team: summary.homeTeam, roster: summary.homeRoster },
                  { team: summary.awayTeam, roster: summary.awayRoster },
                ].map((side, si) => (
                  <div key={si}>
                    <div className="mb-1 font-medium text-brand-500 dark:text-brand-400">
                      {tn(side.team)}
                    </div>
                    {side.roster
                      .filter((p) => p.starter)
                      .map((p, i) => (
                        <div
                          key={i}
                          className="text-gray-600 dark:text-gray-300"
                        >
                          {p.position && (
                            <span className="mr-1 text-gray-400">
                              {position(p.position, locale)}
                            </span>
                          )}
                          {p.name}
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
