/**
 * Phase 10 · P4:多 epoch 搜索循环(loop)。
 * 逐 grid 跑 runSearch,注册表跨轮累积(钉死分母持续增长),追踪全局最优候选;
 * 可选 loop-until-no-improve(连续 K 轮最优 CLV-t 无改善即停)。确定性(时间戳/种子注入)。
 * "常驻持续运行" = cron 定时 hit research/run(内部调本循环),或后续独立 daemon。
 */
import { runSearch } from './search';
import type { SweepConfig, EpochResult } from './search';
import { newRegistry } from './governance';
import type { TrialRegistry } from './governance';
import type { StrategyParams } from './engine';
import type { EngineDataset } from './engine';

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
const base = (
  over: Partial<{ goalShrink: number; dcRho: number; marketWeight: number }> & {
    minEv?: number;
  },
): StrategyParams => ({
  tuning: {
    goalShrink: over.goalShrink ?? 0.6,
    dcRho: over.dcRho ?? -0.14,
    shrinkEloScale: 100,
  },
  home: { eloBonus: 65, goalMult: 1.12 },
  marketWeight: over.marketWeight ?? 0.4,
  bet: { ...bet, minEv: over.minEv ?? bet.minEv },
});

/** 默认搜索网格序列(有意义维度:预测 goalShrink/dcRho + 选注 minEv)。 */
export function defaultGrids(): SweepConfig[][] {
  return [
    [0.4, 0.6, 0.8, 1.0].map((gs) => ({
      label: `gs${gs}`,
      params: base({ goalShrink: gs }),
    })),
    [-0.2, -0.14, -0.08, 0.0].map((rho) => ({
      label: `rho${rho}`,
      params: base({ dcRho: rho }),
    })),
    [0.02, 0.03, 0.05].map((mev) => ({
      label: `minEv${mev}`,
      params: base({ minEv: mev }),
    })),
  ];
}

export interface LoopBest {
  epoch: number;
  label: string;
  params: StrategyParams;
  screen: EpochResult['screen'];
  oosClvT: number;
  oosGap: number;
  dsr: number;
  pbo: number;
}

export interface LoopResult {
  epochs: EpochResult[];
  registry: TrialRegistry;
  best: LoopBest | null;
}

/** 候选优劣:先看三筛是否全过,再看 OOS CLV-t(高优),平手看 OOS gap(低优)。 */
function betterThan(a: LoopBest, b: LoopBest): boolean {
  if (a.screen.overall !== b.screen.overall) return a.screen.overall;
  if (Math.abs(a.oosClvT - b.oosClvT) > 1e-9) return a.oosClvT > b.oosClvT;
  return a.oosGap < b.oosGap;
}

/**
 * 跑多 epoch 循环。grids 每项一轮;注册表跨轮累积(可传入历史注册表续接)。
 * opts.stopAfterNoImprove:连续多少轮全局最优无改善即提前停(缺省=跑完全部 grid)。
 */
export async function runSearchLoop(
  dataset: EngineDataset,
  grids: SweepConfig[][],
  opts?: {
    registry?: TrialRegistry;
    startEpoch?: number;
    stopAfterNoImprove?: number;
    at?: number;
  },
): Promise<LoopResult> {
  let registry = opts?.registry ?? newRegistry();
  const epochs: EpochResult[] = [];
  let best: LoopBest | null = null;
  let noImprove = 0;
  let ep = opts?.startEpoch ?? 1;

  for (const grid of grids) {
    if (!grid.length) continue;
    const { epoch, registry: reg } = await runSearch(dataset, grid, {
      registry,
      epoch: ep,
      at: opts?.at,
    });
    registry = reg;
    epochs.push(epoch);
    const cand: LoopBest = {
      epoch: epoch.epoch,
      label: epoch.winner.label,
      params: epoch.winnerParams,
      screen: epoch.screen,
      oosClvT: epoch.winner.oosClvT,
      oosGap: epoch.winner.oosGap,
      dsr: epoch.dsr.dsr,
      pbo: epoch.pbo,
    };
    if (!best || betterThan(cand, best)) {
      best = cand;
      noImprove = 0;
    } else {
      noImprove += 1;
    }
    ep += 1;
    if (
      opts?.stopAfterNoImprove != null &&
      noImprove >= opts.stopAfterNoImprove
    )
      break;
  }

  return { epochs, registry, best };
}
