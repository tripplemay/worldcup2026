'use client';

import { useState } from 'react';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useLocale } from 'lib/i18n/context';
import { desiredByMetric, isMeaningful } from 'lib/scenario/types';
import type { Outcome, Stage, TeamOutlook } from 'lib/scenario/types';

const pct = (p: number) => `${Math.round(p * 100)}%`;
const TOP_N = 12;

const OUTCOME_BG: Record<Outcome, string> = {
  W: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  D: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  L: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

/**
 * 全部球队晋级前景列表(按期望深度降序;默认前 12,可展开全部)。
 * 三列(出线/进8强/夺冠)为固定参照;「最期望」chip 随所选口径(metricStage)变化。
 */
export default function ScenarioTeamList({
  teams,
  metricStage,
}: {
  teams: TeamOutlook[];
  metricStage: Stage;
}) {
  const { t } = useLocale();
  const [all, setAll] = useState(false);
  const oc = (o: Outcome) =>
    t(`scenarios.${o === 'W' ? 'win' : o === 'D' ? 'draw' : 'lose'}`);
  const shown = all ? teams : teams.slice(0, TOP_N);

  return (
    <Card extra="p-3">
      <div className="mb-2 grid grid-cols-[1.2rem_1fr_3rem_3rem_3rem] items-center gap-2 text-[10px] font-medium text-gray-400">
        <span />
        <span />
        <span className="text-right">{t('scenarios.advance')}</span>
        <span className="text-right">
          {t('scenarios.reach')}
          {t('scenarios.stQF')}
        </span>
        <span className="text-right">{t('scenarios.champion')}</span>
      </div>
      <ul className="space-y-1.5">
        {shown.map((tm, i) => {
          const desired =
            !tm.played3 && isMeaningful(tm.byResult, metricStage)
              ? desiredByMetric(tm.byResult, metricStage)
              : undefined;
          return (
            <li
              key={tm.norm}
              className="grid grid-cols-[1.2rem_1fr_3rem_3rem_3rem] items-center gap-2"
            >
              <span className="text-[11px] tabular-nums text-gray-400">
                {i + 1}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <TeamBadge
                  name={tm.name}
                  logo={tm.logo}
                  className="min-w-0 text-sm text-navy-700 dark:text-white"
                />
                <span className="shrink-0 text-[10px] text-gray-400">
                  {tm.group}
                </span>
                {desired && (
                  <span
                    className={`shrink-0 rounded px-1 text-[9px] font-semibold ${OUTCOME_BG[desired]}`}
                  >
                    {oc(desired)}
                  </span>
                )}
              </span>
              <span className="text-right text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
                {pct(tm.overall.advance)}
              </span>
              <span className="text-right text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
                {pct(tm.overall.qf)}
              </span>
              <span className="text-right text-[11px] font-semibold tabular-nums text-brand-500 dark:text-brand-400">
                {pct(tm.overall.champion)}
              </span>
            </li>
          );
        })}
      </ul>
      {teams.length > TOP_N && (
        <button
          onClick={() => setAll((v) => !v)}
          className="mt-2 w-full rounded-lg py-1.5 text-[11px] text-brand-500 active:opacity-70 dark:text-brand-400"
        >
          {all
            ? t('scenarios.collapse')
            : `${t('scenarios.showAll')} (${teams.length})`}
        </button>
      )}
    </Card>
  );
}
