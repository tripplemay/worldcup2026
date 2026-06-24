'use client';

import { useMemo, useState } from 'react';
import { MdAccountTree } from 'react-icons/md';
import PageHeading from 'components/worldcup/PageHeading';
import ScenarioFixtureCard from 'components/worldcup/ScenarioFixtureCard';
import ScenarioTeamList from 'components/worldcup/ScenarioTeamList';
import { useScenarios } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { Stage, TeamOutlook } from 'lib/scenario/types';

/**
 * 「沙盘」情景推演页:第三轮每队最期望的结果(整条晋级路径最易)+ 双方默契 + 全队前景。
 * 数据由后台 Monte-Carlo 预算(随每场收官重算),本页只读缓存。
 */
export default function ScenariosPage() {
  const { t } = useLocale();
  const { scenario, error, isLoading, refresh } = useScenarios();
  const hasData = !!scenario && scenario.teams.length > 0;
  // 期望度口径:打进8强(整条路径)/ 进下一轮(出线),供交叉比对
  const [metric, setMetric] = useState<Stage>('QF');
  const METRICS: { s: Stage; label: string }[] = [
    { s: 'QF', label: t('scenarios.mQF') },
    { s: 'R32', label: t('scenarios.mNext') },
  ];

  const byNorm = useMemo(() => {
    const m: Record<string, TeamOutlook> = {};
    scenario?.teams.forEach((tm) => (m[tm.norm] = tm));
    return m;
  }, [scenario]);

  // 防御:按比赛(开赛)顺序展示对阵(同组同时开球→相邻;缺时间排最后)
  const fixtures = useMemo(
    () =>
      [...(scenario?.fixtures ?? [])].sort(
        (a, b) =>
          (a.commenceTime || '9999').localeCompare(b.commenceTime || '9999') ||
          a.group.localeCompare(b.group) ||
          a.home.localeCompare(b.home),
      ),
    [scenario],
  );

  const freshness = (() => {
    if (!scenario) return '';
    const d = new Date(scenario.computedAt);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes(),
    ).padStart(2, '0')}`;
    return `${t('scenarios.updatedAt')} ${hm} · ${
      scenario.groupsLocked.length
    } ${t('scenarios.locked')} · ${scenario.groupsPending.length} ${t(
      'scenarios.pending',
    )}`;
  })();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <PageHeading Icon={MdAccountTree}>{t('scenarios.title')}</PageHeading>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('scenarios.subtitle')}
        </p>
        {scenario && (
          <p className="mt-0.5 text-[10px] tabular-nums text-gray-400">
            {freshness}
          </p>
        )}
      </header>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-500 dark:bg-red-500/15 dark:text-red-300">
          {t('common.loadFailed')},
          <button onClick={() => refresh()} className="underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      {isLoading && !hasData && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-[20px] bg-white dark:bg-navy-800"
            />
          ))}
        </div>
      )}

      {!isLoading && !hasData && (
        <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 dark:bg-navy-800 dark:text-gray-400">
          {t('scenarios.empty')}
        </div>
      )}

      {hasData && scenario && (
        <div className="space-y-5">
          {/* 期望度口径切换(交叉比对:整条路径 8强 vs 进下一轮 出线)*/}
          <div>
            <div className="mb-1 text-[10px] text-gray-400">
              {t('scenarios.lens')}
            </div>
            <div className="inline-flex rounded-full bg-gray-100 p-0.5 text-xs dark:bg-navy-800">
              {METRICS.map((m) => (
                <button
                  key={m.s}
                  onClick={() => setMetric(m.s)}
                  className={`rounded-full px-3 py-1 transition-colors ${
                    metric === m.s
                      ? 'bg-white font-semibold text-brand-500 shadow-sm dark:bg-navy-600 dark:text-brand-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <section>
            <h2 className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
              {t('scenarios.fixturesTitle')}
            </h2>
            <div className="space-y-2.5">
              {fixtures.map((f) => (
                <ScenarioFixtureCard
                  key={`${f.group}-${f.home}-${f.away}`}
                  fixture={f}
                  home={byNorm[f.home]}
                  away={byNorm[f.away]}
                  metricStage={metric}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
              {t('scenarios.teamsTitle')}
            </h2>
            <ScenarioTeamList teams={scenario.teams} metricStage={metric} />
          </section>
        </div>
      )}
    </div>
  );
}
