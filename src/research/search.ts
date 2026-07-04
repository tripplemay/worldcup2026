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
  attachTrialMetrics,
  trialCount,
  configHash,
  buildHoldoutManifest,
  excludeHoldout,
  DEFAULT_THRESHOLDS,
} from './governance';
import type { TrialRegistry } from './governance';
import type { EngineDataset, StrategyParams } from './engine';

export interface SweepConfig {
  label: string;
  params: StrategyParams;
  provenance?: 'refine' | 'llm' | 'random' | 'seed' | 'grid'; // 发生器来源(旧网格缺省 grid)
}

export type SelectBy = 'gapBrier' | 'clvT';

export interface ConfigMetrics {
  label: string;
  isGap: number; // 训练段 gap-to-market(选参用,低方差)
  isClvN?: number; // 训练段 value 注 CLV 样本数(两段式选参第二键;旧条目无)
  isClvT?: number; // 训练段 value 注 CLV t 统计量(两段式选参第二键;旧条目无)
  oosGap: number;
  oosValueRoi: number;
  oosClvN: number;
  oosClvT: number;
  oosSharpe: number;
  provenance?: string; // 可选;旧 timeline 条目无此字段,读取端需带缺省
}

export interface EpochResult {
  epoch: number;
  gridSize: number;
  cumulativeTrials: number; // 注册表累计 N(DSR/PBO 分母)
  selectBy: SelectBy;
  partition: Partition;
  configs: ConfigMetrics[];
  winner: ConfigMetrics;
  winnerParams: StrategyParams; // 冠军参数(供面板算参数增量)
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
  dataHash?: string; // 数据 era(进化模式传;DSR/PBO 换全 era 口径 + 去重键维度)
}

/** 事件循环让出(评审 should-fix:同步 CPU 会冻结同进程 livePoller/用户请求)。 */
const yieldLoop = () => new Promise<void>((r) => setTimeout(r, 0));

/** IS 段 CLV 参与选优的最小样本数(不足则该配置在第二键沉底,不可凭少注高 t 胜出)。 */
export const IS_CLV_SELECT_MIN_N = 30;

/** 两段式选参的排序行(最小字段;runSearch 的 rows 超集兼容)。 */
export interface RankRow {
  isGap: number;
  isClvN: number;
  isClvT: number;
  hash: string;
}

/**
 * 两段式嵌套选优(仪器修复:旧实现只按 isGap 排序,而 isGap 仅受 tuning/home/marketWeight
 * 影响,六个下注过滤参数(minEv/minProb/maxEv/useAH/useOU/allowOver)对选优零参与,
 * 平手按 hash 字典序 —— 8 维进化实为 2 维选优 + 6 维随机游走)。
 * 修复后:
 *  · 'gapBrier':①isGap 升序(tuning 形状,低方差)②同组内 IS 段 CLV t 降序(过滤参数,
 *    n≥IS_CLV_SELECT_MIN_N 才可信,不足沉底)③hash 字典序(确定性兜底)。
 *  · 'clvT':①IS 段 CLV t(守卫同上)②isGap ③hash。旧实现用 oosClvT 是选参泄漏,已废。
 * 纪律不变:选参只用 IS 段指标(gap/CLV),绝不用 ROI,绝不看 OOS。
 */
export function selectWinner<T extends RankRow>(
  rows: T[],
  selectBy: SelectBy,
): T {
  const g = (r: RankRow) => (r.isClvN >= IS_CLV_SELECT_MIN_N ? r.isClvT : -1e9);
  return [...rows].sort((a, b) =>
    selectBy === 'gapBrier'
      ? a.isGap - b.isGap || g(b) - g(a) || a.hash.localeCompare(b.hash)
      : g(b) - g(a) || a.isGap - b.isGap || a.hash.localeCompare(b.hash),
  )[0];
}

/** 跑一轮搜索(async:逐配置间让出事件循环)。返回 epoch 结果 + 更新后的注册表。 */
export async function runSearch(
  dataset: EngineDataset,
  grid: SweepConfig[],
  opts?: RunSearchOpts,
): Promise<{ epoch: EpochResult; registry: TrialRegistry }> {
  if (!grid.length) throw new Error('[research] 空网格');
  // label 与 configHash 双重唯一性断言(label 曾是晋级 join key,撞车会配错参数)
  const hashes = grid.map((g) => configHash(g.params));
  if (new Set(grid.map((g) => g.label)).size !== grid.length)
    throw new Error('[research] 网格 label 撞车');
  if (new Set(hashes).size !== grid.length)
    throw new Error('[research] 网格 configHash 撞车(重复配置)');
  // 1) 登记全部配置(看 OOS 前登记;累计 N 含重复/丢弃)
  let registry = opts?.registry ?? newRegistry();
  for (const g of grid)
    registry = registerTrial(registry, g.params, opts?.at, opts?.dataHash);

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
  for (let i = 1; i < S; i++)
    bnd.push(dates[Math.floor((i * dates.length) / S)]);
  const blockOf = (d: string) => {
    let b = 0;
    for (const x of bnd) if (d >= x) b++;
    return b;
  };

  // 3) 逐配置:IS gap / OOS 指标 / OOS 收益 / 全样本按块收益(每配置后让出事件循环)
  const rows = [] as {
    label: string;
    params: StrategyParams;
    hash: string;
    provenance?: SweepConfig['provenance'];
    isGap: number;
    isClvN: number;
    isClvT: number;
    oosGap: number;
    oosValueRoi: number;
    oosClvN: number;
    oosClvT: number;
    oosSharpe: number;
    oosRet: number[];
    perBlock: number[];
  }[];
  for (const g of grid) {
    rows.push(await evalConfig(g));
    await yieldLoop();
  }
  async function evalConfig(g: SweepConfig) {
    const acc = {
      tuning: g.params.tuning,
      home: g.params.home,
      marketWeight: g.params.marketWeight,
    };
    const isGap = (await runAccuracy(safe, { ...acc, to: partition.trainTo }))
      .gapBrier;
    const sOos = await runStrategy(safe, {
      ...g.params,
      from: partition.valFrom,
      to: partition.valTo,
    });
    const oosGap = (
      await runAccuracy(safe, {
        ...acc,
        from: partition.valFrom,
        to: partition.valTo,
      })
    ).gapBrier;
    const oosRet = sOos.bets
      .filter((b) => b.tier === 'value')
      .map((b) => b.pnl / b.stake);
    const sFull = await runStrategy(safe, g.params);
    const blk = Array.from({ length: S }, () => ({ s: 0, n: 0 }));
    for (const b of sFull.bets) {
      if (b.tier !== 'value') continue;
      const i = blockOf(b.date.slice(0, 10));
      blk[i].s += b.pnl / b.stake;
      blk[i].n++;
    }
    // IS 段 value 注 CLV(两段式选参第二键)—— 从全窗跑按日期过滤免费得到。
    // 等价性:全窗跑与单独跑 train 窗共享同一初始资金、同一日期排序且确定性,
    // train 前缀逐注完全一致(资金轨迹只在 val 段才分叉);to 闭区间与 runAccuracy 一致
    const isCs = sFull.bets
      .filter(
        (b) =>
          b.tier === 'value' &&
          b.clv != null &&
          b.date.slice(0, 10) <= partition.trainTo,
      )
      .map((b) => b.clv!);
    const isClvN = isCs.length;
    let isClvT = 0;
    if (isClvN >= 2) {
      const m = isCs.reduce((s, x) => s + x, 0) / isClvN;
      const sd = Math.sqrt(
        isCs.reduce((s, x) => s + (x - m) ** 2, 0) / (isClvN - 1) || 0,
      );
      isClvT = sd > 0 ? m / (sd / Math.sqrt(isClvN)) : m > 0 ? 99 : 0;
    }
    return {
      label: g.label,
      params: g.params,
      hash: configHash(g.params),
      provenance: g.provenance,
      isGap,
      isClvN,
      isClvT: +isClvT.toFixed(4),
      oosGap,
      oosValueRoi: sOos.value.roi,
      oosClvN: sOos.clv.n,
      oosClvT: sOos.clv.tStat,
      oosSharpe: sharpeRatio(oosRet),
      oosRet,
      perBlock: blk.map((x) => (x.n ? x.s / x.n : 0)),
    };
  }
  // 评估后回填指标到注册表(DSR/PBO 全 era 口径的数据源)
  for (const r of rows)
    registry = attachTrialMetrics(registry, r.hash, opts?.dataHash, {
      oosSharpe: +r.oosSharpe.toFixed(6),
      perBlock: r.perBlock.map((x) => +x.toFixed(6)),
    });

  // 4) 两段式嵌套选优(IS 低方差指标:isGap 选 tuning 形状 + IS 段 CLV 选过滤参数;
  //    平手按 configHash 字典序,结果与网格拼接顺序无关;详见 selectWinner)
  const selectBy = opts?.selectBy ?? 'gapBrier';
  const winner = selectWinner(rows, selectBy);

  // 5)+6) PBO 与 DSR 的横截面:进化模式(有 dataHash)用【全 era 去重配置】——
  //    评审 must-fix:精炼后期近邻克隆网格会使当代方差趋零、去膨胀失效;全 era 口径免疫此
  let crossRows: { oosSharpe: number; perBlock: number[] }[] = rows;
  if (opts?.dataHash) {
    const byHash = new Map<string, { oosSharpe: number; perBlock: number[] }>();
    for (const t of registry.trials)
      if (t.dataHash === opts.dataHash && t.oosSharpe != null && t.perBlock)
        byHash.set(t.configHash, {
          oosSharpe: t.oosSharpe,
          perBlock: t.perBlock,
        });
    if (byHash.size >= rows.length) crossRows = [...byHash.values()];
  }
  const M = Array.from({ length: S }, (_, t) =>
    crossRows.map((r) => r.perBlock[t] ?? 0),
  );
  const PBO = pbo(M, S);
  const sharpes = crossRows.map((r) => r.oosSharpe);
  const sMean = mean(sharpes);
  const sharpeVar = mean(sharpes.map((s) => (s - sMean) * (s - sMean)));
  const DSR = deflatedSharpe(winner.oosRet, trialCount(registry), sharpeVar);

  // 7) 三筛(能逐 epoch 完整计算的:CLV/PBO/DSR)
  const T = DEFAULT_THRESHOLDS;
  const clvPass = winner.oosClvN >= T.clvMinN && winner.oosClvT > T.clvMinT;
  const pboPass = PBO < T.pboMax;
  const dsrPass = DSR.dsr > T.roiDsrMin;

  const strip = (r: (typeof rows)[number]): ConfigMetrics => ({
    label: r.label,
    isGap: r.isGap,
    isClvN: r.isClvN,
    isClvT: r.isClvT,
    oosGap: r.oosGap,
    oosValueRoi: r.oosValueRoi,
    oosClvN: r.oosClvN,
    oosClvT: r.oosClvT,
    oosSharpe: +r.oosSharpe.toFixed(4),
    ...(r.provenance ? { provenance: r.provenance } : {}),
  });

  const epoch: EpochResult = {
    epoch: opts?.epoch ?? 1,
    gridSize: grid.length,
    cumulativeTrials: trialCount(registry),
    selectBy,
    partition,
    configs: rows.map(strip),
    winner: strip(winner),
    winnerParams: winner.params, // 行内引用直取(不再按 label find —— label 撞车曾可劫持晋级参数)
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
