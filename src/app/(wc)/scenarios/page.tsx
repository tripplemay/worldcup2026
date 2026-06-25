'use client';

import { useMemo, useState } from 'react';
import { MdAccountTree } from 'react-icons/md';
import PageHeading from 'components/worldcup/PageHeading';
import ScenarioFixtureCard from 'components/worldcup/ScenarioFixtureCard';
import ScenarioTeamList from 'components/worldcup/ScenarioTeamList';
import { useScenarios } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { FixtureView, TeamOutlook } from 'lib/scenario/types';

/** 数据超过该时长视为「可能过期」(沙盘随每场收官重算)。 */
const STALE_HOURS = 6;

/**
 * 「沙盘」情景推演页:球队晋级前景(点击下钻)为主线 + 第三轮双方博弈。
 * 数据由后台 Monte-Carlo 预算(随每场收官重算),本页只读缓存。
 */
export default function ScenariosPage() {
  const { t } = useLocale();
  const { scenario, error, isLoading, refresh } = useScenarios();
  const hasData = !!scenario && scenario.teams.length > 0;
  const [showNotes, setShowNotes] = useState(false);
  const [showPlayed, setShowPlayed] = useState(false);

  const byNorm = useMemo(() => {
    const m: Record<string, TeamOutlook> = {};
    scenario?.teams.forEach((tm) => (m[tm.norm] = tm));
    return m;
  }, [scenario]);

  // 第三轮对阵:未踢在前(按开赛时间),已踢折叠下沉
  const { upcoming, played } = useMemo(() => {
    const sorted = [...(scenario?.fixtures ?? [])].sort(
      (a, b) =>
        (a.commenceTime || '9999').localeCompare(b.commenceTime || '9999') ||
        a.group.localeCompare(b.group) ||
        a.home.localeCompare(b.home),
    );
    return {
      upcoming: sorted.filter((f) => !f.played),
      played: sorted.filter((f) => f.played),
    };
  }, [scenario]);

  const fresh = useMemo(() => {
    if (!scenario) return null;
    const d = new Date(scenario.computedAt);
    const two = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${two(
      d.getHours(),
    )}:${two(d.getMinutes())}`;
    const stale = (Date.now() - scenario.computedAt) / 3.6e6 > STALE_HOURS;
    return { dateStr, stale };
  }, [scenario]);

  const notesWarn = !!scenario?.notes?.includes('⚠');

  const renderFixture = (f: FixtureView) => (
    <ScenarioFixtureCard
      key={`${f.group}-${f.home}-${f.away}`}
      fixture={f}
      home={byNorm[f.home]}
      away={byNorm[f.away]}
    />
  );

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <PageHeading Icon={MdAccountTree}>{t('scenarios.title')}</PageHeading>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('scenarios.subtitle')}
        </p>
        {scenario && fresh && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] tabular-nums text-gray-400">
            <span
              className={
                fresh.stale
                  ? 'font-medium text-amber-600 dark:text-amber-400'
                  : ''
              }
            >
              {t('scenarios.updatedAt')} {fresh.dateStr}
              {fresh.stale ? ` · ${t('scenarios.stale')}` : ''}
            </span>
            <span>
              · {scenario.groupsLocked.length} {t('scenarios.locked')} ·{' '}
              {scenario.groupsPending.length} {t('scenarios.pending')}
            </span>
            <span>
              · {scenario.sims.toLocaleString()}
              {t('scenarios.simsUnit')}
            </span>
            <span>
              ·{' '}
              {scenario.thirdTableSource === 'official'
                ? `${t('scenarios.thirdOfficial')} ✓`
                : t('scenarios.thirdAlgo')}
            </span>
          </div>
        )}
        {scenario?.notes && (
          <div className="mt-1">
            <button
              onClick={() => setShowNotes((v) => !v)}
              aria-expanded={showNotes}
              className={`text-[10px] ${
                notesWarn
                  ? 'font-medium text-amber-600 dark:text-amber-400'
                  : 'text-gray-400'
              }`}
            >
              {notesWarn ? '⚠️ ' : 'ℹ️ '}
              {t('scenarios.notesTitle')} {showNotes ? '▴' : '▾'}
            </button>
            {showNotes && (
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                {scenario.notes}
              </p>
            )}
          </div>
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
          {/* 主线:球队晋级前景(点击行下钻) */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
              {t('scenarios.teamsTitle')}
            </h2>
            <ScenarioTeamList teams={scenario.teams} />
          </section>

          {/* 第三轮双方博弈(未踢) */}
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
                {t('scenarios.fixturesTitle')}
              </h2>
              <div className="space-y-2.5">{upcoming.map(renderFixture)}</div>
            </section>
          )}

          {/* 已开赛场次:折叠下沉 */}
          {played.length > 0 && (
            <section>
              <button
                onClick={() => setShowPlayed((v) => !v)}
                aria-expanded={showPlayed}
                className="mb-2 flex w-full items-center justify-between text-sm font-bold text-gray-500 active:opacity-70 dark:text-gray-400"
              >
                <span>
                  {t('scenarios.playedTitle')} ({played.length})
                </span>
                <span className="text-xs">{showPlayed ? '▴' : '▾'}</span>
              </button>
              {showPlayed && (
                <div className="space-y-2.5">{played.map(renderFixture)}</div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
