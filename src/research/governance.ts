/**
 * Phase 10 · P3c:治理层(纯逻辑,可测)。
 *   · 试验注册表:每评价一个配置就登记,DSR/PBO 分母用【累计 N(含重复/丢弃)】——废掉刷显著。
 *   · holdout manifest:锁定 L3 比赛集,excludeHoldout 让 sweep 物理拿不到 L3;holdoutSlice 供 G6 一次性验收。
 *   · G0–G7 串行晋级闸门:前闸不过后闸不测;G1(CLV)/G5(回撤)为一票否决(序在其后者之前,天然覆盖)。
 * 持久化(trialRegistry.json 等)在 P4 搜索环里接;此处只给纯数据结构 + 判定。
 */
import type { EngineDataset } from './engine';
import type { StrategyParams } from './engine';

const dateKey = (iso: string) => iso.slice(0, 10);

// ── 配置指纹 ─────────────────────────────────────────────
/** 递归按键排序的规范化 JSON(稳定序列化)。 */
function canonical(o: unknown): string {
  if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']';
  if (o && typeof o === 'object')
    return (
      '{' +
      Object.keys(o as Record<string, unknown>)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ':' +
            canonical((o as Record<string, unknown>)[k]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(o);
}

/** 配置指纹(djb2,稳定、确定性)。 */
export function configHash(params: unknown): string {
  const s = canonical(params);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// ── 试验注册表 ───────────────────────────────────────────
export interface TrialRecord {
  configHash: string;
  params: unknown;
  at?: number;
  dataHash?: string; // 数据 era(缺省=era0 旧记录);去重键含此维,跨 era 重评是真实新试验
  oosSharpe?: number; // 评估后回填:OOS 每注夏普(DSR 全体横截面方差用)
  perBlock?: number[]; // 评估后回填:全窗按块单位收益(PBO 全体矩阵用)
}
export interface TrialRegistry {
  trials: TrialRecord[];
  seen: Record<string, number>; // `${configHash}|${dataHash}`(旧格式纯 hash 视为 era0)→ 次数
}
export function newRegistry(): TrialRegistry {
  return { trials: [], seen: {} };
}
const seenKey = (h: string, dataHash?: string) =>
  dataHash ? `${h}|${dataHash}` : h;
/** 登记一个试验(不可变返回新表)。**必须在看到 OOS 结果之前调用**。 */
export function registerTrial(
  reg: TrialRegistry,
  params: unknown,
  at?: number,
  dataHash?: string,
): TrialRegistry {
  const h = configHash(params);
  const k = seenKey(h, dataHash);
  return {
    trials: [...reg.trials, { configHash: h, params, at, dataHash }],
    seen: { ...reg.seen, [k]: (reg.seen[k] ?? 0) + 1 },
  };
}
/** 同配置+同数据 era 是否已试过(精确缓存命中 → 跳过不计 N;跨 era 不算已试)。 */
export function hasTried(
  reg: TrialRegistry,
  params: unknown,
  dataHash?: string,
): boolean {
  return (reg.seen[seenKey(configHash(params), dataHash)] ?? 0) > 0;
}
/** 评估后回填指标到该 (configHash,dataHash) 最新一条 trial(不可变)。 */
export function attachTrialMetrics(
  reg: TrialRegistry,
  h: string,
  dataHash: string | undefined,
  metrics: { oosSharpe: number; perBlock: number[] },
): TrialRegistry {
  const trials = [...reg.trials];
  for (let i = trials.length - 1; i >= 0; i--) {
    if (trials[i].configHash === h && trials[i].dataHash === dataHash) {
      trials[i] = { ...trials[i], ...metrics };
      break;
    }
  }
  return { ...reg, trials };
}
/** 累计试验数 N(含重复 / 丢弃)—— DSR/PBO 多重检验分母用此,不得用"报上来的赢家数"。 */
export function trialCount(reg: TrialRegistry): number {
  return reg.trials.length;
}
/** 去重后的独立配置数(仅诊断,不用作分母)。 */
export function distinctTrialCount(reg: TrialRegistry): number {
  return Object.keys(reg.seen).length;
}
/** 某数据 era 的试验数(campaign 预算 N_max 按 era 计)。 */
export function eraTrialCount(reg: TrialRegistry, dataHash: string): number {
  return reg.trials.filter((t) => t.dataHash === dataHash).length;
}
/**
 * 注册表完整性校验(防损坏静默归零 → DSR 分母崩塌):
 * seen 计数总和必须等于 trials 长度;时间线非空而注册表为空 → 判损坏。
 */
export function registryIntact(
  reg: TrialRegistry,
  timelineNonEmpty: boolean,
): boolean {
  const sum = Object.values(reg.seen).reduce((s, x) => s + x, 0);
  if (sum !== reg.trials.length) return false;
  if (timelineNonEmpty && reg.trials.length === 0) return false;
  return true;
}
/** 数据集内容哈希(排序键消除键序差;赛果+比分+赔率键集)。era 变更/复活判定用。 */
export function datasetHash(dataset: EngineDataset): string {
  const ids = dataset.allRes
    .map((r) => `${r.eventId}:${r.homeGoals}-${r.awayGoals}`)
    .sort();
  const oddsKeys = Object.keys(dataset.odds).sort();
  return configHash({ n: ids.length, ids, oddsKeys });
}

// ── holdout manifest(L3 物理隔离)─────────────────────────
export interface HoldoutManifest {
  holdoutFrom: string; // L3 起始日(含)
  holdoutEventIds: string[]; // L3 比赛 id 集
  lockedAt: number; // 锁定时间戳(传入,保确定性)
  note?: string;
}
/** 由数据集 + 切分构建 manifest:holdoutFrom 及之后的比赛全部锁入 L3。 */
export function buildHoldoutManifest(
  dataset: EngineDataset,
  holdoutFrom: string,
  lockedAt: number,
  note?: string,
): HoldoutManifest {
  const holdoutEventIds = dataset.allRes
    .filter((r) => dateKey(r.date) >= holdoutFrom)
    .map((r) => r.eventId);
  return { holdoutFrom, holdoutEventIds, lockedAt, note };
}
/** 返回**剔除 L3** 的数据集(sweep/选参只能用它;物理拿不到 holdout)。 */
export function excludeHoldout(
  dataset: EngineDataset,
  m: HoldoutManifest,
): EngineDataset {
  const set = new Set(m.holdoutEventIds);
  return {
    ...dataset,
    allRes: dataset.allRes.filter((r) => !set.has(r.eventId)),
  };
}
/** 返回**仅 L3** 的数据集(G6 一次性验收用;用完即"烧毁")。 */
export function holdoutSlice(
  dataset: EngineDataset,
  m: HoldoutManifest,
): EngineDataset {
  const set = new Set(m.holdoutEventIds);
  return {
    ...dataset,
    allRes: dataset.allRes.filter((r) => set.has(r.eventId)),
  };
}

// ── G0–G7 晋级闸门 ───────────────────────────────────────
export interface GateEvidence {
  noLeak: boolean; // G0
  clv: { n: number; t: number; avgClv: number; posRate: number }; // G1(一票否决)
  roi: { dsr: number; spaP: number; ciLower: number; n: number }; // G2
  pbo: number; // G3
  robust: {
    subperiodsPositiveFrac: number;
    segmentsNoCollapse: boolean;
    anchoredPositive: boolean;
    rollingPositive: boolean;
    slippageOk?: boolean; // 滑点压力(1% 价差重跑不崩);旧证据缺省=过
  }; // G4
  drawdown: { historicalMaxDD: number; mc95DD: number; ruinPath: boolean }; // G5(一票否决)
  holdout?: {
    clvPositive: boolean;
    roiNotSigNeg: boolean;
    noNewCollapse: boolean;
  }; // G6
  forward?: { liveBets: number; liveClvT: number }; // G7
}

export interface GateThresholds {
  clvMinN: number;
  clvMinT: number;
  clvMinAvg: number;
  clvMinPosRate: number;
  roiDsrMin: number;
  roiSpaMax: number;
  roiMinN: number;
  pboMax: number;
  robustSubperiodFrac: number;
  ddHistMax: number;
  ddMc95Max: number;
  fwdMinBets: number;
  fwdMinClvT: number;
}
export const DEFAULT_THRESHOLDS: GateThresholds = {
  clvMinN: 100,
  clvMinT: 2,
  clvMinAvg: 0.005,
  clvMinPosRate: 0.53,
  roiDsrMin: 0.95,
  roiSpaMax: 0.05,
  roiMinN: 2500,
  pboMax: 0.1,
  robustSubperiodFrac: 2 / 3,
  ddHistMax: 0.25,
  ddMc95Max: 0.35,
  fwdMinBets: 150,
  fwdMinClvT: 2,
};

/**
 * G1 的 CLV 质量三条件(t / 均值 / 阳性率;不含样本量 —— 各闸按各自功效线另判 n)。
 * 供 evaluateGates(G1)与 pooled.screenPooled 共用:判定逻辑单点维护,防口径漂移。
 */
export function clvQualityOk(
  c: { t: number; avgClv: number; posRate: number },
  T: GateThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return (
    c.t > T.clvMinT && c.avgClv >= T.clvMinAvg && c.posRate >= T.clvMinPosRate
  );
}

export type GateStatus = 'pass' | 'fail' | 'skip';
export interface GateResult {
  id: string;
  name: string;
  status: GateStatus;
  veto?: boolean; // G1/G5 一票否决闸
  detail: string;
}
export interface PromotionVerdict {
  passedAll: boolean;
  blockedAt: string | null; // 卡在哪道闸(null=全过)
  gates: GateResult[];
}

/** 晋级台账一条(落 promotionLedger.json;每候选各闸结论 + 证据快照)。 */
export interface PromotionEntry {
  at?: number;
  epoch: number;
  configHash: string;
  label: string;
  evidence: GateEvidence;
  verdict: PromotionVerdict;
}

/**
 * 串行评估 G0–G7:前闸不过则后闸 skip(省算 + 防在后闸反复 peek)。
 * G1(CLV)、G5(回撤)为一票否决(序在它们之后的一切之前,故 serial-stop 天然覆盖)。
 */
export function evaluateGates(
  ev: GateEvidence,
  thresholds?: Partial<GateThresholds>,
): PromotionVerdict {
  const T = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const gates: GateResult[] = [];
  let blocked: string | null = null;
  const check = (
    id: string,
    name: string,
    cond: () => boolean,
    detail: string,
    veto = false,
  ) => {
    if (blocked) {
      gates.push({ id, name, status: 'skip', detail: '', veto });
      return;
    }
    const pass = cond();
    gates.push({ id, name, status: pass ? 'pass' : 'fail', detail, veto });
    if (!pass) blocked = id;
  };

  check('G0', '构造无泄漏', () => ev.noLeak === true, `noLeak=${ev.noLeak}`);
  check(
    'G1',
    'CLV先行',
    () =>
      ev.clv.n >= T.clvMinN &&
      clvQualityOk(
        { t: ev.clv.t, avgClv: ev.clv.avgClv, posRate: ev.clv.posRate },
        T,
      ),
    `n=${ev.clv.n} t=${ev.clv.t} avg=${ev.clv.avgClv} pos=${ev.clv.posRate}`,
    true,
  );
  check(
    'G2',
    'ROI显著',
    () =>
      ev.roi.dsr > T.roiDsrMin &&
      ev.roi.spaP < T.roiSpaMax &&
      ev.roi.ciLower > 0 &&
      ev.roi.n >= T.roiMinN,
    `dsr=${ev.roi.dsr} spaP=${ev.roi.spaP} ciLo=${ev.roi.ciLower} n=${ev.roi.n}`,
  );
  check('G3', '过拟合体检', () => ev.pbo < T.pboMax, `pbo=${ev.pbo}`);
  check(
    'G4',
    '跨切面稳健',
    () =>
      ev.robust.subperiodsPositiveFrac >= T.robustSubperiodFrac &&
      ev.robust.segmentsNoCollapse &&
      ev.robust.anchoredPositive &&
      ev.robust.rollingPositive &&
      (ev.robust.slippageOk ?? true),
    `subFrac=${ev.robust.subperiodsPositiveFrac}`,
  );
  check(
    'G5',
    '风控回撤',
    () =>
      !ev.drawdown.ruinPath &&
      ev.drawdown.historicalMaxDD <= T.ddHistMax &&
      ev.drawdown.mc95DD <= T.ddMc95Max,
    `maxDD=${ev.drawdown.historicalMaxDD} mc95=${ev.drawdown.mc95DD} ruin=${ev.drawdown.ruinPath}`,
    true,
  );
  check(
    'G6',
    '最终holdout',
    () =>
      !!ev.holdout &&
      ev.holdout.clvPositive &&
      ev.holdout.roiNotSigNeg &&
      ev.holdout.noNewCollapse,
    ev.holdout ? 'holdout 已评' : 'holdout 未评',
  );
  check(
    'G7',
    '前向纸面',
    () =>
      !!ev.forward &&
      ev.forward.liveBets >= T.fwdMinBets &&
      ev.forward.liveClvT > T.fwdMinClvT,
    ev.forward
      ? `liveBets=${ev.forward.liveBets} t=${ev.forward.liveClvT}`
      : '无前向',
  );

  return { passedAll: !blocked, blockedAt: blocked, gates };
}
