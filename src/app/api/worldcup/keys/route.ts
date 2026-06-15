/**
 * The Odds API key 管理(需管理员口令)。
 *   GET  → 列出现有 key(打码)+ 各自剩余配额
 *   POST {key} → 自动校验有效性(零配额),有效则加入轮换池 + 持久化;无效拒绝
 *
 * 鉴权:请求头 x-admin-token 必须等于 env ADMIN_TOKEN。
 * 未设置 ADMIN_TOKEN 时整个功能禁用(403),避免公开站点裸奔。
 * 只增不删(删除请改持久文件/脚本),降低误操作与攻击面。
 */
import { listKeys, addKeyToPool } from 'lib/odds/keys';
import { validateKey } from 'lib/odds/theoddsapi';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

/** null=功能未启用;true/false=口令是否正确。 */
function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

export async function GET(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('未启用 key 管理(服务端未设置 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  return ok({ keys: listKeys() });
}

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('未启用 key 管理(服务端未设置 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);

  let key = '';
  try {
    const body = (await req.json()) as { key?: string };
    key = (body.key ?? '').trim();
  } catch {
    return fail('请求体无效', 400);
  }
  if (!key) return fail('key 不能为空', 400);

  const valid = await validateKey(key);
  if (!valid) return fail('key 无效(校验未通过)', 400);

  const { added, masked } = addKeyToPool(key);
  if (!added) return fail(`key 已存在(${masked})`, 409);
  return ok({ added: true, masked, keys: listKeys() });
}
