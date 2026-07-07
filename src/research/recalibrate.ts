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
import type { HoldoutManifest } from './governance';
import { partitionWithLockedHoldout } from './evolve';
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
  // 0.75/0.9 供 blend 目标(开盘锚融合)探高锚区;'ours' 目标下该维惰性,多两档无害
  marketWeight: [0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9],
};
const KERNEL_KEYS = Object.keys(KERNEL_GRID) as (keyof KernelPoint)[];

export interface RecalResult {
  objective: 'ours' | 'blend' | 'score';
  baseline: KernelPoint;
  tuned: KernelPoint;
  isGapBaseline: number;
  isGapTuned: number;
  valGapBaseline: number;
  valGapTuned: number; // 判决数(口径随 objective:ours/blend=gap,≤0 即追平市场;score=比分 LL,越小越好)
  evals: number; // IS 评估次数(审计)
  truncated: boolean; // 墙钟预算截断(截断点仍是合法的 IS 局部最优,只是没跑满)
}

/** 轴C:逐联赛内核重校准结果落盘形态(era 实质变化时由 runner 刷新;确定性同 era 免重跑)。 */
export interface KernelStore {
  at: number;
  dataHash: string;
  matchCount: number;
  ours: RecalResult; // 无赔率场景(市场无关)tuned 内核
  blend: RecalResult; // 有赔率场景(开盘锚融合)tuned 内核
  score?: RecalResult; // 比分级(对数似然)tuned 内核(后加字段;缺失 → runner 补齐一次)
}

type GapEval = (
  p: KernelPoint,
  win: { from?: string; to?: string },
) => Promise<number>;

/**
 * 坐标下降重校准。deps.evalGap 可注入(单测用合成碗面;缺省真引擎 runAccuracy)。
 * objective:'ours'(市场无关 1X2 gap)| 'blend'(开盘锚融合 vs 同子集闭盘 —— 轴C
 * 有赔率场景)| 'score'(比分对数似然 —— 联合分布严格评分规则,直接校准 λ/μ/ρ,
 * 矩阵与市场无关,是模型独立价值域的目标函数)。'blend' 说明:(轴C
 * 有赔率场景;基准在同窗内是常数,最小化 gapBlendClose ≡ 最小化 blend Brier)。
 * 确定性:遍历顺序固定、无随机;改进阈值 1e-6 防浮点抖动死循环。
 */
export async function recalibrateKernel(
  dataset: EngineDataset,
  opts?: {
    rounds?: number;
    start?: KernelPoint;
    evalGap?: GapEval;
    objective?: 'ours' | 'blend' | 'score';
    manifest?: HoldoutManifest | null; // 锁定 holdout(生产必传;缺失才自派生首建)
    wallClockMs?: number; // 墙钟预算(缺省不设限保实验确定性;runner 显式传)
    clock?: () => number; // 测试注入
  },
): Promise<RecalResult> {
  const rounds = opts?.rounds ?? 2;
  const objective = opts?.objective ?? 'ours';
  // 锁定 holdout 派生切分(评审 must-fix:自算比例切分会让 L3 随数据增长漂进 train/val,
  // 重蹈 evolve 修过的同类 bug;有持久化 manifest 一律复用,缺失才首建 —— 同 evolve 语义)
  const manifest =
    opts?.manifest ??
    buildHoldoutManifest(dataset, sliceDates(dataset).holdoutFrom, 0);
  const partition = partitionWithLockedHoldout(dataset, manifest.holdoutFrom);
  const safe = excludeHoldout(dataset, manifest);
  const clock = opts?.clock ?? Date.now;
  const wallClockMs = opts?.wallClockMs ?? Infinity;
  const started = clock();
  const evalGap: GapEval =
    opts?.evalGap ??
    (async (p, win) => {
      const r = await runAccuracy(safe, {
        tuning: {
          goalShrink: p.goalShrink,
          dcRho: p.dcRho,
          shrinkEloScale: p.shrinkEloScale,
        },
        home: { eloBonus: p.eloBonus, goalMult: p.goalMult },
        marketWeight: p.marketWeight,
        ...win,
      });
      return objective === 'blend'
        ? r.gapBlendClose
        : objective === 'score'
        ? r.score?.logLoss ?? 99 // 无泊松样本 → 大值(该点不可选)
        : r.gapBrier;
    });

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
  let truncated = false;
  outer: for (let round = 0; round < rounds; round++) {
    let roundImproved = false;
    for (const k of KERNEL_KEYS) {
      for (const v of KERNEL_GRID[k]) {
        if (clock() - started > wallClockMs) {
          truncated = true; // 截断点仍是合法 IS 局部最优(只是没跑满)
          break outer;
        }
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
    objective,
    baseline,
    tuned: cur,
    isGapBaseline: +isGapBaseline.toFixed(5),
    isGapTuned: +curGap.toFixed(5),
    valGapBaseline: +valGapBaseline.toFixed(5),
    valGapTuned: +valGapTuned.toFixed(5),
    evals,
    truncated,
  };
}
