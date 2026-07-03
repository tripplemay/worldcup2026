/**
 * P4 分析员单测:buildAnalystBrief 纯函数(把研究状态摘成简报)。
 * analyzeResearch 为网络调用,不在此测(未配 key 返回 null)。
 */
import { buildAnalystBrief } from '../analyst';
import type { EpochResult } from '../search';
import type { PromotionEntry, GateEvidence } from '../governance';
import type { StrategyParams } from '../engine';

const params: StrategyParams = {
  tuning: { goalShrink: 0.4, dcRho: -0.14, shrinkEloScale: 100 },
  home: { eloBonus: 65, goalMult: 1.12 },
  marketWeight: 0.4,
  bet: {
    minProb: 0.3,
    minEv: 0.03,
    maxEv: 0.3,
    kellyFraction: 0.25,
    maxStakePct: 0.05,
    minStake: 10,
    coverageStakePct: 0.005,
    initialBalance: 10000,
  },
};
const winner = {
  label: 'gs0.4',
  isGap: 0.0245,
  oosGap: 0.0142,
  oosValueRoi: 0.028,
  oosClvN: 100,
  oosClvT: -0.24,
  oosSharpe: 0,
};
const epoch = (n: number): EpochResult => ({
  epoch: n,
  gridSize: 3,
  cumulativeTrials: n * 3,
  selectBy: 'gapBrier',
  partition: {
    trainTo: '2025-04-06',
    valFrom: '2025-04-13',
    valTo: '2025-12-13',
    holdoutFrom: '2025-12-20',
    holdoutTo: '2026-05-24',
  },
  configs: [winner, { ...winner, label: 'gs0.6', isGap: 0.026 }],
  winner,
  winnerParams: params,
  pbo: 0.52,
  dsr: { sr: -0.03, sr0: 0.05, dsr: 0.22 },
  screen: { clvPass: false, pboPass: false, dsrPass: false, overall: false },
});
const evidence: GateEvidence = {
  noLeak: true,
  clv: { n: 396, t: -0.24, avgClv: -0.0004, posRate: 0.5 },
  roi: { dsr: 0.22, spaP: 0.6, ciLower: -0.02, n: 396 },
  pbo: 0.52,
  robust: {
    subperiodsPositiveFrac: 0.5,
    segmentsNoCollapse: true,
    anchoredPositive: false,
    rollingPositive: false,
  },
  drawdown: { historicalMaxDD: 0.4, mc95DD: 0.5, ruinPath: false },
  holdout: { clvPositive: false, roiNotSigNeg: true, noNewCollapse: true },
};
const ledger: PromotionEntry[] = [
  {
    epoch: 2,
    configHash: 'abc',
    label: 'gs0.4',
    evidence,
    verdict: { passedAll: false, blockedAt: 'G1', gates: [] },
  },
];

describe('buildAnalystBrief', () => {
  it('epoch = 最新 + 文本含关键事实', () => {
    const b = buildAnalystBrief([epoch(1), epoch(2)], ledger);
    expect(b.epoch).toBe(2);
    expect(b.text).toContain('gs0.4');
    expect(b.text).toContain('卡在 G1');
    expect(b.text).toContain('epoch 2');
    expect(b.text.length).toBeGreaterThan(50);
  });

  it('空台账 → 提示尚无 gauntlet 记录', () => {
    const b = buildAnalystBrief([epoch(1)], []);
    expect(b.text).toContain('尚无全 gauntlet 记录');
  });
});
