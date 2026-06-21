/**
 * GET /api/worldcup/league/list — 可选竞赛列表(供 UI 切换器)。
 * 含世界杯(wc,走原 WC 预测路径)+ 已注册联赛。纯静态,长缓存。
 */
import { listLeagues } from 'lib/predict/leagues';
import { ok } from 'lib/api/respond';

export const revalidate = 3600;

export async function GET() {
  const competitions = [
    { comp: 'wc', name: 'World Cup 2026', kind: 'wc' as const },
    ...listLeagues().map((l) => ({
      comp: l.comp,
      name: l.name,
      kind: 'league' as const,
    })),
  ];
  return ok({ competitions });
}
