/**
 * 人话成绩单单测:字段齐全/样本外窗口径/无 incumbent 降级/确定性。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildScoreboard } from '../scoreboard';
import { newEvolutionState, DEFAULT_EVO, toStrategyParams } from '../evolve';
import { buildHoldoutManifest, configHash } from '../governance';
import type { PromotionEntry } from '../governance';
import type { EngineDataset, MatchOddsView } from '../engine';
import type { HistMatch, ResultMatch } from 'lib/predict/types';

const seed = (n: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'seed/leagues', n), 'utf8'));
const ds: EngineDataset = {
  allHist: Object.values(
    seed('league-epl-2025-historical.json') as Record<string, HistMatch>,
  ),
  allRes: Object.values(
    seed('league-epl-2025-results.json') as Record<string, ResultMatch>,
  ),
  odds: seed('league-epl-2025-oddsx.json') as Record<string, MatchOddsView>,
};
const SINCE = '2023-08-01';
ds.allRes = ds.allRes.filter((r) => r.date >= SINCE);
ds.allHist = ds.allHist.filter((h) => h.date >= SINCE);

const manifest = buildHoldoutManifest(ds, '2025-12-20', 0);
const ledger: PromotionEntry = {
  epoch: 1,
  configHash: 'x',
  label: 'l',
  evidence: {} as PromotionEntry['evidence'],
  verdict: {
    passedAll: false,
    blockedAt: 'G1',
    gates: [
      { id: 'G0', name: '', status: 'pass', detail: '' },
      { id: 'G1', name: '', status: 'fail', veto: true, detail: '' },
      { id: 'G2', name: '', status: 'skip', detail: '' },
    ],
  },
};

describe('buildScoreboard', () => {
  it('无 incumbent → 只有判定块,统计块为 null', async () => {
    const st = newEvolutionState(0, 'dh', 1000, true);
    const sb = await buildScoreboard(ds, st, manifest, null, null);
    expect(sb.incumbentLabel).toBeNull();
    expect(sb.accuracy).toBeNull();
    expect(sb.betting).toBeNull();
    expect(sb.gates).toEqual([]);
    expect(sb.axisC).toBeNull(); // 无 kernel → 轴C 块与逐场对照均为 null
    expect(sb.axisCLog).toBeNull();
  });

  it('传 kernel → axisC 块 + 逐场对照(≤80 场,新→旧)', async () => {
    const st = newEvolutionState(0, 'dh', 1000, true);
    const point = {
      goalShrink: 0.6,
      dcRho: -0.14,
      totalScale: 1.0,
      shrinkEloScale: 100,
      eloBonus: 65,
      goalMult: 1.12,
      marketWeight: 0.9,
    };
    const recal = {
      objective: 'blend' as const,
      baseline: point,
      tuned: point,
      isGapBaseline: 0.01,
      isGapTuned: 0.008,
      valGapBaseline: 0.01,
      valGapTuned: 0.009,
      evals: 1,
      truncated: false,
    };
    const sb = await buildScoreboard(ds, st, manifest, null, null, {
      at: 0,
      dataHash: 'dh',
      matchCount: ds.allRes.length,
      ours: { ...recal, objective: 'ours' as const },
      blend: recal,
    });
    expect(sb.axisC).toBeTruthy();
    expect(sb.axisC!.marketWeight).toBe(0.9);
    expect(sb.axisCLog!.length).toBeGreaterThan(0);
    expect(sb.axisCLog!.length).toBeLessThanOrEqual(80);
    // 新→旧排序
    const dates = sb.axisCLog!.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  }, 120000);

  it('有 incumbent → 三块齐全,口径=样本外 val 窗,gates 透传', async () => {
    const st = newEvolutionState(0, 'dh', 1000, true);
    st.incumbent = {
      label: 'inc',
      configHash: configHash(toStrategyParams(DEFAULT_EVO)),
      evo: DEFAULT_EVO,
      clvT: 0,
      clvLcb: 0,
      gap: 0,
      screenOverall: false,
      dataHash: 'dh',
    };
    const sb = await buildScoreboard(ds, st, manifest, null, ledger);
    expect(sb.blockedAt).toBe('G1');
    expect(sb.gates).toHaveLength(3);
    expect(sb.accuracy!.n).toBeGreaterThan(0);
    expect(sb.accuracy!.oursHit).toBeGreaterThan(0.3);
    expect(sb.betting!.n).toBeGreaterThan(0);
    expect(Number.isFinite(sb.money!.end)).toBe(true);
    // 台账双口径显式化(仪器债修复):end−start = value 注 + coverage 试探注,代数闭合
    expect(sb.money!.valuePnl).toBeCloseTo(sb.betting!.pnl, 2);
    expect(sb.money!.valuePnl! + sb.money!.coveragePnl!).toBeCloseTo(
      sb.money!.end - sb.money!.start,
      1,
    );
    expect(sb.window!.to < '2025-12-20').toBe(true); // 样本外窗不触 holdout
    // 确定性
    const sb2 = await buildScoreboard(ds, st, manifest, null, ledger);
    expect(sb).toEqual(sb2);
  }, 120000);
});
