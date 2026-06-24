'use client';

import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useLocale, useTn } from 'lib/i18n/context';
import { reachProb } from 'lib/scenario/types';
import type {
  FixtureView,
  Outcome,
  Stage,
  TeamOutlook,
} from 'lib/scenario/types';

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** 自身视角胜平负 → 颜色(胜=翠绿、平=灰、负=玫红;「想输」用红色显眼)。 */
const OUTCOME_COLOR: Record<Outcome, string> = {
  W: 'text-emerald-600 dark:text-emerald-400',
  D: 'text-gray-500 dark:text-gray-300',
  L: 'text-rose-600 dark:text-rose-400',
};
const OUTCOME_BG: Record<Outcome, string> = {
  W: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  D: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  L: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

/** 一支队的一侧视角(队徽 + 最期望 + 各结果路径概率 / 已踢则显总体前景)。 */
function TeamSide({
  outlook,
  played,
  targetStage,
}: {
  outlook?: TeamOutlook;
  played: boolean;
  targetStage: Stage;
}) {
  const { t } = useLocale();
  const tn = useTn();
  if (!outlook) return null;
  const oc = (o: Outcome) =>
    t(`scenarios.${o === 'W' ? 'win' : o === 'D' ? 'draw' : 'lose'}`);
  const targetLabel = t('scenarios.reach') + t(`scenarios.st${targetStage}`);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <TeamBadge
          name={outlook.name}
          logo={outlook.logo}
          className="min-w-0 text-sm font-semibold text-navy-700 dark:text-white"
        />
        {!played && outlook.desired && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              OUTCOME_BG[outlook.desired]
            }`}
          >
            {t('scenarios.desired')} {oc(outlook.desired)}
          </span>
        )}
      </div>

      {/* 总体前景 */}
      <div className="mt-1 flex gap-3 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
        <span>
          {t('scenarios.advance')} {pct(outlook.overall.advance)}
        </span>
        <span>
          {targetLabel} {pct(reachProb(outlook.overall, targetStage))}
        </span>
        <span>
          {t('scenarios.champion')} {pct(outlook.overall.champion)}
        </span>
      </div>

      {/* 未踢:各结果(胜/平/负)的路径概率,最期望置顶 */}
      {!played && outlook.byResult.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {outlook.byResult.map((b, i) => (
            <div
              key={b.outcome}
              className="flex items-center gap-2 text-[11px]"
            >
              <span
                className={`w-4 shrink-0 font-semibold ${
                  OUTCOME_COLOR[b.outcome]
                }`}
              >
                {oc(b.outcome)}
              </span>
              {/* 固定宽度进度条:腾出空间让对手名在手机上也始终可见 */}
              <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-gray-100 dark:bg-navy-700">
                <span
                  className={`block h-full rounded-full ${
                    i === 0 ? 'bg-brand-500' : 'bg-gray-300 dark:bg-navy-500'
                  }`}
                  style={{ width: pct(b.target) }}
                />
              </div>
              <span className="w-9 shrink-0 text-right tabular-nums text-gray-500 dark:text-gray-400">
                {pct(b.target)}
              </span>
              {b.topOpponent && (
                <span className="min-w-0 flex-1 truncate text-gray-400">
                  vs {tn(b.topOpponent.norm)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 第三轮一场对阵的双视角卡(含默契高亮)。 */
export default function ScenarioFixtureCard({
  fixture,
  home,
  away,
  targetStage,
}: {
  fixture: FixtureView;
  home?: TeamOutlook;
  away?: TeamOutlook;
  targetStage: Stage;
}) {
  const { t } = useLocale();
  const tn = useTn();

  const when = (() => {
    if (fixture.played) return `· ${t('scenarios.played')}`;
    if (!fixture.commenceTime) return '';
    const d = new Date(fixture.commenceTime);
    return `· ${d.getMonth() + 1}/${d.getDate()}`;
  })();

  const jointLabel = (() => {
    if (!fixture.mutualInterest || !fixture.jointOutcome) return '';
    if (fixture.jointOutcome === 'draw') return t('scenarios.draw');
    return fixture.jointOutcome === 'home'
      ? tn(fixture.homeName)
      : tn(fixture.awayName);
  })();

  return (
    <Card extra="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {t('scenarios.groupsTag')} {fixture.group} {when}
        </span>
        {fixture.mutualInterest && fixture.jointOutcome && (
          <span
            title={t('scenarios.mutualHint')}
            className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
          >
            ⚖ {t('scenarios.mutual')} · {jointLabel}
          </span>
        )}
      </div>
      <TeamSide
        outlook={home}
        played={fixture.played}
        targetStage={targetStage}
      />
      <div className="my-2 h-px bg-gray-100 dark:bg-white/5" />
      <TeamSide
        outlook={away}
        played={fixture.played}
        targetStage={targetStage}
      />
    </Card>
  );
}
