'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import LeagueBadge from 'components/worldcup/LeagueBadge';
import RadarChart from 'components/worldcup/RadarChart';
import { useTeamProfile } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import { formatMatchTime } from 'lib/format/matchTime';
import { gradeLetter, regressionVerdict } from 'lib/team/score';
import type { TeamProfile, TeamFixture } from 'lib/team/types';
import type { RosterPlayer } from 'lib/espn/types';

const RES_CLS: Record<string, string> = {
  W: 'bg-green-500 text-white',
  D: 'bg-gray-400 text-white',
  L: 'bg-red-500 text-white',
  '': 'bg-gray-200 text-gray-400 dark:bg-navy-700',
};

const gradeColor = (g: number) =>
  g >= 80
    ? 'text-green-600 dark:text-green-400'
    : g >= 65
    ? 'text-brand-500 dark:text-brand-400'
    : g >= 50
    ? 'text-amber-500'
    : 'text-red-500 dark:text-red-400';

const signed2 = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
const diffCls = (x: number) =>
  x > 0.05
    ? 'text-green-600 dark:text-green-400'
    : x < -0.05
    ? 'text-red-500 dark:text-red-400'
    : 'text-gray-500 dark:text-gray-400';

function Bar({
  label,
  value,
  color = 'bg-brand-500',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-navy-700">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-navy-700 dark:text-white">
        {Math.round(value)}
      </span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-mono tabular-nums font-medium text-navy-700 dark:text-white">
        {value}
      </span>
    </div>
  );
}

function GradeHero({ p }: { p: TeamProfile }) {
  const { t, tn } = useLocale();
  return (
    <Card extra="mb-3 p-4">
      <div className="flex items-center gap-3">
        {p.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.logo}
            alt=""
            className="h-12 w-12 shrink-0 object-contain"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold text-navy-700 dark:text-white">
            {tn(p.name)}
          </div>
          {p.standing && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {p.standing.group ? `${p.standing.group} · ` : ''}
              {t('team.rank')} {p.standing.rank ?? '—'} · {p.standing.win}
              {t('team.w')}
              {p.standing.draw}
              {t('team.d')}
              {p.standing.loss}
              {t('team.l')}
            </div>
          )}
          {p.coach && (
            <div className="truncate text-[11px] text-gray-400">
              {t('team.coach')}: {p.coach}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div
            className={`font-mono text-3xl font-extrabold leading-none ${gradeColor(
              p.grade,
            )}`}
          >
            {p.grade}
          </div>
          <div className={`text-[11px] font-bold ${gradeColor(p.grade)}`}>
            {gradeLetter(p.grade)} · {t('team.grade')}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-[11px] text-gray-400 dark:border-white/5">
        <span className="rounded-full bg-gray-200/70 px-2 py-0.5 font-medium text-gray-600 dark:bg-navy-700 dark:text-gray-300">
          {t('tmi.tag')}
        </span>
        <span>
          {t('team.strengthRating')} {p.strengthAvg}
        </span>
      </div>
    </Card>
  );
}

function StateBlock({ p }: { p: TeamProfile }) {
  const { t } = useLocale();
  const s = p.state;
  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        {t('team.state')}
      </div>
      <div className="space-y-1.5">
        <Bar label={t('team.momentum')} value={s.momentum} />
        <Bar
          label={t('team.recentForm')}
          value={s.recentForm}
          color="bg-green-500"
        />
        <Bar label={t('team.fitness')} value={s.fitness} color="bg-amber-500" />
      </div>
      {s.formStreak.length > 0 && (
        <div className="mt-2.5 flex items-center gap-1">
          <span className="mr-1 text-[11px] text-gray-400">
            {t('team.recent')}
          </span>
          {s.formStreak.map((r, i) => (
            <span
              key={i}
              className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
                RES_CLS[r] ?? RES_CLS['']
              }`}
            >
              {r || '·'}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function StrengthBlock({ p }: { p: TeamProfile }) {
  const { t } = useLocale();
  const data = p.strengthRadar.map((a) => ({
    label: t(`team.${a.key}`),
    value: a.value,
    available: a.available,
  }));
  return (
    <Card extra="mb-3 p-4">
      <div className="mb-1 text-sm font-bold text-navy-700 dark:text-white">
        {t('team.strengthProfile')}
      </div>
      <RadarChart data={data} />
      {!p.squad && (
        <div className="mt-1 text-center text-[10px] text-gray-400">
          {t('team.squadNa')}
        </div>
      )}
    </Card>
  );
}

function StyleRow({
  label,
  value,
  actualLabel,
  actual,
  xg,
}: {
  label: string;
  value: number;
  actualLabel: string;
  actual?: number;
  xg: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] tabular-nums text-gray-400">
          {actualLabel} {actual != null ? actual.toFixed(1) : '—'} / xG{' '}
          {xg.toFixed(1)}
        </span>
        <span
          className={`w-11 text-right font-mono font-bold tabular-nums ${diffCls(
            value,
          )}`}
        >
          {signed2(value)}
        </span>
      </span>
    </div>
  );
}

function StyleBlock({ p }: { p: TeamProfile }) {
  const { t } = useLocale();
  const s = p.style;
  const c = p.cup;
  const v = regressionVerdict(s.regression);
  const verdictCls =
    v === 'over'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
      : v === 'under'
      ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'
      : 'bg-gray-200/70 text-gray-600 dark:bg-navy-700 dark:text-gray-300';
  const verdictKey =
    v === 'over'
      ? 'team.regOver'
      : v === 'under'
      ? 'team.regUnder'
      : 'team.regFair';
  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-navy-700 dark:text-white">
          {t('team.style')}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${verdictCls}`}
        >
          {t(verdictKey)}
        </span>
      </div>
      <div className="space-y-2">
        <StyleRow
          label={t('team.finishing')}
          value={s.finishing}
          actualLabel={t('team.gf')}
          actual={c.goalsForPerMatch}
          xg={c.xgForPerMatch}
        />
        <StyleRow
          label={t('team.keeping')}
          value={s.keeping}
          actualLabel={t('team.ga')}
          actual={c.goalsAgainstPerMatch}
          xg={c.xgAgainstPerMatch}
        />
      </div>
      <div className="mt-2 text-[10px] text-gray-400">
        {t('team.styleHint')}
        {c.xgSource === 'season' ? ` · ${t('team.seasonNote')}` : ''}
      </div>
    </Card>
  );
}

function SeasonBlock({ p }: { p: TeamProfile }) {
  const { t } = useLocale();
  const s = p.season;
  if (!s) return null;
  const buckets = s.goalsByMinute.filter((b) => {
    const start = Number(b.range.split('-')[0]);
    return Number.isFinite(start) && start < 90; // 仅常规时段
  });
  const max = Math.max(1, ...buckets.map((b) => b.goals));
  const hasGoals = buckets.some((b) => b.goals > 0);
  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 flex items-center justify-between text-sm font-bold text-navy-700 dark:text-white">
        <span>{t('team.seasonTitle')}</span>
        <span className="text-[11px] font-normal text-gray-400">
          {t('team.cleanSheet')} {s.cleanSheets}
        </span>
      </div>
      <div className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">
        {t('team.goalsByMin')}
      </div>
      {hasGoals ? (
        <div className="flex h-16 items-end gap-1">
          {buckets.map((b) => (
            <div
              key={b.range}
              className="flex flex-1 flex-col items-center gap-0.5"
            >
              <div className="flex h-12 w-full items-end">
                <div
                  className="w-full rounded-t bg-brand-500/70"
                  style={{ height: `${(b.goals / max) * 100}%` }}
                />
              </div>
              <span className="text-[8px] text-gray-400">
                {b.range.split('-')[0]}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-gray-400">—</div>
      )}
    </Card>
  );
}

function CupData({ p }: { p: TeamProfile }) {
  const { t } = useLocale();
  const c = p.cup;
  const st = p.standing;
  const one = (v?: number) => (v == null ? '—' : v.toFixed(1));
  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        {t('team.cupData')}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {st && (
          <>
            <StatRow label={t('team.points')} value={String(st.points)} />
            <StatRow
              label={t('team.goals')}
              value={`${st.goalsFor}-${st.goalsAgainst}`}
            />
          </>
        )}
        <StatRow
          label={`${t('team.xgFor')}${c.xgSource === 'season' ? '*' : ''}`}
          value={c.xgForPerMatch.toFixed(2)}
        />
        <StatRow
          label={`${t('team.xgAgainst')}${c.xgSource === 'season' ? '*' : ''}`}
          value={c.xgAgainstPerMatch.toFixed(2)}
        />
        {c.possessionPct != null && (
          <StatRow
            label={t('stats.possessionPct')}
            value={`${one(c.possessionPct)}%`}
          />
        )}
        {c.shotsPerMatch != null && (
          <StatRow label={t('stats.totalShots')} value={one(c.shotsPerMatch)} />
        )}
        {c.sotPerMatch != null && (
          <StatRow
            label={t('stats.shotsOnTarget')}
            value={one(c.sotPerMatch)}
          />
        )}
        {c.cornersPerMatch != null && (
          <StatRow
            label={t('stats.wonCorners')}
            value={one(c.cornersPerMatch)}
          />
        )}
        {c.foulsPerMatch != null && (
          <StatRow
            label={t('stats.foulsCommitted')}
            value={one(c.foulsPerMatch)}
          />
        )}
        {c.yellowPerMatch != null && (
          <StatRow
            label={t('stats.yellowCards')}
            value={one(c.yellowPerMatch)}
          />
        )}
      </div>
      {c.xgSource === 'season' && (
        <div className="mt-2 text-[10px] text-gray-400">
          {t('team.seasonNote')}
        </div>
      )}
    </Card>
  );
}

function FixtureRow({ f }: { f: TeamFixture }) {
  const { locale, tn } = useLocale();
  const score = f.gf != null && f.ga != null ? `${f.gf}-${f.ga}` : '';
  return (
    <Link
      href={`/match/${f.eventId}`}
      className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
          RES_CLS[f.result] ?? RES_CLS['']
        }`}
      >
        {f.result || '·'}
      </span>
      <span className="w-14 shrink-0 tabular-nums text-gray-400">
        {formatMatchTime(f.date, locale)}
      </span>
      <TeamBadge
        name={f.opponent}
        logo={f.opponentLogo}
        className="min-w-0 flex-1"
      />
      <span className="shrink-0 font-mono tabular-nums font-medium text-navy-700 dark:text-white">
        {score}
      </span>
    </Link>
  );
}

function StarterRow({ p }: { p: RosterPlayer }) {
  const { locale } = useLocale();
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
      {p.jersey && (
        <span className="w-4 shrink-0 text-right tabular-nums text-gray-400">
          {p.jersey}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {locale === 'zh' && p.zh ? p.zh : p.name}
      </span>
      {p.form?.leagueId != null && (
        <LeagueBadge leagueId={p.form.leagueId} className="text-[9px]" />
      )}
      {p.form?.rating != null && (
        <span className="shrink-0 tabular-nums text-gray-400">
          ⭐{p.form.rating.toFixed(1)}
        </span>
      )}
    </div>
  );
}

export default function TeamPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { profile: p, isLoading } = useTeamProfile(id);
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1)
      router.back();
    else router.push('/standings');
  };

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 flex items-center gap-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <button
          onClick={goBack}
          className="text-sm text-gray-500 dark:text-gray-400"
        >
          ‹ {t('common.back')}
        </button>
        <h1 className="text-lg font-bold text-navy-700 dark:text-white">
          {t('team.title')}
        </h1>
      </header>

      {isLoading && !p && (
        <div className="h-40 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
      )}

      {!isLoading && !p && (
        <div className="py-16 text-center text-gray-400">{t('team.empty')}</div>
      )}

      {p && (
        <>
          <GradeHero p={p} />
          <StateBlock p={p} />
          <StrengthBlock p={p} />
          <CupData p={p} />
          <StyleBlock p={p} />
          <SeasonBlock p={p} />

          {p.fixtures.length > 0 && (
            <Card extra="mb-3 p-4">
              <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
                {t('team.fixtures')}
              </div>
              <div className="space-y-2">
                {p.fixtures.map((f) => (
                  <FixtureRow key={f.eventId} f={f} />
                ))}
              </div>
            </Card>
          )}

          {p.roster.length > 0 && (
            <Card extra="mb-3 p-4">
              <div className="mb-2 flex items-center justify-between text-sm font-bold text-navy-700 dark:text-white">
                <span>{t('team.lineup')}</span>
                {p.rosterFormation && (
                  <span className="font-normal text-gray-400">
                    {p.rosterFormation}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {p.roster.map((pl, i) => (
                  <StarterRow key={i} p={pl} />
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
