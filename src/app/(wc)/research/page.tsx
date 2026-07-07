'use client';

import { useState } from 'react';
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
  const [selLeague, setSelLeague] = useState<string | undefined>(undefined);
  const {
    league,
    leagues,
    scoreboard: sb,
    epochs,
    analysis,
    evolution,
    marginals,
    recentLog,
    gauntlet,
    forward,
    isLoading,
  } = useResearch(selLeague);
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

      {leagues.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {leagues.map((l) => {
            const active = l.key === league;
            return (
              <button
                key={l.key}
                onClick={() => setSelLeague(l.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  active
                    ? 'bg-brand-500 text-white dark:bg-brand-400 dark:text-navy-900'
                    : 'bg-white text-gray-600 shadow-sm dark:bg-navy-800 dark:text-gray-300'
                }`}
              >
                {l.nameZh}
                {l.generation > 0 && (
                  <span
                    className={`ml-1 ${
                      active ? 'opacity-80' : 'text-gray-400'
                    }`}
                  >
                    {l.generation}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {epochs.length > 0 && last && (
        <div className="space-y-3">
          {sb && (
            <Card
              extra={`border-l-4 p-4 ${
                sb.passedAll
                  ? 'border-l-green-500 bg-green-50/60 dark:bg-green-500/10'
                  : 'border-l-amber-400 bg-amber-50/40 dark:bg-amber-500/10'
              }`}
            >
              {/* 人话结论:现在能不能下注 */}
              <div className="text-sm font-bold text-navy-700 dark:text-white">
                {sb.passedAll
                  ? t('research.sbBetVerdictPass')
                  : sb.incumbentLabel
                  ? `${t('research.sbBetVerdictBlocked')} —— ${t(
                      'research.sbBlockedAtPre',
                    )} ${sb.blockedAt ?? '—'}·${t(
                      `research.gateNames.${sb.blockedAt}`,
                    )}`
                  : t('research.sbBetVerdictNone')}
              </div>
              {/* 关卡进度点 */}
              {sb.gates.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {sb.gates.map((g) => (
                    <span
                      key={g.id}
                      className="flex items-center gap-0.5 text-[10px]"
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          g.status === 'pass'
                            ? 'bg-green-500'
                            : g.status === 'fail'
                            ? 'bg-red-400'
                            : 'bg-gray-300 dark:bg-navy-600'
                        }`}
                      />
                      <span className="text-gray-500 dark:text-gray-400">
                        {t(`research.gateNames.${g.id}`)}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {/* 三块人话数字:预测 / 下注 / 收益 */}
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2 text-center dark:border-white/5">
                <div>
                  <div className="text-[10px] text-gray-400">
                    {t('research.sbPredict')}
                  </div>
                  {sb.accuracy ? (
                    <>
                      <div className="font-mono text-lg font-extrabold text-navy-700 dark:text-white">
                        {(sb.accuracy.oursHit * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {t('research.sbVsMarket')}{' '}
                        {(sb.accuracy.marketHit * 100).toFixed(1)}%
                      </div>
                    </>
                  ) : (
                    <div className="text-lg text-gray-400">—</div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] text-gray-400">
                    {t('research.sbBets')}
                  </div>
                  {sb.betting ? (
                    <>
                      <div className="font-mono text-lg font-extrabold text-navy-700 dark:text-white">
                        {sb.betting.n}
                        <span className="ml-0.5 text-[10px] font-normal text-gray-400">
                          {t('research.sbBetsUnit')}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {t('research.sbWinRate')}{' '}
                        {(sb.betting.winRate * 100).toFixed(0)}% ·{' '}
                        <span
                          className={
                            sb.betting.roi > 0
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-500 dark:text-red-400'
                          }
                        >
                          ROI {signed(sb.betting.roi * 100, 1)}%
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-lg text-gray-400">—</div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] text-gray-400">
                    {t('research.sbMoney')}
                  </div>
                  {sb.money ? (
                    <>
                      <div
                        className={`font-mono text-lg font-extrabold ${
                          sb.money.end >= sb.money.start
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-500 dark:text-red-400'
                        }`}
                      >
                        {Math.round(sb.money.end).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {t('research.sbMoneyStart')}{' '}
                        {Math.round(sb.money.start).toLocaleString()}{' '}
                        {t('research.sbMoneyArrow')}
                      </div>
                    </>
                  ) : (
                    <div className="text-lg text-gray-400">—</div>
                  )}
                </div>
              </div>
              {/* 轴C:双场景预测精度(诚实标注:有盘以市场为准) */}
              {sb.axisC && (
                <div className="mt-2 border-t border-gray-100 pt-1.5 text-[10px] text-gray-500 dark:border-white/5 dark:text-gray-400">
                  <span className="font-bold text-navy-700 dark:text-white">
                    {t('research.sbAxisC')}
                  </span>{' '}
                  {t('research.sbAxisCBlend')}{' '}
                  {(sb.axisC.blendHit * 100).toFixed(1)}% ·{' '}
                  {t('research.sbAxisCClose')}{' '}
                  {(sb.axisC.closeHit * 100).toFixed(1)}%
                  {sb.axisC.eceBlend != null && (
                    <>
                      {' '}
                      · {t('research.sbAxisCEce')}{' '}
                      {sb.axisC.eceBlend.toFixed(3)}
                    </>
                  )}
                  <div className="mt-0.5 text-gray-400">
                    {t('research.sbAxisCHonest')}
                  </div>
                </div>
              )}
              {/* 前向 + 统计窗脚注 */}
              <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-1.5 text-[10px] text-gray-400 dark:border-white/5">
                <span>
                  {t('research.sbForward')}:{' '}
                  {sb.forward && sb.forward.n > 0
                    ? `${sb.forward.n} ${t('research.sbBetsUnit')} · ${signed(
                        sb.forward.pnl,
                        0,
                      )}`
                    : t('research.sbForwardWait')}
                </span>
                {sb.window && (
                  <span>
                    {t('research.sbWindow')} {sb.window.from}~{sb.window.to}
                  </span>
                )}
              </div>
            </Card>
          )}
          {/* 逐场对照(样本外):我们(融合) vs 市场 vs 实际赛果;分歧场高亮 */}
          {sb?.axisC && (
            <Card extra="p-4">
              <div className="mb-0.5 text-sm font-bold text-navy-700 dark:text-white">
                {t('research.mlTitle')}
              </div>
              <div className="mb-2 text-[10px] text-gray-400">
                {t('research.mlSub')}
                {sb.axisCLog && sb.axisCLog.length > 0 && (
                  <>
                    {' '}
                    ·{' '}
                    {t('research.mlMore').replace(
                      '{n}',
                      String(sb.axisCLog.length),
                    )}
                  </>
                )}
              </div>
              {sb.axisCLog && sb.axisCLog.length > 0 ? (
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-white text-left text-[10px] text-gray-400 dark:bg-navy-800">
                      <tr>
                        <th className="py-1 pr-2 font-normal">{t('research.mlDate')}</th>
                        <th className="py-1 pr-2 font-normal">
                          {t('research.mlMatch')}
                        </th>
                        <th className="py-1 pr-2 font-normal">
                          {t('research.mlOurs')}
                        </th>
                        <th className="py-1 font-normal">
                          {t('research.mlMarket')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sb.axisCLog.map((r, i) => {
                        const pickTxt = (
                          pick: 'H' | 'D' | 'A',
                          p: { home: number; draw: number; away: number },
                        ) =>
                          `${
                            pick === 'H' ? '主' : pick === 'A' ? '客' : '平'
                          } ${(
                            (pick === 'H'
                              ? p.home
                              : pick === 'A'
                              ? p.away
                              : p.draw) * 100
                          ).toFixed(0)}%`;
                        const disagree = r.blendPick !== r.marketPick;
                        return (
                          <tr
                            key={`${r.date}-${r.home}-${i}`}
                            className={`border-t border-gray-50 dark:border-white/5 ${
                              disagree
                                ? 'bg-amber-50/60 dark:bg-amber-500/10'
                                : ''
                            }`}
                          >
                            <td className="py-1 pr-2 font-mono text-[10px] text-gray-400">
                              {r.date.slice(5)}
                            </td>
                            <td className="py-1 pr-2 text-gray-600 dark:text-gray-300">
                              <span className="capitalize">{r.home}</span>
                              <span className="mx-0.5 font-mono font-bold text-navy-700 dark:text-white">
                                {r.score}
                              </span>
                              <span className="capitalize">{r.away}</span>
                            </td>
                            <td
                              className={`py-1 pr-2 font-mono ${
                                r.blendHit
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-500 dark:text-red-400'
                              }`}
                            >
                              {pickTxt(r.blendPick, r.blend)}{' '}
                              {r.blendHit ? '✓' : '✗'}
                            </td>
                            <td
                              className={`py-1 font-mono ${
                                r.marketHit
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-500 dark:text-red-400'
                              }`}
                            >
                              {pickTxt(r.marketPick, r.market)}{' '}
                              {r.marketHit ? '✓' : '✗'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-gray-400">
                  {t('research.mlEmpty')}
                </div>
              )}
            </Card>
          )}
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
          {forward.length > 0 && (
            <Card extra="p-4">
              <h2 className="mb-1 text-sm font-bold text-navy-700 dark:text-white">
                {t('research.forwardT')}
              </h2>
              <p className="mb-2 text-[10px] leading-snug text-gray-400">
                {t('research.forwardHint')}
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className={TH}>
                    <th className="text-left">{t('research.colWinner')}</th>
                    <th className={numTd}>{t('research.fwdSince')}</th>
                    <th className={numTd}>{t('research.fwdBets')}</th>
                    <th className={numTd}>{t('research.fwdRoi')}</th>
                    <th className={numTd}>{t('research.fwdPnl')}</th>
                    <th className={numTd}>{t('research.colClvT')}</th>
                    <th className="text-center">{t('research.fwdG7')}</th>
                  </tr>
                </thead>
                <tbody>
                  {forward.map((f) => {
                    const g7ok = f.n >= 150 && f.clvT > 2;
                    return (
                      <tr
                        key={f.configHash}
                        className="border-t border-gray-100 text-gray-600 dark:border-white/5 dark:text-gray-300"
                      >
                        <td className="py-1 text-left">{f.label}</td>
                        <td className={numTd}>{f.since}</td>
                        <td className={numTd}>{f.n}</td>
                        <td
                          className={`${numTd} font-semibold ${
                            f.n === 0
                              ? 'text-gray-400'
                              : f.roi > 0
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-500 dark:text-red-400'
                          }`}
                        >
                          {f.n ? signed(f.roi) : '—'}
                        </td>
                        <td className={numTd}>
                          {f.n ? signed(f.pnl, 0) : '—'}
                        </td>
                        <td className={numTd}>
                          {f.clvN > 1 ? fmt(f.clvT, 2) : '—'}
                        </td>
                        <td className="text-center">
                          {g7ok ? (
                            <Screen ok={true} />
                          ) : (
                            <span className="font-mono text-[10px] text-gray-400">
                              {f.n}/150
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {forward.every((f) => f.n === 0) && (
                <div className="mt-2 text-center text-[11px] text-gray-400">
                  {t('research.fwdNoBets')}
                </div>
              )}
            </Card>
          )}
          {(marginals.length > 0 ||
            recentLog.length > 0 ||
            gauntlet.length > 0) && (
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
                    <div
                      key={m.param}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-gray-500 dark:text-gray-400">
                        {m.param}
                      </span>
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
                    <div
                      key={l.generation}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-gray-500 dark:text-gray-400">
                        {t('research.gen')}
                        {l.generation} · {l.winnerLabel} · LLM×{l.llmAccepted}
                      </span>
                      <span
                        className={
                          l.improved
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-gray-400'
                        }
                      >
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
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs"
                    >
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
