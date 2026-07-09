/**
 * Phase 10 · 跨联赛 pooled CLV 检验:
 * 单联赛 7/9 insufficientPower(G2 的 n≥2500 按构造不可达)—— 合并 9 联赛 value 注
 * 才有功效,把「单联赛证否」升级为「该参数族在欧洲主流联赛主盘整体无效/有效」的
 * 家族级命题。为避免选择偏差,主读数用**预注册默认配置**(DEFAULT_EVO,非各联赛
 * 选后 incumbent);CLV 汇总 + t + 种子自助 95% CI。
 */
import { runStrategy } from './engine';
import {
  toStrategyParams,
  DEFAULT_EVO,
  partitionWithLockedHoldout,
} from './evolve';
import { sliceDates } from './walkforward';
import {
  buildHoldoutManifest,
  excludeHoldout,
  DEFAULT_THRESHOLDS,
  clvQualityOk,
  configHash,
  datasetHash,
} from './governance';
import type { HoldoutManifest } from './governance';
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
    n >= 2 ? Math.sqrt(all.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)) : 0;
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

/** 单联赛 val 窗 value 注 CLV 样本(锁定 holdout 物理剔除;manifest 缺失才自派生首建)。 */
export async function leagueValClvs(
  dataset: EngineDataset,
  params?: StrategyParams,
  manifest?: HoldoutManifest | null,
): Promise<number[]> {
  const p = params ?? toStrategyParams(DEFAULT_EVO);
  const mf =
    manifest ??
    buildHoldoutManifest(dataset, sliceDates(dataset).holdoutFrom, 0);
  const partition = partitionWithLockedHoldout(dataset, mf.holdoutFrom);
  const safe = excludeHoldout(dataset, mf);
  const r = await runStrategy(safe, {
    ...p,
    from: partition.valFrom,
    to: partition.valTo,
  });
  return r.bets
    .filter((b) => b.tier === 'value' && b.clv != null)
    .map((b) => b.clv!);
}

// ── 家族级池化功效检验(2026-07-09 复盘 P2b):单联赛 G2 的 n≥2500 对 8/9 联赛
// 结构性不可达 —— 池化 9 联赛 val 注(合计 ~3300 注)让「n1/g1 式单联赛卡功效的
// 正 CLV 信号」获得一次诚实检验。runner 队列排空后自动刷新落盘。──────────────

export interface PooledScreen {
  nPass: boolean; // n ≥ roiMinN(G2 功效线,2500)
  tPass: boolean; // t > clvMinT(2)
  avgPass: boolean; // avgClv ≥ clvMinAvg(0.005)
  posPass: boolean; // posRate ≥ clvMinPosRate(0.53)
  ciPass: boolean; // 自助 95% CI 下界 > 0
  overall: boolean;
}

export interface PooledConfigRow {
  key: 'default' | 'incumbents';
  label: string;
  result: PooledResult;
  screen: PooledScreen;
}

/** 逐联赛样本缓存:键全中(数据 era + holdout 边界 + 配置哈希)则复用,免全量重跑。 */
export interface PooledLeagueCache {
  dataHash: string;
  holdoutFrom: string | null;
  defHash: string;
  defClvs: number[];
  incHash: string | null;
  incClvs: number[] | null;
}

export interface PooledStore {
  at: number;
  leagues: string[]; // 参与联赛(有数据者)
  /** 判定阈值随店下发(UI 直接渲染,不在文案里二次硬编码)。 */
  thresholds?: { minN: number; minT: number; minAvg: number; minPos: number };
  cache?: Record<string, PooledLeagueCache>;
  configs: PooledConfigRow[];
  note: string;
}

/** G1 质量条件(共享谓词 clvQualityOk,与闸门同口径)+ G2 功效线的池化筛。 */
export function screenPooled(
  r: PooledResult,
  t = DEFAULT_THRESHOLDS,
): PooledScreen {
  const nPass = r.n >= t.roiMinN;
  const quality = clvQualityOk(
    { t: r.tStat, avgClv: r.avgClv, posRate: r.posRate },
    t,
  );
  const ciPass = r.ci95[0] > 0;
  return {
    nPass,
    tPass: r.tStat > t.clvMinT,
    avgPass: r.avgClv >= t.clvMinAvg,
    posPass: r.posRate >= t.clvMinPosRate,
    ciPass,
    overall: nPass && quality && ciPass,
  };
}

const breathe = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 构建池化报告(依赖全注入,可单测):
 *  · default 行 = 预注册默认配置(DEFAULT_EVO)—— 无选择偏差的家族级主读数;
 *  · incumbents 行 = 各联赛现任 incumbent 组合 —— 有选后偏差(IS 选参),只作
 *    "单联赛卡功效的正信号在池化下是否兑现"的参考读数(诚实标注)。
 * 成本纪律(评审确认的三处):
 *  · 逐联赛缓存:CLV 样本按 (dataHash, holdoutFrom, configHash) 键存入 store,
 *    键全中直接复用 —— 常态下每日只有数据真变的联赛重算,不再 9 联赛全量重跑;
 *  · incumbent === 默认配置(bootstrap 锚常态)→ 复用 default 样本,不跑第二趟;
 *  · 联赛间 1s 喘息(对齐 runner drain 的约定,常驻进程不被连续回测锁死)。
 * 单联赛任何异常只跳过该联赛(整联赛 try/catch),不击穿家族级报告。
 */
export async function buildPooledReport(deps: {
  leagues: string[];
  loadDataset: (key: string) => EngineDataset;
  loadManifest: (key: string) => HoldoutManifest | null;
  loadIncumbentParams: (key: string) => StrategyParams | null;
  at: number;
  prev?: PooledStore | null; // 上一份报告(缓存来源)
}): Promise<PooledStore> {
  const defSamples: { league: string; clvs: number[] }[] = [];
  const incSamples: { league: string; clvs: number[] }[] = [];
  const used: string[] = [];
  const cache: Record<string, PooledLeagueCache> = {};
  let incMissing = 0;
  for (const key of deps.leagues) {
    try {
      const dataset = deps.loadDataset(key);
      if (!dataset.allRes.length || !Object.keys(dataset.odds).length) continue;
      const mf = deps.loadManifest(key);
      const dataHash = datasetHash(dataset);
      const holdoutFrom = mf?.holdoutFrom ?? null;
      const defParams = toStrategyParams(DEFAULT_EVO);
      const defHash = configHash(defParams);
      const inc = deps.loadIncumbentParams(key);
      const incHash = inc ? configHash(inc) : null;
      const prev = deps.prev?.cache?.[key];
      const prevFresh =
        prev && prev.dataHash === dataHash && prev.holdoutFrom === holdoutFrom;

      const defClvs =
        prevFresh && prev.defHash === defHash
          ? prev.defClvs
          : await leagueValClvs(dataset, undefined, mf);
      let incClvs: number[] | null = null;
      if (incHash) {
        incClvs =
          incHash === defHash
            ? defClvs // incumbent 仍是预注册默认(bootstrap 锚)→ 同输入零重算
            : prevFresh && prev.incHash === incHash && prev.incClvs
            ? prev.incClvs
            : await leagueValClvs(dataset, inc!, mf);
      } else incMissing += 1;

      used.push(key);
      cache[key] = {
        dataHash,
        holdoutFrom,
        defHash,
        defClvs,
        incHash,
        incClvs,
      };
      defSamples.push({ league: key, clvs: defClvs });
      if (incClvs) incSamples.push({ league: key, clvs: incClvs });
      await breathe(1000); // 联赛间喘息(同 drain 约定)
    } catch (e) {
      console.error('[research-pooled] 联赛跳过(不阻断家族级报告)', key, e);
    }
  }
  const T = DEFAULT_THRESHOLDS;
  const defResult = poolClvStats(defSamples);
  const incResult = poolClvStats(incSamples);
  return {
    at: deps.at,
    leagues: used,
    thresholds: {
      minN: T.roiMinN,
      minT: T.clvMinT,
      minAvg: T.clvMinAvg,
      minPos: T.clvMinPosRate,
    },
    cache,
    configs: [
      {
        key: 'default',
        label: '预注册默认配置(无选择偏差,家族级主读数)',
        result: defResult,
        screen: screenPooled(defResult),
      },
      {
        key: 'incumbents',
        label: `各联赛 incumbent 组合(IS 选后,有乐观偏差,仅参考${
          incMissing ? `;${incMissing} 联赛无 incumbent 未入池` : ''
        })`,
        result: incResult,
        screen: screenPooled(incResult),
      },
    ],
    note: '池化口径:各联赛 val 窗 value 注 CLV 合并;screen = G1 质量条件(与闸门共享谓词)+ G2 功效线 + 自助 CI 下界>0。',
  };
}
