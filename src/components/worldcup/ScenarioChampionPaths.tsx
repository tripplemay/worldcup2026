'use client';

import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useLocale, useTn } from 'lib/i18n/context';
import { formatPct, KO_ROUND_LABEL_KEY } from 'lib/scenario/display';
import type { ChampionPath } from 'lib/scenario/types';

/**
 * 最可能夺冠路径:按夺冠概率前 N 队,各展示其最常见的一条**自洽**夺冠路线
 * (同一次模拟里从 R32 连胜到决赛的真实对手序列,边与边自洽,区别于下钻里的逐轮独立众数)。
 */
export default function ScenarioChampionPaths({
  paths,
  covered,
}: {
  paths: ChampionPath[];
  covered: number;
}) {
  const { t } = useLocale();
  const tn = useTn();
  if (!paths.length) return null;

  return (
    <div className="space-y-2.5">
      <p className="text-[10px] leading-relaxed text-gray-400">
        {t('scenarios.pathCoveredPre')} {formatPct(covered)}
      </p>
      {paths.map((p) => (
        <Card key={p.champion} extra="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <TeamBadge
              name={p.name}
              logo={p.logo}
              className="min-w-0 text-sm font-semibold text-navy-700 dark:text-white"
            />
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                {t('scenarios.pathReal')}
              </span>
              <span className="text-sm font-bold tabular-nums text-brand-500 dark:text-brand-400">
                {formatPct(p.prob)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {p.legs.map((leg, idx) => (
              <div key={leg.matchNo} className="flex items-center gap-1">
                {idx > 0 && (
                  <span className="shrink-0 text-gray-300 dark:text-navy-500">
                    ›
                  </span>
                )}
                <div className="flex w-[3.6rem] shrink-0 flex-col items-center gap-0.5 rounded-lg bg-gray-50 px-1 py-1 dark:bg-navy-900/60">
                  <span className="text-[8px] text-gray-400">
                    {t(KO_ROUND_LABEL_KEY[leg.round])}
                  </span>
                  <span
                    className="w-full truncate text-center text-[10px] text-navy-700 dark:text-white"
                    title={tn(leg.opponentNorm)}
                  >
                    {tn(leg.opponentNorm)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
