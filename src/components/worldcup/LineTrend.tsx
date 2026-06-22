'use client';

/**
 * 盘口走势(读盘):某场庄家「去水真概率」随时间的轨迹 + 开盘→当前漂移。
 * 数据 = /api/worldcup/odds-series(内存时序,trueIP 去水)。直播中累积;不足则空态。
 */
import { useOddsSeries, type OddsSeriesPoint } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';

const W = 280;
const H = 60;
const PAD = 5;
const KEYS = ['home', 'draw', 'away'] as const;
type Key = (typeof KEYS)[number];
const COLOR: Record<Key, string> = {
  home: '#4318FF', // brand
  draw: '#A3AED0', // gray
  away: '#E9A23B', // amber
};

/** 自适应纵轴(让movement可见):取全序列 min/max + 小留白。 */
function scaler(points: OddsSeriesPoint[]): (v: number) => number {
  let lo = 1;
  let hi = 0;
  for (const p of points)
    for (const k of KEYS) {
      if (p[k] < lo) lo = p[k];
      if (p[k] > hi) hi = p[k];
    }
  const pad = Math.max(0.02, (hi - lo) * 0.15);
  lo = Math.max(0, lo - pad);
  hi = Math.min(1, hi + pad);
  const span = hi - lo || 1;
  return (v) => PAD + (1 - (v - lo) / span) * (H - 2 * PAD);
}

function linePath(points: OddsSeriesPoint[], key: Key, y: (v: number) => number) {
  const n = points.length;
  return points
    .map((p, i) => {
      const x = PAD + (i / (n - 1)) * (W - 2 * PAD);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y(p[key]).toFixed(1)}`;
    })
    .join(' ');
}

export default function LineTrend({ matchId }: { matchId: string }) {
  const { t } = useLocale();
  const { points, open, last } = useOddsSeries(matchId);
  if (points.length < 2 || !open || !last)
    return (
      <div className="py-3 text-center text-[11px] text-gray-400">
        {t('odds.trendEmpty')}
      </div>
    );
  const y = scaler(points);
  const label: Record<Key, string> = {
    home: t('odds.home'),
    draw: t('odds.draw'),
    away: t('odds.away'),
  };
  return (
    <div className="mt-1">
      <div className="mb-1 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400">
        {t('odds.trendTitle')}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        {KEYS.map((k) => (
          <path
            key={k}
            d={linePath(points, k, y)}
            fill="none"
            stroke={COLOR[k]}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-around text-[11px] text-gray-600 dark:text-gray-300">
        {KEYS.map((k) => {
          const drift = last[k] - open[k];
          const cls =
            drift > 0.005
              ? 'text-green-500'
              : drift < -0.005
              ? 'text-red-500'
              : 'text-gray-400';
          return (
            <span key={k} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: COLOR[k] }}
              />
              {label[k]} {Math.round(last[k] * 100)}%
              <span className={`tabular-nums ${cls}`}>
                {drift > 0.005 ? '▲' : drift < -0.005 ? '▼' : '·'}
                {Math.abs(Math.round(drift * 100))}
              </span>
            </span>
          );
        })}
      </div>
      <div className="mt-0.5 text-center text-[10px] text-gray-400">
        {t('odds.trendNote')}
      </div>
    </div>
  );
}
