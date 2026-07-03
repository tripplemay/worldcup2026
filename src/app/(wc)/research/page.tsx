'use client';

import { MdScience, MdCheckCircle, MdCancel } from 'react-icons/md';
import Card from 'components/card';
import PageHeading from 'components/worldcup/PageHeading';
import { useResearch } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import { epochDiff, flattenParams } from 'research/dashboard';
import type { EpochResult } from 'research/search';

const fmt = (n: number | undefined, d = 4) =>
  n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(d);
const signed = (n: number, d = 4) => `${n >= 0 ? '+' : ''}${fmt(n, d)}`;

/** 三筛/闸门 ✓✗ 图标(与设计系统绿/红一致)。 */
function Screen({ ok }: { ok: boolean }) {
  return ok ? (
    <MdCheckCircle className="inline text-green-600 dark:text-green-400" />
  ) : (
    <MdCancel className="inline text-red-500 dark:text-red-400" />
  );
}

const TH = 'font-normal text-[11px] text-gray-400';
const numTd = 'text-right tabular-nums font-mono';

function TimelinePanel({
  epochs,
  t,
}: {
  epochs: EpochResult[];
  t: (k: string) => string;
}) {
  return (
    <Card extra="p-4">
      <h2 className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        {t('research.timeline')}
      </h2>
      <table className="w-full text-xs">
        <thead>
          <tr className={TH}>
            <th className="text-left">{t('research.colEpoch')}</th>
            <th className={numTd}>{t('research.colGrid')}</th>
            <th className={numTd}>{t('research.colTrials')}</th>
            <th className="text-left">{t('research.colWinner')}</th>
            <th className={numTd}>{t('research.colGap')}</th>
            <th className={numTd}>{t('research.colClvT')}</th>
            <th className={numTd}>PBO</th>
            <th className={numTd}>DSR</th>
            <th className="text-center">{t('research.screen')}</th>
          </tr>
        </thead>
        <tbody>
          {epochs.map((e, i) => {
            const isLast = i === epochs.length - 1;
            const rowCls = isLast
              ? 'text-navy-700 dark:text-white font-semibold'
              : 'text-gray-500 dark:text-gray-400';
            return (
              <tr
                key={e.epoch}
                className={`border-t border-gray-100 dark:border-white/5 ${rowCls}`}
              >
                <td className="py-1">{e.epoch}</td>
                <td className={numTd}>{e.gridSize}</td>
                <td className={numTd}>{e.cumulativeTrials}</td>
                <td className="text-left">{e.winner.label}</td>
                <td className={numTd}>{fmt(e.winner.oosGap)}</td>
                <td className={numTd}>{fmt(e.winner.oosClvT, 2)}</td>
                <td className={numTd}>{fmt(e.pbo, 3)}</td>
                <td className={numTd}>{fmt(e.dsr.dsr, 3)}</td>
                <td className="text-center">
                  <Screen ok={e.screen.overall} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function DiffPanel({
  prev,
  cur,
  t,
}: {
  prev: EpochResult;
  cur: EpochResult;
  t: (k: string) => string;
}) {
  const d = epochDiff(prev, cur);
  const changed = d.paramDeltas.filter((p) => p.changed);
  const accent = cur.screen.overall
    ? 'border-l-green-500 bg-green-50/60 dark:bg-green-500/10'
    : 'border-l-brand-400';
  return (
    <Card extra={`border-l-4 ${accent} p-4`}>
      <h2 className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        {t('research.diff')}(epoch {prev.epoch}→{cur.epoch})
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
            {t('research.paramDelta')}
          </div>
          {changed.length ? (
            changed.map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between gap-2 rounded bg-amber-50/60 px-1.5 py-0.5 text-xs dark:bg-amber-500/10"
              >
                <span className="text-gray-500 dark:text-gray-400">
                  {p.name}
                </span>
                <span className="font-mono tabular-nums text-navy-700 dark:text-white">
                  {fmt(p.prev)} → {fmt(p.cur)}
                </span>
              </div>
            ))
          ) : (
            <div className="text-xs text-gray-400">—</div>
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
            {t('research.metricDelta')}
          </div>
          {d.metricDeltas.map((m) => (
            <div
              key={m.name}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="text-gray-500 dark:text-gray-400">{m.name}</span>
              <span
                className={`font-mono tabular-nums font-semibold ${
                  m.delta === 0
                    ? 'text-gray-400'
                    : m.better
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-500 dark:text-red-400'
                }`}
              >
                {signed(m.delta)} {m.delta === 0 ? '' : m.better ? '↑' : '↓'}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 border-t border-gray-100 pt-2 text-xs dark:border-white/5">
        <span className="text-gray-500 dark:text-gray-400">
          {t('research.gateFlip')}:{' '}
        </span>
        {d.screenFlips.length ? (
          d.screenFlips.map((f) => (
            <span key={f.name} className="mr-2">
              {f.name} <Screen ok={f.from} />→<Screen ok={f.to} />
            </span>
          ))
        ) : (
          <span className="text-gray-400">{t('research.noFlip')}</span>
        )}
      </div>
    </Card>
  );
}

function LeaderboardPanel({
  e,
  t,
}: {
  e: EpochResult;
  t: (k: string) => string;
}) {
  const rows = [...e.configs].sort((a, b) => a.isGap - b.isGap);
  return (
    <Card extra="p-4">
      <h2 className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        {t('research.leaderboard')}
      </h2>
      <table className="w-full text-xs">
        <thead>
          <tr className={TH}>
            <th className="text-left">{t('research.colWinner')}</th>
            <th className={numTd}>{t('research.colIsGap')}</th>
            <th className={numTd}>{t('research.colGap')}</th>
            <th className={numTd}>{t('research.colRoi')}</th>
            <th className={numTd}>{t('research.colClvT')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const win = c.label === e.winner.label;
            return (
              <tr
                key={c.label}
                className={`border-t border-gray-100 dark:border-white/5 ${
                  win
                    ? 'bg-green-50/50 font-semibold text-navy-700 dark:bg-green-500/10 dark:text-white'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                <td className="py-1 text-left">
                  {win && (
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-400 align-middle" />
                  )}
                  {c.label}
                </td>
                <td className={numTd}>{fmt(c.isGap)}</td>
                <td className={numTd}>{fmt(c.oosGap)}</td>
                <td className={numTd}>{signed(c.oosValueRoi)}</td>
                <td className={numTd}>{fmt(c.oosClvT, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

export default function ResearchPage() {
  const { t } = useLocale();
  const { epochs, analysis, evolution, marginals, recentLog, gauntlet, isLoading } =
    useResearch();
  const last = epochs.length ? epochs[epochs.length - 1] : null;

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between gap-2 pr-24">
          <PageHeading Icon={MdScience}>{t('research.title')}</PageHeading>
          {last && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-gray-200/70 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-navy-700 dark:text-gray-300">
              {t('research.latest')} {last.winner.label}{' '}
              <Screen ok={last.screen.overall} />
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('research.subtitle')}
          {evolution && (
            <span
              className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                evolution.status === 'exploring'
                  ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400'
                  : evolution.status === 'exhausted'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                  : 'bg-gray-200 text-gray-600 dark:bg-navy-700 dark:text-gray-300'
              }`}
            >
              {t('research.gen')}
              {evolution.generation} · {t(`research.${evolution.status}`)}
              {evolution.insufficientPower
                ? ` · ${t('research.lowPower')}`
                : ''}
            </span>
          )}
        </p>
      </header>

      {isLoading && !epochs.length && (
        <div className="h-40 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
      )}

      {!isLoading && !epochs.length && (
        <div className="py-16 text-center text-sm text-gray-400">
          {t('research.empty')}
        </div>
      )}

      {epochs.length > 0 && last && (
        <div className="space-y-3">
          {analysis && (
            <Card extra="border-l-4 border-l-brand-400 p-4">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-navy-700 dark:text-white">
                <MdScience className="text-brand-500 dark:text-brand-400" />
                {t('research.analyst')}
              </div>
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                {analysis.text}
              </div>
              <div className="mt-1 text-right text-[10px] text-gray-400">
                {analysis.model}
              </div>
            </Card>
          )}
          <TimelinePanel epochs={epochs} t={t} />
          {epochs.length >= 2 ? (
            <DiffPanel prev={epochs[epochs.length - 2]} cur={last} t={t} />
          ) : (
            <Card extra="p-4">
              <div className="text-xs text-gray-400">
                {t('research.needTwo')}
              </div>
            </Card>
          )}
          <LeaderboardPanel e={last} t={t} />
          {(marginals.length > 0 || recentLog.length > 0 || gauntlet.length > 0) && (
            <Card extra="p-4">
              <h2 className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
                {t('research.deep')}
              </h2>
              {marginals.length > 0 && (
                <div className="mb-2">
                  <div className="mb-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                    {t('research.marginals')}
                  </div>
                  {marginals.map((m) => (
                    <div key={m.param} className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">{m.param}</span>
                      <span className="font-mono tabular-nums text-navy-700 dark:text-white">
                        {m.distinct} 档 · {m.bestValue ?? '—'}
                        {m.bestSharpe != null ? ` (${m.bestSharpe})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {recentLog.length > 0 && (
                <div className="mb-2 border-t border-gray-100 pt-2 dark:border-white/5">
                  <div className="mb-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                    {t('research.logRecent')}
                  </div>
                  {recentLog.map((l) => (
                    <div key={l.generation} className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        {t('research.gen')}
                        {l.generation} · {l.winnerLabel} · LLM×{l.llmAccepted}
                      </span>
                      <span className={l.improved ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>
                        {l.improved ? `↑ t=${l.pairedT}` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {gauntlet.length > 0 && (
                <div className="border-t border-gray-100 pt-2 dark:border-white/5">
                  <div className="mb-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                    {t('research.gauntletT')}
                  </div>
                  {gauntlet.map((g, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        {g.label}
                      </span>
                      <span className="font-mono">
                        {g.passedAll ? (
                          <Screen ok={true} />
                        ) : (
                          <span className="text-gray-400">→{g.blockedAt}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          <p className="px-1 text-[11px] leading-snug text-gray-400">
            {t('research.note')}
          </p>
        </div>
      )}
    </div>
  );
}
