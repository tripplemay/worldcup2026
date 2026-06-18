/**
 * GET /api/worldcup/team?id=<espnTeamId> — 单支球队杯赛档案 + 状态评测。
 * 纯计算(ESPN 缓存 + 本地 JSON),不耗赔率配额;短缓存吸收重复请求。
 */
import { cached } from 'lib/cache';
import { buildTeamProfile } from 'lib/team/profile';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

const TTL = 5 * 60_000;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return fail('缺少 id 参数', 400);
  try {
    const profile = await cached(`team:profile:${id}`, TTL, () =>
      buildTeamProfile(id),
    );
    if (!profile) return fail('未找到该球队', 404);
    return ok({ profile });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '球队档案获取失败');
  }
}
