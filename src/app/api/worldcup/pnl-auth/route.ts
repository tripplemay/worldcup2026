/**
 * POST /api/worldcup/pnl-auth { password } — 校验盈亏页浏览密码。
 * 正确则写 httpOnly cookie(后续 /pnl 与 /bet-image 凭此放行);错误 401。
 */
import { NextResponse } from 'next/server';
import { checkViewPassword, PNL_COOKIE } from 'lib/bets/viewAuth';
import { fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { password } = (await req.json()) as { password?: string };
    if (!password || !checkViewPassword(password))
      return fail('浏览密码错误', 401);
    const res = NextResponse.json({ success: true, data: { ok: true } });
    // 直接存原值:Next 的 cookies.set 会自行 URL 编码传输,读取侧再 decode(切勿预编码,否则双重编码)
    res.cookies.set(PNL_COOKIE, password, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 天
    });
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : '校验失败');
  }
}
