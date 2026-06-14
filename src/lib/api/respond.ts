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

export function fail(error: string, status = 500): NextResponse {
  return NextResponse.json<ApiResponse<null>>({ success: false, data: null, error }, { status });
}

/** 当前 UTC 日期 YYYYMMDD(ESPN scoreboard 的 dates 参数格式)。 */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}
