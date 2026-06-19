/**
 * GET  /api/worldcup/signals — 交易指令流 + 未读数(Copilot 指令台)。
 * POST /api/worldcup/signals — 更新指令状态 { id, status: 'EXECUTED'|'DISMISSED' }(人工跟单/忽略)。
 */
import { loadSignals } from 'lib/db/store';
import { setSignalStatus } from 'lib/trade/signals';
import { ensureLiveBoard } from 'lib/odds/livePoller';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureLiveBoard(); // 确保轮询器在跑(指令靠它 + cron 产出)
    const signals = loadSignals();
    return ok({
      signals,
      unread: signals.filter((s) => s.status === 'UNREAD').length,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '指令获取失败');
  }
}

export async function POST(req: Request) {
  try {
    const { id, status } = (await req.json()) as {
      id?: string;
      status?: string;
    };
    if (!id || (status !== 'EXECUTED' && status !== 'DISMISSED'))
      return fail('参数错误(需 id 与 status=EXECUTED|DISMISSED)', 400);
    return setSignalStatus(id, status)
      ? ok({ id, status })
      : fail('指令不存在', 404);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '更新失败');
  }
}
