/**
 * POST /api/worldcup/pnl-auth { password } — 校验盈亏页密码。
 * 管理密码 → 写 pnl_admin cookie(可看+可改);浏览密码 → 写 pnl_auth cookie(只读)。
 * 返回 { role: 'admin' | 'view' };都不匹配 401。
 */
import { NextResponse } from 'next/server';
import {
  checkViewPassword,
  checkAdminPassword,
  PNL_COOKIE,
  PNL_ADMIN_COOKIE,
} from 'lib/bets/viewAuth';
import { fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 天
};

export async function POST(req: Request) {
  try {
    const { password } = (await req.json()) as { password?: string };
    if (!password) return fail('密码错误', 401);
    // 优先识别管理密码(管理密码可看可改)
    if (checkAdminPassword(password)) {
      const res = NextResponse.json({
        success: true,
        data: { ok: true, role: 'admin' },
      });
      // 直接存原值:Next cookies.set 自带 URL 编码,读取侧再 decode(勿预编码)
      res.cookies.set(PNL_ADMIN_COOKIE, password, COOKIE_OPTS);
      return res;
    }
    if (checkViewPassword(password)) {
      const res = NextResponse.json({
        success: true,
        data: { ok: true, role: 'view' },
      });
      res.cookies.set(PNL_COOKIE, password, COOKIE_OPTS);
      return res;
    }
    return fail('密码错误', 401);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '校验失败');
  }
}
