'use client';

import Card from 'components/card';
import ProbBar from 'components/worldcup/ProbBar';
import { useMatchPrediction } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { MatchPrediction } from 'lib/predict/model';

const pct = (p: number) => `${Math.round(p * 100)}%`;

const CONF_CLS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500 dark:bg-navy-700 dark:text-gray-400',
  medium: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  high: 'bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400',
};

function ModelBlock({
  p,
  homeTeam,
  awayTeam,
}: {
  p: MatchPrediction;
  homeTeam: string;
  awayTeam: string;
}) {
  const { t, tn } = useLocale();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-500 dark:text-gray-400">
          {t(`predict.${p.modelId === 'poisson-xg' ? 'modelPoisson' : 'model'}`)}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${CONF_CLS[p.confidence]}`}>
          {t(`predict.conf_${p.confidence}`)}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{t('predict.xg')}</span>
        <span className="tabular-nums text-navy-700 dark:text-white">
          {tn(homeTeam)} <b>{p.xgHome.toFixed(1)}</b> — <b>{p.xgAway.toFixed(1)}</b> {tn(awayTeam)}
        </span>
      </div>

      <ProbBar home={p.homeWin} draw={p.draw} away={p.awayWin} />

      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{t('predict.topScores')}</span>
        <span className="flex gap-1">
          {p.topScores.map((s) => (
            <span
              key={s.score}
              className="rounded bg-lightPrimary px-1.5 py-0.5 tabular-nums text-navy-700 dark:bg-navy-700 dark:text-white"
            >
              {s.score} <span className="text-gray-400">{pct(s.p)}</span>
            </span>
          ))}
        </span>
      </div>

      <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <span>
          {t('predict.over25')} {pct(p.over25)} · {t('predict.under25')} {pct(p.under25)}
        </span>
        <span>
          {t('predict.btts')} {pct(p.btts)}
        </span>
      </div>
    </div>
  );
}

/** 详情页「模型预测」卡。多模型时逐块渲染 + 共识(目前 1 个模型)。 */
export default function PredictionCard({
  matchId,
  homeTeam,
  awayTeam,
}: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
}) {
  const { t } = useLocale();
  const { prediction, isLoading } = useMatchPrediction(matchId);
  const preds = prediction?.predictions ?? [];

  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        🔮 {t('predict.cardTitle')}
      </div>
      {isLoading && preds.length === 0 ? (
        <div className="py-4 text-center text-xs text-gray-400">
          {t('detail.loadingOdds')}
        </div>
      ) : preds.length === 0 ? (
        <div className="py-4 text-center text-xs text-gray-400">
          {t('predict.empty')}
        </div>
      ) : (
        <div className="space-y-4 divide-y divide-gray-100 dark:divide-white/5">
          {preds.map((p) => (
            <div key={p.modelId} className="pt-3 first:pt-0">
              <ModelBlock p={p} homeTeam={homeTeam} awayTeam={awayTeam} />
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 text-[10px] text-gray-400">
        ⓘ {t('predict.disclaimer')}
      </div>
    </Card>
  );
}
