/**
 * P4 分析员单测:buildAnalystBrief 纯函数(把研究状态摘成简报)。
 * analyzeResearch 为网络调用,不在此测(未配 key 返回 null)。
 */
import { buildAnalystBrief, auditReportNumbers } from '../analyst';
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

describe('auditReportNumbers(报告数字审计,2026-07-09 仪器债修复)', () => {
  const brief = '冠军 gs0.4,OOS gap 0.0161,CLV-t 0.33,PBO 0.524,命中 0.551';

  it('幻觉数字被抓出(t1 事故重演:报告引 2.31,台账 0.33)', () => {
    const bad = auditReportNumbers(brief, '诊断:CLV-t 达 2.31,显著为正。');
    expect(bad).toContain('2.31');
  });

  it('忠实引用不误伤:精确 / 四舍五入 / 百分比换算 / 区间连字符 / 平台闸门常数', () => {
    expect(
      auditReportNumbers(brief, 'gap 0.0161,CLV-t 0.33,PBO 0.524'),
    ).toHaveLength(0);
    expect(auditReportNumbers(brief, 'gap 约 0.016')).toHaveLength(0); // 舍入
    expect(auditReportNumbers(brief, '命中率 55.10%')).toHaveLength(0); // ×100
    // 区间「0.33-0.55」的连字符不是负号(负号前瞻;曾把右端切成伪负数 -0.55 误标)
    expect(auditReportNumbers(brief, 'CLV-t 介于 0.33-0.55 之间')).toHaveLength(
      0,
    );
    // 平台公开常数(简报不含,但属合法引用)
    expect(
      auditReportNumbers(brief, '探索门 t>1.28;G1 要求 avg≥0.005、pos≥0.53'),
    ).toHaveLength(0);
  });

  it('整数与一位小数不核对(「2-3 个假设」「G0–G7」不误伤)', () => {
    expect(
      auditReportNumbers(brief, '提出 2-3 个假设;G0–G7 闸门;ROI -13%'),
    ).toHaveLength(0);
  });

  it('漏检修复:两位小数 ×100 撞简报小整数不再白名单化(0.07 vs「7」)', () => {
    expect(auditReportNumbers('epoch 7 网格 12', '幻觉读数 0.07')).toContain(
      '0.07',
    );
  });

  it('输出上限 5 条(防刷屏)', () => {
    const bad = auditReportNumbers(
      brief,
      '1.11 2.22 3.33 4.44 5.55 6.66 7.77',
    );
    expect(bad.length).toBeLessThanOrEqual(5);
  });
});
