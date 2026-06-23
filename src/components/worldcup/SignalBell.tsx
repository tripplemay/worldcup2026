'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MdNotificationsNone } from 'react-icons/md';
import { useSignals } from 'lib/hooks/useWorldCup';

/**
 * 右上角指令铃铛(固定,设置齿轮左侧)。有比「上次查看」更新的指令时显示红点;
 * 进入指令台后由该页清除(localStorage wc:signalsSeenAt + wc-signals-seen 事件)。
 */
export default function SignalBell() {
  const { signals } = useSignals();
  const maxTs = signals.reduce((m, s) => Math.max(m, s.ts), 0);
  const [seenAt, setSeenAt] = useState(0);
  useEffect(() => {
    const read = () =>
      setSeenAt(Number(localStorage.getItem('wc:signalsSeenAt') || 0));
    read();
    window.addEventListener('wc-signals-seen', read);
    return () => window.removeEventListener('wc-signals-seen', read);
  }, []);
  const fresh = maxTs > 0 && maxTs > seenAt;
  return (
    <Link
      href="/signals"
      aria-label="Signals"
      className="fixed z-50 flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-gray-500 shadow-sm backdrop-blur active:opacity-70 dark:bg-navy-800/70 dark:text-gray-300"
      style={{ top: 'calc(env(safe-area-inset-top) + 10px)', right: '3.5rem' }}
    >
      <MdNotificationsNone className="text-xl" />
      {fresh && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-navy-800" />
      )}
    </Link>
  );
}
