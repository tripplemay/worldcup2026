/**
 * Phase 10 · P4:搜索环(把 P3a/b/c 串成"一轮搜索")。
 *
 * runSearch(一个 epoch):登记全部配置进注册表(钉死累计 N)→ 物理剔除 holdout →
 * 逐配置在 IS 段测 gap、OOS 段测 ROI/CLV/gap → 按低方差指标嵌套选优 →
 * 全网格×时间块喂 PBO → 冠军 OOS 收益跑 DSR(分母=累计 N)→ CLV/PBO/DSR 三筛。
 * 确定性(无 Date/随机;时间戳/随机种子经参数注入)。多 epoch 循环、G0–G7 全 gauntlet
 * (含 holdout/robustness/MC)由上层组合;此处给单轮搜索的核心数据 + 三筛。
 */
import { runStrategy } from './engine';
import { runAccuracy } from './accuracy';
import { sliceDates } from './walkforward';
import type { Partition } from './walkforward';
import { pbo, deflatedSharpe, sharpeRatio, mean } from './stats';
import type { DsrResult } from './stats';
import {
  newRegistry,
  registerTrial,
  trialCount,
  buildHoldoutManifest,
  excludeHoldout,
  DEFAULT_THRESHOLDS,
} from './governance';
import type { TrialRegistry } from './governance';
import type { EngineDataset, StrategyParams } from './engine';

export interface SweepConfig {
  label: string;
  params: StrategyParams;
}

export type SelectBy = 'gapBrier' | 'clvT';

export interface ConfigMetrics {
  label: string;
  isGap: number; // 训练段 gap-to-market(选参用,低方差)
  oosGap: number;
  oosValueRoi: number;
  oosClvN: number;
  oosClvT: number;
  oosSharpe: number;
}

export interface EpochResult {
  epoch: number;
  gridSize: number;
  cumulativeTrials: number; // 注册表累计 N(DSR/PBO 分母)
  selectBy: SelectBy;
  partition: Partition;
  configs: ConfigMetrics[];
  winner: ConfigMetrics;
  pbo: number; // 全网格 value-ROI 的 CSCV 过拟合概率
  dsr: DsrResult; // 冠军 OOS 收益去膨胀夏普(nTrials=累计 N)
  screen: {
    clvPass: boolean; // G1 CLV 先行(n/t/avg/pos)
    pboPass: boolean; // G3 过拟合(pbo<0.10)
    dsrPass: boolean; // DSR>0.95
    overall: boolean; // 三筛全过才算"值得进 G4+ 全 gauntlet"
  };
}

export interface RunSearchOpts {
  registry?: TrialRegistry;
  epoch?: number;
  selectBy?: SelectBy;
  partition?: Partition;
  blocksForPbo?: number;
  at?: number; // 注册时间戳(注入以保确定性)
}

/** 跑一轮搜索。返回 epoch 结果 + 更新后的注册表(供多 epoch 累积)。 */
export function runSearch(
  dataset: EngineDataset,
  grid: SweepConfig[],
  opts?: RunSearchOpts,
): { epoch: EpochResult; registry: TrialRegistry } {
  if (!grid.length) throw new Error('[research] 空网格');
  // 1) 登记全部配置(看 OOS 前登记;累计 N 含重复/丢弃)
  let registry = opts?.registry ?? newRegistry();
  for (const g of grid) registry = registerTrial(registry, g.params, opts?.at);

  // 2) 切分 + 物理剔除 holdout(sweep 拿不到 L3)
  const partition = opts?.partition ?? sliceDates(dataset);
  const manifest = buildHoldoutManifest(
    dataset,
    partition.holdoutFrom,
    opts?.at ?? 0,
  );
  const safe = excludeHoldout(dataset, manifest);

  // 时间块边界(safe 数据按 date 计数切 S 块),供 PBO
  const S = opts?.blocksForPbo ?? 10;
  const dates = safe.allRes.map((r) => r.date.slice(0, 10)).sort();
  const bnd: string[] = [];
  for (let i = 1; i < S; i++) bnd.push(dates[Math.floor((i * dates.length) / S)]);
  const blockOf = (d: string) => {
    let b = 0;
    for (const x of bnd) if (d >= x) b++;
    return b;
  };

  // 3) 逐配置:IS gap / OOS 指标 / OOS 收益 / 全样本按块收益
  const rows = grid.map((g) => {
    const acc = { tuning: g.params.tuning, home: g.params.home, marketWeight: g.params.marketWeight };
    const isGap = runAccuracy(safe, { ...acc, to: partition.trainTo }).gapBrier;
    const sOos = runStrategy(safe, {
      ...g.params,
      from: partition.valFrom,
      to: partition.valTo,
    });
    const oosGap = runAccuracy(safe, {
      ...acc,
      from: partition.valFrom,
      to: partition.valTo,
    }).gapBrier;
    const oosRet = sOos.bets
      .filter((b) => b.tier === 'value')
      .map((b) => b.pnl / b.stake);
    const sFull = runStrategy(safe, g.params);
    const blk = Array.from({ length: S }, () => ({ s: 0, n: 0 }));
    for (const b of sFull.bets) {
      if (b.tier !== 'value') continue;
      const i = blockOf(b.date.slice(0, 10));
      blk[i].s += b.pnl / b.stake;
      blk[i].n++;
    }
    return {
      label: g.label,
      isGap,
      oosGap,
      oosValueRoi: sOos.value.roi,
      oosClvN: sOos.clv.n,
      oosClvT: sOos.clv.tStat,
      oosSharpe: sharpeRatio(oosRet),
      oosRet,
      perBlock: blk.map((x) => (x.n ? x.s / x.n : 0)),
    };
  });

  // 4) 嵌套选优(IS 低方差指标)
  const selectBy = opts?.selectBy ?? 'gapBrier';
  const winner = [...rows].sort((a, b) =>
    selectBy === 'gapBrier' ? a.isGap - b.isGap : b.oosClvT - a.oosClvT,
  )[0];

  // 5) PBO(全网格 × 时间块 value-ROI)
  const M = Array.from({ length: S }, (_, t) => rows.map((r) => r.perBlock[t]));
  const PBO = pbo(M, S);

  // 6) DSR(冠军 OOS 收益;nTrials=累计 N;sharpeVar=各配置 OOS 夏普方差)
  const sharpes = rows.map((r) => r.oosSharpe);
  const sMean = mean(sharpes);
  const sharpeVar = mean(sharpes.map((s) => (s - sMean) * (s - sMean)));
  const DSR = deflatedSharpe(winner.oosRet, trialCount(registry), sharpeVar);

  // 7) 三筛(能逐 epoch 完整计算的:CLV/PBO/DSR)
  const T = DEFAULT_THRESHOLDS;
  const clvPass =
    winner.oosClvN >= T.clvMinN && winner.oosClvT > T.clvMinT;
  const pboPass = PBO < T.pboMax;
  const dsrPass = DSR.dsr > T.roiDsrMin;

  const strip = (r: (typeof rows)[number]): ConfigMetrics => ({
    label: r.label,
    isGap: r.isGap,
    oosGap: r.oosGap,
    oosValueRoi: r.oosValueRoi,
    oosClvN: r.oosClvN,
    oosClvT: r.oosClvT,
    oosSharpe: +r.oosSharpe.toFixed(4),
  });

  const epoch: EpochResult = {
    epoch: opts?.epoch ?? 1,
    gridSize: grid.length,
    cumulativeTrials: trialCount(registry),
    selectBy,
    partition,
    configs: rows.map(strip),
    winner: strip(winner),
    pbo: PBO,
    dsr: DSR,
    screen: {
      clvPass,
      pboPass,
      dsrPass,
      overall: clvPass && pboPass && dsrPass,
    },
  };
  return { epoch, registry };
}
