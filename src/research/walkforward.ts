/**
 * Phase 10 · P3a:walk-forward 时间切分 + 嵌套选择原语(反过拟合地基)。
 *
 * 纪律:在 IS(训练段)按【低方差指标】(gap-to-market / CLV,不用 ROI)选配置,
 * 在【没碰过的】OOS(验证段)评 ROI/CLV/gap。L3 holdout 在此**不触碰**(留给 P3c 最终验收)。
 * 训练↔验证间留 embargo 隔离带(相邻轮次经 Elo/form 更新携带信息,防泄漏,脊柱 §5.2)。
 *
 * 说明:当前 embargo 按天数近似;按整轮 gameweek 对齐是后续精化(§5.2),此处先给可用切分。
 */
import { runStrategy } from './engine';
import { runAccuracy } from './accuracy';
import type { EngineDataset, StrategyParams } from './engine';

const dateKey = (iso: string) => iso.slice(0, 10);

/** 平移日期串 N 天(UTC)。研究代码可用 Date(非 Workflow 脚本)。 */
function shiftDate(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 时间三分边界(含 embargo 隔离带)。L3 holdout 仅记录、routine sweep 不触碰。 */
export interface Partition {
  trainTo: string; // 训练段止(含)
  valFrom: string; // 验证段起(= trainTo + embargo)
  valTo: string; // 验证段止(含)
  holdoutFrom: string; // holdout 起(= valTo + embargo);此模块不评它
  holdoutTo: string;
}

/** 按比例切分(默认 L1 60% / L2 20% / L3 20%,embargo 7 天)。 */
export function sliceDates(
  dataset: EngineDataset,
  opts?: { trainFrac?: number; valFrac?: number; embargoDays?: number },
): Partition {
  const trainFrac = opts?.trainFrac ?? 0.6;
  const valFrac = opts?.valFrac ?? 0.2;
  const embargo = opts?.embargoDays ?? 7;
  const dates = dataset.allRes.map((r) => dateKey(r.date)).sort();
  const n = dates.length;
  const trainTo = dates[Math.floor(n * trainFrac)];
  const valTo = dates[Math.floor(n * (trainFrac + valFrac))];
  return {
    trainTo,
    valFrom: shiftDate(trainTo, embargo),
    valTo,
    holdoutFrom: shiftDate(valTo, embargo),
    holdoutTo: dates[n - 1],
  };
}

/** 一个窗口的综合指标(edge + 精度合一)。 */
export interface WindowMetrics {
  matches: number;
  valueBets: number;
  valueRoi: number;
  clvN: number;
  clvAvg: number;
  clvT: number;
  ourBrier: number;
  marketBrier: number;
  gapBrier: number;
}

/** 在 [from,to] 窗内评一个配置:跑引擎(ROI/CLV)+ 精度(gap-to-market)。 */
export function evalWindow(
  dataset: EngineDataset,
  params: StrategyParams,
  from?: string,
  to?: string,
): WindowMetrics {
  const s = runStrategy(dataset, { ...params, from, to });
  const a = runAccuracy(dataset, {
    tuning: params.tuning,
    home: params.home,
    marketWeight: params.marketWeight,
    from,
    to,
  });
  return {
    matches: s.matches,
    valueBets: s.value.bets,
    valueRoi: s.value.roi,
    clvN: s.clv.n,
    clvAvg: s.clv.avgClv,
    clvT: s.clv.tStat,
    ourBrier: a.ours.brier,
    marketBrier: a.market.brier,
    gapBrier: a.gapBrier,
  };
}

export type SelectBy = 'gapBrier' | 'clvAvg';

export interface NestedSelectResult {
  selectBy: SelectBy;
  partition: Partition;
  all: { label: string; is: WindowMetrics }[]; // 各配置 IS 指标
  best: { label: string; is: WindowMetrics; oos: WindowMetrics }; // IS 选出 → OOS 评
}

/**
 * 嵌套选择:在训练段(IS)按 selectBy 低方差指标选最优配置,再在**没碰过的**验证段(OOS)评它。
 * 这是"选择无偏"的核心结构——选参与验收物理分离。
 */
export function nestedSelect(
  dataset: EngineDataset,
  grid: { label: string; params: StrategyParams }[],
  partition: Partition,
  selectBy: SelectBy = 'gapBrier',
): NestedSelectResult {
  if (!grid.length) throw new Error('[research] 空网格');
  const all = grid.map((g) => ({
    label: g.label,
    params: g.params,
    is: evalWindow(dataset, g.params, undefined, partition.trainTo),
  }));
  // IS 选优:gapBrier 越小越好 / clvAvg 越大越好
  const pick = all.reduce((best, cur) =>
    selectBy === 'gapBrier'
      ? cur.is.gapBrier < best.is.gapBrier
        ? cur
        : best
      : cur.is.clvAvg > best.is.clvAvg
      ? cur
      : best,
  );
  const oos = evalWindow(
    dataset,
    pick.params,
    partition.valFrom,
    partition.valTo,
  );
  return {
    selectBy,
    partition,
    all: all.map((a) => ({ label: a.label, is: a.is })),
    best: { label: pick.label, is: pick.is, oos },
  };
}
