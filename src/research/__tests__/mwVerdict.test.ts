/**
 * P0a 裁决实验(MW_EXP=1 显式触发,CI 不跑;一次性,跑完出报告即删):
 *   MW_EXP=1 pnpm test src/research/__tests__/mwVerdict.test.ts
 *
 * 问题:blend 最优 marketWeight 曾被网格上界 0.9 右删失(6/9 联赛贴界)——
 * 网格扩到 {0.95,0.98,1.0} 后,最优落在哪?
 *   · =1.0 → 模型 blend 价值为零(有盘场景纯抄市场即最优)
 *   · 停 0.95/0.98 → 模型有非零真实权重(量化其大小)
 * 纪律:坐标下降只在 IS;val 只评基线与终点(与生产 runner 完全同路径)。
 */
import { recalibrateKernel } from '../recalibrate';
import { loadLeagueDataset } from '../dataset';

const d = process.env.MW_EXP ? describe : describe.skip;

// 6 个右删失联赛(07-09 复盘:blend-tuned marketWeight=0.9 贴旧上界)
const CENSORED = ['epl-2025', 'sc0', 'p1', 'n1', 'b1', 'f1'];

d('P0a 裁决:marketWeight 右删失(扩档后 blend 重校准)', () => {
  it('6 联赛 blend 重校准(新网格)→ 最优 mw 读数', async () => {
    const rows: Record<string, unknown>[] = [];
    for (const key of CENSORED) {
      const dataset = loadLeagueDataset(key);
      if (!dataset.allRes.length) {
        rows.push({ league: key, error: '数据缺失' });
        continue;
      }
      const r = await recalibrateKernel(dataset, { objective: 'blend' });
      rows.push({
        league: key,
        bestMw: r.tuned.marketWeight,
        tuned: r.tuned,
        isBlendBaseline: r.isGapBaseline,
        isBlendTuned: r.isGapTuned,
        valBlendBaseline: r.valGapBaseline,
        valBlendTuned: r.valGapTuned,
        evals: r.evals,
        truncated: r.truncated,
      });
      // eslint-disable-next-line no-console
      console.log('[MW_EXP]', JSON.stringify(rows[rows.length - 1]));
    }
    // eslint-disable-next-line no-console
    console.log('[MW_EXP] 汇总', JSON.stringify(rows, null, 2));
    expect(rows.length).toBe(CENSORED.length);
  }, 7_200_000);
});
