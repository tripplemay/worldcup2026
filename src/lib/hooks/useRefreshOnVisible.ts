'use client';

import { useEffect, useRef } from 'react';

/**
 * 纯判定:仅当页面可见时依次调用刷新器;单个刷新抛错不影响其余。
 * 返回成功触发的数量(便于测试)。抽成纯函数以便单测(hook 的事件接线保持薄)。
 */
export function runRefreshersWhenVisible(
  refreshers: ReadonlyArray<() => unknown>,
  visible: boolean,
): number {
  if (!visible) return 0;
  let fired = 0;
  for (const r of refreshers) {
    try {
      r();
      fired += 1;
    } catch {
      // 单个刷新失败忽略,继续其余,保证一处异常不拖垮整批刷新
    }
  }
  return fired;
}

/**
 * 回前台立即刷新:监听 `visibilitychange` 与 `pageshow`(persisted=bfcache 恢复),
 * 页面重新可见时主动调用传入的刷新函数(通常是各 SWR hook 的 mutate)。
 *
 * 背景:SWR 的 `revalidateOnFocus` 在移动端 PWA(锁屏恢复 / 切后台返回 / bfcache 回退)
 * 上 `focus`/`visibilitychange` 事件不稳定,配合 `refreshWhenHidden:false`(隐藏即暂停轮询)
 * 与 `keepPreviousData:true`,会让实时比分/盘口卡在切走前的旧快照。本 hook 显式补足这一缺口。
 *
 * @param refreshers 刷新回调数组;引用每次渲染变化无妨,内部用 ref 取最新值。
 */
export function useRefreshOnVisible(refreshers: Array<() => unknown>): void {
  const ref = useRef(refreshers);
  ref.current = refreshers;

  useEffect(() => {
    const fire = () =>
      runRefreshersWhenVisible(
        ref.current,
        typeof document === 'undefined' ||
          document.visibilityState === 'visible',
      );
    const onVisibility = () => fire();
    const onPageShow = (e: PageTransitionEvent) => {
      // 仅在 bfcache 恢复(persisted)时刷新;首次加载 SWR 已自行拉取,无需重复。
      if (e.persisted) fire();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}
