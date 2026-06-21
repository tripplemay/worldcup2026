'use client';

import { useParams, useRouter } from 'next/navigation';
import {
  MdSportsSoccer,
  MdSquare,
  MdSwapHoriz,
  MdFiberManualRecord,
} from 'react-icons/md';
import Card from 'components/card';
import StatCompare from 'components/worldcup/StatCompare';
import RecentForm from 'components/worldcup/RecentForm';
import PitchFormation from 'components/worldcup/PitchFormation';
import PredictionCard from 'components/worldcup/PredictionCard';
import {
  useLeagueMatchSummary,
  useLeagueMatchPrediction,
} from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import { eventType, statusText, position } from 'lib/i18n/events';

function EventIcon({ type, scoringPlay }: { type: string; scoringPlay?: boolean }) {
  if (scoringPlay || type.includes('Goal')) return <MdSportsSoccer />;
  if (type.includes('Red')) return <MdSquare className="text-red-500" />;
  if (type.includes('Yellow')) return <MdSquare className="text-yellow-400" />;
  if (type.includes('Substitution'))
    return <MdSwapHoriz className="text-green-500" />;
  return <MdFiberManualRecord className="text-[8px] text-gray-400" />;
}

/** 联赛单场详情:ESPN 比分/统计/阵容 + 多模型预测(套用联赛 calib)。WC 详情页的精简联赛版。 */
export default function LeagueMatchDetailPage() {
  const { locale, t, tn } = useLocale();
  const router = useRouter();
  const { comp, id } = useParams<{ comp: string; id: string }>();
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1)
      router.back();
    else router.push('/predict');
  };
  const { summary, isLoading } = useLeagueMatchSummary(comp, id);
  const { prediction } = useLeagueMatchPrediction(comp, id);
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
                    width={48}
                    height={48}
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
                    width={48}
                    height={48}
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

          <PredictionCard matchId={id} data={prediction} />

          <RecentForm
            homeTeam={summary.homeTeam}
            awayTeam={summary.awayTeam}
            homeForm={summary.homeForm}
            awayForm={summary.awayForm}
          />

          <StatCompare home={summary.homeStats} away={summary.awayStats} />

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
                    <span className="text-gray-600 dark:text-gray-300">
                      <EventIcon type={e.type} scoringPlay={e.scoringPlay} />
                    </span>
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
              <PitchFormation
                home={{
                  team: summary.homeTeam,
                  formation: summary.homeFormation,
                  starters: summary.homeRoster.filter((p) => p.starter),
                }}
                away={{
                  team: summary.awayTeam,
                  formation: summary.awayFormation,
                  starters: summary.awayRoster.filter((p) => p.starter),
                }}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
