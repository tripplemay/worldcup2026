/**
 * 轴C 判决实验(BLEND_EXP=1 显式触发,CI 不跑;重活 ~30-60 分钟):
 *   BLEND_EXP=1 pnpm test src/research/__tests__/blendVerdict.test.ts
 *
 * 问题:开盘锚融合(blend)在 val 窗上 —— ①能否追平/超越闭盘(gapBlendClose≤0)?
 * ②能否打败纯开盘去水(gapBlendOpen<0 = 模型携带开盘之外的正交信息)?
 * ③最优 marketWeight 是多少(<0.9 = 模型有非零最优权重)? ④ECE 校准质量?
 * 纪律:blend Brier 坐标下降只在 IS;val 只评基线与终点;断言只做结构检查,
 * 数值进 console 读数供决策记录。
 */
import { recalibrateKernel, KERNEL_BASELINE } from '../recalibrate';
import { runAccuracy } from '../accuracy';
import { sliceDates } from '../walkforward';
import { buildHoldoutManifest, excludeHoldout } from '../governance';
import { loadLeagueDataset } from '../dataset';
import { LEAGUES } from '../leagues';
import type { KernelPoint } from '../recalibrate';

const d = process.env.BLEND_EXP ? describe : describe.skip;

d('轴C 判决:开盘锚融合 vs 闭盘/开盘(9 联赛)', () => {
  it('逐联赛 blend 重校准 + val 全读数', async () => {
    const rows: Record<string, unknown>[] = [];
    for (const lg of LEAGUES) {
      const dataset = loadLeagueDataset(lg.key);
      if (!dataset.allRes.length) {
        rows.push({ league: lg.key, error: '数据缺失' });
        continue;
      }
      const partition = sliceDates(dataset);
      const manifest = buildHoldoutManifest(dataset, partition.holdoutFrom, 0);
      const safe = excludeHoldout(dataset, manifest);
      const valAcc = async (p: KernelPoint) =>
        runAccuracy(safe, {
          tuning: {
            goalShrink: p.goalShrink,
            dcRho: p.dcRho,
            shrinkEloScale: p.shrinkEloScale,
          },
          home: { eloBonus: p.eloBonus, goalMult: p.goalMult },
          marketWeight: p.marketWeight,
          from: partition.valFrom,
          to: partition.valTo,
        });

      const r = await recalibrateKernel(dataset, { objective: 'blend' });
      const vb = await valAcc(KERNEL_BASELINE);
      const vt = await valAcc(r.tuned);
      const row = {
        league: lg.key,
        nameZh: lg.nameZh,
        bestMarketWeight: r.tuned.marketWeight,
        tuned: r.tuned,
        isBlendGapBaseline: r.isGapBaseline,
        isBlendGapTuned: r.isGapTuned,
        val: {
          blendN: vt.blend.n,
          gapBlendCloseBaseline: vb.gapBlendClose,
          gapBlendCloseTuned: vt.gapBlendClose,
          gapBlendOpenTuned: vt.gapBlendOpen,
          blendBrier: vt.blend.brier,
          openBrier: vt.marketOpen.brier,
          closeBrierSub: +(vt.blend.brier - vt.gapBlendClose).toFixed(4),
          eceBlend: vt.calibration.blend,
          eceOurs: vt.calibration.ours,
          oursGapClose: vt.gapBrier,
        },
        verdict: {
          parityClose: vt.gapBlendClose <= 0,
          beatsOpen: vt.gapBlendOpen < 0,
        },
        evals: r.evals,
      };
      rows.push(row);
      console.log(`[blend-verdict] ${lg.key}`, JSON.stringify(row));
    }
    console.log('[blend-verdict][table]', JSON.stringify(rows));
    expect(rows.length).toBe(LEAGUES.length);
  }, 7200000);
});
