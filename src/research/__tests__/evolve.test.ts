/**
 * P4+ 进化循环单测:量化/验证器七步管线/发生器去重与确定性/配对显著性障碍/
 * 锁定 holdout 切分/编排器(状态机·预算·注入式 LLM 重放·确定性)。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  quantizeEvo,
  toStrategyParams,
  deriveLabel,
  partitionWithLockedHoldout,
  refineGen,
  randomGen,
  validateProposals,
  pairedClvImprovement,
  clvLcb,
  runEvolutionCycle,
  newEvolutionState,
  DEFAULT_EVO,
  N_MAX,
  extractEvo,
} from '../evolve';
import {
  newRegistry,
  registerTrial,
  configHash,
  datasetHash,
} from '../governance';
import type { EngineDataset, MatchOddsView, BetRecord } from '../engine';
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

// 7 季 seed 后为控测试时长:截到近 3 季(既有断言行为不变)
const SINCE = '2023-08-01';
ds.allRes = ds.allRes.filter((r) => r.date >= SINCE);
ds.allHist = ds.allHist.filter((h) => h.date >= SINCE);
const DH = datasetHash(ds);

describe('量化 + label 派生', () => {
  it('夹紧 + 步进量化(ε-变体归一到同一配置)', () => {
    const a = quantizeEvo({
      goalShrink: 0.6000001,
      dcRho: -0.14,
      minEv: 0.03,
      minProb: 0.3,
      maxEv: 0.3,
    });
    expect(a.goalShrink).toBe(0.6);
    const b = quantizeEvo({
      goalShrink: 99,
      dcRho: -99,
      minEv: 0.0004,
      minProb: 0.9,
      maxEv: 0.2,
    });
    expect(b.goalShrink).toBe(1.2); // 夹到上界
    expect(b.dcRho).toBe(-0.3);
    expect(b.minEv).toBe(0.01);
    expect(b.minProb).toBe(0.5);
    // ε-变体与原值同 hash
    expect(configHash(toStrategyParams(a))).toBe(
      configHash(toStrategyParams(DEFAULT_EVO)),
    );
  });
  it('label 服务端从 configHash 派生', () => {
    const sp = toStrategyParams(DEFAULT_EVO);
    expect(deriveLabel(3, 'llm', sp)).toBe(
      `g3-llm-${configHash(sp).slice(0, 8)}`,
    );
  });
});

describe('锁定 holdout 切分(L3 永不漂移)', () => {
  it('数据增长后 train/val 仍不越锁定日', () => {
    const p1 = partitionWithLockedHoldout(ds, '2025-12-20');
    expect(p1.trainTo < p1.valFrom).toBe(true);
    expect(p1.valTo < '2025-12-20').toBe(true);
    expect(p1.holdoutFrom).toBe('2025-12-20');
    // 模拟数据增长(加 100 场更晚比赛):val 边界不动
    const grown: EngineDataset = {
      ...ds,
      allRes: [
        ...ds.allRes,
        ...Array.from({ length: 100 }, (_, i) => ({
          eventId: `new${i}`,
          date: '2026-06-30T12:00:00Z',
          homeNorm: 'a',
          awayNorm: 'b',
          homeGoals: 1,
          awayGoals: 0,
        })),
      ],
    };
    const p2 = partitionWithLockedHoldout(grown, '2025-12-20');
    expect(p2.valTo).toBe(p1.valTo); // 新场次只进 holdout 前沿
    expect(p2.holdoutTo > p1.holdoutTo).toBe(true);
  });
});

describe('LLM 验证器七步管线', () => {
  const run = (raw: string | null) =>
    validateProposals(raw, 1, newRegistry(), DH, new Set(), 4);

  it('坏 JSON / 非法形状 → 全拒', () => {
    expect(run('not json').accepted).toHaveLength(0);
    expect(run('{"foo":1}').accepted).toHaveLength(0);
    expect(run(null).accepted).toHaveLength(0);
  });
  it('幻觉参数名 / label 注入 → 整项丢弃', () => {
    const r = run(
      JSON.stringify({
        proposals: [
          {
            goalShrink: 0.5,
            dcRho: -0.1,
            minEv: 0.04,
            minProb: 0.3,
            maxEv: 0.3,
            label: 'hack',
          },
        ],
      }),
    );
    expect(r.accepted).toHaveLength(0);
    expect(r.decisions[0].reason).toContain('unknown-keys');
  });
  it('NaN → 拒;越界 → 夹紧接受;未知键 → 拒;夹紧后重复 → 拒', () => {
    const good = {
      goalShrink: 0.5,
      dcRho: -0.1,
      minEv: 0.04,
      minProb: 0.3,
      maxEv: 0.3,
    };
    const r = run(
      JSON.stringify({
        proposals: [
          { ...good, goalShrink: 'NaN' }, // 非有限 → 拒
          { ...good, goalShrink: 9 }, // 越界 → 夹紧(1.2)接受
          { ...good, hack: 1 }, // 未知键 → 整项拒
          { ...good, goalShrink: 9.0000001 }, // 夹紧后与第 2 项重复 → 拒
        ],
      }),
    );
    expect(r.accepted).toHaveLength(1);
    expect(extractEvo(r.accepted[0].params).goalShrink).toBe(1.2);
    expect(r.decisions.filter((d) => d.verdict === 'rejected')).toHaveLength(3);
    // 注:当前边界下(minEv≤0.1 < maxEv≥0.15)夹紧后跨字段违规不可能——检查为保险性质
  });
  it('已注册配置(同 era)→ 拒;跨 era 不算已试', () => {
    const sp = toStrategyParams(
      quantizeEvo({
        goalShrink: 0.5,
        dcRho: -0.1,
        minEv: 0.04,
        minProb: 0.3,
        maxEv: 0.3,
      }),
    );
    const reg = registerTrial(newRegistry(), sp, 0, DH);
    const raw = JSON.stringify({
      proposals: [
        { goalShrink: 0.5, dcRho: -0.1, minEv: 0.04, minProb: 0.3, maxEv: 0.3 },
      ],
    });
    expect(
      validateProposals(raw, 1, reg, DH, new Set(), 4).accepted,
    ).toHaveLength(0);
    expect(
      validateProposals(raw, 1, reg, 'other-era', new Set(), 4).accepted,
    ).toHaveLength(1);
  });
});

describe('发生器', () => {
  it('refine:围绕锚点、去重、確定性、数量受 quota', () => {
    const a = refineGen(DEFAULT_EVO, 0.25, 1, newRegistry(), DH, new Set(), 4);
    const b = refineGen(DEFAULT_EVO, 0.25, 1, newRegistry(), DH, new Set(), 4);
    expect(a.map((x) => x.label)).toEqual(b.map((x) => x.label));
    expect(a.length).toBeLessThanOrEqual(4);
    expect(a.every((x) => x.provenance === 'refine')).toBe(true);
  });
  it('random:种子确定性;不同代不同样本', () => {
    const a = randomGen(1, DH, newRegistry(), new Set(), 4);
    const b = randomGen(1, DH, newRegistry(), new Set(), 4);
    const c = randomGen(2, DH, newRegistry(), new Set(), 4);
    expect(a.map((x) => x.label)).toEqual(b.map((x) => x.label));
    expect(a.map((x) => x.label)).not.toEqual(c.map((x) => x.label));
  });
});

describe('配对显著性障碍 + CLV LCB', () => {
  const mk = (i: number, clv: number | null): BetRecord => ({
    date: `2025-0${(i % 8) + 1}-0${(i % 27) + 1}T12:00:00Z`,
    home: `h${i}`,
    away: `a${i}`,
    tier: 'value',
    betPhase: 'open',
    market: '1X2',
    selection: 'home',
    odds: 2,
    stake: 100,
    pnl: 0,
    result: 'won',
    clv,
  });
  it('系统性 ΔCLV=+2% × 40 对 → 判改进;纯噪声 → 平局', () => {
    const inc = Array.from({ length: 40 }, (_, i) => mk(i, 0.01));
    const chBetter = inc.map((b) => ({
      ...b,
      clv: (b.clv ?? 0) + 0.02 + Math.sin(b.home.length) * 0.001,
    }));
    expect(pairedClvImprovement(chBetter, inc).improved).toBe(true);
    // 交替 ±,均值≈0 → 不改进
    const chNoise = inc.map((b, i) => ({
      ...b,
      clv: (b.clv ?? 0) + (i % 2 === 0 ? 0.01 : -0.01),
    }));
    expect(pairedClvImprovement(chNoise, inc).improved).toBe(false);
  });
  it('配对数 <30 → 一律平局(样本不足不算赢)', () => {
    const inc = Array.from({ length: 10 }, (_, i) => mk(i, 0.01));
    const ch = inc.map((b) => ({ ...b, clv: 0.5 }));
    expect(pairedClvImprovement(ch, inc).improved).toBe(false);
  });
  it('clvLcb:n<10 → 极负;正 CLV 大样本 → LCB 合理', () => {
    expect(clvLcb([mk(1, 0.5)]).lcb).toBe(-99);
    const bets = Array.from({ length: 100 }, (_, i) => mk(i, 0.02));
    expect(clvLcb(bets).lcb).toBeCloseTo(0.02, 3);
  });
});

describe('编排器 runEvolutionCycle', () => {
  it('首代 bootstrap incumbent + 状态/注册表/日志齐全 + 确定性(注入重放)', async () => {
    const llm = async () =>
      JSON.stringify({
        proposals: [
          {
            goalShrink: 0.9,
            dcRho: 0.0,
            minEv: 0.06,
            minProb: 0.25,
            maxEv: 0.4,
            rationale: 'test',
          },
        ],
      });
    const run = () =>
      runEvolutionCycle(
        {
          dataset: ds,
          state: null,
          registry: newRegistry(),
          timeline: [],
          manifest: null,
        },
        { now: 1000, llmPropose: llm, clock: () => 0, maxGenerations: 1 },
      );
    const a = await run();
    const b = await run();
    expect(a.newEpochs).toHaveLength(1);
    expect(a.state.incumbent).not.toBeNull(); // 首代 bootstrap
    expect(a.state.generation).toBe(1);
    expect(a.logs).toHaveLength(1);
    expect(a.logs[0].accepted.some((x) => x.provenance === 'llm')).toBe(true);
    expect(a.logs[0].accepted.some((x) => x.provenance === 'seed')).toBe(true);
    expect(a.ledgerAppend).toHaveLength(1); // incumbent 变更 → gauntlet 一次
    // 注入式重放 → 逐字节相等
    expect(a.state).toEqual(b.state);
    expect(a.newEpochs).toEqual(b.newEpochs);
  }, 300000);

  it('EPL null:多代后无配对改进(noImprove 递增)且 G6 预算受控', async () => {
    const r = await runEvolutionCycle(
      {
        dataset: ds,
        state: null,
        registry: newRegistry(),
        timeline: [],
        manifest: null,
      },
      { now: 1000, clock: () => 0, maxGenerations: 3 },
    );
    expect(r.newEpochs).toHaveLength(3);
    expect(r.state.holdoutTouches.length).toBeLessThanOrEqual(3);
    // 首代 bootstrap 后,EPL null 下配对障碍应拦住大多数"改进"
    expect(r.state.noImproveCount).toBeGreaterThanOrEqual(1);
  }, 300000);

  it('frozen:era 试验数达 N_MAX 即硬停,数据变化不解除', async () => {
    // 预填注册表至 N_MAX(同 era)
    let reg = newRegistry();
    for (let i = 0; i < N_MAX; i++)
      reg = registerTrial(reg, { fill: i }, 0, DH);
    const r = await runEvolutionCycle(
      { dataset: ds, state: null, registry: reg, timeline: [], manifest: null },
      { now: 1000, clock: () => 0, maxGenerations: 2 },
    );
    expect(r.state.status).toBe('frozen');
    expect(r.newEpochs).toHaveLength(0);
  }, 300000);
});
