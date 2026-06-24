/**
 * POST   /api/worldcup/bets — 管理员改账(assign / resettle / patch)。
 * DELETE /api/worldcup/bets?id=X  — 删除单张;?all=1 — 清空全部。
 * 鉴权:浏览密码 cookie 或 x-admin-token。
 */
import { updateBet, assignBettor, removeBet, clearBets } from 'lib/bets/bets';
import { settlePendingBets } from 'lib/bets/run';
import { isAdminAuthed } from 'lib/bets/viewAuth';
import { ok, fail } from 'lib/api/respond';
import type { BetSlip } from 'lib/bets/types';

export const dynamic = 'force-dynamic';

/** 写权限:持管理密码 cookie(配置后浏览密码降为只读);或带管理口令(供 API/脚本)。 */
function authorized(req: Request): boolean {
  if (isAdminAuthed(req)) return true;
  const tok = process.env.ADMIN_TOKEN;
  return !!tok && req.headers.get('x-admin-token') === tok;
}

const PATCHABLE: (keyof BetSlip)[] = [
  'stake',
  'potentialReturn',
  'status',
  'pnl',
  'note',
  'bettorId',
  'legs',
  'currency',
  'platform',
];

function sanitizePatch(raw: unknown): Partial<BetSlip> {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<BetSlip> = {};
  for (const k of PATCHABLE) {
    if (k in o) (out as Record<string, unknown>)[k] = o[k];
  }
  return out;
}

export async function POST(req: Request) {
  if (!authorized(req)) return fail('需要浏览密码或管理口令', 401);
  try {
    const body = (await req.json()) as {
      id?: string;
      action?: string;
      bettorId?: string;
      patch?: unknown;
    };
    if (body.action === 'resettle') {
      const r = await settlePendingBets();
      return ok(r);
    }
    if (!body.id) return fail('缺少 id', 400);
    if (body.action === 'assign') {
      if (!body.bettorId) return fail('缺少 bettorId', 400);
      return (await assignBettor(body.id, body.bettorId))
        ? ok({ id: body.id, bettorId: body.bettorId })
        : fail('注单不存在', 404);
    }
    // 默认:白名单 patch
    const patch = sanitizePatch(body.patch);
    if (!Object.keys(patch).length) return fail('无可更新字段', 400);
    return (await updateBet(body.id, patch))
      ? ok({ id: body.id })
      : fail('注单不存在', 404);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '改账失败');
  }
}

export async function DELETE(req: Request) {
  if (!authorized(req)) return fail('需要浏览密码或管理口令', 401);
  const url = new URL(req.url);
  if (url.searchParams.get('all') === '1') {
    const cleared = await clearBets();
    return ok({ cleared });
  }
  const id = url.searchParams.get('id') ?? '';
  if (!id) return fail('缺少 id', 400);
  return (await removeBet(id)) ? ok({ id }) : fail('注单不存在', 404);
}
