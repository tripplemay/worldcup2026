'use client';

import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useLocale, useTn } from 'lib/i18n/context';
import { formatPct, DISPLAY_LENS } from 'lib/scenario/display';
import { desiredByMetric, isMeaningful } from 'lib/scenario/types';
import type { FixtureView, Outcome, TeamOutlook } from 'lib/scenario/types';

const OUTCOME_BG: Record<Outcome, string> = {
  W: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  D: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
  L: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

/** 自身期望结果 → 比赛结果(主胜/平/客胜),用于默契判定。 */
const homeOutcome = (o?: Outcome) =>
  o === 'W' ? 'home' : o === 'D' ? 'draw' : o === 'L' ? 'away' : undefined;
const awayOutcome = (o?: Outcome) =>
  o === 'W' ? 'away' : o === 'D' ? 'draw' : o === 'L' ? 'home' : undefined;

/** 固定口径下某队的「最期望」(摆动够大才给,否则视为势均)。 */
function desiredOf(
  outlook?: TeamOutlook,
  played?: boolean,
): Outcome | undefined {
  if (!outlook || played || !isMeaningful(outlook.byResult, DISPLAY_LENS))
    return undefined;
  return desiredByMetric(outlook.byResult, DISPLAY_LENS);
}

/**
 * 一侧视角(队徽 + 出线概率 + 最期望 chip)。
 * 缺 outlook(跨源对齐失败)时仍用 fixture 自带的展示名/队徽兜底,避免卡片半空塌陷。
 */
function TeamSide({
  outlook,
  name,
  logo,
  played,
  desired,
}: {
  outlook?: TeamOutlook;
  name: string;
  logo?: string;
  played: boolean;
  desired?: Outcome;
}) {
  const { t } = useLocale();
  const oc = (o: Outcome) =>
    t(`scenarios.${o === 'W' ? 'win' : o === 'D' ? 'draw' : 'lose'}`);

  const st = outlook?.standing;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <TeamBadge
          name={name}
          logo={logo}
          className="min-w-0 text-sm font-semibold text-navy-700 dark:text-white"
        />
        <div className="flex shrink-0 items-center gap-2">
          {outlook ? (
            <span className="text-[10px] tabular-nums text-gray-400">
              {t('scenarios.advance')} {formatPct(outlook.overall.advance)}
            </span>
          ) : (
            <span className="text-[10px] text-gray-300 dark:text-navy-500">
              —
            </span>
          )}
          {!played &&
            (desired ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${OUTCOME_BG[desired]}`}
              >
                {t('scenarios.desired')} {oc(desired)}
              </span>
            ) : (
              outlook && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-400">
                  {t('scenarios.evenOdds')}
                </span>
              )
            ))}
        </div>
      </div>
      {st && (
        <div className="mt-0.5 text-[9px] tabular-nums text-gray-400">
          #{st.rank} · {st.points}
          {t('scenarios.standPts')} · {t('scenarios.standLeftPre')}
          {st.remaining}
          {t('scenarios.standLeftPost')}
        </div>
      )}
    </div>
  );
}

/**
 * 第三轮一场对阵卡(双视角)。口径固定为 DISPLAY_LENS,默契判定稳定不再随口径闪烁。
 * 详细的条件晋级/对手分布下沉到「球队晋级前景」的下钻面板。
 */
export default function ScenarioFixtureCard({
  fixture,
  home,
  away,
}: {
  fixture: FixtureView;
  home?: TeamOutlook;
  away?: TeamOutlook;
}) {
  const { t } = useLocale();
  const tn = useTn();

  const when = (() => {
    if (!fixture.commenceTime)
      return fixture.played ? `· ${t('scenarios.played')}` : '';
    const d = new Date(fixture.commenceTime);
    const two = (n: number) => String(n).padStart(2, '0');
    // 日期 + 开赛时间(本地时区,与页头新鲜度口径一致)
    const dt = `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(
      d.getMinutes(),
    )}`;
    return fixture.played ? `· ${dt} ${t('scenarios.played')}` : `· ${dt}`;
  })();

  const hDesired = desiredOf(home, fixture.played);
  const aDesired = desiredOf(away, fixture.played);
  const hOut = homeOutcome(hDesired);
  const aOut = awayOutcome(aDesired);
  const mutual = !!hOut && !!aOut && hOut === aOut;
  const jointLabel = !mutual
    ? ''
    : hOut === 'draw'
    ? t('scenarios.draw')
    : hOut === 'home'
    ? tn(fixture.homeName)
    : tn(fixture.awayName);

  return (
    <Card extra="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {t('scenarios.groupsTag')} {fixture.group} {when}
        </span>
        {mutual && (
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
        name={fixture.homeName}
        logo={fixture.homeLogo}
        played={fixture.played}
        desired={hDesired}
      />
      <div className="my-2 h-px bg-gray-100 dark:bg-white/5" />
      <TeamSide
        outlook={away}
        name={fixture.awayName}
        logo={fixture.awayLogo}
        played={fixture.played}
        desired={aDesired}
      />
    </Card>
  );
}
