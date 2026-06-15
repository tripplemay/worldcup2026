'use client';

import Card from 'components/card';
import ProbBar from 'components/worldcup/ProbBar';
import { useMatchPrediction } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { MatchPrediction } from 'lib/predict/model';
import type { TeamIntel } from 'lib/intel/types';

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
      className={`px-1 text-center tabular-nums ${
        hi
          ? 'font-bold text-navy-700 dark:text-white'
          : 'text-gray-500 dark:text-gray-400'
      }`}
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
      <td
        className={`py-1 ${
          ens
            ? 'font-bold text-navy-700 dark:text-white'
            : 'text-gray-600 dark:text-gray-300'
        }`}
      >
        {ens ? '🎯 ' : ''}
        {t(MODEL_KEY[p.modelId] ?? 'predict.model')}
      </td>
      <Cell v={p.homeWin} hi={mx === 'home'} />
      <Cell v={p.draw} hi={mx === 'draw'} />
      <Cell v={p.awayWin} hi={mx === 'away'} />
    </tr>
  );
}

function IntelRow({ it }: { it: TeamIntel }) {
  const { t, tn } = useLocale();
  const s = it.sentiment.score;
  const cls =
    s < -0.05
      ? 'text-red-500 dark:text-red-400'
      : s > 0.05
      ? 'text-green-600 dark:text-green-400'
      : 'text-gray-500';
  return (
    <div className="text-[11px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-brand-500 dark:text-brand-400">
          {tn(it.team)}
        </span>
        <span className="rounded bg-lightPrimary px-1 text-[10px] text-gray-500 dark:bg-navy-700 dark:text-gray-400">
          {it.sentiment.eventType}
        </span>
        <span className={`tabular-nums ${cls}`}>{s.toFixed(2)}</span>
        {Math.abs(it.modifier) >= 0.005 && (
          <span className={`tabular-nums ${cls}`}>
            {t('predict.suggest')} {it.modifier > 0 ? '+' : ''}
            {Math.round(it.modifier * 100)}%
          </span>
        )}
      </div>
      <div className="text-gray-500 dark:text-gray-400">
        {it.sentiment.reasoning || it.news.title}{' '}
        <span className="text-gray-400">({it.news.source})</span>
      </div>
    </div>
  );
}

export default function PredictionCard({
  matchId,
}: {
  matchId: string;
  homeTeam?: string;
  awayTeam?: string;
}) {
  const { t, tn } = useLocale();
  const { prediction, isLoading } = useMatchPrediction(matchId);
  const base = prediction?.predictions ?? [];
  const ens = prediction?.ensemble ?? null;
  const intel = [prediction?.homeIntel, prediction?.awayIntel].filter(
    (x): x is TeamIntel => !!x,
  );
  const adjusted = prediction?.adjusted ?? null;
  const h2h = prediction?.h2h ?? null;
  const weightMode = prediction?.weightMode;

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
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              CONF_CLS[main.confidence]
            }`}
          >
            {t(`predict.conf_${main.confidence}`)}
          </span>
        )}
      </div>

      {isLoading && base.length === 0 ? (
        <div className="py-4 text-center text-xs text-gray-400">
          {t('detail.loadingOdds')}
        </div>
      ) : !main ? (
        <div className="py-4 text-center text-xs text-gray-400">
          {t('predict.empty')}
        </div>
      ) : (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[11px] text-gray-400">
                <th className="py-1 text-left font-normal">
                  {t('predict.model')}
                </th>
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
            <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px]">
              {consensus ? (
                <span className="text-green-600 dark:text-green-400">
                  ✅ {t('predict.consensusHigh')}
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  ⚠️ {t('predict.consensusLow')}
                </span>
              )}
              {(weightMode === 'gap' || weightMode === 'even') && (
                <span className="text-gray-400">
                  · {t(`predict.wm_${weightMode}`)}
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
                      <span
                        key={s.score}
                        className="tabular-nums text-navy-700 dark:text-white"
                      >
                        {s.score}
                        <span className="text-gray-400"> {pct(s.p)}</span>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span>
                  {t('predict.over25')} {pct(main.over25 ?? 0)} ·{' '}
                  {t('predict.under25')} {pct(main.under25 ?? 0)}
                </span>
                <span>
                  {t('predict.btts')} {pct(main.btts ?? 0)}
                </span>
              </div>
            </div>
          )}

          {intel.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2 dark:border-white/5">
              <div className="text-[11px] font-semibold text-navy-700 dark:text-white">
                📰 {t('predict.intelTitle')}
              </div>
              {intel.map((it) => (
                <IntelRow key={it.norm} it={it} />
              ))}
              {adjusted && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  {t('predict.adjusted')}: {t('odds.home')} {pct(adjusted.home)}{' '}
                  · {t('odds.draw')} {pct(adjusted.draw)} · {t('odds.away')}{' '}
                  {pct(adjusted.away)}
                  <span className="text-gray-400">
                    {' '}
                    · {t('predict.adjustedNote')}
                  </span>
                </div>
              )}
            </div>
          )}

          {h2h && h2h.played > 0 && (
            <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 dark:border-white/5">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="font-semibold text-navy-700 dark:text-white">
                  📅 {t('predict.h2hTitle')}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {h2h.played} {t('predict.h2hPlayed')} · {t('odds.home')}{' '}
                  {h2h.homeWins} · {t('odds.draw')} {h2h.draws} ·{' '}
                  {t('odds.away')} {h2h.awayWins}
                </span>
              </div>
              {h2h.recent.map((g, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400"
                >
                  <span className="w-12 tabular-nums">
                    {g.date.slice(0, 7)}
                  </span>
                  <span className="flex-1 truncate text-right">
                    {tn(g.home)}
                  </span>
                  <span className="tabular-nums font-medium text-navy-700 dark:text-white">
                    {g.hs}-{g.as}
                  </span>
                  <span className="flex-1 truncate">{tn(g.away)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="mt-3 text-[10px] text-gray-400">
        ⓘ {t('predict.disclaimer')}
      </div>
    </Card>
  );
}
