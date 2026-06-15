/**
 * The Odds API 配额守卫(多 key 聚合)。
 * 逐 key 的跟踪在 keys.ts;这里把聚合结果透传给前端,
 * 低于阈值时前端关闭自动刷新。
 */
import type { QuotaInfo } from './types';
import { getAggregateQuota } from './keys';

export function getQuota(): QuotaInfo {
  const a = getAggregateQuota();
  return {
    remaining: a.remaining,
    used: a.used,
    last: a.last,
    keyCount: a.keyCount,
    total: a.total,
  };
}

/** 剩余配额(跨所有 key)低于此值视为「吃紧」。 */
export const QUOTA_LOW_THRESHOLD = 50;

export function isQuotaLow(): boolean {
  const { remaining } = getAggregateQuota();
  return remaining != null && remaining < QUOTA_LOW_THRESHOLD;
}
