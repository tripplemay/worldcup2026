/**
 * 内核重校准单测:注入合成碗面验证坐标下降收敛/纪律(val 只评两点)/确定性。
 */
import {
  recalibrateKernel,
  KERNEL_BASELINE,
  KERNEL_GRID,
} from '../recalibrate';
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
    const evalGap = async (
      p: KernelPoint,
      win: { from?: string; to?: string },
    ) => {
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

  it('墙钟截断:预算耗尽 → truncated=true 且返回当前局部最优;val 仍只评两点', async () => {
    let t = 0;
    let valEvals = 0;
    const evalGap = async (p: KernelPoint, win: { from?: string }) => {
      if (win.from) valEvals += 1;
      return bowl(p);
    };
    const r = await recalibrateKernel(mkDs(), {
      evalGap,
      wallClockMs: 5,
      clock: () => (t += 3), // 第 2 次检查即超预算
    });
    expect(r.truncated).toBe(true);
    expect(r.evals).toBeLessThan(5); // 远未跑满
    expect(valEvals).toBe(2); // 截断不影响 val 两点纪律
    expect(r.tuned).toBeDefined();
  });

  it('锁定 holdout:传入 manifest 时切分以 manifest.holdoutFrom 为界(L3 不随数据漂移)', async () => {
    // 两个不同 holdoutFrom 的 manifest → IS 窗(to=trainTo)不同 → 注入的 evalGap 能观测到
    const seen: string[] = [];
    const evalGap = async (
      _p: KernelPoint,
      win: { from?: string; to?: string },
    ) => {
      if (!win.from && win.to) seen.push(win.to);
      return 0.5;
    };
    const ds = mkDs();
    const mkManifest = (holdoutFrom: string) => ({
      holdoutFrom,
      holdoutEventIds: [],
      lockedAt: 0,
    });
    await recalibrateKernel(ds, {
      evalGap,
      manifest: mkManifest('2025-03-01') as never,
    });
    const a = seen[seen.length - 1];
    await recalibrateKernel(ds, {
      evalGap,
      manifest: mkManifest('2025-02-01') as never,
    });
    const b = seen[seen.length - 1];
    expect(a).not.toBe(b); // holdout 边界前移 → train 窗跟着变(锁定生效)
  });

  it('网格护栏:marketWeight 严禁含 1.0(ensemble 奇异点:非市场权重全 0,ours 通道 wsum=0 → 全预测 null → n=0 → 目标兜底 0 被当最优)', () => {
    expect(Math.max(...KERNEL_GRID.marketWeight)).toBeLessThan(1);
  });

  it('基线已是最优 → 原地不动且提前停', async () => {
    const flat = async () => 0.5;
    const r = await recalibrateKernel(mkDs(), { evalGap: flat });
    expect(r.tuned).toEqual(KERNEL_BASELINE);
    // 1 轮全维无改进即停:1(基线) + 全档位数(减去与基线相等的档)
    const gridEvals = Object.entries(KERNEL_GRID).reduce(
      (s, [k, vs]) =>
        s +
        vs.filter((v) => v !== KERNEL_BASELINE[k as keyof KernelPoint]).length,
      0,
    );
    expect(r.evals).toBe(1 + gridEvals);
  });
});
