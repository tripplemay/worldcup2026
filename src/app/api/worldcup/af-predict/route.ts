/**
 * GET /api/worldcup/af-predict?home=&away=&date=YYYY-MM-DD
 * API-Football 现成预测(advice + 胜平负百分比),作为详情页第三方参考(不进我们的融合)。
 */
import { cached } from 'lib/cache';
import { normalizeTeam } from 'lib/match/normalize';
import { getWcFixtures, getPrediction } from 'lib/predict/apifootball';
import { ok, fail } from 'lib/api/respond';

export const dynamic = 'force-dynamic';

const TTL = 30 * 60_000;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const home = sp.get('home');
  const away = sp.get('away');
  const date = sp.get('date');
  if (!home || !away || !date) return fail('缺少 home/away/date 参数', 400);
  try {
    const prediction = await cached(
      `af:predict:${normalizeTeam(home)}|${normalizeTeam(away)}|${date}`,
      TTL,
      async () => {
        const fixtures = await getWcFixtures(date);
        const hN = normalizeTeam(home);
        const aN = normalizeTeam(away);
        const f = fixtures.find(
          (x) => normalizeTeam(x.home) === hN && normalizeTeam(x.away) === aN,
        );
        return f ? await getPrediction(f.id) : null;
      },
    );
    return ok({ prediction });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '预测参考获取失败');
  }
}
