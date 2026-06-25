'use client';

import { useState } from 'react';
import { useLocale, useTn } from 'lib/i18n/context';
import {
  formatPct,
  pctWidth,
  DEPTH_STAGES,
  KO_ROUND_LABEL_KEY,
  roadSteps,
} from 'lib/scenario/display';
import type { Outcome, StageProbs, TeamOutlook } from 'lib/scenario/types';

/** 名次分布四段(头名/次名/第三/第四)的取值与配色。 */
const RANKS: {
  key: string;
  pick: (r: TeamOutlook['rankProbs']) => number;
  bar: string;
}[] = [
  { key: 'scenarios.rank1', pick: (r) => r.p1, bar: 'bg-brand-500' },
  { key: 'scenarios.rank2', pick: (r) => r.p2, bar: 'bg-sky-400' },
  { key: 'scenarios.rank3', pick: (r) => r.p3, bar: 'bg-amber-400' },
  {
    key: 'scenarios.rank4',
    pick: (r) => r.p4,
    bar: 'bg-gray-300 dark:bg-navy-600',
  },
];

/** 深度阶梯进度条配色:总体=brand,条件视角随胜/平/负着色。 */
const VIEW_BAR: Record<'overall' | Outcome, string> = {
  overall: 'bg-brand-500',
  W: 'bg-emerald-500',
  D: 'bg-gray-400 dark:bg-navy-400',
  L: 'bg-rose-500',
};
const OUTCOME_BG: Record<Outcome, string> = {
  W: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  D: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  L: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

/** 晋级深度阶梯:6 档累积概率,逐行 标签 + 进度条 + 百分比(漏斗形)。 */
function DepthLadder({ probs, bar }: { probs: StageProbs; bar: string }) {
  const { t } = useLocale();
  return (
    <div className="space-y-1">
      {DEPTH_STAGES.map((d) => {
        const v = d.pick(probs);
        return (
          <div key={d.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-10 shrink-0 text-gray-500 dark:text-gray-400">
              {t(d.key)}
            </span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-navy-700">
              <span
                className={`block h-full rounded-full ${bar}`}
                style={{ width: pctWidth(v) }}
              />
            </div>
            <span className="w-9 shrink-0 text-right tabular-nums text-gray-600 dark:text-gray-300">
              {formatPct(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 球队下钻面板:把引擎已算、原本被压扁的信号展开 ——
 * 组内名次分布(rankProbs)+ 可切换视角的 6 阶段晋级深度(总体 ↔ 第三轮若赢/平/输)
 * + 该条件下的出现概率与最可能 R32 对手。全部基于已有 payload,无后端依赖。
 */
export default function ScenarioTeamDetail({
  outlook,
}: {
  outlook: TeamOutlook;
}) {
  const { t } = useLocale();
  const tn = useTn();
  const [view, setView] = useState<'overall' | Outcome>('overall');

  const rp = outlook.rankProbs ?? { p1: 0, p2: 0, p3: 0, p4: 0 };
  const buckets = outlook.played3 ? [] : outlook.byResult ?? [];
  const activeBucket =
    view === 'overall' ? undefined : buckets.find((b) => b.outcome === view);
  const active: StageProbs = activeBucket?.probs ?? outlook.overall;
  const oc = (o: Outcome) =>
    t(`scenarios.${o === 'W' ? 'win' : o === 'D' ? 'draw' : 'lose'}`);

  // 上下文行:条件视角看「该结果出现概率 + 该结果下最可能对手」;总体看整体最可能对手
  const opp = activeBucket?.topOpponent ?? outlook.topOpponent;

  // 最可能路线 chips:R32→R16→QF→SF→F 逐轮独立众数对手(仅在有 path 时显示)
  const pathChips = outlook.path?.length
    ? roadSteps(outlook).map((s) => ({
        key: s.round,
        round: t(KO_ROUND_LABEL_KEY[s.round]),
        norm: s.norm,
        prob: s.prob,
      }))
    : [];

  const st = outlook.standing;

  return (
    <div className="mt-2 space-y-3 rounded-xl bg-gray-50 p-3 dark:bg-navy-900/60">
      {/* 当前真实形势(现状) */}
      {st && (
        <div className="rounded-lg bg-white/70 px-2 py-1.5 text-[10px] dark:bg-navy-800/60">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-navy-700 dark:text-white">
              {t('scenarios.grpPre')}
              {outlook.group}
              {t('scenarios.grpPost')} #{st.rank}
            </span>
            <span>
              {st.win}
              {t('scenarios.win')} {st.draw}
              {t('scenarios.draw')} {st.loss}
              {t('scenarios.lose')}
            </span>
            <span>
              {t('scenarios.standGoals')} {st.gf}-{st.ga}
            </span>
            <span>
              {st.points}
              {t('scenarios.standPts')}
            </span>
          </div>
          {st.remainingOpps && st.remainingOpps.length > 0 && (
            <div className="mt-0.5 text-gray-400">
              {t('scenarios.standRemain')}{' '}
              {st.remainingOpps.map((o) => tn(o.norm)).join(' / ')}
            </div>
          )}
        </div>
      )}

      {/* 组内名次分布 */}
      <div>
        <div className="mb-1 text-[10px] font-medium text-gray-400">
          {t('scenarios.rankTitle')}
        </div>
        <div className="flex h-2 overflow-hidden rounded-full">
          {RANKS.map((r) => {
            const v = r.pick(rp);
            return v > 0 ? (
              <span
                key={r.key}
                className={r.bar}
                style={{ width: pctWidth(v) }}
              />
            ) : null;
          })}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
          {RANKS.map((r) => (
            <span key={r.key} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 shrink-0 rounded-full ${r.bar}`} />
              {t(r.key)} {formatPct(r.pick(rp))}
            </span>
          ))}
        </div>
      </div>

      {/* 晋级深度(可切换视角) */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-gray-400">
            {t('scenarios.depthTitle')}
          </span>
          {buckets.length > 0 && (
            <div className="inline-flex rounded-full bg-gray-100 p-0.5 text-[10px] dark:bg-navy-800">
              {(['overall', ...buckets.map((b) => b.outcome)] as const).map(
                (v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded-full px-2 py-0.5 transition-colors ${
                      view === v
                        ? 'bg-white font-semibold text-brand-500 shadow-sm dark:bg-navy-600 dark:text-brand-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {v === 'overall' ? t('scenarios.overallView') : oc(v)}
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        {/* 条件视角:该结果的出现概率 */}
        {activeBucket && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px]">
            <span
              className={`rounded px-1 font-semibold ${
                OUTCOME_BG[activeBucket.outcome]
              }`}
            >
              {oc(activeBucket.outcome)}
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              {t('scenarios.ifTitle')} · {t('scenarios.happens')}{' '}
              {formatPct(activeBucket.prob)}
            </span>
          </div>
        )}

        <DepthLadder probs={active} bar={VIEW_BAR[view]} />

        {/* 最可能 R32 对手 */}
        {opp && (
          <div className="mt-1.5 text-[10px] text-gray-400">
            {t('scenarios.opponent')}:{' '}
            <span className="text-gray-600 dark:text-gray-300">
              {tn(opp.norm)}
            </span>{' '}
            <span className="tabular-nums">{formatPct(opp.prob)}</span>
          </div>
        )}
      </div>

      {/* 最可能路线(R32→R16→QF;逐轮独立众数,非真实单链) */}
      {outlook.path && outlook.path.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-gray-400">
            <span>{t('scenarios.pathTitle')}</span>
            <span
              title={t('scenarios.pathIndepNote')}
              className="cursor-help text-gray-300 dark:text-navy-500"
            >
              ⓘ
            </span>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {pathChips.map((c, idx) => (
              <div key={c.key} className="flex items-center gap-1">
                {idx > 0 && (
                  <span className="shrink-0 text-gray-300 dark:text-navy-500">
                    ›
                  </span>
                )}
                <div className="flex w-[3.6rem] shrink-0 flex-col items-center gap-0.5 rounded-lg bg-gray-50 px-1 py-1 dark:bg-navy-900/60">
                  <span className="text-[8px] text-gray-400">{c.round}</span>
                  <span
                    className="w-full truncate text-center text-[10px] text-navy-700 dark:text-white"
                    title={tn(c.norm)}
                  >
                    {tn(c.norm)}
                  </span>
                  <span className="text-[8px] tabular-nums text-gray-400">
                    {formatPct(c.prob)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-0.5 text-[9px] leading-snug text-gray-400">
            {t('scenarios.pathIndepNote')}
          </div>
        </div>
      )}
    </div>
  );
}
