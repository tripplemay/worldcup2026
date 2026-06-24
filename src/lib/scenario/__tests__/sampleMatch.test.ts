import { mulberry32, hashSeed } from '../rng';
import { buildScoreSampler, sampleScore } from '../sampleMatch';
import type { MatchPrediction } from 'lib/predict/model';

const pred = (over: Partial<MatchPrediction>): MatchPrediction => ({
  modelId: 'ensemble',
  matchId: 'sim',
  homeWin: 0.5,
  draw: 0.27,
  awayWin: 0.23,
  confidence: 'medium',
  xgHome: 1.6,
  xgAway: 1.1,
  ...over,
});

describe('rng', () => {
  it('同种子完全可复现', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('不同种子序列不同', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('hashSeed 稳定且区分', () => {
    expect(hashSeed('brazil v argentina')).toBe(hashSeed('brazil v argentina'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
});

describe('比分采样', () => {
  it('采样的胜平负收敛到融合头条', () => {
    const s = buildScoreSampler(pred({}));
    const rng = mulberry32(42);
    const N = 40000;
    let h = 0;
    let d = 0;
    let a = 0;
    let goals = 0;
    for (let i = 0; i < N; i++) {
      const { homeGoals, awayGoals } = sampleScore(s, rng);
      if (homeGoals > awayGoals) h++;
      else if (homeGoals === awayGoals) d++;
      else a++;
      goals += homeGoals + awayGoals;
    }
    expect(h / N).toBeCloseTo(0.5, 1);
    expect(d / N).toBeCloseTo(0.27, 1);
    expect(a / N).toBeCloseTo(0.23, 1);
    // 平均总进球应接近 λ+μ=2.7(允许 DC/倾斜带来的偏移)
    expect(goals / N).toBeGreaterThan(2.2);
    expect(goals / N).toBeLessThan(3.2);
  });

  it('采样确定性:同种子同序列', () => {
    const s = buildScoreSampler(pred({}));
    const seq = (seed: number) => {
      const rng = mulberry32(seed);
      return Array.from({ length: 8 }, () => sampleScore(s, rng));
    };
    expect(seq(7)).toEqual(seq(7));
  });

  it('无 λ/μ 时退化为按头条抽代表比分', () => {
    const s = buildScoreSampler(
      pred({ xgHome: undefined, xgAway: undefined }),
    );
    const rng = mulberry32(9);
    const N = 20000;
    let h = 0;
    let d = 0;
    let a = 0;
    for (let i = 0; i < N; i++) {
      const { homeGoals, awayGoals } = sampleScore(s, rng);
      // 只可能出现 1-0 / 1-1 / 0-1
      expect([
        `${homeGoals}-${awayGoals}`,
      ]).toEqual(
        expect.arrayContaining([expect.stringMatching(/^(1-0|1-1|0-1)$/)]),
      );
      if (homeGoals > awayGoals) h++;
      else if (homeGoals === awayGoals) d++;
      else a++;
    }
    expect(h / N).toBeCloseTo(0.5, 1);
    expect(d / N).toBeCloseTo(0.27, 1);
    expect(a / N).toBeCloseTo(0.23, 1);
  });
});
