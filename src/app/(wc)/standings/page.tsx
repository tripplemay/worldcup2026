'use client';

import { useMemo } from 'react';
import { MdLeaderboard } from 'react-icons/md';
import { useStandings } from 'lib/hooks/useWorldCup';
import { useT } from 'lib/i18n/context';
import StandingsTable from 'components/worldcup/StandingsTable';
import PageHeading from 'components/worldcup/PageHeading';
import type { GroupStanding, GroupStandingRow } from 'lib/espn/types';

/**
 * 2026 赛制出线球队:每组前 2 名直接出线 + 12 个小组里成绩最好的 8 个第三名出线。
 * 第三名排序:积分 → 净胜球 → 总进球(相互交锋/公平竞赛/FIFA 排名无数据,略)。
 */
function computeAdvancing(groups: GroupStanding[]): Set<string> {
  const adv = new Set<string>();
  const thirds: GroupStandingRow[] = [];
  for (const g of groups) {
    g.rows.forEach((r, i) => {
      if (i < 2) adv.add(r.team);
      else if (i === 2) thirds.push(r);
    });
  }
  thirds.sort(
    (a, b) =>
      b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor,
  );
  thirds.slice(0, 8).forEach((r) => adv.add(r.team));
  return adv;
}

export default function StandingsPage() {
  const t = useT();
  const { groups, error, isLoading, refresh } = useStandings();
  const advancing = useMemo(() => computeAdvancing(groups), [groups]);

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <PageHeading Icon={MdLeaderboard}>{t('standings.title')}</PageHeading>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('standings.hint')}
        </p>
      </header>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-500 dark:bg-red-500/15 dark:text-red-300">
          {t('common.loadFailed')},
          <button onClick={() => refresh()} className="underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      {isLoading && groups.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-[20px] bg-white dark:bg-navy-800"
            />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
          <StandingsTable key={g.group} g={g} advancing={advancing} />
        ))}
      </div>
    </div>
  );
}
