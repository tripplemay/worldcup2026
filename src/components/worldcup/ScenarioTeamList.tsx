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
import type { Outcome, TeamOutlook, TeamStanding } from 'lib/scenario/types';

const TOP_N = 12;
type SortMode = 'depth' | 'rank';

const OUTCOME_BG: Record<Outcome, string> = {
  W: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  D: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  L: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

/**
 * 全部球队晋级前景列表。
 * - 折叠行 line1:队名 + 最期望 chip + expStage「预期走多远」标尺;line2:当前真实形势(排名/积分/净胜/剩余)。
 * - 排序切换:预测深度(默认,按 expStage 降序)/ 当前排名(按小组聚合 + 组表头,读作实时小组表)。
 * - 点击行手风琴展开下钻面板。
 */
export default function ScenarioTeamList({ teams }: { teams: TeamOutlook[] }) {
  const { t } = useLocale();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('depth');
  const oc = (o: Outcome) =>
    t(`scenarios.${o === 'W' ? 'win' : o === 'D' ? 'draw' : 'lose'}`);

  // 当前形势一行文案(无组前缀,组别由 line1 chip / 组表头承载)
  const standingLine = (s: TeamStanding): string => {
    const gd = s.gd > 0 ? `+${s.gd}` : `${s.gd}`;
    return [
      `#${s.rank}`,
      `${s.points}${t('scenarios.standPts')}`,
      `${t('scenarios.standGd')}${gd}`,
      `${t('scenarios.standLeftPre')}${s.remaining}${t(
        'scenarios.standLeftPost',
      )}`,
    ].join(' · ');
  };

  const ordered =
    sortMode === 'rank'
      ? [...teams].sort(
          (a, b) =>
            a.group.localeCompare(b.group) ||
            (a.standing?.rank ?? 9) - (b.standing?.rank ?? 9) ||
            a.norm.localeCompare(b.norm),
        )
      : teams;
  // 当前排名模式展示全部(读作完整小组表);预测深度模式保留前 12 可展开
  const shown = sortMode === 'rank' || all ? ordered : ordered.slice(0, TOP_N);

  const SORTS: { m: SortMode; label: string }[] = [
    { m: 'depth', label: t('scenarios.sortDepth') },
    { m: 'rank', label: t('scenarios.sortRank') },
  ];

  return (
    <Card extra="p-3">
      {/* 排序切换 */}
      <div className="mb-2 inline-flex rounded-full bg-gray-100 p-0.5 text-[11px] dark:bg-navy-800">
        {SORTS.map((s) => (
          <button
            key={s.m}
            onClick={() => {
              setSortMode(s.m);
              setAll(false);
            }}
            className={`rounded-full px-3 py-1 transition-colors ${
              sortMode === s.m
                ? 'bg-white font-semibold text-brand-500 shadow-sm dark:bg-navy-600 dark:text-brand-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

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
          const lead = sortMode === 'rank' ? tm.standing?.rank ?? i + 1 : i + 1;
          const showHeader =
            sortMode === 'rank' && (i === 0 || shown[i - 1].group !== tm.group);
          return (
            <li key={tm.norm} className="py-1">
              {showHeader && (
                <div className="-mx-1 mb-0.5 mt-1 px-1 text-[10px] font-bold text-gray-400">
                  {t('scenarios.grpPre')}
                  {tm.group}
                  {t('scenarios.grpPost')}
                </div>
              )}
              <button
                onClick={() => setOpen(isOpen ? null : tm.norm)}
                aria-expanded={isOpen}
                aria-controls={`scn-detail-${tm.norm}`}
                className="flex w-full items-start gap-2 py-1.5 text-left active:opacity-70"
              >
                <span className="mt-0.5 w-4 shrink-0 text-center text-[11px] tabular-nums text-gray-400">
                  {lead}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <TeamBadge
                      name={tm.name}
                      logo={tm.logo}
                      className="min-w-0 text-sm text-navy-700 dark:text-white"
                    />
                    {sortMode === 'depth' && (
                      <span className="shrink-0 text-[10px] text-gray-400">
                        {tm.group}
                      </span>
                    )}
                    {desired && (
                      <span
                        className={`shrink-0 rounded px-1 text-[9px] font-semibold ${OUTCOME_BG[desired]}`}
                      >
                        {oc(desired)}
                      </span>
                    )}
                  </span>
                  {tm.standing && (
                    <span className="text-[10px] tabular-nums text-gray-400">
                      {standingLine(tm.standing)}
                    </span>
                  )}
                </span>
                {/* 预期走多远标尺 */}
                <span className="mt-0.5 flex w-[4.25rem] shrink-0 flex-col items-end gap-0.5">
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
                  className={`mt-0.5 shrink-0 text-gray-400 transition-transform ${
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
      {sortMode === 'depth' && teams.length > TOP_N && (
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
