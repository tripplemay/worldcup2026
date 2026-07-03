/**
 * Phase 10 · 人话成绩单(scoreboard)—— 观测台顶部的直观区域。
 *
 * 回答三个人类问题:①预测得准不准(命中率 vs 市场)②下注下得怎么样(样本外注数/胜率/ROI)
 * ③钱变成了多少(虚拟 1 万本金 → X;前向实测收益)。外加最重要的一句话:**现在能不能下注**
 * (由 G0–G7 关卡判定,逐关进度可视)。每轮 research/run 顺手计算落盘,面板只读。
 * 统计口径:一律【样本外验证窗】(锁定 holdout 之前的 val 段)—— 不用样本内数字骗人。
 */
import { runStrategy } from './engine';
import { runAccuracy } from './accuracy';
import { partitionWithLockedHoldout, toStrategyParams } from './evolve';
import type { EvolutionState } from './evolve';
import { forwardSummary } from './forward';
import type { ForwardStore } from './forward';
import type { HoldoutManifest, PromotionEntry } from './governance';
import type { EngineDataset } from './engine';

export interface Scoreboard {
  at: number;
  status: EvolutionState['status'];
  generation: number;
  insufficientPower: boolean;
  incumbentLabel: string | null;
  // 真钱建议(人话结论的判定源)
  passedAll: boolean;
  blockedAt: string | null;
  gates: { id: string; status: 'pass' | 'fail' | 'skip' }[];
  // ① 预测
  accuracy: {
    oursHit: number;
    marketHit: number;
    gapBrier: number;
    n: number;
  } | null;
  // ② 下注(样本外模拟)
  betting: {
    n: number;
    winRate: number;
    record: string;
    roi: number;
    pnl: number;
    clvAvg: number;
  } | null;
  // ③ 收益(虚拟本金复利 + 前向实测)
  money: { start: number; end: number } | null;
  forward: { n: number; pnl: number; roi: number; clvT: number } | null;
  window: { from: string; to: string } | null; // 样本外窗(诚实标注口径)
}

/** 由当前 incumbent 在【样本外 val 窗】实算成绩单(约 2-3s;每轮 run 一次)。 */
export async function buildScoreboard(
  dataset: EngineDataset,
  state: EvolutionState,
  manifest: HoldoutManifest,
  forward: ForwardStore | null,
  latestLedger: PromotionEntry | null,
): Promise<Scoreboard> {
  const base: Scoreboard = {
    at: state.runId,
    status: state.status,
    generation: state.generation,
    insufficientPower: state.insufficientPower,
    incumbentLabel: state.incumbent?.label ?? null,
    passedAll: latestLedger?.verdict.passedAll ?? false,
    blockedAt: latestLedger?.verdict.blockedAt ?? null,
    gates: (latestLedger?.verdict.gates ?? []).map((g) => ({
      id: g.id,
      status: g.status,
    })),
    accuracy: null,
    betting: null,
    money: null,
    forward: null,
    window: null,
  };
  if (!state.incumbent) return base;

  const partition = partitionWithLockedHoldout(dataset, manifest.holdoutFrom);
  const sp = toStrategyParams(state.incumbent.evo);
  // 样本外窗(val 段;止于锁定 holdout 之前)—— runStrategy 的 from/to 已保证不触 L3
  const s = await runStrategy(dataset, {
    ...sp,
    from: partition.valFrom,
    to: partition.valTo,
  });
  const a = await runAccuracy(dataset, {
    tuning: sp.tuning,
    home: sp.home,
    marketWeight: sp.marketWeight,
    from: partition.valFrom,
    to: partition.valTo,
  });
  const fwd = forwardSummary(forward).find(
    (f) => f.configHash === state.incumbent!.configHash,
  );
  return {
    ...base,
    accuracy: {
      oursHit: a.ours.hitRate,
      marketHit: a.market.hitRate,
      gapBrier: a.gapBrier,
      n: a.n,
    },
    betting: {
      n: s.value.bets,
      winRate: s.value.winRate,
      record: s.value.record,
      roi: s.value.roi,
      pnl: s.value.pnl,
      clvAvg: s.clv.avgClv,
    },
    money: { start: s.bankrollStart, end: s.bankrollEnd },
    forward: fwd
      ? { n: fwd.n, pnl: fwd.pnl, roi: fwd.roi, clvT: fwd.clvT }
      : null,
    window: { from: partition.valFrom, to: partition.valTo },
  };
}
