/**
 * P4 面板单测:epochDiff(参数/指标增量、闸门翻转)+ renderTimeline(HTML 含关键块)。
 */
import { epochDiff, renderTimeline, flattenParams } from '../dashboard';
import type { EpochResult } from '../search';
import type { StrategyParams } from '../engine';

const params = (goalShrink: number): StrategyParams => ({
  tuning: { goalShrink, dcRho: -0.14, shrinkEloScale: 100 },
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
});

const mkEpoch = (
  epoch: number,
  o: {
    label: string;
    gs: number;
    gap: number;
    roi: number;
    clvT: number;
    pbo: number;
    dsr: number;
    overall: boolean;
  },
): EpochResult => {
  const m = {
    label: o.label,
    isGap: o.gap,
    oosGap: o.gap,
    oosValueRoi: o.roi,
    oosClvN: 120,
    oosClvT: o.clvT,
    oosSharpe: 0,
  };
  return {
    epoch,
    gridSize: 2,
    cumulativeTrials: epoch * 2,
    selectBy: 'gapBrier',
    partition: {
      trainTo: '2025-04-06',
      valFrom: '2025-04-13',
      valTo: '2025-12-13',
      holdoutFrom: '2025-12-20',
      holdoutTo: '2026-05-24',
    },
    configs: [m, { ...m, label: 'other', isGap: o.gap + 0.01 }],
    winner: m,
    winnerParams: params(o.gs),
    pbo: o.pbo,
    dsr: { sr: 0, sr0: 0, dsr: o.dsr },
    screen: {
      clvPass: o.overall,
      pboPass: o.pbo < 0.1,
      dsrPass: o.dsr > 0.95,
      overall: o.overall,
    },
  };
};

describe('flattenParams', () => {
  it('摊平关键参数', () => {
    const f = flattenParams(params(0.6));
    expect(f.goalShrink).toBe(0.6);
    expect(f.marketWeight).toBe(0.4);
    expect(f.kellyFraction).toBe(0.25);
  });
});

describe('epochDiff', () => {
  const prev = mkEpoch(1, { label: 'gs0.6', gs: 0.6, gap: 0.025, roi: -0.02, clvT: -1.0, pbo: 0.5, dsr: 0.2, overall: false });
  const cur = mkEpoch(2, { label: 'gs0.8', gs: 0.8, gap: 0.02, roi: 0.01, clvT: 0.5, pbo: 0.3, dsr: 0.4, overall: true });
  const d = epochDiff(prev, cur);

  it('参数增量:goalShrink 变化被标记', () => {
    const gs = d.paramDeltas.find((p) => p.name === 'goalShrink')!;
    expect(gs.prev).toBe(0.6);
    expect(gs.cur).toBe(0.8);
    expect(gs.changed).toBe(true);
    expect(d.paramDeltas.find((p) => p.name === 'dcRho')!.changed).toBe(false);
  });

  it('指标增量:gap↓=向好、ROI↑=向好、PBO↓=向好', () => {
    expect(d.metricDeltas.find((m) => m.name === 'gap(OOS)')!.better).toBe(true);
    expect(d.metricDeltas.find((m) => m.name === 'valueROI(OOS)')!.better).toBe(true);
    expect(d.metricDeltas.find((m) => m.name === 'PBO')!.better).toBe(true);
    expect(d.metricDeltas.find((m) => m.name === 'DSR')!.better).toBe(true);
  });

  it('闸门翻转:overall false→true 被捕获', () => {
    const o = d.screenFlips.find((f) => f.name === 'overall');
    expect(o).toBeDefined();
    expect(o!.from).toBe(false);
    expect(o!.to).toBe(true);
  });
});

describe('renderTimeline', () => {
  it('两轮 → HTML 含时间线 + Diff 卡 + 冠军', () => {
    const html = renderTimeline([
      mkEpoch(1, { label: 'gs0.6', gs: 0.6, gap: 0.025, roi: -0.02, clvT: -1, pbo: 0.5, dsr: 0.2, overall: false }),
      mkEpoch(2, { label: 'gs0.8', gs: 0.8, gap: 0.02, roi: 0.01, clvT: 0.5, pbo: 0.3, dsr: 0.4, overall: false }),
    ]);
    expect(html).toContain('进度时间线');
    expect(html).toContain('本轮 vs 上轮');
    expect(html).toContain('gs0.8');
    expect(html).toContain('<!doctype html>');
  });

  it('空时间线 → 占位', () => {
    expect(renderTimeline([])).toContain('暂无 epoch');
  });
});
