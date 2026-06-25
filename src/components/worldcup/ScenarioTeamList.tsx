'use client';

import { useState } from 'react';
import { MdExpandMore } from 'react-icons/md';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import ScenarioTeamDetail from 'components/worldcup/ScenarioTeamDetail';
import { useLocale } from 'lib/i18n/context';
import {
  DISPLAY_LENS,
  STAGE_LABEL_KEY,
  expStageProgress,
  expStageStage,
} from 'lib/scenario/display';
import { isMeaningful } from 'lib/scenario/types';
import type { Outcome, TeamOutlook } from 'lib/scenario/types';

const TOP_N = 12;

const OUTCOME_BG: Record<Outcome, string> = {
  W: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  D: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  L: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

/**
 * 全部球队晋级前景列表(按期望深度降序;默认前 12,可展开全部)。
 * 折叠行用 expStage「预期走多远」标尺取代旧的全 0% 概率列;点击行手风琴展开下钻面板。
 */
export default function ScenarioTeamList({ teams }: { teams: TeamOutlook[] }) {
  const { t } = useLocale();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const oc = (o: Outcome) =>
    t(`scenarios.${o === 'W' ? 'win' : o === 'D' ? 'draw' : 'lose'}`);
  const shown = all ? teams : teams.slice(0, TOP_N);

  return (
    <Card extra="p-3">
      <ul className="divide-y divide-gray-100 dark:divide-white/5">
        {shown.map((tm, i) => {
          const isOpen = open === tm.norm;
          const desired =
            !tm.played3 && isMeaningful(tm.byResult, DISPLAY_LENS)
              ? tm.desired
              : undefined;
          const projLabel = t(
            STAGE_LABEL_KEY[expStageStage(tm.overall.expStage)],
          );
          return (
            <li key={tm.norm} className="py-1">
              <button
                onClick={() => setOpen(isOpen ? null : tm.norm)}
                aria-expanded={isOpen}
                aria-controls={`scn-detail-${tm.norm}`}
                className="flex w-full items-center gap-2 py-2 text-left active:opacity-70"
              >
                <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-gray-400">
                  {i + 1}
                </span>
                <TeamBadge
                  name={tm.name}
                  logo={tm.logo}
                  className="min-w-0 flex-1 text-sm text-navy-700 dark:text-white"
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
                {/* 预期走多远标尺(expStage 连续标量 → 进度 + 阶段标签) */}
                <span className="flex w-[4.25rem] shrink-0 flex-col items-end gap-0.5">
                  <span className="h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-navy-700">
                    <span
                      className="block h-full rounded-full bg-brand-500"
                      style={{
                        width: `${
                          expStageProgress(tm.overall.expStage) * 100
                        }%`,
                      }}
                    />
                  </span>
                  <span className="whitespace-nowrap text-[9px] text-gray-400">
                    {t('scenarios.proj')} {projLabel}
                  </span>
                </span>
                <MdExpandMore
                  className={`shrink-0 text-gray-400 transition-transform ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isOpen && (
                <div id={`scn-detail-${tm.norm}`}>
                  <ScenarioTeamDetail outlook={tm} />
                </div>
              )}
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
