import {
  formatPct,
  pctWidth,
  expStageStage,
  expStageProgress,
  DISPLAY_LENS,
  STAGE_LABEL_KEY,
  DEPTH_STAGES,
} from 'lib/scenario/display';
import { STAGE_ORDER } from 'lib/scenario/types';
import type { StageProbs } from 'lib/scenario/types';

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
