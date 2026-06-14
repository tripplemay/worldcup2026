/**
 * The Odds API 配额守卫。
 * 从响应头(x-requests-remaining / used / last)读取并记录最新配额,
 * 供 Route Handler 透传给前端;低于阈值时前端关闭自动刷新。
 */
import type { QuotaInfo } from './types';

let latest: QuotaInfo = { remaining: null, used: null, last: null };

const toNum = (v: string | null): number | null => (v == null || v === '' ? null : Number(v));

/** 用一次 API 响应的头更新配额状态。 */
export function updateQuota(headers: Headers): QuotaInfo {
  latest = {
    remaining: toNum(headers.get('x-requests-remaining')),
    used: toNum(headers.get('x-requests-used')),
    last: toNum(headers.get('x-requests-last')),
  };
  return latest;
}

export function getQuota(): QuotaInfo {
  return latest;
}

/** 剩余配额低于此值视为「吃紧」。 */
export const QUOTA_LOW_THRESHOLD = 50;

export function isQuotaLow(): boolean {
  return latest.remaining != null && latest.remaining < QUOTA_LOW_THRESHOLD;
}
