'use client';

import { useEffect, useState } from 'react';
import { MdScience, MdRestartAlt } from 'react-icons/md';
import Card from 'components/card';
import PageHeading from 'components/worldcup/PageHeading';
import { useLeagueBacktest, type BacktestParams } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';

const LEAGUES = [
  { key: 'epl-2025', name: 'Premier League' },
  { key: 'laliga', name: 'La Liga' },
  { key: 'bundesliga', name: 'Bundesliga' },
  { key: 'seriea', name: 'Serie A' },
  { key: 'ligue1', name: 'Ligue 1' },
];

const MODEL_KEY: Record<string, string> = {
  'poisson-xg': 'predict.modelPoisson',
  'poisson-goals': 'predict.modelPoissonGoals',
  elo: 'predict.modelElo',
  market: 'predict.modelMarket',
  ensemble: 'predict.ensemble',
};

type PKey = Exclude<keyof BacktestParams, 'from'>;
const SLIDERS: {
  k: PKey;
  label: string;
  min: number;
  max: number;
  step: number;
  fb: number;
  fmt: (v: number) => string;
}[] = [
  { k: 'shrinkEloScale', label: 'pShrink', min: 0, max: 300, step: 10, fb: 120, fmt: (v) => String(v) },
  { k: 'hfaElo', label: 'pHfaElo', min: 0, max: 120, step: 5, fb: 65, fmt: (v) => String(v) },
  { k: 'hfaMult', label: 'pHfaMult', min: 1, max: 1.25, step: 0.01, fb: 1.12, fmt: (v) => v.toFixed(2) },
  { k: 'goalShrink', label: 'pGoalShrink', min: 0.3, max: 1, step: 0.05, fb: 0.6, fmt: (v) => v.toFixed(2) },
  { k: 'dcRho', label: 'pDcRho', min: -0.25, max: 0, step: 0.01, fb: -0.14, fmt: (v) => v.toFixed(2) },
  { k: 'marketWeight', label: 'pMarketWeight', min: 0, max: 0.6, step: 0.05, fb: 0.4, fmt: (v) => v.toFixed(2) },
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** 防抖:拖动滑杆时合并多次更新,降低回测请求频率。 */
function useDebounce<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

/** favBias 着色:越接近 0 越好(绿);负得越多越欠自信(红)。 */
function biasCls(v: number): string {
  const a = Math.abs(v);
  if (a < 0.03) return 'text-green-600 dark:text-green-400';
  if (a < 0.08) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-xl bg-lightPrimary py-2 text-center dark:bg-navy-700">
      <div className="text-[10px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-bold tabular-nums text-navy-700 dark:text-white">
        {value}
      </div>
    </div>
  );
}

export default function BacktestPage() {
  const { t } = useLocale();
  const [key, setKey] = useState('epl-2025');
  const [params, setParams] = useState<BacktestParams>({ from: '2024-08-01' });
  const debounced = useDebounce(params, 400);
  const { result, isLoading, error } = useLeagueBacktest(key, debounced);

  // 切联赛:清空覆盖参数(回到该联赛默认),保留起始日期
  const switchLeague = (k: string) => {
    setKey(k);
    setParams((p) => ({ from: p.from }));
  };
  const reset = () => setParams((p) => ({ from: p.from }));

  // 滑杆值:用户覆盖 > 回测回显的该联赛默认 > 兜底
  const echoed: Record<PKey, number | undefined> = {
    shrinkEloScale: result?.tuning?.shrinkEloScale,
    hfaElo: result?.hfa?.elo,
    hfaMult: result?.hfa?.mult,
    goalShrink: result?.tuning?.goalShrink,
    dcRho: result?.tuning?.dcRho,
    marketWeight: result?.marketWeight,
  };
  const valOf = (s: (typeof SLIDERS)[number]) =>
    params[s.k] ?? echoed[s.k] ?? s.fb;

  const models = result
    ? Object.entries(result.perModel).sort((a, b) => a[1].brier - b[1].brier)
    : [];

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <PageHeading Icon={MdScience}>{t('backtest.title')}</PageHeading>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('backtest.subtitle')}
        </p>
        <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LEAGUES.map((l) => (
            <button
              key={l.key}
              onClick={() => switchLeague(l.key)}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition ${
                key === l.key
                  ? 'bg-brand-500 text-white'
                  : 'bg-white text-gray-600 dark:bg-navy-800 dark:text-gray-300'
              }`}
            >
              {l.name}
            </button>
          ))}
        </div>
      </header>

      {/* 参数控制 */}
      <Card extra="mb-3 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold text-navy-700 dark:text-white">
            {t('backtest.params')}
          </span>
          <button
            onClick={reset}
            className="flex items-center gap-0.5 text-[11px] text-brand-500 dark:text-brand-400"
          >
            <MdRestartAlt /> {t('backtest.reset')}
          </button>
        </div>
        <div className="space-y-3">
          {SLIDERS.map((s) => {
            const v = valOf(s);
            return (
              <div key={s.k}>
                <div className="mb-0.5 flex items-baseline justify-between text-[11px]">
                  <span className="text-gray-600 dark:text-gray-300">
                    {t(`backtest.${s.label}`)}
                  </span>
                  <span className="font-semibold tabular-nums text-navy-700 dark:text-white">
                    {s.fmt(v)}
                  </span>
                </div>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={v}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, [s.k]: Number(e.target.value) }))
                  }
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-brand-500 dark:bg-navy-700"
                />
              </div>
            );
          })}
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-600 dark:text-gray-300">
              {t('backtest.pFrom')}
            </span>
            <input
              type="date"
              value={params.from ?? ''}
              onChange={(e) =>
                setParams((p) => ({ ...p, from: e.target.value || undefined }))
              }
              className="rounded-lg bg-lightPrimary px-2 py-1 text-navy-700 dark:bg-navy-700 dark:text-white"
            />
          </div>
        </div>
        <div className="mt-2 text-[10px] text-gray-400">ⓘ {t('backtest.note')}</div>
      </Card>

      {/* 结果 */}
      {error ? (
        <div className="py-10 text-center text-sm text-gray-400">
          {t('backtest.empty')}
        </div>
      ) : !result ? (
        <div className="h-40 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
      ) : (
        <div className={`space-y-3 ${isLoading ? 'opacity-60' : ''}`}>
          <Card extra="p-4">
            <div className="mb-2 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
              <span>
                {t('backtest.ensemble')} · {t('backtest.sample')} {result.n}
                {result.skipped > 0 && (
                  <span className="text-gray-400">
                    {' '}
                    · {t('backtest.skipped')} {result.skipped}
                  </span>
                )}
              </span>
            </div>
            <div className="flex gap-2">
              <Stat label="Brier" value={result.ensemble.brier.toFixed(3)} />
              <Stat label="LogLoss" value={result.ensemble.logLoss.toFixed(3)} />
              <Stat
                label={t('backtest.hitRate')}
                value={pct(result.ensemble.hitRate)}
              />
            </div>
          </Card>

          {/* 逐模型 Brier / 命中 */}
          <Card extra="p-4">
            <div className="mb-1 text-xs font-bold text-navy-700 dark:text-white">
              {t('backtest.perModel')}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] text-gray-400">
                  <th className="py-1 text-left font-normal">
                    {t('backtest.model')}
                  </th>
                  <th className="px-1 text-right font-normal">Brier</th>
                  <th className="px-1 text-right font-normal">
                    {t('backtest.hitRate')}
                  </th>
                  <th className="px-1 text-right font-normal">n</th>
                </tr>
              </thead>
              <tbody>
                {models.map(([id, m], i) => (
                  <tr
                    key={id}
                    className="border-t border-gray-100 dark:border-white/5"
                  >
                    <td className="py-1 text-gray-600 dark:text-gray-300">
                      {t(MODEL_KEY[id] ?? 'predict.model')}
                      {i === 0 && (
                        <span className="ml-1 text-[9px] text-green-600 dark:text-green-400">
                          ●
                        </span>
                      )}
                    </td>
                    <td className="px-1 text-right tabular-nums font-semibold text-navy-700 dark:text-white">
                      {m.brier.toFixed(3)}
                    </td>
                    <td className="px-1 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {pct(m.hitRate)}
                    </td>
                    <td className="px-1 text-right tabular-nums text-gray-400">
                      {m.n}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* R1 favBias */}
          <Card extra="p-4">
            <div className="mb-0.5 text-xs font-bold text-navy-700 dark:text-white">
              {t('backtest.favBiasTitle')}
            </div>
            <div className="mb-1.5 text-[10px] text-gray-400">
              {t('backtest.favBiasHint')} ·{' '}
              {t('backtest.oddsCov')} {result.oddsCoverage.withOdds} ·{' '}
              {t('backtest.mismatch')} {result.oddsCoverage.mismatch}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] text-gray-400">
                  <th className="py-1 text-left font-normal">
                    {t('backtest.model')}
                  </th>
                  <th className="px-1 text-right font-normal">
                    {t('backtest.favBiasAll')}
                  </th>
                  <th className="px-1 text-right font-normal">
                    {t('backtest.favBiasMis')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.r1).map(([id, r]) => (
                  <tr
                    key={id}
                    className="border-t border-gray-100 dark:border-white/5"
                  >
                    <td className="py-1 text-gray-600 dark:text-gray-300">
                      {t(MODEL_KEY[id] ?? 'predict.model')}
                    </td>
                    <td
                      className={`px-1 text-right tabular-nums ${biasCls(
                        r.favBias,
                      )}`}
                    >
                      {r.favBias > 0 ? '+' : ''}
                      {r.favBias.toFixed(3)}
                    </td>
                    <td
                      className={`px-1 text-right tabular-nums ${biasCls(
                        r.favBiasMismatch,
                      )}`}
                    >
                      {r.favBiasMismatch > 0 ? '+' : ''}
                      {r.favBiasMismatch.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* 大球 / 平局 / 进球 */}
          <Card extra="p-4 space-y-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-navy-700 dark:text-white">
                {t('backtest.over25')}
              </span>
              <span className="tabular-nums text-gray-600 dark:text-gray-300">
                {t('backtest.pred')} {pct(result.over25.predOverRate)} ·{' '}
                {t('backtest.actual')} {pct(result.over25.actualOverRate)} ·{' '}
                {t('backtest.hitRate')} {pct(result.over25.hitRate)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-navy-700 dark:text-white">
                {t('backtest.drawTitle')}
              </span>
              <span className="tabular-nums text-gray-600 dark:text-gray-300">
                {t('backtest.actual')} {pct(result.draw.actualRate)} ·{' '}
                {t('backtest.picked')} {pct(result.draw.pickedRate)} ·{' '}
                {t('backtest.pred')} {pct(result.draw.meanPredicted)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-navy-700 dark:text-white">
                {t('backtest.goalsTitle')}
              </span>
              <span className="tabular-nums text-gray-600 dark:text-gray-300">
                {t('backtest.pred')} {result.goals.meanPred} ·{' '}
                {t('backtest.actual')} {result.goals.meanActual}
              </span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
