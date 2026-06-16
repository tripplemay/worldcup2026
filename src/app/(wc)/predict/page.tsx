'use client';

import Link from 'next/link';
import Card from 'components/card';
import { MdInsights } from 'react-icons/md';
import ProbBar from 'components/worldcup/ProbBar';
import TeamBadge from 'components/worldcup/TeamBadge';
import PageHeading from 'components/worldcup/PageHeading';
import { usePredictions } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import { formatMatchTime } from 'lib/format/matchTime';
import type { MatchWithPredictions } from 'lib/predict/predict';

/** 取融合(或首个模型)最大概率的赛果作为「预测」。 */
function pick(m: MatchWithPredictions, homeShort: string, awayShort: string) {
  const p = m.ensemble ?? m.predictions[0];
  if (!p) return null;
  const max = Math.max(p.homeWin, p.draw, p.awayWin);
  const side =
    max === p.homeWin ? homeShort : max === p.awayWin ? awayShort : '—';
  return { side, score: p.topScores?.[0]?.score ?? '', conf: p.confidence };
}

export default function PredictPage() {
  const { locale, t, tn } = useLocale();
  const { matches, isLoading } = usePredictions(14);
  const withPred = matches.filter((m) => m.predictions.length > 0);

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <PageHeading Icon={MdInsights}>{t('predict.title')}</PageHeading>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('predict.subtitle')}
        </p>
      </header>

      {isLoading && withPred.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-[20px] bg-white dark:bg-navy-800"
            />
          ))}
        </div>
      )}

      {!isLoading && withPred.length === 0 && (
        <div className="py-16 text-center text-gray-400">
          {t('predict.empty')}
        </div>
      )}

      <div className="space-y-3">
        {withPred.map((m) => {
          const p = m.ensemble ?? m.predictions[0];
          const pk = pick(m, tn(m.homeTeam), tn(m.awayTeam));
          return (
            <Link key={m.matchId} href={`/match/${m.matchId}`}>
              <Card extra="p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                  <span>{formatMatchTime(m.commenceTime, locale)}</span>
                  {pk && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                      {t('predict.pick')} {pk.side} {pk.score}
                    </span>
                  )}
                </div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <TeamBadge
                    name={m.homeTeam}
                    logo={m.homeLogo}
                    nameFirst
                    className="min-w-0 flex-1 text-sm font-medium text-navy-700 dark:text-white"
                  />
                  <span className="shrink-0 px-2 text-xs text-gray-400">
                    {p.xgHome != null
                      ? `${p.xgHome.toFixed(1)} - ${p.xgAway?.toFixed(1)}`
                      : ''}
                  </span>
                  <TeamBadge
                    name={m.awayTeam}
                    logo={m.awayLogo}
                    className="min-w-0 flex-1 justify-end text-right text-sm font-medium text-navy-700 dark:text-white"
                  />
                </div>
                <ProbBar home={p.homeWin} draw={p.draw} away={p.awayWin} />
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
