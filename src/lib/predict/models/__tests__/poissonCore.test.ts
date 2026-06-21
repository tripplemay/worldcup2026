import {
  buildMatrix,
  scoreStatsFromMatrix,
  tiltMatrix,
  tiltEnsembleScores,
} from '../poissonCore';
import type { MatchPrediction } from '../../model';

/** 从比分矩阵求胜平负(主 i>j / 平 i=j / 客 i<j)。 */
function proj1x2(m: number[][]) {
  let h = 0,
    d = 0,
    a = 0,
    t = 0;
  for (let i = 0; i < m.length; i++)
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      t += p;
      if (i > j) h += p;
      else if (i === j) d += p;
      else a += p;
    }
  return { h: h / t, d: d / t, a: a / t };
}

describe('后验矩阵倾斜 (Phase 8.1 Q5)', () => {
  it('pois===ens 时为恒等(分布不变)', () => {
    const m = buildMatrix(1.6, 1.1);
    const s0 = scoreStatsFromMatrix(m);
    const ident = proj1x2(m);
    const t = tiltMatrix(m, ident, ident);
    const s1 = scoreStatsFromMatrix(t);
    expect(s1.over25).toBeCloseTo(s0.over25, 3);
    expect(s1.topScores[0].score).toBe(s0.topScores[0].score);
  });

  it('倾斜后矩阵的胜平负严格等于 ensemble 头条', () => {
    const m = buildMatrix(1.5, 1.3);
    const pois = proj1x2(m);
    const ens = { h: 0.84, d: 0.1, a: 0.06 };
    const x = proj1x2(tiltMatrix(m, pois, ens));
    expect(x.h).toBeCloseTo(0.84, 2);
    expect(x.d).toBeCloseTo(0.1, 2);
    expect(x.a).toBeCloseTo(0.06, 2);
  });

  it('强主优:头条强主胜 → 最可能比分主队赢(消除"高胜率却首推平局")', () => {
    const m = buildMatrix(1.4, 1.2);
    const p1 = proj1x2(m);
    const pois: MatchPrediction = {
      modelId: 'poisson-xg',
      matchId: 'x',
      homeWin: p1.h,
      draw: p1.d,
      awayWin: p1.a,
      xgHome: 1.4,
      xgAway: 1.2,
      confidence: 'high',
    };
    const ens: MatchPrediction = {
      modelId: 'ensemble',
      matchId: 'x',
      homeWin: 0.85,
      draw: 0.1,
      awayWin: 0.05,
      confidence: 'high',
    };
    const tilted = tiltEnsembleScores(ens, [pois]);
    expect(tilted.homeWin).toBe(0.85); // 头条 1X2 不变
    const [h, a] = tilted.topScores![0].score.split('-').map(Number);
    expect(h).toBeGreaterThan(a); // 最可能比分为主胜
  });

  it('无 poisson 腿时原样返回', () => {
    const ens: MatchPrediction = {
      modelId: 'ensemble',
      matchId: 'x',
      homeWin: 0.5,
      draw: 0.3,
      awayWin: 0.2,
      confidence: 'medium',
    };
    expect(tiltEnsembleScores(ens, [])).toBe(ens);
  });
});
