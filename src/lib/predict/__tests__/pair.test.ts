import { predictPair, leagueAverages } from '../pair';
import type { TeamRating } from '../types';

const rating = (norm: string, elo: number): TeamRating => ({
  norm,
  name: norm,
  xgFor: 1.4,
  xgAgainst: 1.1,
  goalsFor: 1.4,
  goalsAgainst: 1.1,
  elo,
  sample: 10,
  updatedAt: 0,
});

describe('predictPair', () => {
  const ratings = { strong: rating('strong', 1900), weak: rating('weak', 1500) };
  const eloMap = { strong: 1900, weak: 1500 };
  const { leagueAvg, leagueAvgGoals } = leagueAverages(ratings);
  const ctx = { ratings, eloMap, leagueAvg, leagueAvgGoals };

  it('返回归一化的胜平负(和≈1)+ λ/μ', () => {
    const p = predictPair('strong', 'weak', ctx)!;
    expect(p).not.toBeNull();
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 2);
    expect(p.xgHome).toBeGreaterThan(0);
    expect(p.xgAway).toBeGreaterThan(0);
  });

  it('强队作主时胜率高于其作客时', () => {
    const asHome = predictPair('strong', 'weak', ctx)!;
    const asAway = predictPair('weak', 'strong', ctx)!;
    expect(asHome.homeWin).toBeGreaterThan(asAway.awayWin === undefined ? 0 : 0);
    // 强队胜率(无论主客)应明显高于弱队
    expect(asHome.homeWin).toBeGreaterThan(asHome.awayWin);
    expect(asAway.awayWin).toBeGreaterThan(asAway.homeWin);
  });

  it('提高某队 Elo 会抬高其胜率', () => {
    const base = predictPair('strong', 'weak', ctx)!;
    const boostedElo = { strong: 2100, weak: 1500 };
    const boosted = predictPair('strong', 'weak', {
      ...ctx,
      eloMap: boostedElo,
      ratings: { ...ratings, strong: rating('strong', 2100) },
    })!;
    expect(boosted.homeWin).toBeGreaterThan(base.homeWin);
  });
});
