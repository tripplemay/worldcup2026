import {
  formatPct,
  pctWidth,
  expStageStage,
  expStageProgress,
  advanceSwing,
  mindsetOf,
  DISPLAY_LENS,
  STAGE_LABEL_KEY,
  DEPTH_STAGES,
} from 'lib/scenario/display';
import { STAGE_ORDER } from 'lib/scenario/types';
import type {
  Outcome,
  StageProbs,
  TeamOutlook,
  TeamStanding,
} from 'lib/scenario/types';

describe('formatPct', () => {
  it('0 与负数显示 0%', () => {
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(-0.5)).toBe('0%');
  });

  it('非零但四舍五入为 0 的小概率显示 <1%(保留弱旅区分度)', () => {
    expect(formatPct(0.004)).toBe('<1%'); // 0.4% → 旧实现会变 0%
    expect(formatPct(0.0001)).toBe('<1%');
  });

  it('0.5% 边界向上取整为 1%', () => {
    expect(formatPct(0.005)).toBe('1%');
  });

  it('常规概率四舍五入取整', () => {
    expect(formatPct(0.146)).toBe('15%');
    expect(formatPct(0.5)).toBe('50%');
    expect(formatPct(1)).toBe('100%');
  });
});

describe('pctWidth', () => {
  it('夹紧到 [0,1] 并输出 CSS 百分比', () => {
    expect(pctWidth(0)).toBe('0%');
    expect(pctWidth(0.5)).toBe('50%');
    expect(pctWidth(1)).toBe('100%');
    expect(pctWidth(1.5)).toBe('100%');
    expect(pctWidth(-1)).toBe('0%');
  });

  it('NaN/Infinity 兜底为 0%', () => {
    expect(pctWidth(NaN)).toBe('0%');
    expect(pctWidth(Infinity)).toBe('0%');
  });
});

describe('expStageStage', () => {
  it('四舍五入到最近阶段', () => {
    expect(expStageStage(0)).toBe('OUT');
    expect(expStageStage(0.8)).toBe('R32');
    expect(expStageStage(3.2)).toBe('QF');
    expect(expStageStage(6)).toBe('CHAMPION');
  });

  it('越界夹紧', () => {
    expect(expStageStage(-1)).toBe('OUT');
    expect(expStageStage(99)).toBe('CHAMPION');
  });

  it('NaN/Infinity 防御回退到 OUT(避免 t(undefined) 崩溃)', () => {
    expect(expStageStage(NaN)).toBe('OUT');
    expect(expStageStage(Infinity)).toBe('OUT');
  });
});

describe('expStageProgress', () => {
  it('归一化到 [0,1]', () => {
    expect(expStageProgress(0)).toBe(0);
    expect(expStageProgress(3)).toBe(0.5);
    expect(expStageProgress(6)).toBe(1);
    expect(expStageProgress(9)).toBe(1);
    expect(expStageProgress(-2)).toBe(0);
  });

  it('NaN 防御回退到 0', () => {
    expect(expStageProgress(NaN)).toBe(0);
  });
});

// 构造最小 TeamOutlook:advances=各结果(W/D/L)的出线概率;standing 可覆盖
const sp = (advance: number): StageProbs => ({
  advance,
  r16: 0,
  qf: 0,
  sf: 0,
  final: 0,
  champion: 0,
  expStage: 1,
});
const mkOutlook = (
  advances: number[],
  over: Partial<TeamOutlook> = {},
): TeamOutlook => ({
  norm: 'x',
  name: 'X',
  group: 'A',
  played3: false,
  overall: sp(0.5),
  rankProbs: { p1: 0, p2: 0, p3: 0, p4: 0 },
  byResult: advances.map((a, i) => ({
    outcome: (['W', 'D', 'L'] as Outcome[])[i],
    prob: 1 / advances.length,
    target: 0,
    probs: sp(a),
  })),
  ...over,
});
const st = (o: Partial<TeamStanding>): TeamStanding => ({
  rank: 2,
  played: 2,
  win: 1,
  draw: 0,
  loss: 1,
  gf: 2,
  ga: 2,
  gd: 0,
  points: 3,
  remaining: 1,
  ...o,
});

describe('advanceSwing', () => {
  it('胜平负出线概率的极差(max−min)', () => {
    expect(advanceSwing(mkOutlook([0.8, 0.5, 0.3]))).toBeCloseTo(0.5, 6);
  });
  it('已踢(played3)→ 0', () => {
    expect(advanceSwing(mkOutlook([0.8, 0.3], { played3: true }))).toBe(0);
  });
  it('无条件桶 → 0', () => {
    expect(advanceSwing(mkOutlook([]))).toBe(0);
  });
});

describe('mindsetOf', () => {
  it('确定性优先:已锁头名 / 已锁前二', () => {
    expect(
      mindsetOf(
        mkOutlook([0.9, 0.9, 0.9], { standing: st({ clinchedTop1: true }) }),
      ),
    ).toBe('clinchedTop1');
    expect(
      mindsetOf(
        mkOutlook([0.9, 0.9, 0.9], { standing: st({ clinchedTop2: true }) }),
      ),
    ).toBe('clinched');
  });
  it('必垫底(bestRank=4)→ 已出局;无缘前二→力争第三', () => {
    expect(
      mindsetOf(
        mkOutlook([0, 0, 0], { standing: st({ bestRank: 4, worstRank: 4 }) }),
      ),
    ).toBe('eliminated');
    expect(
      mindsetOf(
        mkOutlook([0.4, 0.3, 0.2], {
          standing: st({ bestRank: 3, eliminatedTop2: true }),
        }),
      ),
    ).toBe('thirdHunt');
  });
  it('无确定性标志时按出线摆动:大→生死战、小→安稳、中→争夺', () => {
    expect(mindsetOf(mkOutlook([0.9, 0.5, 0.2]))).toBe('decisive'); // swing 0.7
    expect(mindsetOf(mkOutlook([0.52, 0.5, 0.48]))).toBe('cushion'); // swing 0.04
    expect(mindsetOf(mkOutlook([0.6, 0.5, 0.45]))).toBe('contending'); // swing 0.15
  });
});

describe('常量自洽', () => {
  it('DISPLAY_LENS 是合法 Stage', () => {
    expect(STAGE_ORDER).toContain(DISPLAY_LENS);
  });

  it('STAGE_LABEL_KEY 覆盖全部阶段', () => {
    for (const s of STAGE_ORDER) {
      expect(STAGE_LABEL_KEY[s]).toMatch(/^scenarios\./);
    }
  });

  it('DEPTH_STAGES 6 档按累积概率取值', () => {
    const p: StageProbs = {
      advance: 0.9,
      r16: 0.7,
      qf: 0.5,
      sf: 0.3,
      final: 0.15,
      champion: 0.07,
      expStage: 3,
    };
    expect(DEPTH_STAGES).toHaveLength(6);
    expect(DEPTH_STAGES.map((d) => d.pick(p))).toEqual([
      0.9, 0.7, 0.5, 0.3, 0.15, 0.07,
    ]);
  });
});
