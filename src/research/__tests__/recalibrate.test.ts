/**
 * 内核重校准单测:注入合成碗面验证坐标下降收敛/纪律(val 只评两点)/确定性。
 */
import { recalibrateKernel, KERNEL_BASELINE, KERNEL_GRID } from '../recalibrate';
import type { KernelPoint } from '../recalibrate';
import type { EngineDataset } from '../engine';

// 最小可切分数据集(sliceDates 需要日期序列;odds 空即可 —— evalGap 注入后不触引擎)
const mkDs = (): EngineDataset => ({
  allHist: [],
  allRes: Array.from({ length: 100 }, (_, i) => ({
    eventId: `e${i}`,
    date: `2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(
      1 + (i % 28),
    ).padStart(2, '0')}T15:00:00Z`,
    home: `h${i}`,
    away: `a${i}`,
    homeNorm: `h${i}`,
    awayNorm: `a${i}`,
    homeGoals: 1,
    awayGoals: 0,
  })) as EngineDataset['allRes'],
  odds: {},
});

describe('recalibrateKernel(注入碗面)', () => {
  // 碗面:最优点在 goalShrink=0.31 / marketWeight=0.6,其余维平坦
  const bowl = async (p: KernelPoint) =>
    (p.goalShrink - 0.31) ** 2 + (p.marketWeight - 0.6) ** 2;

  it('坐标下降收敛到网格最优;val 仅评两点;确定性', async () => {
    let valEvals = 0;
    const evalGap = async (p: KernelPoint, win: { from?: string; to?: string }) => {
      if (win.from) valEvals += 1; // val 窗带 from;IS 窗只有 to
      return bowl(p);
    };
    const r = await recalibrateKernel(mkDs(), { evalGap });
    expect(r.tuned.goalShrink).toBe(0.31);
    expect(r.tuned.marketWeight).toBe(0.6);
    expect(r.isGapTuned).toBeLessThan(r.isGapBaseline);
    expect(valEvals).toBe(2); // 纪律:val 只在基线与终点各评一次
    const r2 = await recalibrateKernel(mkDs(), { evalGap });
    expect(r2.tuned).toEqual(r.tuned); // 确定性
  });

  it('基线已是最优 → 原地不动且提前停', async () => {
    const flat = async () => 0.5;
    const r = await recalibrateKernel(mkDs(), { evalGap: flat });
    expect(r.tuned).toEqual(KERNEL_BASELINE);
    // 1 轮全维无改进即停:1(基线) + 全档位数(减去与基线相等的档)
    const gridEvals = Object.entries(KERNEL_GRID).reduce(
      (s, [k, vs]) =>
        s + vs.filter((v) => v !== KERNEL_BASELINE[k as keyof KernelPoint]).length,
      0,
    );
    expect(r.evals).toBe(1 + gridEvals);
  });
});
