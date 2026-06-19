'use client';

import {
  MdBolt,
  MdLocalFireDepartment,
  MdTrendingUp,
  MdBlock,
} from 'react-icons/md';
import Card from 'components/card';
import PageHeading from 'components/worldcup/PageHeading';
import { useRadar } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { RadarType, RadarAlert } from 'lib/odds/radar';

const TYPE: Record<
  RadarType,
  { Icon: typeof MdBolt; cls: string; badge: string; key: string }
> = {
  STEAM: {
    Icon: MdLocalFireDepartment,
    cls: 'text-orange-500',
    badge: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400',
    key: 'radar.steam',
  },
  BREAKOUT: {
    Icon: MdTrendingUp,
    cls: 'text-brand-500 dark:text-brand-400',
    badge: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
    key: 'radar.breakout',
  },
  RLM: {
    Icon: MdBlock,
    cls: 'text-red-500 dark:text-red-400',
    badge: 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
    key: 'radar.rlm',
  },
};

/** True_IP 走势 sparkline。 */
function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const W = 120;
  const H = 28;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const range = hi - lo || 1;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => (1 - (v - lo) / range) * H;
  const path = data
    .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-28" preserveAspectRatio="none">
      <path
        d={path}
        fill="none"
        className={up ? 'stroke-orange-500' : 'stroke-gray-400'}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function relTime(ts: number, t: (k: string) => string): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return t('radar.justNow');
  if (mins < 60) return `${mins}${t('radar.minAgo')}`;
  return `${Math.floor(mins / 60)}${t('radar.hrAgo')}`;
}

function AlertCard({ a }: { a: RadarAlert }) {
  const { t, tn } = useLocale();
  const cfg = TYPE[a.type];
  const [home, away] = a.teams.split('-');
  return (
    <Card
      extra={`p-3.5 ${a.type === 'RLM' ? 'border border-red-300/60 bg-red-50/40 dark:border-red-500/30 dark:bg-red-500/5' : ''}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.badge}`}
        >
          <cfg.Icon className="text-sm" />
          {t(cfg.key)}
        </span>
        <span className="text-[10px] text-gray-400">{relTime(a.ts, t)}</span>
      </div>
      <div className="text-sm font-medium text-navy-700 dark:text-white">
        {tn(home)} <span className="text-gray-400">vs</span> {tn(away)}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={`flex-1 text-xs ${cfg.cls}`}>{a.message}</p>
        {a.spark.length > 1 && <Spark data={a.spark} />}
      </div>
    </Card>
  );
}

export default function RadarPage() {
  const { t } = useLocale();
  const { alerts, isLoading } = useRadar();

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <PageHeading Icon={MdBolt}>{t('radar.title')}</PageHeading>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('radar.subtitle')}
        </p>
      </header>

      {isLoading && alerts.length === 0 && (
        <div className="h-20 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
      )}
      {!isLoading && alerts.length === 0 && (
        <div className="py-16 text-center text-sm text-gray-400">
          {t('radar.empty')}
        </div>
      )}
      <div className="space-y-3">
        {alerts.map((a) => (
          <AlertCard key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}
