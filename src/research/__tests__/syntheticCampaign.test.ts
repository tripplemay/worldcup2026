/**
 * 合成注入 campaign(平台生死判据;重活 ~20-40 分钟,SYNTH_CAMPAIGN=1 显式触发,CI 不跑):
 *   SYNTH_CAMPAIGN=1 pnpm test src/research/__tests__/syntheticCampaign.test.ts
 *
 * 验收(写入决策记录):
 *  · 注入组(EPL 3 季副本,40% 场次开盘主胜 +2.5%):管线必须检出 —— 存在 epoch 冠军
 *    clvPass(n≥100 且 t>2)且终局 incumbent clvT>2。检不出 = 搜索层判死刑。
 *  · 空白对照组(同数据未注入):必须不误报 —— 所有 epoch clvPass=false。
 * 注:验收对准 G1(CLV 检出仪器);PBO/DSR 针对 ROI 噪声,注入不保证其通过,不在判据内。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { runEvolutionCycle } from '../evolve';
import { injectEdge, makeNullControl } from '../synthetic';
import { newRegistry } from '../governance';
import type { EngineDataset, MatchOddsView } from '../engine';
import type { HistMatch, ResultMatch } from 'lib/predict/types';

const d = process.env.SYNTH_CAMPAIGN ? describe : describe.skip;

const seed = (n: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'seed/leagues', n), 'utf8'));
const base: EngineDataset = {
  allHist: Object.values(
    seed('league-epl-2025-historical.json') as Record<string, HistMatch>,
  ),
  allRes: Object.values(
    seed('league-epl-2025-results.json') as Record<string, ResultMatch>,
  ),
  odds: seed('league-epl-2025-oddsx.json') as Record<string, MatchOddsView>,
};
// 3 季(与 search.test 同口径):val 窗 CLV 样本 ~400,远超 G1 n≥100
const SINCE = '2023-08-01';
base.allRes = base.allRes.filter((r) => r.date >= SINCE);
base.allHist = base.allHist.filter((h) => h.date >= SINCE);

const campaign = async (dataset: EngineDataset) =>
  runEvolutionCycle(
    {
      dataset,
      state: null,
      registry: newRegistry(),
      timeline: [],
      manifest: null,
      forward: null,
    },
    {
      now: Date.parse('2026-07-04T00:00:00Z'),
      llmPropose: async () => null, // 无 LLM:refine/random 补足(实验只测仪器,不测提议器)
      wallClockBudgetMs: 30 * 60_000,
      maxGenerations: 8,
    },
  );

d('合成注入 campaign(生死判据)', () => {
  // MDE(最小可检出 edge)已测读数:
  //  · lift=+2.5%(单边抬主胜):检不出 —— 单边抬价精准招募模型最高估该侧的场次,
  //    边际注基线 CLV ≈ −3% 把注入吃掉(内生逆向选择,winner's curse);
  //  · lift=+2.5%(三向同抬):IS 冠军 t +3.3~4.0(选参链检出)但 val 全负 −0.7~−2.3
  //    —— 被选中注的基线逆选择深度 ≈ −3%,+2.5% 翻不正;IS 高分 = max-of-73 选择偏差。
  //  ⇒ 在 gapBrier>0 的引擎上,组合级可检出的开盘价差下界在 2.5%~5% 之间;
  //    「对 ≤2.5% 的真 edge 当前引擎是聋的」为正式功效读数,写入决策记录。
  it('注入组:检出已知 +5% edge(存在 clvPass epoch 且 incumbent clvT>2)', async () => {
    const inj = injectEdge(base, { rate: 0.4, liftPct: 0.05 });
    expect(inj.injected.length).toBeGreaterThan(200);
    const res = await campaign(inj.dataset);
    const passEpochs = res.newEpochs.filter((e) => e.screen.clvPass);
    // 供决策记录的原始读数
    console.log(
      '[synth-campaign][注入组]',
      JSON.stringify({
        injected: inj.injected.length,
        liftPct: inj.liftPct,
        generations: res.newEpochs.length,
        clvPassEpochs: passEpochs.map((e) => e.epoch),
        winners: res.newEpochs.map((e) => ({
          g: e.epoch,
          label: e.winner.label,
          isClvT: e.winner.isClvT,
          oosClvT: e.winner.oosClvT,
          oosClvN: e.winner.oosClvN,
        })),
        incumbent: res.state.incumbent,
        note: res.note,
      }),
    );
    expect(passEpochs.length).toBeGreaterThan(0);
    expect(res.state.incumbent?.clvT ?? 0).toBeGreaterThan(2);
  }, 3600000);

  it('构造性零假设对照组:不误报(所有 epoch clvPass=false)', async () => {
    // 对照必须按构造为 null(开盘=闭盘×零均值噪声):真实数据的开/闭盘差可能藏真 CLV
    // 结构(旧仪器失明从未探过),拿真实数据断言「必须无检出」不成立
    const nullDs = makeNullControl(base, { noisePct: 0.01 });
    const res = await campaign(nullDs);
    console.log(
      '[synth-campaign][对照组]',
      JSON.stringify({
        generations: res.newEpochs.length,
        clvPass: res.newEpochs.map((e) => e.screen.clvPass),
        incumbentClvT: res.state.incumbent?.clvT ?? null,
        note: res.note,
      }),
    );
    expect(res.newEpochs.every((e) => !e.screen.clvPass)).toBe(true);
  }, 3600000);
});
