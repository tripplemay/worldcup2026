'use client';

import { useState } from 'react';
import ScenarioTeamDetail from 'components/worldcup/ScenarioTeamDetail';
import { useLocale, useTn } from 'lib/i18n/context';
import { formatPct, advanceSwing, mindsetOf } from 'lib/scenario/display';
import type { Mindset } from 'lib/scenario/display';
import type {
  FixtureResultImpact,
  FixtureView,
  TeamOutlook,
} from 'lib/scenario/types';

const MINDSET_BG: Record<Mindset, string> = {
  clinchedTop1:
    'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  clinched:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  eliminated: 'bg-gray-200 text-gray-500 dark:bg-white/10 dark:text-gray-400',
  thirdHunt: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  decisive: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  contending:
    'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  cushion: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400',
};

const RES_KEY: Record<FixtureResultImpact['result'], string> = {
  home: 'scenarios.resultHome',
  draw: 'scenarios.resultDraw',
  away: 'scenarios.resultAway',
};

/** 出线概率变化(百分点)文案 + 涨跌配色。 */
function DeltaPp({ d }: { d: number }) {
  const pp = Math.round(Math.abs(d) * 100);
  if (pp === 0) return <span className="text-gray-400">±0</span>;
  const up = d > 0;
  return (
    <span
      className={
        up
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-500 dark:text-rose-400'
      }
    >
      {up ? '+' : '−'}
      {pp}
    </span>
  );
}

/** 老缓存无 resultImpact 时,用双方 byResult 兜底出「本场两队」的结果矩阵(无同组连带)。 */
function fallbackImpact(
  home?: TeamOutlook,
  away?: TeamOutlook,
): FixtureResultImpact[] {
  const rows: {
    result: FixtureResultImpact['result'];
    hOut: 'W' | 'D' | 'L';
    aOut: 'W' | 'D' | 'L';
  }[] = [
    { result: 'home', hOut: 'W', aOut: 'L' },
    { result: 'draw', hOut: 'D', aOut: 'D' },
    { result: 'away', hOut: 'L', aOut: 'W' },
  ];
  const out: FixtureResultImpact[] = [];
  for (const r of rows) {
    const hb = home?.byResult.find((b) => b.outcome === r.hOut);
    const ab = away?.byResult.find((b) => b.outcome === r.aOut);
    const teams = [];
    if (home && hb)
      teams.push({
        norm: home.norm,
        name: home.name,
        advance: hb.probs.advance,
        advanceDelta: hb.probs.advance - home.overall.advance,
      });
    if (away && ab)
      teams.push({
        norm: away.norm,
        name: away.name,
        advance: ab.probs.advance,
        advanceDelta: ab.probs.advance - away.overall.advance,
      });
    if (!teams.length) continue;
    out.push({ result: r.result, prob: hb?.prob ?? ab?.prob ?? 0, teams });
  }
  return out;
}

/** 一队的「赌注 + 心态」一行(心态 chip + 出线摆动 + 可达名次区间)。 */
function StakeRow({ outlook }: { outlook: TeamOutlook }) {
  const { t } = useLocale();
  const tn = useTn();
  const mind = mindsetOf(outlook);
  const swing = Math.round(advanceSwing(outlook) * 100);
  const st = outlook.standing;
  const rankRange =
    st?.bestRank && st?.worstRank
      ? st.bestRank === st.worstRank
        ? `${st.bestRank}`
        : `${st.bestRank}–${st.worstRank}`
      : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
      <span className="font-semibold text-navy-700 dark:text-white">
        {tn(outlook.name)}
      </span>
      <span
        className={`rounded-full px-1.5 py-0.5 font-semibold ${MINDSET_BG[mind]}`}
      >
        {t(`scenarios.mindset.${mind}`)}
      </span>
      {!outlook.played3 && swing > 0 && (
        <span className="tabular-nums text-gray-500 dark:text-gray-400">
          {t('scenarios.swing')} {swing}pp
        </span>
      )}
      {rankRange && (
        <span className="tabular-nums text-gray-400">
          {t('scenarios.rankRange')} {rankRange}
        </span>
      )}
    </div>
  );
}

/**
 * 第三轮对阵「博弈细节」下钻:
 * - 赌注与心态:双方各自的心态分类 + 出线摆动 + 可达名次区间(T2 确定性优先);
 * - 若本场结果:三结果矩阵,每结果列出同组各队出线概率 + 相对总体的变化(T3 连带影响,本场双方加粗);
 * - 完整前景:每队可展开复用 ScenarioTeamDetail(深度阶梯/名次分布/路线)。
 */
export default function ScenarioFixtureDetail({
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
  const [openTeam, setOpenTeam] = useState<string | null>(null);

  const impact = fixture.resultImpact ?? fallbackImpact(home, away);
  const playing = new Set([fixture.home, fixture.away]);
  const hasGroupKnockOn = impact.some((r) => r.teams.length > 2);

  return (
    <div className="mt-2 space-y-3 rounded-xl bg-gray-50 p-3 dark:bg-navy-900/60">
      {/* 赌注与心态(仅未踢) */}
      {!fixture.played && (home || away) && (
        <div>
          <div className="mb-1 text-[10px] font-medium text-gray-400">
            {t('scenarios.stakeTitle')}
          </div>
          <div className="space-y-1">
            {home && <StakeRow outlook={home} />}
            {away && <StakeRow outlook={away} />}
          </div>
          {fixture.mutualInterest && (
            <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
              ⚖ {t('scenarios.mutual')} · {t('scenarios.mutualHint')}
            </div>
          )}
        </div>
      )}

      {/* 若本场结果:结果矩阵 + 同组连带 */}
      {impact.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-gray-400">
            <span>{t('scenarios.ifResultTitle')}</span>
            {hasGroupKnockOn && <span>· {t('scenarios.impactTitle')}</span>}
          </div>
          <div className="space-y-2">
            {impact.map((row) => {
              const ordered = [...row.teams].sort((a, b) => {
                const pa = playing.has(a.norm) ? 0 : 1;
                const pb = playing.has(b.norm) ? 0 : 1;
                return pa - pb || Math.abs(b.advanceDelta) - Math.abs(a.advanceDelta);
              });
              return (
                <div
                  key={row.result}
                  className="rounded-lg bg-white/70 px-2 py-1.5 dark:bg-navy-800/60"
                >
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-navy-700 dark:text-white">
                      {t(RES_KEY[row.result])}
                    </span>
                    <span className="tabular-nums text-gray-400">
                      {formatPct(row.prob)}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {ordered.map((tm) => {
                      const isPlaying = playing.has(tm.norm);
                      return (
                        <div
                          key={tm.norm}
                          className="flex items-center justify-between gap-2 text-[10px] tabular-nums"
                        >
                          <span
                            className={`min-w-0 truncate ${
                              isPlaying
                                ? 'font-semibold text-navy-700 dark:text-white'
                                : 'text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {tn(tm.name)}
                          </span>
                          <span className="shrink-0 text-gray-500 dark:text-gray-400">
                            {t('scenarios.advance')} {formatPct(tm.advance)}{' '}
                            <DeltaPp d={tm.advanceDelta} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {(fixture.resultImpact || home?.standing?.bestRank) && (
            <div className="mt-1 text-[9px] leading-snug text-gray-400">
              {t('scenarios.approxNote')}
            </div>
          )}
        </div>
      )}

      {/* 完整前景:逐队展开复用球队下钻 */}
      <div className="flex flex-wrap gap-1.5">
        {[home, away].filter(Boolean).map((o) => {
          const ol = o as TeamOutlook;
          const on = openTeam === ol.norm;
          return (
            <button
              key={ol.norm}
              onClick={() => setOpenTeam(on ? null : ol.norm)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                on
                  ? 'bg-brand-500 text-white'
                  : 'bg-white text-gray-500 dark:bg-navy-800 dark:text-gray-400'
              }`}
            >
              {tn(ol.name)} · {t('scenarios.fullOutlook')} {on ? '▴' : '▾'}
            </button>
          );
        })}
      </div>
      {openTeam && home && openTeam === home.norm && (
        <ScenarioTeamDetail outlook={home} />
      )}
      {openTeam && away && openTeam === away.norm && (
        <ScenarioTeamDetail outlook={away} />
      )}
    </div>
  );
}
