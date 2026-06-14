'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from 'lib/i18n/context';

/** 实时状态条:上次更新 N 秒前 · 下次刷新倒计时 · ● LIVE N 场。 */
export default function StatusBar({
  signal,
  liveCount = 0,
  intervalMs,
}: {
  signal: unknown;
  liveCount?: number;
  intervalMs: number;
}) {
  const t = useT();
  const updatedAt = useRef(Date.now());
  const [, tick] = useState(0);

  useEffect(() => {
    updatedAt.current = Date.now();
    tick((x) => x + 1);
  }, [signal]);

  useEffect(() => {
    const timer = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const ago = Math.round((Date.now() - updatedAt.current) / 1000);
  const next = Math.max(0, Math.round(intervalMs / 1000 - ago));

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
        {ago}s {t('statusbar.ago')}
      </span>
      <span>
        · {t('statusbar.next')} {next}s
      </span>
      {liveCount > 0 && (
        <span className="font-medium text-red-500">
          · ● {t('statusbar.live')} {liveCount}
        </span>
      )}
    </div>
  );
}
