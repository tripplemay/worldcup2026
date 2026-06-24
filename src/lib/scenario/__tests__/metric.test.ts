import { desiredByMetric, sortBucketsByMetric, isMeaningful } from '../types';
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

describe('isMeaningful:势均阈值(5pp 绝对 或 50% 相对)', () => {
  it('摆动≥5pp → 有取舍', () => {
    const b = [
      bucket('W', 0.3, 0.3),
      bucket('D', 0.3, 0.24),
      bucket('L', 0.3, 0.2),
    ];
    expect(isMeaningful(b, 'QF')).toBe(true);
  });

  it('绝对小但相对≥50%(弱旅 2%/0%)→ 有取舍', () => {
    const b = [bucket('W', 0.02, 0.02), bucket('D', 0, 0), bucket('L', 0, 0)];
    expect(isMeaningful(b, 'QF')).toBe(true);
  });

  it('三者几乎相等(33/31/31)→ 势均', () => {
    const b = [
      bucket('L', 0.33, 0.33),
      bucket('D', 0.31, 0.31),
      bucket('W', 0.31, 0.31),
    ];
    expect(isMeaningful(b, 'QF')).toBe(false);
  });

  it('不足两桶 → false', () => {
    expect(isMeaningful([bucket('W', 0.5, 0.5)], 'QF')).toBe(false);
  });
});
