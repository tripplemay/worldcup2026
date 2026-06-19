/** 统一 API 响应封装(success/data/error)。 */
import { NextResponse } from 'next/server';

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error?: string;
}

export function ok<T>(data: T): NextResponse {
  return NextResponse.json<ApiResponse<T>>({ success: true, data });
}

/**
 * 实时数据响应:显式 no-store,禁止任何中间层(nginx proxy_cache / 浏览器启发式缓存)
 * 缓存——否则进行中比分/赔率会被代理缓存数分钟,刷新也不更新。
 */
export function okLive<T>(data: T): NextResponse {
  const res = NextResponse.json<ApiResponse<T>>({ success: true, data });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.headers.set('Pragma', 'no-cache');
  return res;
}

export function fail(error: string, status = 500): NextResponse {
  return NextResponse.json<ApiResponse<null>>(
    { success: false, data: null, error },
    { status },
  );
}

/** 当前 UTC 日期 YYYYMMDD(ESPN scoreboard 的 dates 参数格式)。 */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}
