'use client';

import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useLocale, useTn } from 'lib/i18n/context';
import { formatPct, KO_ROUND_LABEL_KEY, roadSteps } from 'lib/scenario/display';
import type { TeamOutlook } from 'lib/scenario/types';

const TOP_N = 6;

/**
 * 夺冠形势:按夺冠概率取前 N 队,大号数字 = 球队夺冠概率;下方给出其 R32→决赛
 * 各轮**最可能对手**(逐轮独立众数,每腿都有有意义的概率),取代了原先无意义的「整条自洽路线 ~0.2%」。
 */
export default function ScenarioChampionPaths({
  teams,
}: {
  teams: TeamOutlook[];
}) {
  const { t } = useLocale();
  const tn = useTn();
  const top = [...teams]
    .filter((x) => x.overall.champion > 0)
    .sort((a, b) => b.overall.champion - a.overall.champion)
    .slice(0, TOP_N);
  if (!top.length) return null;

  return (
    <div className="space-y-2.5">
      <p className="text-[10px] leading-relaxed text-gray-400">
        {t('scenarios.pathCoveredPre')}
      </p>
      {top.map((tm) => {
        const road = roadSteps(tm);
        return (
          <Card key={tm.norm} extra="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <TeamBadge
                name={tm.name}
                logo={tm.logo}
                className="min-w-0 text-sm font-semibold text-navy-700 dark:text-white"
              />
              {/* 大号数字 = 球队夺冠概率(有意义的标尺) */}
              <span className="shrink-0 text-base font-bold tabular-nums text-brand-500 dark:text-brand-400">
                {formatPct(tm.overall.champion)}
              </span>
            </div>
            {road.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {road.map((s, idx) => (
                  <div key={s.round} className="flex items-center gap-1">
                    {idx > 0 && (
                      <span className="shrink-0 text-gray-300 dark:text-navy-500">
                        ›
                      </span>
                    )}
                    <div className="flex w-[3.8rem] shrink-0 flex-col items-center gap-0.5 rounded-lg bg-gray-50 px-1 py-1 dark:bg-navy-900/60">
                      <span className="text-[8px] text-gray-400">
                        {t(KO_ROUND_LABEL_KEY[s.round])}
                      </span>
                      <span
                        className="w-full truncate text-center text-[10px] text-navy-700 dark:text-white"
                        title={tn(s.norm)}
                      >
                        {tn(s.norm)}
                      </span>
                      <span className="text-[8px] tabular-nums text-gray-400">
                        {formatPct(s.prob)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
      <p className="text-[9px] leading-snug text-gray-400">
        ⓘ {t('scenarios.pathIndepNote')}
      </p>
    </div>
  );
}
