'use client';

import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';
import type { QuotaInfo } from 'lib/odds/types';

/** 赔率配额环(Horizon react-circular-progressbar):剩余/500,低于阈值变色。 */
export default function QuotaRing({ quota }: { quota?: QuotaInfo }) {
  const remaining = quota?.remaining ?? null;
  if (remaining == null) return null;
  const pct = Math.round((remaining / 500) * 100);
  const low = remaining < 50;
  const color = low ? '#f53939' : pct < 30 ? '#f59e0b' : '#4318FF';
  return (
    <div className="flex items-center gap-2">
      <div className="h-9 w-9">
        <CircularProgressbar
          value={pct}
          text={`${remaining}`}
          styles={buildStyles({
            pathColor: color,
            textColor: color,
            trailColor: 'rgba(163,174,208,0.2)',
            textSize: '30px',
          })}
        />
      </div>
      <span className="text-[11px] text-gray-500 dark:text-gray-400">
        配额{low ? ' · 已节流' : ''}
      </span>
    </div>
  );
}
