/**
 * 微信多 bot 管理(Phase 9b):新增管理员扫码后各得一个独立 clawbot/token,
 * 经此接口把附加 token 存入 wx-bots.json,轮询器 reconcile 后即开始轮询(无需重启)。
 * 鉴权:管理密码(cookie pnl_admin)或 x-admin-token=ADMIN_TOKEN。token 列表只返回脱敏前缀。
 */
import { loadWxBots, saveWxBots } from 'lib/db/store';
import { botKey } from 'lib/wx/client';
import { isAdminAuthed } from 'lib/bets/viewAuth';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

function authed(req: Request): boolean {
  if (isAdminAuthed(req)) return true;
  const t = process.env.ADMIN_TOKEN;
  return !!t && req.headers.get('x-admin-token') === t;
}

/** 列出附加 bot(脱敏:只给 key/label/时间/token 前 4 位)。 */
export async function GET(req: Request) {
  if (!authed(req)) return fail('未授权', 401);
  const bots = loadWxBots().map((b) => ({
    key: botKey(b.token),
    label: b.label ?? null,
    addedAt: b.addedAt,
    tokenHint: `${b.token.slice(0, 4)}…${b.token.slice(-2)}`,
  }));
  return ok({ bots });
}

/** 新增一个 clawbot token(幂等:同 token 不重复)。body: { token, label? } */
export async function POST(req: Request) {
  if (!authed(req)) return fail('未授权', 401);
  const body = (await req.json().catch(() => null)) as {
    token?: unknown;
    label?: unknown;
  } | null;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) return fail('缺少 token', 400);
  const list = loadWxBots();
  const exists = list.some((b) => b.token === token);
  if (!exists) {
    list.push({
      token,
      label: typeof body?.label === 'string' ? body.label : undefined,
      addedAt: Date.now(),
    });
    saveWxBots(list);
  }
  return ok({ added: !exists, key: botKey(token), count: list.length });
}

/** 删除一个附加 bot(按 botKey)。?key=xxx */
export async function DELETE(req: Request) {
  if (!authed(req)) return fail('未授权', 401);
  const key = new URL(req.url).searchParams.get('key') ?? '';
  if (!key) return fail('缺少 key', 400);
  const list = loadWxBots();
  const next = list.filter((b) => botKey(b.token) !== key);
  saveWxBots(next);
  return ok({ removed: list.length - next.length, count: next.length });
}
