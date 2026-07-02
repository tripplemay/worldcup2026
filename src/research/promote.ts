/**
 * Phase 10 · P4:全 gauntlet —— 对一个候选配置算 G0–G6 完整证据并跑 G0–G7 闸门。
 * G1 CLV(非 holdout)· G2 DSR(搜索给)+SPA(单策略自助)+ROI CI 下界(自助)· G3 PBO(搜索给)·
 * G4 跨赛季稳健 · G5 历史回撤 + MC 95 分位回撤 + 破产路径 · G6 holdout 一次性验收(用完即烧毁)。
 * 确定性:随机全走注入种子。G7(前向 live)非此处职责(留 predictionLog/live)。
 */
import { runStrategy } from './engine';
import { sliceDates } from './walkforward';
import { spaTest, mulberry32 } from './stats';
import {
  buildHoldoutManifest,
  excludeHoldout,
  holdoutSlice,
  evaluateGates,
} from './governance';
import type { GateEvidence, PromotionVerdict } from './governance';
import type { EngineDataset, StrategyParams } from './engine';

const dateKey = (iso: string) => iso.slice(0, 10);
const seasonOf = (d: string): string => {
  const y = +d.slice(0, 4);
  const m = +d.slice(5, 7);
  return m >= 7 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
};

/** 权益曲线最大回撤(峰谷跌幅比例)。 */
function maxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let mdd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak);
  }
  return +mdd.toFixed(4);
}

/** MC 回撤:自助重采样单注 pnl 序列 → 重建权益 → 95 分位回撤 + 是否触破产(≤5% 本金)。 */
function mcDrawdown(
  pnls: number[],
  initial: number,
  runs: number,
  seed: number,
): { p95: number; ruin: boolean } {
  if (!pnls.length) return { p95: 0, ruin: false };
  const rng = mulberry32(seed);
  const dds: number[] = [];
  let ruin = false;
  for (let r = 0; r < runs; r++) {
    let bal = initial;
    let peak = initial;
    let mdd = 0;
    for (let i = 0; i < pnls.length; i++) {
      bal += pnls[Math.floor(rng() * pnls.length)];
      if (bal <= initial * 0.05) ruin = true;
      if (bal > peak) peak = bal;
      if (peak > 0) mdd = Math.max(mdd, (peak - bal) / peak);
    }
    dds.push(mdd);
  }
  dds.sort((a, b) => a - b);
  return {
    p95: +(dds[Math.floor(0.95 * (dds.length - 1))] ?? 0).toFixed(4),
    ruin,
  };
}

/** 自助 ROI 95% CI 下界(单位注收益均值)。 */
function ciLower95(rets: number[], runs: number, seed: number): number {
  if (!rets.length) return 0;
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < runs; r++) {
    let s = 0;
    for (let i = 0; i < rets.length; i++)
      s += rets[Math.floor(rng() * rets.length)];
    means.push(s / rets.length);
  }
  means.sort((a, b) => a - b);
  return +(means[Math.floor(0.025 * (means.length - 1))] ?? 0).toFixed(4);
}

export interface PromoteCtx {
  epoch: number;
  dsr: number; // 搜索轮给(去膨胀夏普,已含累计 N 分母)
  pbo: number; // 搜索轮给(过拟合概率)
}
export interface PromoteResult {
  evidence: GateEvidence;
  verdict: PromotionVerdict;
}

/** 对候选跑全 gauntlet。opts.holdoutFrom 缺省由 sliceDates 推。 */
export function promoteCandidate(
  dataset: EngineDataset,
  params: StrategyParams,
  ctx: PromoteCtx,
  opts?: { holdoutFrom?: string; mcRuns?: number; seed?: number },
): PromoteResult {
  const holdoutFrom = opts?.holdoutFrom ?? sliceDates(dataset).holdoutFrom;
  const mcRuns = opts?.mcRuns ?? 500;
  const seed = opts?.seed ?? 12345;
  const manifest = buildHoldoutManifest(dataset, holdoutFrom, 0);
  const safe = excludeHoldout(dataset, manifest);
  const hold = holdoutSlice(dataset, manifest);

  // 非 holdout 全窗跑一次 → CLV / 收益序列 / 权益 / 分赛季
  const s = runStrategy(safe, params);
  const vbets = s.bets.filter((b) => b.tier === 'value');
  const pnls = vbets.map((b) => b.pnl);
  const rets = vbets.map((b) => b.pnl / b.stake);

  // G2:SPA(单策略自助 vs 零)+ ROI CI 下界 + DSR(用 nTrials 分母)
  const spa = rets.length ? spaTest([rets], { seed }).p : 1;
  const ciLo = ciLower95(rets, mcRuns, seed);
  const dsr = ctx.dsr; // 搜索轮已算(与冠军一致)

  // G4:分赛季稳健(非 holdout)
  const bySeason: Record<string, { staked: number; pnl: number }> = {};
  for (const b of vbets) {
    const k = seasonOf(dateKey(b.date));
    const a = (bySeason[k] ??= { staked: 0, pnl: 0 });
    a.staked += b.stake;
    a.pnl += b.pnl;
  }
  const seasonRois = Object.values(bySeason)
    .filter((a) => a.staked > 0)
    .map((a) => a.pnl / a.staked);
  const posFrac = seasonRois.length
    ? seasonRois.filter((r) => r > 0).length / seasonRois.length
    : 0;
  const noCollapse = seasonRois.every((r) => r > -0.3);
  const overallRoi = s.value.roi;

  // G5:历史回撤 + MC + 破产
  const equity: number[] = [params.bet.initialBalance];
  for (const p of pnls) equity.push(equity[equity.length - 1] + p);
  const histMdd = maxDrawdown(equity);
  const mc = mcDrawdown(pnls, params.bet.initialBalance, mcRuns, seed + 1);

  // G6:holdout 一次性
  const h = runStrategy(hold, params);
  const holdout = {
    clvPositive: h.clv.avgClv > 0,
    roiNotSigNeg: h.value.roi >= -0.05,
    noNewCollapse: h.value.roi > -0.3,
  };

  const evidence: GateEvidence = {
    noLeak: true,
    clv: {
      n: s.clv.n,
      t: s.clv.tStat,
      avgClv: s.clv.avgClv,
      posRate: s.clv.posRate,
    },
    roi: { dsr, spaP: spa, ciLower: ciLo, n: vbets.length },
    pbo: ctx.pbo,
    robust: {
      subperiodsPositiveFrac: +posFrac.toFixed(3),
      segmentsNoCollapse: noCollapse,
      anchoredPositive: overallRoi > 0,
      rollingPositive: posFrac >= 0.5,
    },
    drawdown: { historicalMaxDD: histMdd, mc95DD: mc.p95, ruinPath: mc.ruin },
    holdout,
    // G7 前向 live 非此处职责(留 predictionLog);缺省 → 卡在 G7(达标才是"可接真钱")
  };
  const verdict = evaluateGates(evidence);
  return { evidence, verdict };
}
