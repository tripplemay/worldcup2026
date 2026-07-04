/**
 * Phase 10 · 跨联赛 pooled CLV 检验:
 * 单联赛 7/9 insufficientPower(G2 的 n≥2500 按构造不可达)—— 合并 9 联赛 value 注
 * 才有功效,把「单联赛证否」升级为「该参数族在欧洲主流联赛主盘整体无效/有效」的
 * 家族级命题。为避免选择偏差,主读数用**预注册默认配置**(DEFAULT_EVO,非各联赛
 * 选后 incumbent);CLV 汇总 + t + 种子自助 95% CI。
 */
import { runStrategy } from './engine';
import { toStrategyParams, DEFAULT_EVO } from './evolve';
import { sliceDates } from './walkforward';
import { buildHoldoutManifest, excludeHoldout } from './governance';
import { mulberry32 } from './stats';
import type { EngineDataset, StrategyParams } from './engine';

export interface LeagueClv {
  league: string;
  n: number;
  avgClv: number;
  tStat: number;
}

export interface PooledResult {
  n: number; // 合并 value 注 CLV 样本数(对照 G2 n≥2500)
  avgClv: number;
  tStat: number;
  posRate: number;
  ci95: [number, number]; // 种子自助均值 95% CI
  perLeague: LeagueClv[];
}

/** 纯统计聚合(可单测):多联赛 CLV 样本 → 合并读数 + 自助 CI。 */
export function poolClvStats(
  samples: { league: string; clvs: number[] }[],
  bootN = 2000,
  seed = 20260704,
): PooledResult {
  const perLeague: LeagueClv[] = samples.map((s) => {
    const n = s.clvs.length;
    const m = n ? s.clvs.reduce((a, x) => a + x, 0) / n : 0;
    const sd =
      n >= 2
        ? Math.sqrt(s.clvs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1))
        : 0;
    return {
      league: s.league,
      n,
      avgClv: +m.toFixed(5),
      tStat: sd > 0 ? +(m / (sd / Math.sqrt(n))).toFixed(3) : 0,
    };
  });
  const all = samples.flatMap((s) => s.clvs);
  const n = all.length;
  if (!n)
    return { n: 0, avgClv: 0, tStat: 0, posRate: 0, ci95: [0, 0], perLeague };
  const m = all.reduce((a, x) => a + x, 0) / n;
  const sd =
    n >= 2
      ? Math.sqrt(all.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1))
      : 0;
  const rng = mulberry32(seed);
  const boots: number[] = [];
  for (let b = 0; b < bootN; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += all[Math.floor(rng() * n)];
    boots.push(s / n);
  }
  boots.sort((a, b) => a - b);
  return {
    n,
    avgClv: +m.toFixed(5),
    tStat: sd > 0 ? +(m / (sd / Math.sqrt(n))).toFixed(3) : 0,
    posRate: +(all.filter((x) => x > 0).length / n).toFixed(4),
    ci95: [
      +boots[Math.floor(bootN * 0.025)].toFixed(5),
      +boots[Math.min(bootN - 1, Math.floor(bootN * 0.975))].toFixed(5),
    ],
    perLeague,
  };
}

/** 单联赛 val 窗 value 注 CLV 样本(holdout 物理剔除;与 runSearch 同切分纪律)。 */
export async function leagueValClvs(
  dataset: EngineDataset,
  params?: StrategyParams,
): Promise<number[]> {
  const p = params ?? toStrategyParams(DEFAULT_EVO);
  const partition = sliceDates(dataset);
  const manifest = buildHoldoutManifest(dataset, partition.holdoutFrom, 0);
  const safe = excludeHoldout(dataset, manifest);
  const r = await runStrategy(safe, {
    ...p,
    from: partition.valFrom,
    to: partition.valTo,
  });
  return r.bets
    .filter((b) => b.tier === 'value' && b.clv != null)
    .map((b) => b.clv!);
}
