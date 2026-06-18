'use client';

import { MdTrendingUp } from 'react-icons/md';
import Card from 'components/card';
import { useModelStats } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-sm font-bold text-navy-700 dark:text-white">
        {value}
      </div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  );
}

/** 模型战绩卡:读预测存档的命中率/Brier/LogLoss/进球误差 + 近场命中点阵。无数据不渲染。 */
export default function ModelRecord() {
  const { t } = useLocale();
  const { stats } = useModelStats();
  if (!stats || stats.total === 0) return null;

  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1 text-sm font-bold text-navy-700 dark:text-white">
          <MdTrendingUp className="text-brand-500 dark:text-brand-400" />
          {t('predict.modelRecord')}
        </span>
        <span className="text-[10px] text-gray-400">
          {t('predict.mrSample')} {stats.total}
          {stats.reconstructed > 0 ? ` (${stats.live} ${t('predict.mrLive')})` : ''}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label={t('predict.mrHit')} value={pct(stats.hitRate)} />
        <Stat label="Brier" value={stats.brier.toFixed(2)} />
        <Stat label="LogLoss" value={stats.logLoss.toFixed(2)} />
        <Stat
          label={t('predict.mrGoals')}
          value={`${stats.meanPredGoals}/${stats.meanActualGoals}`}
        />
      </div>
      {stats.rows.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {stats.rows.slice(0, 16).map((r) => (
            <span
              key={r.matchId}
              title={`${r.homeTeam}-${r.awayTeam}`}
              className={`h-2 w-2 rounded-full ${
                r.hit ? 'bg-green-500' : 'bg-red-400'
              }`}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
