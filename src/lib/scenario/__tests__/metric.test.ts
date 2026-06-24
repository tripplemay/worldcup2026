import { desiredByMetric, sortBucketsByMetric } from '../types';
import type { ResultBucket, StageProbs } from '../types';

const probs = (advance: number, qf: number): StageProbs => ({
  advance,
  r16: (advance + qf) / 2,
  qf,
  sf: qf / 2,
  final: qf / 4,
  champion: qf / 8,
  expStage: advance + qf,
});

const bucket = (
  outcome: ResultBucket['outcome'],
  advance: number,
  qf: number,
): ResultBucket => ({
  outcome,
  prob: 0.33,
  target: qf,
  probs: probs(advance, qf),
});

describe('口径切换:desiredByMetric / sortBucketsByMetric', () => {
  // 赢→最易出线但不易进8强;负→最易进8强(反摆铺路)
  const byResult = [
    bucket('W', 0.9, 0.2),
    bucket('D', 0.5, 0.5),
    bucket('L', 0.4, 0.6),
  ];

  it('「进下一轮(出线)」口径下最期望=胜', () => {
    expect(desiredByMetric(byResult, 'R32')).toBe('W');
  });

  it('「打进8强」口径下最期望=负', () => {
    expect(desiredByMetric(byResult, 'QF')).toBe('L');
  });

  it('两口径排序不同(支持交叉比对)', () => {
    expect(sortBucketsByMetric(byResult, 'R32').map((b) => b.outcome)).toEqual([
      'W',
      'D',
      'L',
    ]);
    expect(sortBucketsByMetric(byResult, 'QF').map((b) => b.outcome)).toEqual([
      'L',
      'D',
      'W',
    ]);
  });

  it('空桶返回 undefined', () => {
    expect(desiredByMetric([], 'QF')).toBeUndefined();
  });
});
