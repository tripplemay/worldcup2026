'use client';

import { useEffect } from 'react';

/**
 * 注册 PWA Service Worker(仅生产环境)。
 * 开发环境不注册,避免 SW 缓存干扰热更新。
 */
export default function PwaRegister() {
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      process.env.NODE_ENV === 'production'
    ) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* 注册失败不影响主功能,静默处理 */
      });
    }
  }, []);

  return null;
}
