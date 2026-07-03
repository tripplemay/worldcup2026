/**
 * POST /api/worldcup/research/run —— 触发后台研究 Runner(管理员;x-admin-token)。
 * v3(多联赛):本路由只做鉴权 + 入队,立即返回;真正执行在进程内后台队列逐联赛跑
 * (research/runner.ts),每联赛独立全额预算(每日代数上限),加联赛不减代数。
 * ?league=e1(单联赛)或缺省=全部注册联赛;?force=1 绕过同日幂等。
 * cron/部署预热 URL 不变(缺省全联赛)。
 */
import { okLive, fail } from 'lib/api/respond';
import { enqueueResearch, runnerStatus } from 'research/runner';
import { LEAGUES, safeLeagueKey } from 'research/leagues';

export const dynamic = 'force-dynamic';

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('研究重算未启用(缺 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get('force') === '1';
    const raw = url.searchParams.get('league');
    const leagues = raw
      ? [safeLeagueKey(raw)]
      : LEAGUES.map((l) => l.key);
    const status = enqueueResearch(leagues.map((league) => ({ league, force })));
    return okLive({ enqueued: leagues, ...status });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '研究触发失败');
  }
}
