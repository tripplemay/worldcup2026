/**
 * Phase 9 盈亏页门禁:浏览密码(看)+ 管理密码(改)分权。
 *
 * - 浏览密码 PNL_VIEW_PASSWORD → cookie pnl_auth → 只读(/pnl、/bet-image)。
 * - 管理密码 PNL_ADMIN_PASSWORD → cookie pnl_admin → 写(改注单/投注人)。
 * - 管理密码持有者天然也能看(isViewAuthed 包含 admin)。
 *
 * 兼容:未配置 PNL_ADMIN_PASSWORD 时退回旧行为 —— 浏览密码即可写(isAdminAuthed=isViewAuthed),
 * 这样在设置管理密码前不破坏现有使用;配置后浏览密码降为只读。
 *
 * fail-closed:未配置 PNL_VIEW_PASSWORD(且无 admin)时一律拒绝,绝不裸奔。
 */
export const PNL_COOKIE = 'pnl_auth';
export const PNL_ADMIN_COOKIE = 'pnl_admin';

function viewPw(): string {
  return process.env.PNL_VIEW_PASSWORD ?? '';
}
function adminPw(): string {
  return process.env.PNL_ADMIN_PASSWORD ?? '';
}

/** 请求 cookie 中某项是否等于期望值(容忍 Next 传输编码)。 */
function cookieMatches(req: Request, name: string, expected: string): boolean {
  if (!expected) return false;
  const cookie = req.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(cookie);
  if (!m) return false;
  const v = m[1];
  if (v === expected) return true;
  try {
    return decodeURIComponent(v) === expected;
  } catch {
    return false;
  }
}

/** 输入是否为正确的浏览密码(空配置 → false)。 */
export function checkViewPassword(pw: string): boolean {
  const exp = viewPw();
  return exp.length > 0 && pw === exp;
}

/** 输入是否为正确的管理密码(空配置 → false)。 */
export function checkAdminPassword(pw: string): boolean {
  const exp = adminPw();
  return exp.length > 0 && pw === exp;
}

/** 是否已配置独立管理密码(决定是否启用看/改分权)。 */
export function adminPasswordConfigured(): boolean {
  return adminPw().length > 0;
}

/** 是否持有有效管理(写)权限 cookie;未配管理密码时退回浏览权限(旧行为)。 */
export function isAdminAuthed(req: Request): boolean {
  if (!adminPasswordConfigured()) return isViewAuthed(req); // 兼容:未分权
  return cookieMatches(req, PNL_ADMIN_COOKIE, adminPw());
}

/** 是否持有有效浏览(读)权限 cookie;管理密码持有者也算可看。 */
export function isViewAuthed(req: Request): boolean {
  if (cookieMatches(req, PNL_COOKIE, viewPw())) return true;
  if (adminPasswordConfigured() && cookieMatches(req, PNL_ADMIN_COOKIE, adminPw()))
    return true;
  return false;
}
