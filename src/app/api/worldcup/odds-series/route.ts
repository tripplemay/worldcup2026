/**
 * GET /api/worldcup/odds-series?id=<liveMatchId> — 某场盘口的「去水真概率」时序轨迹
 *   (读盘:庄家的线如何移动)。源 = 内存环形缓冲(livePoller 每拍录),trueIP 去水,降采样。
 *   零上游消耗(读服务端内存)。
 */
import { getOddsSeries } from 'lib/odds/oddsSeries';
import { trueIP3 } from 'lib/odds/trueIP';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return fail('缺少 id', 400);
    const series = getOddsSeries(id) ?? [];
    const pts: { ts: number; home: number; draw: number; away: number }[] = [];
    for (const s of series) {
      const ip = trueIP3(s[1], s[2], s[3]); // [ts,h,d,a,...]
      if (ip) pts.push({ ts: s[0], home: ip.home, draw: ip.draw, away: ip.away });
    }
    // 降采样到 ~50 点(保留最后一点)
    const step = Math.max(1, Math.ceil(pts.length / 50));
    const points = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    return ok({
      id,
      n: pts.length,
      open: pts[0] ?? null,
      last: pts[pts.length - 1] ?? null,
      points,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '盘口走势失败');
  }
}
