/**
 * 精度测量(gap-to-market)单测:注入 seed(含已提交 oddsx),小窗断言结构 + 确定性。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { runAccuracy } from '../accuracy';
import type { AccuracyParams } from '../accuracy';
import type { EngineDataset, MatchOddsView } from '../engine';
import type { HistMatch, ResultMatch } from 'lib/predict/types';

const seed = (n: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'seed/leagues', n), 'utf8'));

const dataset: EngineDataset = {
  allHist: Object.values(
    seed('league-epl-2025-historical.json') as Record<string, HistMatch>,
  ),
  allRes: Object.values(
    seed('league-epl-2025-results.json') as Record<string, ResultMatch>,
  ),
  odds: seed('league-epl-2025-oddsx.json') as Record<string, MatchOddsView>,
};

// 7 季 seed 后为控测试时长:截到近 3 季(既有断言行为不变)
const SINCE = '2023-08-01';
dataset.allRes = dataset.allRes.filter((r) => r.date >= SINCE);
dataset.allHist = dataset.allHist.filter((h) => h.date >= SINCE);

const params: AccuracyParams = {
  tuning: { goalShrink: 0.6, dcRho: -0.14, shrinkEloScale: 100 },
  home: { eloBonus: 65, goalMult: 1.12 },
  marketWeight: 0.4,
  from: '2026-03-01', // 末段小窗(前有充足历史)
};

describe('runAccuracy(gap-to-market)', () => {
  it('产出双方 Brier + gap,数值合理', async () => {
    const r = await runAccuracy(dataset, params);
    expect(r.n).toBeGreaterThan(0);
    expect(r.ours.brier).toBeGreaterThan(0);
    expect(r.ours.brier).toBeLessThan(1);
    expect(r.market.brier).toBeGreaterThan(0);
    expect(r.market.brier).toBeLessThan(1);
    expect(Number.isFinite(r.gapBrier)).toBe(true);
    expect(r.ours.n).toBe(r.market.n); // 同批比赛
    expect(r.perModel['poisson-xg']).toBeDefined();
  });

  it('确定性:同输入两次相等', async () => {
    expect(runAccuracy(dataset, params)).toEqual(runAccuracy(dataset, params));
  });
});

describe('轴C 双场景:blend(开盘锚融合)+ 开盘基准 + ECE 校准', () => {
  it('blend/marketOpen 结构 + 同子集可比 + 融合确实靠近市场', async () => {
    const r = await runAccuracy(dataset, params);
    // blend 只在有开盘价的场次上计(与 marketOpen/closeSub 同子集,严格可比)
    expect(r.blend.n).toBeGreaterThan(0);
    expect(r.blend.n).toBeLessThanOrEqual(r.ours.n);
    expect(r.blend.n).toBe(r.marketOpen.n);
    expect(r.closeSub.n).toBe(r.blend.n); // 展示对比用的闭盘命中率必须同子集
    expect(r.blend.brier).toBeGreaterThan(0);
    expect(r.blend.brier).toBeLessThan(1);
    expect(Number.isFinite(r.gapBlendClose)).toBe(true);
    expect(Number.isFinite(r.gapBlendOpen)).toBe(true);
    // 语义:开盘锚必须真的把融合拉向市场 —— blend 对闭盘的差距应显著小于市场无关 ours
    expect(r.gapBlendClose).toBeLessThan(r.gapBrier);
  });

  it('ECE 校准指标:双场景均有,取值在 [0,0.5]', async () => {
    const r = await runAccuracy(dataset, params);
    expect(r.calibration.ours).toBeGreaterThanOrEqual(0);
    expect(r.calibration.ours).toBeLessThanOrEqual(0.5);
    expect(r.calibration.blend).not.toBeNull();
    expect(r.calibration.blend!).toBeGreaterThanOrEqual(0);
    expect(r.calibration.blend!).toBeLessThanOrEqual(0.5);
  });

  it('gapBrier(旧口径:市场无关 ours vs 全样本闭盘)语义不变 —— 下游 search/evolve 不受影响', async () => {
    const r = await runAccuracy(dataset, params);
    expect(r.gapBrier).toBeCloseTo(r.ours.brier - r.market.brier, 4);
  });

  it('比分级 score 块:LL/最可能比分命中/净胜球体检数值合理', async () => {
    const r = await runAccuracy(dataset, params);
    expect(r.score).toBeTruthy();
    expect(r.score!.n).toBeGreaterThan(0);
    expect(r.score!.n).toBeLessThanOrEqual(r.n);
    // 比分 LL:9×9 均匀分布 = ln81 ≈ 4.39;像样的模型应显著低于均匀、高于 1
    expect(r.score!.logLoss).toBeGreaterThan(1);
    expect(r.score!.logLoss).toBeLessThan(4.39);
    // 最可能比分命中:足球典型 ~8-12%,必须优于纯随机(1/81)
    expect(r.score!.mlsHit).toBeGreaterThan(1 / 81);
    expect(r.score!.mlsHit).toBeLessThan(0.3);
    expect(Number.isFinite(r.score!.marginBias)).toBe(true);
    expect(r.score!.dispersionRatio).toBeGreaterThan(0.3);
    expect(r.score!.dispersionRatio).toBeLessThan(3);
  });

  it('matchLog:逐场行数=blend 样本数,pick/hit 自洽,默认不收集', async () => {
    const off = await runAccuracy(dataset, params);
    expect(off.matchLog).toBeUndefined(); // 搜索环默认关,省内存
    const r = await runAccuracy(dataset, { ...params, matchLog: true });
    expect(r.matchLog!.length).toBe(r.blend.n);
    for (const row of r.matchLog!.slice(0, 20)) {
      const probs = [row.blend.home, row.blend.draw, row.blend.away];
      expect(Math.max(...probs)).toBeCloseTo(
        row.blendPick === 'H'
          ? probs[0]
          : row.blendPick === 'A'
          ? probs[2]
          : probs[1],
        6,
      );
      expect(row.blendHit).toBe(row.blendPick === row.actual);
      expect(row.marketHit).toBe(row.marketPick === row.actual);
      expect(row.score).toMatch(/^\d+-\d+$/);
    }
    // 命中率与聚合读数一致(逐场即聚合的展开)
    const hitN = r.matchLog!.filter((x) => x.blendHit).length;
    expect(hitN / r.matchLog!.length).toBeCloseTo(r.blend.hitRate, 3);
  });
});

describe('比分级 totalBias(总进球水平体检,2026-07-09)', () => {
  it('totalBias 有限;totalScale 调低预测总球 → totalBias 单调上移', async () => {
    const r1 = await runAccuracy(dataset, params);
    expect(r1.score).toBeTruthy();
    expect(Number.isFinite(r1.score!.totalBias)).toBe(true);
    const r08 = await runAccuracy(dataset, {
      ...params,
      tuning: { ...params.tuning, totalScale: 0.8 },
    });
    expect(r08.score!.n).toBe(r1.score!.n); // 同批比赛
    // 预测 λ+μ 变小 → 实际−预测 变大(方向性,不依赖具体联赛数值)
    expect(r08.score!.totalBias).toBeGreaterThan(r1.score!.totalBias);
    // 量级自洽:Δ ≈ 0.2×(λ+μ)均值 > 0.3 球
    expect(r08.score!.totalBias - r1.score!.totalBias).toBeGreaterThan(0.3);
  });
});

describe('marketWeight=1.0 奇异点(记录语义,防误用)', () => {
  it('mw=1.0 → 非市场权重全 0,ours 通道无市场模型 wsum=0 → 全部预测 null → n=0', async () => {
    const r = await runAccuracy(dataset, { ...params, marketWeight: 1.0 });
    expect(r.n).toBe(0); // 调参网格严禁 1.0;recalibrate evalGap 已加 n=0 → 99 退化守卫
  });
});
