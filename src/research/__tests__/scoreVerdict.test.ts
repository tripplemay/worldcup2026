/**
 * 轴C 比分级判决实验(SCORE_EXP=1 显式触发,CI 不跑;~30-50 分钟):
 *   SCORE_EXP=1 pnpm test src/research/__tests__/scoreVerdict.test.ts
 *
 * 问题:按比分对数似然重校准内核,①IS/val 比分 LL 能提升多少?②对 1X2 gap 是帮
 * 是害(副作用)?③最可能比分命中率变化?④泊松方差假设(dispersionRatio)成立否?
 * 断言只做结构检查;数值进 console 供决策记录。
 */
import { recalibrateKernel, KERNEL_BASELINE } from '../recalibrate';
import { runAccuracy } from '../accuracy';
import { sliceDates } from '../walkforward';
import { buildHoldoutManifest, excludeHoldout } from '../governance';
import { partitionWithLockedHoldout } from '../evolve';
import { loadLeagueDataset } from '../dataset';
import { LEAGUES } from '../leagues';
import type { KernelPoint } from '../recalibrate';

const d = process.env.SCORE_EXP ? describe : describe.skip;

d('轴C 比分级判决:score-LL 重校准(9 联赛)', () => {
  it('逐联赛 score 重校准 + val 全读数', async () => {
    const rows: Record<string, unknown>[] = [];
    for (const lg of LEAGUES) {
      const dataset = loadLeagueDataset(lg.key);
      if (!dataset.allRes.length) {
        rows.push({ league: lg.key, error: '数据缺失' });
        continue;
      }
      const manifest = buildHoldoutManifest(
        dataset,
        sliceDates(dataset).holdoutFrom,
        0,
      );
      const partition = partitionWithLockedHoldout(
        dataset,
        manifest.holdoutFrom,
      );
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

      const r = await recalibrateKernel(dataset, {
        objective: 'score',
        manifest,
      });
      const vb = await valAcc(KERNEL_BASELINE);
      const vt = await valAcc(r.tuned);
      const row = {
        league: lg.key,
        nameZh: lg.nameZh,
        tuned: r.tuned,
        isScoreLL: { baseline: r.isGapBaseline, tuned: r.isGapTuned },
        val: {
          scoreLLBaseline: vb.score?.logLoss,
          scoreLLTuned: vt.score?.logLoss,
          mlsHitBaseline: vb.score?.mlsHit,
          mlsHitTuned: vt.score?.mlsHit,
          marginBiasTuned: vt.score?.marginBias,
          dispersionTuned: vt.score?.dispersionRatio,
          // 副作用:比分目标对 1X2 的影响
          oursGapBaseline: vb.gapBrier,
          oursGapTuned: vt.gapBrier,
        },
        evals: r.evals,
      };
      rows.push(row);
      console.log(`[score-verdict] ${lg.key}`, JSON.stringify(row));
    }
    console.log('[score-verdict][table]', JSON.stringify(rows));
    expect(rows.length).toBe(LEAGUES.length);
  }, 7200000);
});
