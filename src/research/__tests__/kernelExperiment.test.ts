/**
 * 第④项实验 runner(KERNEL_EXP=1 显式触发,CI 不跑;重活 ~30-60 分钟):
 *   KERNEL_EXP=1 pnpm test src/research/__tests__/kernelExperiment.test.ts
 *
 * A. 内核重校准判决表:9 联赛逐个解冻内核 6 参(仅 train 段 IS gapBrier 坐标下降),
 *    输出「val gapBrier 能否 ≤0」—— 模型概率路线最后一次体检。
 * B. 跨联赛 pooled CLV:预注册默认配置在 9 联赛 val 窗合并 value 注 CLV
 *    (n 对照 G2 的 2500;把单联赛证否升级为家族级命题)。
 * 断言只做结构性检查;数值结论进 console 读数供决策记录。
 */
import { recalibrateKernel } from '../recalibrate';
import { poolClvStats, leagueValClvs } from '../pooled';
import { loadLeagueDataset } from '../dataset';
import { LEAGUES } from '../leagues';

const d = process.env.KERNEL_EXP ? describe : describe.skip;

d('第④项:内核重校准 + pooled CLV(判决实验)', () => {
  it('A. 9 联赛内核重校准判决表', async () => {
    const rows: Record<string, unknown>[] = [];
    for (const lg of LEAGUES) {
      const dataset = loadLeagueDataset(lg.key);
      if (!dataset.allRes.length) {
        rows.push({ league: lg.key, error: '数据缺失' });
        continue;
      }
      const r = await recalibrateKernel(dataset);
      rows.push({
        league: lg.key,
        nameZh: lg.nameZh,
        valGapBaseline: r.valGapBaseline,
        valGapTuned: r.valGapTuned,
        delta: +(r.valGapTuned - r.valGapBaseline).toFixed(5),
        reachedParity: r.valGapTuned <= 0,
        isGapBaseline: r.isGapBaseline,
        isGapTuned: r.isGapTuned,
        tuned: r.tuned,
        evals: r.evals,
      });
      console.log(`[kernel-recal] ${lg.key}`, JSON.stringify(rows[rows.length - 1]));
    }
    console.log('[kernel-recal][verdict-table]', JSON.stringify(rows));
    expect(rows.length).toBe(LEAGUES.length);
  }, 7200000);

  it('B. 跨联赛 pooled CLV(预注册默认配置)', async () => {
    const samples: { league: string; clvs: number[] }[] = [];
    for (const lg of LEAGUES) {
      const dataset = loadLeagueDataset(lg.key);
      if (!dataset.allRes.length) continue;
      samples.push({ league: lg.key, clvs: await leagueValClvs(dataset) });
    }
    const pooled = poolClvStats(samples);
    console.log('[pooled-clv]', JSON.stringify(pooled));
    console.log(
      '[pooled-clv][G2-power]',
      JSON.stringify({ n: pooled.n, g2MinN: 2500, sufficient: pooled.n >= 2500 }),
    );
    expect(pooled.perLeague.length).toBeGreaterThan(0);
  }, 7200000);
});
