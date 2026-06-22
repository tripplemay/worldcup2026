'use client';

import { useState } from 'react';
import Link from 'next/link';
import Card from 'components/card';
import { MdInsights, MdBolt, MdScience } from 'react-icons/md';
import ProbBar from 'components/worldcup/ProbBar';
import BookDivergenceNote from 'components/worldcup/BookDivergenceNote';
import TeamBadge from 'components/worldcup/TeamBadge';
import ModelRecord from 'components/worldcup/ModelRecord';
import PageHeading from 'components/worldcup/PageHeading';
import {
  usePredictions,
  useLeaguePredictions,
  useCompetitions,
} from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import { formatMatchTime } from 'lib/format/matchTime';
import type { MatchWithPredictions } from 'lib/predict/predict';

/**
 * 取融合(或首个模型)最大概率的赛果作为「预测」,并选取**与该赛果一致**的最可能比分。
 * (泊松下单一最可能比分常是 1-1,会与"主胜/客胜"矛盾;故按预测方筛选,回退到最可能比分。)
 */
function pick(m: MatchWithPredictions, homeShort: string, awayShort: string) {
  const p = m.ensemble ?? m.predictions[0];
  if (!p) return null;
  const outcome =
    p.homeWin >= p.draw && p.homeWin >= p.awayWin
      ? 'home'
      : p.awayWin >= p.draw && p.awayWin >= p.homeWin
      ? 'away'
      : 'draw';
  const side =
    outcome === 'home' ? homeShort : outcome === 'away' ? awayShort : '—';
  const consistent = (sc: string) => {
    const [h, a] = sc.split('-').map(Number);
    return outcome === 'home' ? h > a : outcome === 'away' ? h < a : h === a;
  };
  const ts = p.topScores ?? [];
  const score = (ts.find((s) => consistent(s.score)) ?? ts[0])?.score ?? '';
  return { side, score, conf: p.confidence };
}

export default function PredictPage() {
  const { locale, t, tn } = useLocale();
  const [comp, setComp] = useState('wc');
  const isWc = comp === 'wc';
  const { competitions } = useCompetitions();
  const wc = usePredictions(14);
  const league = useLeaguePredictions(isWc ? null : comp, 14);
  const matches = isWc ? wc.matches : league.matches;
  const isLoading = isWc ? wc.isLoading : league.isLoading;
  const withPred = matches.filter((m) => m.predictions.length > 0);

  // 切换器选项:接口未就绪时退回内置默认
  const tabs = competitions.length
    ? competitions
    : [{ comp: 'wc', name: 'World Cup 2026', kind: 'wc' as const }];

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between gap-2">
          <PageHeading Icon={MdInsights}>{t('predict.title')}</PageHeading>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              href="/backtest"
              className="flex items-center gap-0.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
            >
              <MdScience className="text-sm" />
              {t('backtest.entry')}
            </Link>
            <Link
              href="/tmi"
              className="flex items-center gap-0.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
            >
              <MdBolt className="text-sm" />
              {t('tmi.entry')}
            </Link>
          </div>
        </div>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('predict.subtitle')}
        </p>
        {/* 竞赛切换器(WC + 联赛) */}
        <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((c) => (
            <button
              key={c.comp}
              onClick={() => setComp(c.comp)}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition ${
                comp === c.comp
                  ? 'bg-brand-500 text-white'
                  : 'bg-white text-gray-600 dark:bg-navy-800 dark:text-gray-300'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </header>

      {isWc && <ModelRecord />}

      {isLoading && withPred.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-[20px] bg-white dark:bg-navy-800"
            />
          ))}
        </div>
      )}

      {!isLoading && withPred.length === 0 && (
        <div className="py-16 text-center text-sm text-gray-400">
          {isWc ? t('predict.empty') : t('predict.leagueEmpty')}
        </div>
      )}

      <div className="space-y-3">
        {withPred.map((m) => {
          const p = m.ensemble ?? m.predictions[0];
          // Pivot:头条概率条用市场去水共识(无盘口回退模型);xG/比分仍取模型作上下文
          const headline =
            m.predictions.find((x) => x.modelId === 'market') ?? p;
          const pk = pick(m, tn(m.homeTeam), tn(m.awayTeam));
          const body = (
            <Card extra="p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                <span>{formatMatchTime(m.commenceTime, locale)}</span>
                {pk && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                    {t('predict.pick')} {pk.side} {pk.score}
                  </span>
                )}
              </div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <TeamBadge
                  name={m.homeTeam}
                  logo={m.homeLogo}
                  nameFirst
                  className="min-w-0 flex-1 text-sm font-medium text-navy-700 dark:text-white"
                />
                <span className="shrink-0 px-2 text-xs text-gray-400">
                  {p.xgHome != null
                    ? `${p.xgHome.toFixed(1)} - ${p.xgAway?.toFixed(1)}`
                    : ''}
                </span>
                <TeamBadge
                  name={m.awayTeam}
                  logo={m.awayLogo}
                  className="min-w-0 flex-1 justify-end text-right text-sm font-medium text-navy-700 dark:text-white"
                />
              </div>
              <ProbBar
                home={headline.homeWin}
                draw={headline.draw}
                away={headline.awayWin}
              />
              {(() => {
                // 有锐盘 → 仅锐盘与软市场分歧时显示;无锐盘 → 回退裸幅度(非 tight)
                const d = m.marketDivergence;
                if (!d) return null;
                const show = d.sharp
                  ? d.sharp.level !== 'aligned'
                  : d.level !== 'tight';
                return show ? (
                  <div className="mt-2">
                    <BookDivergenceNote d={d} compact />
                  </div>
                ) : null;
              })()}
            </Card>
          );
          // WC → /match/[id](WC ESPN);联赛 → /league/[comp]/[id](联赛 ESPN + calib 预测)
          return (
            <Link
              key={m.matchId}
              href={
                isWc ? `/match/${m.matchId}` : `/league/${comp}/${m.matchId}`
              }
            >
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
