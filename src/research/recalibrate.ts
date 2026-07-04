/**
 * Phase 10 · 内核重校准实验(模型概率路线的判决性体检):
 * 复盘确认全部 9 联赛 gapBrier 为正(模型概率系统性劣于闭盘去水),且内核 4 参
 * (eloBonus/goalMult/marketWeight/shrinkEloScale)是 EPL 校准值冻结硬套 —— 本模块
 * 解冻内核 6 参(含 goalShrink/dcRho),按【仅 train 段 IS gapBrier】坐标下降,
 * 回答判决性问题:「逐联赛重校准后 val gapBrier 能否 ≤0(追平市场)?」
 * 纪律:选择只发生在 IS;val 只在起点与终点各评一次(无 val 选择);holdout 物理剔除。
 * 结论≥0 → 模型概率路线关闭(第二次也是最后一次验证);<0 → 该联赛模型路线尚有戏。
 */
import { runAccuracy } from './accuracy';
import { sliceDates } from './walkforward';
import { buildHoldoutManifest, excludeHoldout } from './governance';
import type { EngineDataset } from './engine';

/** 内核点:预测概率质量的全部自由度(下注过滤参数与此无关,不在本实验内)。 */
export interface KernelPoint {
  goalShrink: number;
  dcRho: number;
  shrinkEloScale: number;
  eloBonus: number;
  goalMult: number;
  marketWeight: number;
}

/** 生产冻结值(EPL 校准;toStrategyParams 硬编码的同一组)= 实验基线。 */
export const KERNEL_BASELINE: KernelPoint = {
  goalShrink: 0.6,
  dcRho: -0.14,
  shrinkEloScale: 100,
  eloBonus: 65,
  goalMult: 1.12,
  marketWeight: 0.4,
};

/** 各维坐标档位(粗网格;坐标下降逐维择优,2 轮足够收敛到网格局部最优)。 */
export const KERNEL_GRID: Record<keyof KernelPoint, number[]> = {
  goalShrink: [0.2, 0.31, 0.4, 0.6, 0.8, 1.0],
  dcRho: [-0.25, -0.2, -0.14, -0.08, -0.04, 0, 0.05],
  shrinkEloScale: [60, 80, 100, 150, 250, 400],
  eloBonus: [0, 25, 50, 65, 80, 110],
  goalMult: [1.0, 1.06, 1.12, 1.18, 1.25],
  marketWeight: [0.2, 0.3, 0.4, 0.5, 0.6],
};
const KERNEL_KEYS = Object.keys(KERNEL_GRID) as (keyof KernelPoint)[];

export interface RecalResult {
  baseline: KernelPoint;
  tuned: KernelPoint;
  isGapBaseline: number;
  isGapTuned: number;
  valGapBaseline: number;
  valGapTuned: number; // 判决数:≤0 = 追平/超越市场
  evals: number; // IS 评估次数(审计)
}

type GapEval = (p: KernelPoint, win: { from?: string; to?: string }) => Promise<number>;

/**
 * 坐标下降重校准。deps.evalGap 可注入(单测用合成碗面;缺省真引擎 runAccuracy)。
 * 确定性:遍历顺序固定、无随机;改进阈值 1e-6 防浮点抖动死循环。
 */
export async function recalibrateKernel(
  dataset: EngineDataset,
  opts?: { rounds?: number; start?: KernelPoint; evalGap?: GapEval },
): Promise<RecalResult> {
  const rounds = opts?.rounds ?? 2;
  const partition = sliceDates(dataset);
  const manifest = buildHoldoutManifest(dataset, partition.holdoutFrom, 0);
  const safe = excludeHoldout(dataset, manifest);
  const evalGap: GapEval =
    opts?.evalGap ??
    (async (p, win) =>
      (
        await runAccuracy(safe, {
          tuning: {
            goalShrink: p.goalShrink,
            dcRho: p.dcRho,
            shrinkEloScale: p.shrinkEloScale,
          },
          home: { eloBonus: p.eloBonus, goalMult: p.goalMult },
          marketWeight: p.marketWeight,
          ...win,
        })
      ).gapBrier);

  const IS = { to: partition.trainTo };
  const VAL = { from: partition.valFrom, to: partition.valTo };

  const baseline = opts?.start ?? KERNEL_BASELINE;
  let evals = 0;
  const isGapOf = async (p: KernelPoint) => {
    evals += 1;
    return evalGap(p, IS);
  };

  let cur = baseline;
  const isGapBaseline = await isGapOf(cur);
  let curGap = isGapBaseline;
  for (let round = 0; round < rounds; round++) {
    let roundImproved = false;
    for (const k of KERNEL_KEYS) {
      for (const v of KERNEL_GRID[k]) {
        if (v === cur[k]) continue;
        const cand = { ...cur, [k]: v };
        const g = await isGapOf(cand);
        if (g < curGap - 1e-6) {
          cur = cand;
          curGap = g;
          roundImproved = true;
        }
      }
    }
    if (!roundImproved) break; // 本轮全维无改进 → 已达网格局部最优
  }

  // val 只评两点:基线与终点(选择从未看 val)
  const valGapBaseline = await evalGap(baseline, VAL);
  const valGapTuned = await evalGap(cur, VAL);
  return {
    baseline,
    tuned: cur,
    isGapBaseline: +isGapBaseline.toFixed(5),
    isGapTuned: +curGap.toFixed(5),
    valGapBaseline: +valGapBaseline.toFixed(5),
    valGapTuned: +valGapTuned.toFixed(5),
    evals,
  };
}
