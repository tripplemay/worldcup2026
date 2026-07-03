/**
 * Phase 10 · P4+:自动进化循环(evolve)。设计 v2 —— 经三视角对抗评审修正。
 *
 * 结构:三发生器(精炼/LLM 提议/种子随机)每代产 ≤12 个**量化后**新配置 → runSearch 评估
 * → 与 incumbent 做【配对显著性障碍】(同 L2 窗逐场 ΔCLV,配对 t>1.28 才算改进,防爬噪声峰)
 * → 状态机 exploring / exhausted(软停,数据实质变化可复活)/ frozen(N_max 硬停,仅显式新 campaign 解除)。
 *
 * 评审修正要点(缺一不可):
 *  · 切分一律用【锁定 holdout】派生(partitionWithLockedHoldout),数据增长时 L3 绝不漂进 L2;
 *  · 去重键 = (configHash, dataHash):跨 era 重评是真实新试验(计 N),精确缓存命中跳过(不计 N);
 *  · label 服务端从 configHash 派生,LLM 输出中的 label/自由文本一律丢弃(防晋级 join 劫持);
 *  · 全部发生器输出按参数步进网格量化后再哈希(杜绝浮点噪声/ε-变体绕过去重);
 *  · 提议者简报(buildProposerBrief)只含 L1/L2 粗化信息,零台账零 G6;rationale 永不回灌;
 *  · G6 预算化(≤3 次/campaign,按 configHash 缓存)在编排器层控制;
 *  · exhausted 需【覆盖下限 + 连续无改进】同时满足(防运行最大值判据早退);
 *  · append-only 进化日志:LLM 原始响应 + 验证器逐条裁决,支持注入式重放。
 */
import { runStrategy } from './engine';
import { runSearch } from './search';
import type { SweepConfig, EpochResult } from './search';
import { promoteCandidate } from './promote';
import {
  registerTrial,
  hasTried,
  eraTrialCount,
  configHash,
  buildHoldoutManifest,
  registryIntact,
  datasetHash,
} from './governance';
import type {
  TrialRegistry,
  HoldoutManifest,
  PromotionEntry,
} from './governance';
import { mulberry32 } from './stats';
import { updateForwardLog, forwardEvidence } from './forward';
import type { ForwardStore } from './forward';
import type { Partition } from './walkforward';
import type { EngineDataset, StrategyParams, BetRecord } from './engine';

const dateKey = (iso: string) => iso.slice(0, 10);

// ── 参数空间(仅阶段 A edge 参数;marketWeight/shrinkEloScale 已证惰性、sizing 属阶段 B,不进化)──
export interface EvoParams {
  goalShrink: number;
  dcRho: number;
  minEv: number;
  minProb: number;
  maxEv: number;
  // 市场白名单开关(0/1;"押哪些市场"本身进搜索空间)
  useAH: number;
  useOU: number;
  allowOver: number;
}
export const PARAM_SPACE: Record<
  keyof EvoParams,
  { lo: number; hi: number; step: number }
> = {
  goalShrink: { lo: 0.2, hi: 1.2, step: 0.01 },
  dcRho: { lo: -0.3, hi: 0.1, step: 0.005 },
  minEv: { lo: 0.01, hi: 0.1, step: 0.001 },
  minProb: { lo: 0.2, hi: 0.5, step: 0.005 },
  maxEv: { lo: 0.15, hi: 0.5, step: 0.005 },
  useAH: { lo: 0, hi: 1, step: 1 },
  useOU: { lo: 0, hi: 1, step: 1 },
  allowOver: { lo: 0, hi: 1, step: 1 },
};
/** 原始默认(旧持久化 incumbent 缺新字段时的回填源;quantizeEvo 兜底用)。 */
const DEFAULT_RAW: EvoParams = {
  goalShrink: 0.6,
  dcRho: -0.14,
  minEv: 0.03,
  minProb: 0.3,
  maxEv: 0.3,
  useAH: 1,
  useOU: 1,
  allowOver: 0,
};
export const PARAM_KEYS = Object.keys(PARAM_SPACE) as (keyof EvoParams)[];

/** 夹紧 + 按步进网格量化(消浮点噪声/ε-变体;缺字段回填默认——兼容旧持久化 shape)。 */
export function quantizeEvo(p: Partial<EvoParams>): EvoParams {
  const out = {} as EvoParams;
  for (const k of PARAM_KEYS) {
    const { lo, hi, step } = PARAM_SPACE[k];
    const v = p[k];
    const raw = v != null && Number.isFinite(v) ? v : DEFAULT_RAW[k]; // 旧 shape 缺字段 → 默认回填
    const clamped = Math.min(hi, Math.max(lo, raw));
    out[k] = +(Math.round(clamped / step) * step).toFixed(6);
  }
  return out;
}

/** EvoParams → 完整 StrategyParams(固定项:EPL calib 主场/marketWeight/四分之一凯利等)。 */
export function toStrategyParams(e: EvoParams): StrategyParams {
  return {
    tuning: { goalShrink: e.goalShrink, dcRho: e.dcRho, shrinkEloScale: 100 },
    home: { eloBonus: 65, goalMult: 1.12 },
    marketWeight: 0.4,
    bet: {
      minProb: e.minProb,
      minEv: e.minEv,
      maxEv: e.maxEv,
      kellyFraction: 0.25,
      maxStakePct: 0.05,
      minStake: 10,
      coverageStakePct: 0.005,
      initialBalance: 10000,
      markets: { ah: e.useAH === 1, ou: e.useOU === 1, over: e.allowOver === 1 },
    },
  };
}
export const DEFAULT_EVO: EvoParams = quantizeEvo(DEFAULT_RAW);

/** label 服务端派生(LLM 的 label 一律丢弃;hash 前 8 位防 join 撞车)。 */
export function deriveLabel(
  generation: number,
  source: 'refine' | 'llm' | 'random' | 'seed',
  params: StrategyParams,
): string {
  return `g${generation}-${source}-${configHash(params).slice(0, 8)}`;
}

// ── 锁定 holdout 派生切分(评审 must-fix:数据增长时 L3 绝不漂进 L2)──────
function shiftDate(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** 以锁定的 holdoutFrom 为唯一边界:train/val 只在 pre-holdout 内切,新到场次只进 holdout 前沿。 */
export function partitionWithLockedHoldout(
  dataset: EngineDataset,
  holdoutFrom: string,
  embargoDays = 7,
): Partition {
  const all = dataset.allRes.map((r) => dateKey(r.date)).sort();
  const pre = all.filter((d) => d < holdoutFrom);
  const n = pre.length;
  const trainTo = pre[Math.min(n - 1, Math.floor(n * 0.75))];
  return {
    trainTo,
    valFrom: shiftDate(trainTo, embargoDays),
    valTo: pre[n - 1],
    holdoutFrom,
    holdoutTo: all[all.length - 1],
  };
}

// ── 发生器 ───────────────────────────────────────────────
export interface GenConfig extends SweepConfig {
  provenance: 'refine' | 'llm' | 'random' | 'seed';
  rationale?: string; // 仅存档/展示;永不回灌任何 prompt
}

const hashToSeed = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
};

/** 精炼:围绕 incumbent 每参 ±radius×全距;步长下限 = 4×该参步进(统计分辨率近似)。 */
export function refineGen(
  incumbent: EvoParams,
  radius: number,
  generation: number,
  registry: TrialRegistry,
  dataHash: string,
  batch: Set<string>,
  quota: number,
): GenConfig[] {
  const out: GenConfig[] = [];
  for (const k of PARAM_KEYS) {
    for (const dir of [1, -1]) {
      if (out.length >= quota) return out;
      const { lo, hi, step } = PARAM_SPACE[k];
      const delta = Math.max(radius * (hi - lo), 4 * step); // 分辨率下限
      const cand = quantizeEvo({
        ...incumbent,
        [k]: incumbent[k] + dir * delta,
      });
      const sp = toStrategyParams(cand);
      const h = configHash(sp);
      if (batch.has(h) || hasTried(registry, sp, dataHash)) continue;
      batch.add(h);
      out.push({
        label: deriveLabel(generation, 'refine', sp),
        params: sp,
        provenance: 'refine',
      });
    }
  }
  return out;
}

/** 种子随机:mulberry32(hash(generation|dataHash)) 边界内均匀采样(状态重建后不重复产旧配置)。 */
export function randomGen(
  generation: number,
  dataHash: string,
  registry: TrialRegistry,
  batch: Set<string>,
  quota: number,
): GenConfig[] {
  const rng = mulberry32(hashToSeed(`${generation}|${dataHash}`));
  const out: GenConfig[] = [];
  let guard = 0;
  while (out.length < quota && guard++ < 60) {
    const e = {} as EvoParams;
    for (const k of PARAM_KEYS) {
      const { lo, hi } = PARAM_SPACE[k];
      e[k] = lo + rng() * (hi - lo);
    }
    const cand = quantizeEvo(e);
    if (cand.minEv >= cand.maxEv) continue;
    const sp = toStrategyParams(cand);
    const h = configHash(sp);
    if (batch.has(h) || hasTried(registry, sp, dataHash)) continue;
    batch.add(h);
    out.push({
      label: deriveLabel(generation, 'random', sp),
      params: sp,
      provenance: 'random',
    });
  }
  return out;
}

// ── LLM 提议验证器(七步管线;任何一步失败该项静默丢弃)──────────────
export interface ValidatorDecision {
  raw: unknown;
  verdict: 'accepted' | 'rejected';
  reason?: string;
}
export function validateProposals(
  rawText: string | null,
  generation: number,
  registry: TrialRegistry,
  dataHash: string,
  batch: Set<string>,
  quota: number,
): { accepted: GenConfig[]; decisions: ValidatorDecision[] } {
  const decisions: ValidatorDecision[] = [];
  const accepted: GenConfig[] = [];
  if (!rawText) return { accepted, decisions };
  let parsed: unknown;
  try {
    // 剥 markdown 围栏后 parse
    parsed = JSON.parse(rawText.replace(/```(json)?/g, '').trim());
  } catch {
    decisions.push({
      raw: rawText.slice(0, 200),
      verdict: 'rejected',
      reason: 'parse',
    });
    return { accepted, decisions };
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { proposals?: unknown[] })?.proposals)
    ? (parsed as { proposals: unknown[] }).proposals
    : null;
  if (!arr) {
    decisions.push({ raw: parsed, verdict: 'rejected', reason: 'shape' });
    return { accepted, decisions };
  }
  for (const item of arr.slice(0, quota * 2)) {
    if (accepted.length >= quota) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      decisions.push({ raw: item, verdict: 'rejected', reason: 'not-object' });
      continue;
    }
    const rec = item as Record<string, unknown>;
    // strict:除 5 参 + rationale 外的未知键 → 整项丢弃(防幻觉参数名/label 注入)
    const extra = Object.keys(rec).filter(
      (k) => !(PARAM_KEYS as string[]).includes(k) && k !== 'rationale',
    );
    if (extra.length) {
      decisions.push({
        raw: rec,
        verdict: 'rejected',
        reason: `unknown-keys:${extra.join(',')}`,
      });
      continue;
    }
    const e = {} as EvoParams;
    let bad: string | null = null;
    for (const k of PARAM_KEYS) {
      // 缺省字段回填默认(LLM 可只提 5 个核心参;市场开关等缺省沿用 DEFAULT_RAW)
      const v = rec[k] == null ? DEFAULT_RAW[k] : Number(rec[k]);
      if (!Number.isFinite(v)) {
        bad = `non-finite:${k}`;
        break;
      }
      e[k] = v;
    }
    if (bad) {
      decisions.push({ raw: rec, verdict: 'rejected', reason: bad });
      continue;
    }
    const cand = quantizeEvo(e); // 夹紧 + 量化
    if (cand.minEv >= cand.maxEv) {
      decisions.push({ raw: rec, verdict: 'rejected', reason: 'minEv>=maxEv' });
      continue;
    }
    const sp = toStrategyParams(cand);
    const h = configHash(sp);
    if (batch.has(h) || hasTried(registry, sp, dataHash)) {
      decisions.push({ raw: rec, verdict: 'rejected', reason: 'duplicate' });
      continue;
    }
    batch.add(h);
    const rationale =
      typeof rec.rationale === 'string'
        ? rec.rationale.slice(0, 200)
        : undefined;
    accepted.push({
      label: deriveLabel(generation, 'llm', sp),
      params: sp,
      provenance: 'llm',
      rationale,
    });
    decisions.push({ raw: rec, verdict: 'accepted' });
  }
  return { accepted, decisions };
}

// ── 提议者简报(回灌 LLM 的;只含 L1/L2 粗化信息,零台账零 G6;与分析员简报物理分离)──
const bucketClvT = (t: number) =>
  t < -2 ? '<-2' : t < 0 ? '-2..0' : t < 1 ? '0..1' : t < 2 ? '1..2' : '>2';
export function buildProposerBrief(
  incumbent: { params: EvoParams; clvT: number; gap: number } | null,
  recent: {
    gen: number;
    source: string;
    clvT: number;
    gap: number;
    improved: boolean;
  }[],
  triedCount: number,
): string {
  // Thresholdout-lite:L2 读数经种子 Laplace 噪声(b=0.25)再分桶,限制提议通道对固定 OOS 的自适应剥削
  const rng = mulberry32(hashToSeed(`brief|${triedCount}`));
  const lap = () => {
    const u = rng() - 0.5;
    return -0.25 * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  };
  const noisy = (t: number) => t + lap();
  const inc = incumbent
    ? `当前最优:${JSON.stringify(incumbent.params)},OOS CLV-t 桶 ${bucketClvT(
        noisy(incumbent.clvT),
      )},gap ${incumbent.gap.toFixed(2)}`
    : '尚无最优(首代)';
  const hist = recent
    .slice(-8)
    .map(
      (r) =>
        `- 代${r.gen} ${r.source}:CLV-t 桶 ${bucketClvT(
          r.clvT,
        )},gap ${r.gap.toFixed(3)},${r.improved ? '有改进' : '无改进'}`,
    )
    .join('\n');
  const space = PARAM_KEYS.map(
    (k) => `${k}∈[${PARAM_SPACE[k].lo},${PARAM_SPACE[k].hi}]`,
  ).join(', ');
  return `联赛策略参数搜索(EPL,样本外验证)。参数空间:${space}。
${inc}
已试配置数:${triedCount}
最近各代:
${hist || '(无)'}
请提出最多 4 组**未试过的新参数组合**去探索可能的 edge 区域。只输出 JSON:{"proposals":[{"goalShrink":..,"dcRho":..,"minEv":..,"minProb":..,"maxEv":..,"rationale":"一句话"}]}。数值必须在区间内。`;
}

// ── 配对显著性障碍(评审 must-fix:取代"CLV-t 比大小",防爬噪声峰)────────
export function clvLcb(bets: BetRecord[]): { lcb: number; n: number } {
  const cs = bets
    .filter((b) => b.tier === 'value' && b.clv != null)
    .map((b) => b.clv!);
  const n = cs.length;
  if (n < 10) return { lcb: -99, n };
  const mean = cs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(
    cs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) || 0,
  );
  return { lcb: +(mean - (1.64 * sd) / Math.sqrt(n)).toFixed(5), n };
}
/** 同窗配对 ΔCLV:挑战者 vs 在位者按比赛配对,配对 t>1.28(单侧 p<0.1)且 n≥30 才算改进。 */
export function pairedClvImprovement(
  challenger: BetRecord[],
  incumbent: BetRecord[],
  minPairs = 30,
  tThreshold = 1.28,
): { improved: boolean; nPairs: number; t: number } {
  const key = (b: BetRecord) => `${dateKey(b.date)}|${b.home}|${b.away}`;
  const incMap = new Map<string, number>();
  for (const b of incumbent)
    if (b.tier === 'value' && b.clv != null) incMap.set(key(b), b.clv);
  const deltas: number[] = [];
  for (const b of challenger) {
    if (b.tier !== 'value' || b.clv == null) continue;
    const ic = incMap.get(key(b));
    if (ic != null) deltas.push(b.clv - ic);
  }
  const n = deltas.length;
  if (n < minPairs) return { improved: false, nPairs: n, t: 0 };
  const mean = deltas.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(
    deltas.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) || 0,
  );
  const t = sd > 0 ? mean / (sd / Math.sqrt(n)) : mean > 0 ? 99 : 0;
  return { improved: t > tThreshold, nPairs: n, t: +t.toFixed(2) };
}

// ── 进化状态(evolution-state.json)──────────────────────────
export type EvoStatus = 'exploring' | 'exhausted' | 'frozen';
export interface Incumbent {
  label: string;
  configHash: string;
  evo: EvoParams;
  clvT: number;
  clvLcb: number;
  gap: number;
  screenOverall: boolean;
  dataHash: string; // 指标评于哪个数据 era(跨 era 不可比 → 复活后先重评)
}
export interface HoldoutTouch {
  configHash: string;
  at: number;
  vintage: number; // manifest.lockedAt
}
export interface EvolutionState {
  schemaVersion: 1;
  runId: number;
  generation: number;
  status: EvoStatus;
  dataHash: string;
  matchCount: number;
  incumbent: Incumbent | null;
  noImproveCount: number;
  refineRadius: number; // 全距比例;证据驱动收缩/扩张
  lcbHistory?: number[]; // 每代最优 CLV LCB(exhausted 的停滞判据)
  holdoutTouches: HoldoutTouch[];
  insufficientPower: boolean;
  lastRunDay?: string; // UTC 日,幂等守卫
  lastGauntletHash?: string; // 防同一 incumbent 每日重跑 gauntlet
}
export const N_MAX = 120; // campaign 试验硬上限(用户定档;era 计)
export const G6_BUDGET = 3; // holdout 触碰预算(用户定档)
export const K_NO_IMPROVE = 3; // 连续无改进代数(需与覆盖下限同时满足)
export const COVERAGE_FLOOR = 60; // exhausted 需 era 试验 ≥ 此(防运行最大值早退)
export const REVIVE_MIN_MATCHES = 30; // 复活的数据实质变化阈值
export const GEN_SIZE = 12;
export const QUOTA = { refine: 4, llm: 4, random: 4 };

export function newEvolutionState(
  runId: number,
  dataHash: string,
  matchCount: number,
  insufficientPower: boolean,
): EvolutionState {
  return {
    schemaVersion: 1,
    runId,
    generation: 0,
    status: 'exploring',
    dataHash,
    matchCount,
    incumbent: null,
    noImproveCount: 0,
    refineRadius: 0.25,
    holdoutTouches: [],
    insufficientPower,
  };
}

// ── 进化日志(append-only;含 LLM 原始响应与验证器裁决 → 支持注入式重放)──
export interface EvolutionLogEntry {
  generation: number;
  at: number;
  dataHash: string;
  trialsBefore: number;
  proposerBrief: string;
  llmRaw: string | null;
  validatorDecisions: ValidatorDecision[];
  accepted: { label: string; provenance: string; params: StrategyParams }[];
  winnerLabel: string;
  improved: boolean;
  pairedT: number;
  incumbentLabel: string | null;
  budgetUsedEra: number;
  statusAfter: EvoStatus;
}

// ── 编排器:一次 run 内循环多代直到 exhausted/frozen/墙钟护栏 ────────────
export interface EvolveDeps {
  now: number; // 注入时间戳(落盘/审计)
  llmPropose?: (brief: string) => Promise<string | null>; // LLM 调用(注入;重放时喂日志)
  clock?: () => number; // 墙钟(缺省 Date.now;测试注入)
  wallClockBudgetMs?: number; // 单次 run 墙钟护栏(默认 200s)
  maxGenerations?: number; // 测试用上限
}
export interface EvolveResult {
  state: EvolutionState;
  registry: TrialRegistry;
  newEpochs: EpochResult[];
  ledgerAppend: PromotionEntry[];
  logs: EvolutionLogEntry[];
  manifest: HoldoutManifest;
  forward: ForwardStore;
  note: string;
}

export async function runEvolutionCycle(
  input: {
    dataset: EngineDataset;
    state: EvolutionState | null;
    registry: TrialRegistry;
    timeline: EpochResult[];
    manifest: HoldoutManifest | null;
    forward?: ForwardStore | null;
  },
  deps: EvolveDeps,
): Promise<EvolveResult> {
  const { dataset } = input;
  const clock = deps.clock ?? Date.now;
  const budget = deps.wallClockBudgetMs ?? 200_000;
  const started = clock();
  const dataHash = datasetHash(dataset);
  const matchCount = dataset.allRes.length;

  // 注册表完整性(损坏 → 拒跑,防 DSR 分母静默归零)
  if (!registryIntact(input.registry, input.timeline.length > 0))
    throw new Error(
      '[research] 试验注册表完整性校验失败(可能损坏)—— 拒绝运行,请人工恢复',
    );

  // holdout manifest:锁定为唯一事实源;缺失才首建
  const manifest =
    input.manifest ??
    buildHoldoutManifest(
      dataset,
      partitionWithLockedHoldout(
        dataset,
        // 首建:用全数据 80% 分位做锁定日
        dataset.allRes.map((r) => dateKey(r.date)).sort()[
          Math.floor(dataset.allRes.length * 0.8)
        ],
      ).holdoutFrom,
      deps.now,
    );
  const partition = partitionWithLockedHoldout(dataset, manifest.holdoutFrom);

  // value 注经验占比 ~0.8×场次(7 季 EPL 实测 1976/2660≈0.74)→ 达不到 G2 的 n≥2500 即标记功效不足
  const insufficientPower = matchCount * 0.8 < 2500;
  let state =
    input.state && input.state.schemaVersion === 1
      ? { ...input.state, runId: deps.now }
      : newEvolutionState(deps.now, dataHash, matchCount, insufficientPower);
  state.insufficientPower = insufficientPower;

  let registry = input.registry;
  const newEpochs: EpochResult[] = [];
  const logs: EvolutionLogEntry[] = [];
  const ledgerAppend: PromotionEntry[] = [];

  // ── era 变更处理 ──
  if (state.dataHash !== dataHash) {
    const grew = matchCount - state.matchCount;
    const substantial =
      grew >= REVIVE_MIN_MATCHES ||
      grew / Math.max(1, state.matchCount) >= 0.03;
    if (state.status === 'frozen') {
      // frozen 是硬停:数据变化不解除(仅显式新 campaign);前向照常推进(不烧搜索预算)
      return {
        state: { ...state, runId: deps.now },
        registry,
        newEpochs,
        ledgerAppend,
        logs,
        manifest,
        forward: updateForwardLog(dataset, input.forward ?? null, []),
        note: 'frozen(N_max 已耗尽):数据变化不解除,需显式 newCampaign',
      };
    }
    if (substantial) {
      // 复活:第一件事 = incumbent 在新 era 同窗重评(真实新试验,计 N)
      state = {
        ...state,
        dataHash,
        matchCount,
        status: 'exploring',
        noImproveCount: 0,
      };
      if (state.incumbent) {
        const sp = toStrategyParams(state.incumbent.evo);
        registry = registerTrial(registry, sp, deps.now, dataHash);
        const r = runStrategy(dataset, {
          ...sp,
          from: partition.valFrom,
          to: partition.valTo,
        });
        const lcb = clvLcb(r.bets);
        state.incumbent = {
          ...state.incumbent,
          clvT: r.clv.tStat,
          clvLcb: lcb.lcb,
          dataHash,
        };
      }
    } else {
      // 未达实质阈值:更新计数但不复活(exhausted 保持)
      state = { ...state, matchCount };
    }
  }

  // ── 主循环:逐代进化 ──
  let note = '';
  while (
    state.status === 'exploring' &&
    clock() - started < budget &&
    (deps.maxGenerations == null || newEpochs.length < deps.maxGenerations)
  ) {
    if (eraTrialCount(registry, dataHash) >= N_MAX) {
      state = { ...state, status: 'frozen' };
      note = `frozen:era 试验数达 N_max=${N_MAX}`;
      break;
    }
    const generation = state.generation + 1;
    const batch = new Set<string>();
    // ① LLM 提议(可选;失败由其余补足)
    const brief = buildProposerBrief(
      state.incumbent
        ? {
            params: state.incumbent.evo,
            clvT: state.incumbent.clvT,
            gap: state.incumbent.gap,
          }
        : null,
      logs.map((l) => ({
        gen: l.generation,
        source: 'mix',
        clvT: 0,
        gap: 0,
        improved: l.improved,
      })),
      eraTrialCount(registry, dataHash),
    );
    let llmRaw: string | null = null;
    if (deps.llmPropose) {
      try {
        llmRaw = await deps.llmPropose(brief);
      } catch {
        llmRaw = null;
      }
    }
    const { accepted: llmConfigs, decisions } = validateProposals(
      llmRaw,
      generation,
      registry,
      dataHash,
      batch,
      QUOTA.llm,
    );
    // ② 精炼(围绕 incumbent;首代无 incumbent 则以 DEFAULT_EVO 为种子锚)
    const anchor = state.incumbent?.evo ?? DEFAULT_EVO;
    const refined = refineGen(
      anchor,
      state.refineRadius,
      generation,
      registry,
      dataHash,
      batch,
      QUOTA.refine,
    );
    // ③ 种子随机补足到 GEN_SIZE
    const fill = GEN_SIZE - llmConfigs.length - refined.length;
    const randoms = randomGen(
      generation,
      dataHash,
      registry,
      batch,
      Math.max(0, fill),
    );
    // 首代:锚点本身也入网格(bootstrap incumbent)
    const seedCfg: GenConfig[] = [];
    if (!state.incumbent) {
      const sp = toStrategyParams(anchor);
      if (!hasTried(registry, sp, dataHash) && !batch.has(configHash(sp))) {
        batch.add(configHash(sp));
        seedCfg.push({
          label: deriveLabel(generation, 'seed', sp),
          params: sp,
          provenance: 'seed',
        });
      }
    }
    // 整代按 configHash 排序(结果与发生器拼接顺序无关,平手裁决确定性)
    const genConfigs = [...seedCfg, ...refined, ...llmConfigs, ...randoms].sort(
      (a, b) => configHash(a.params).localeCompare(configHash(b.params)),
    );
    if (!genConfigs.length) {
      // 无新可试(当前半径下空间已干):先扩半径再试一次,仍空 → exhausted
      if (state.refineRadius < 0.5) {
        state = {
          ...state,
          refineRadius: Math.min(0.5, state.refineRadius * 1.5),
        };
        continue;
      }
      state = { ...state, status: 'exhausted' };
      note = 'exhausted:发生器无法产出未试配置';
      break;
    }

    // ④ 评估一代(runSearch:锁定切分 + 注册 + 三筛;registry 经其累积)
    const { epoch, registry: reg2 } = await runSearch(dataset, genConfigs, {
      registry,
      epoch: generation,
      partition,
      dataHash,
      at: deps.now,
    });
    registry = reg2;
    newEpochs.push(epoch);

    // ⑤ 配对显著性障碍:代冠军 vs incumbent 同 L2 窗
    const winnerCfg = genConfigs.find((g) => g.label === epoch.winner.label)!;
    const winRun = runStrategy(dataset, {
      ...winnerCfg.params,
      from: partition.valFrom,
      to: partition.valTo,
    });
    const winLcb = clvLcb(winRun.bets);
    let improved = false;
    let pairedT = 0;
    if (!state.incumbent) {
      improved = true; // 首代 bootstrap
    } else if (configHash(winnerCfg.params) !== state.incumbent.configHash) {
      const incRun = runStrategy(dataset, {
        ...toStrategyParams(state.incumbent.evo),
        from: partition.valFrom,
        to: partition.valTo,
      });
      const pr = pairedClvImprovement(winRun.bets, incRun.bets);
      improved = pr.improved;
      pairedT = pr.t;
    }

    const lcbHistory = [...(state.lcbHistory ?? []), winLcb.lcb];
    if (improved) {
      const evo = extractEvo(winnerCfg.params);
      state = {
        ...state,
        generation,
        incumbent: {
          label: winnerCfg.label,
          configHash: configHash(winnerCfg.params),
          evo,
          clvT: epoch.winner.oosClvT,
          clvLcb: winLcb.lcb,
          gap: epoch.winner.oosGap,
          screenOverall: epoch.screen.overall,
          dataHash,
        },
        noImproveCount: 0,
        lcbHistory,
        // 证据驱动收缩(有显著改进才收);首代 bootstrap 不收
        refineRadius: state.incumbent
          ? Math.max(0.02, state.refineRadius * 0.5)
          : state.refineRadius,
      };
    } else {
      state = {
        ...state,
        generation,
        lcbHistory,
        noImproveCount: state.noImproveCount + 1,
        refineRadius: Math.min(0.5, state.refineRadius * 1.5), // 连败扩半径让位探索
      };
    }
    // exhausted 判据(复合,防运行最大值早退):连续无改进 + 覆盖下限 + LCB 停滞(近3代最优无实质抬升)
    const hist = state.lcbHistory ?? [];
    const lcbStagnant =
      hist.length >= 4 &&
      Math.max(...hist.slice(-3)) -
        Math.max(...hist.slice(0, hist.length - 3)) <
        0.002;
    if (
      state.noImproveCount >= K_NO_IMPROVE &&
      eraTrialCount(registry, dataHash) >= COVERAGE_FLOOR &&
      lcbStagnant
    ) {
      state = { ...state, status: 'exhausted' };
      note = `exhausted:连续 ${K_NO_IMPROVE} 代无配对显著改进(era 试验 ${eraTrialCount(
        registry,
        dataHash,
      )})`;
    }

    logs.push({
      generation,
      at: deps.now,
      dataHash,
      trialsBefore: epoch.cumulativeTrials - epoch.gridSize,
      proposerBrief: brief,
      llmRaw,
      validatorDecisions: decisions,
      accepted: genConfigs.map((g) => ({
        label: g.label,
        provenance: g.provenance,
        params: g.params,
      })),
      winnerLabel: epoch.winner.label,
      improved,
      pairedT,
      incumbentLabel: state.incumbent?.label ?? null,
      budgetUsedEra: eraTrialCount(registry, dataHash),
      statusAfter: state.status,
    });
  }

  // ── G7 前向管道:incumbent 加入追踪,补记 watermark 之后新到完赛的虚拟注 ──
  const forward = updateForwardLog(
    dataset,
    input.forward ?? null,
    state.incumbent
      ? [
          {
            configHash: state.incumbent.configHash,
            label: state.incumbent.label,
            evo: state.incumbent.evo,
          },
        ]
      : [],
  );

  // ── G6 预算化 gauntlet:仅 incumbent 变更 + 首过 G0–G5 + 预算未耗尽 ──
  if (
    state.incumbent &&
    state.status !== 'frozen' &&
    state.incumbent.configHash !== state.lastGauntletHash
  ) {
    const sp = toStrategyParams(state.incumbent.evo);
    const lastEpoch =
      newEpochs[newEpochs.length - 1] ??
      input.timeline[input.timeline.length - 1];
    const ctx = {
      epoch: state.generation,
      dsr: lastEpoch?.dsr.dsr ?? 0,
      pbo: lastEpoch?.pbo ?? 1,
    };
    // 先跑 G0–G5(skipHoldout):卡在 G6 = 通过了 G0–G5
    const fwd = forwardEvidence(forward, state.incumbent.configHash);
    const pre = await promoteCandidate(dataset, sp, ctx, {
      holdoutFrom: manifest.holdoutFrom,
      skipHoldout: true,
      forward: fwd,
    });
    let final = pre;
    const touched = state.holdoutTouches.some(
      (t) => t.configHash === state.incumbent!.configHash,
    );
    if (
      pre.verdict.blockedAt === 'G6' &&
      !touched &&
      state.holdoutTouches.length < G6_BUDGET
    ) {
      final = await promoteCandidate(dataset, sp, ctx, {
        holdoutFrom: manifest.holdoutFrom,
        forward: fwd,
      });
      state = {
        ...state,
        holdoutTouches: [
          ...state.holdoutTouches,
          {
            configHash: state.incumbent.configHash,
            at: deps.now,
            vintage: manifest.lockedAt,
          },
        ],
      };
    }
    ledgerAppend.push({
      at: deps.now,
      epoch: state.generation,
      configHash: state.incumbent.configHash,
      label: state.incumbent.label,
      evidence: final.evidence,
      verdict: final.verdict,
    });
    state = { ...state, lastGauntletHash: state.incumbent.configHash };
  }

  return {
    state,
    registry,
    newEpochs,
    ledgerAppend,
    logs,
    manifest,
    forward,
    note:
      note ||
      (state.status === 'exploring'
        ? `exploring:本次 ${newEpochs.length} 代(墙钟/上限止),下次续跑`
        : state.status),
  };
}

/** 从 StrategyParams 提取进化参数(含市场开关)。 */
export function extractEvo(p: StrategyParams): EvoParams {
  return quantizeEvo({
    goalShrink: p.tuning.goalShrink ?? 0.6,
    dcRho: p.tuning.dcRho ?? -0.14,
    minEv: p.bet.minEv,
    minProb: p.bet.minProb,
    maxEv: p.bet.maxEv,
    useAH: p.bet.markets?.ah === false ? 0 : 1,
    useOU: p.bet.markets?.ou === false ? 0 : 1,
    allowOver: p.bet.markets?.over === true ? 1 : 0,
  });
}
