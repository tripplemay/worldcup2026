'use client';

import Card from 'components/card';
import ProbBar from 'components/worldcup/ProbBar';
import { useMatchPrediction } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { MatchPrediction } from 'lib/predict/model';

const pct = (p: number) => `${Math.round(p * 100)}%`;
const argmax = (p: MatchPrediction) =>
  p.homeWin >= p.draw && p.homeWin >= p.awayWin
    ? 'home'
    : p.awayWin >= p.draw
      ? 'away'
      : 'draw';

const CONF_CLS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500 dark:bg-navy-700 dark:text-gray-400',
  medium: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  high: 'bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400',
};

const MODEL_KEY: Record<string, string> = {
  'poisson-xg': 'predict.modelPoisson',
  elo: 'predict.modelElo',
  market: 'predict.modelMarket',
  ensemble: 'predict.ensemble',
};

function Cell({ v, hi }: { v: number; hi: boolean }) {
  return (
    <td
      className={`px-1 text-center tabular-nums ${hi ? 'font-bold text-navy-700 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}
    >
      {pct(v)}
    </td>
  );
}

function Row({ p, ens }: { p: MatchPrediction; ens?: boolean }) {
  const { t } = useLocale();
  const mx = argmax(p);
  return (
    <tr className={ens ? 'border-t border-gray-200 dark:border-white/10' : ''}>
      <td className={`py-1 ${ens ? 'font-bold text-navy-700 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
        {ens ? '🎯 ' : ''}
        {t(MODEL_KEY[p.modelId] ?? 'predict.model')}
      </td>
      <Cell v={p.homeWin} hi={mx === 'home'} />
      <Cell v={p.draw} hi={mx === 'draw'} />
      <Cell v={p.awayWin} hi={mx === 'away'} />
    </tr>
  );
}

export default function PredictionCard({
  matchId,
}: {
  matchId: string;
  homeTeam?: string;
  awayTeam?: string;
}) {
  const { t } = useLocale();
  const { prediction, isLoading } = useMatchPrediction(matchId);
  const base = prediction?.predictions ?? [];
  const ens = prediction?.ensemble ?? null;

  const consensus =
    base.length >= 2 && base.every((p) => argmax(p) === argmax(base[0]));
  const main = ens ?? base[0];

  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold text-navy-700 dark:text-white">
          🔮 {t('predict.cardTitle')}
        </span>
        {main && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${CONF_CLS[main.confidence]}`}>
            {t(`predict.conf_${main.confidence}`)}
          </span>
        )}
      </div>

      {isLoading && base.length === 0 ? (
        <div className="py-4 text-center text-xs text-gray-400">{t('detail.loadingOdds')}</div>
      ) : !main ? (
        <div className="py-4 text-center text-xs text-gray-400">{t('predict.empty')}</div>
      ) : (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[11px] text-gray-400">
                <th className="py-1 text-left font-normal">{t('predict.model')}</th>
                <th className="px-1 font-normal">{t('odds.home')}</th>
                <th className="px-1 font-normal">{t('odds.draw')}</th>
                <th className="px-1 font-normal">{t('odds.away')}</th>
              </tr>
            </thead>
            <tbody>
              {base.map((p) => (
                <Row key={p.modelId} p={p} />
              ))}
              {ens && <Row p={ens} ens />}
            </tbody>
          </table>

          <div className="mt-2">
            <ProbBar home={main.homeWin} draw={main.draw} away={main.awayWin} />
          </div>

          {base.length >= 2 && (
            <div className="mt-2 text-[11px]">
              {consensus ? (
                <span className="text-green-600 dark:text-green-400">
                  ✅ {t('predict.consensusHigh')}
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  ⚠️ {t('predict.consensusLow')}
                </span>
              )}
            </div>
          )}

          {main.xgHome != null && (
            <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-white/5 dark:text-gray-400">
              <div className="flex justify-between">
                <span>{t('predict.xg')}</span>
                <span className="tabular-nums text-navy-700 dark:text-white">
                  {main.xgHome.toFixed(1)} - {main.xgAway?.toFixed(1)}
                </span>
              </div>
              {main.topScores && (
                <div className="flex justify-between">
                  <span>{t('predict.topScores')}</span>
                  <span className="flex gap-1">
                    {main.topScores.map((s) => (
                      <span key={s.score} className="tabular-nums text-navy-700 dark:text-white">
                        {s.score}
                        <span className="text-gray-400"> {pct(s.p)}</span>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span>
                  {t('predict.over25')} {pct(main.over25 ?? 0)} · {t('predict.under25')}{' '}
                  {pct(main.under25 ?? 0)}
                </span>
                <span>
                  {t('predict.btts')} {pct(main.btts ?? 0)}
                </span>
              </div>
            </div>
          )}
        </>
      )}
      <div className="mt-3 text-[10px] text-gray-400">ⓘ {t('predict.disclaimer')}</div>
    </Card>
  );
}
