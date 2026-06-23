/**
 * Phase 9 盈亏页「浏览密码」门禁(保护数据,不只是隐藏 UI)。
 * 密码经 POST /api/worldcup/pnl-auth 校验后写入 httpOnly cookie;
 * /api/worldcup/pnl 与 /api/worldcup/bet-image 读 cookie 验证(<a> 取图也会自动带 cookie)。
 *
 * 失败关闭(fail-closed):未配置 PNL_VIEW_PASSWORD 时一律拒绝,绝不裸奔。
 * 生产经 GitHub Secret + deploy.yml 注入;本地见 .env.local。
 */
export const PNL_COOKIE = 'pnl_auth';

function expectedPw(): string {
  return process.env.PNL_VIEW_PASSWORD ?? '';
}

/** 输入密码是否正确(空配置 → 永远 false)。 */
export function checkViewPassword(pw: string): boolean {
  const exp = expectedPw();
  return exp.length > 0 && pw === exp;
}

/** 请求是否已持有有效浏览 cookie。 */
export function isViewAuthed(req: Request): boolean {
  const exp = expectedPw();
  if (!exp) return false; // fail-closed
  const cookie = req.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${PNL_COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return false;
  const v = m[1];
  if (v === exp) return true; // 原值
  try {
    return decodeURIComponent(v) === exp; // 反解 Next 传输编码
  } catch {
    return false;
  }
}
