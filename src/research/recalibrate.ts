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
  /** 总进球水平缩放(λ、μ 同乘;1=不变)。2026-07-09 对抗校验定位:冻结 EPL 内核在
   * 8 个非英超联赛把 λ+μ 系统性高估 +24%~+39%(病灶=poisson-xg damp 锚 leagueAvg
   * =球队 xgFor 均值,高于真实进球水平),旧 6 参网格无任何总水平维、结构性修不到。 */
  totalScale: number;
  shrinkEloScale: number;
  eloBonus: number;
  goalMult: number;
  marketWeight: number;
}

// (KERNEL_GRID_VERSION 从网格+基线内容派生,定义在 KERNEL_GRID 之后 —— 见下)

/** 生产冻结值(EPL 校准;toStrategyParams 硬编码的同一组)= 实验基线。 */
export const KERNEL_BASELINE: KernelPoint = {
  goalShrink: 0.6,
  dcRho: -0.14,
  totalScale: 1.0, // 基线=不缩放(EPL 实测 λ+μ 偏差仅 +0.5%,行为中性)
  shrinkEloScale: 100,
  eloBonus: 65,
  goalMult: 1.12,
  marketWeight: 0.4,
};

/** 各维坐标档位(粗网格;坐标下降逐维择优,2 轮足够收敛到网格局部最优)。 */
export const KERNEL_GRID: Record<keyof KernelPoint, number[]> = {
  goalShrink: [0.2, 0.31, 0.4, 0.6, 0.8, 1.0],
  dcRho: [-0.25, -0.2, -0.14, -0.08, -0.04, 0, 0.05],
  // 高估 +24%~39% 对应校正 ≈1/1.39~1/1.24 = 0.72~0.81;两端各留余量
  totalScale: [0.7, 0.78, 0.85, 0.93, 1.0, 1.06],
  shrinkEloScale: [60, 80, 100, 150, 250, 400],
  // 负值域:n1(荷甲)marginBias −0.130 在旧下界 0 仍调不平 → 允许"负主场加成"
  eloBonus: [-50, -25, 0, 25, 50, 65, 80, 110],
  goalMult: [1.0, 1.06, 1.12, 1.18, 1.25],
  // 0.9 曾是上界:6/9 联赛贴界(右删失)→ 扩 0.95/0.98。
  // 不放 1.0:那是 ensemble 奇异点(非市场权重全 0,ours 通道无市场模型 → wsum=0 →
  // 全部预测 null → 各通道 n=0 → 目标兜底 0 被优化器当最优;07-09 本地实验实测踩中)。
  // 「模型 blend 价值是否为零」由 0.98 档 + gapBlendOpen≈0 联合判定,不需要字面 1.0。
  marketWeight: [0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95, 0.98],
};
const KERNEL_KEYS = Object.keys(KERNEL_GRID) as (keyof KernelPoint)[];

const djb2 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
};
/**
 * 网格版本 = 网格+基线内容哈希:runner 据此判定存量 kernel 过期强制全量重校准
 * (era 门控只看数据变化,不看网格变化)。内容派生而非人肉 +1 —— 改档忘 bump
 * 会让扩档在生产永远不生效,该失败模式在 2026-07-09 复盘中被点名,从机制上消除。
 */
export const KERNEL_GRID_VERSION = `g-${djb2(
  JSON.stringify({ grid: KERNEL_GRID, base: KERNEL_BASELINE }),
)}`;

/** KernelPoint → runAccuracy 参数(单点维护:此映射曾在 3 处复制粘贴,加维漏改会静默错)。 */
export function kernelToAccuracyParams(p: KernelPoint): {
  tuning: {
    goalShrink: number;
    dcRho: number;
    totalScale?: number;
    shrinkEloScale: number;
  };
  home: { eloBonus: number; goalMult: number };
  marketWeight: number;
} {
  return {
    tuning: {
      goalShrink: p.goalShrink,
      dcRho: p.dcRho,
      // v1 存量 kernel 缺此字段 → undefined = 1(行为不变)
      totalScale: p.totalScale,
      shrinkEloScale: p.shrinkEloScale,
    },
    home: { eloBonus: p.eloBonus, goalMult: p.goalMult },
    marketWeight: p.marketWeight,
  };
}

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
  gridVersion?: number | string; // 产出时的 KERNEL_GRID_VERSION(内容哈希;缺失=旧版;runner 据此判过期强刷)
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
        ...kernelToAccuracyParams(p),
        ...win,
      });
      // 退化守卫:样本数为 0 的评估一律返回大值(不可选)。gapBlendClose/gapBrier 在
      // n=0 时兜底为 0,若不拦截,优化器会把"预测管线崩溃"当成"完美追平市场"选中
      // (mw=1.0 奇异点实验实测教训;守卫按通道各自的 n 判,防未来任何参数组合再触发)
      return objective === 'blend'
        ? r.blend.n
          ? r.gapBlendClose
          : 99
        : objective === 'score'
        ? r.score?.logLoss ?? 99 // 无泊松样本 → 大值(该点不可选)
        : r.n
        ? r.gapBrier
        : 99;
    });

  const IS = { to: partition.trainTo };
  const VAL = { from: partition.valFrom, to: partition.valTo };

  // 旧持久化点缺新维(totalScale 为 v2 后加)→ 用基线回填,保证坐标下降各维都有起点
  const baseline: KernelPoint = { ...KERNEL_BASELINE, ...(opts?.start ?? {}) };
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
