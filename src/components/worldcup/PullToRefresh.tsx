'use client';

import { useRef, useState, type ReactNode, type TouchEvent } from 'react';

/** 下拉刷新容器(纯触摸手势,移动端核心交互)。 */
export default function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  children: ReactNode;
}) {
  const startY = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const THRESHOLD = 70;

  const onTouchStart = (e: TouchEvent) => {
    startY.current = window.scrollY <= 0 && !refreshing ? e.touches[0].clientY : 0;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!startY.current) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setPull(Math.min(dy * 0.5, 90));
  };
  const onTouchEnd = async () => {
    if (pull >= THRESHOLD) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    setPull(0);
    startY.current = 0;
  };

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div
        className="flex items-center justify-center overflow-hidden text-xs text-white/50 transition-[height]"
        style={{ height: refreshing ? 32 : pull }}
      >
        {refreshing ? '刷新中…' : pull >= THRESHOLD ? '松开刷新' : pull > 0 ? '下拉刷新' : ''}
      </div>
      {children}
    </div>
  );
}
