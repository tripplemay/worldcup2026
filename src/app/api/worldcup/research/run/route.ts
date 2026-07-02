/**
 * POST /api/worldcup/research/run —— 重算研究调参时间线并落盘(管理员;x-admin-token)。
 * 读 seed/leagues 的 EPL 数据 → runSearch 两轮(goalShrink 网格 → dcRho 网格,累积注册表)→ saveResearchTimeline。
 * 后续接常驻 daemon 后可由其定期刷新;此接口为手动/兜底触发。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { okLive, fail } from 'lib/api/respond';
import { saveResearchTimeline } from 'lib/db/store';
import { runSearch } from 'research/search';
import type { SweepConfig } from 'research/search';
import type { EngineDataset, StrategyParams, MatchOddsView } from 'research/engine';
import type { HistMatch, ResultMatch } from 'lib/predict/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function checkAuth(req: Request): boolean | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return null;
  return req.headers.get('x-admin-token') === token;
}

const seed = (n: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'seed/leagues', n), 'utf8'),
  );

const bet = {
  minProb: 0.3,
  minEv: 0.03,
  maxEv: 0.3,
  kellyFraction: 0.25,
  maxStakePct: 0.05,
  minStake: 10,
  coverageStakePct: 0.005,
  initialBalance: 10000,
};
const cfg = (goalShrink: number, dcRho: number): StrategyParams => ({
  tuning: { goalShrink, dcRho, shrinkEloScale: 100 },
  home: { eloBonus: 65, goalMult: 1.12 },
  marketWeight: 0.4,
  bet,
});

export async function POST(req: Request) {
  const a = checkAuth(req);
  if (a === null) return fail('研究重算未启用(缺 ADMIN_TOKEN)', 403);
  if (!a) return fail('管理口令错误', 401);
  try {
    const dataset: EngineDataset = {
      allHist: Object.values(
        seed('league-epl-2025-historical.json') as Record<string, HistMatch>,
      ),
      allRes: Object.values(
        seed('league-epl-2025-results.json') as Record<string, ResultMatch>,
      ),
      odds: seed('league-epl-2025-oddsx.json') as Record<string, MatchOddsView>,
    };
    const gridA: SweepConfig[] = [0.4, 0.6, 0.8].map((gs) => ({
      label: `gs${gs}`,
      params: cfg(gs, -0.14),
    }));
    const gridB: SweepConfig[] = [-0.2, -0.14, -0.08].map((rho) => ({
      label: `rho${rho}`,
      params: cfg(0.6, rho),
    }));
    const e1 = runSearch(dataset, gridA, { epoch: 1 });
    const e2 = runSearch(dataset, gridB, { epoch: 2, registry: e1.registry });
    const epochs = [e1.epoch, e2.epoch];
    saveResearchTimeline(epochs);
    return okLive({ epochs: epochs.length, latestWinner: e2.epoch.winner.label });
  } catch (e) {
    return fail(e instanceof Error ? e.message : '研究重算失败');
  }
}
