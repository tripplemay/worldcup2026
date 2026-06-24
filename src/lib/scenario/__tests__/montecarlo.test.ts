import { runMonteCarlo, detectRound3 } from '../montecarlo';
import { GROUP_LETTERS } from '../types';
import type { GroupLetter, GroupMatch, TeamMeta } from '../types';
import type { TeamRating } from 'lib/predict/types';

// 每组 4 队 g1..g4,组内 g1 最强 g4 最弱;elo 驱动强弱
const ELO_BY_RANK = [1820, 1660, 1540, 1430];
const teamsOfGroup = (g: GroupLetter) => [1, 2, 3, 4].map((n) => `${g}${n}`);

function buildInputs() {
  const ratings: Record<string, TeamRating> = {};
  const eloMap: Record<string, number> = {};
  const teamMeta: Record<string, TeamMeta> = {};
  const matchesByGroup: Record<string, GroupMatch[]> = {};

  for (const g of GROUP_LETTERS) {
    const [t1, t2, t3, t4] = teamsOfGroup(g);
    [t1, t2, t3, t4].forEach((t, i) => {
      const elo = ELO_BY_RANK[i];
      eloMap[t] = elo;
      const strength = (elo - 1430) / 400; // 0..~1
      ratings[t] = {
        norm: t,
        name: t,
        xgFor: 1.0 + strength * 0.9,
        xgAgainst: 1.6 - strength * 0.9,
        goalsFor: 1.0 + strength * 0.9,
        goalsAgainst: 1.6 - strength * 0.9,
        elo,
        sample: 10,
        updatedAt: 0,
      };
      teamMeta[t] = {
        norm: t,
        name: t.toUpperCase(),
        group: g,
        logo: undefined,
      };
    });
    const M = (
      home: string,
      away: string,
      hg: number,
      ag: number,
      round: number,
      played: boolean,
    ): GroupMatch => ({
      group: g,
      home,
      away,
      homeGoals: played ? hg : undefined,
      awayGoals: played ? ag : undefined,
      played,
      round,
      commenceTime: `2026-06-${10 + round}T00:00:00Z`,
    });
    matchesByGroup[g] = [
      // md1
      M(t1, t2, 1, 0, 1, true),
      M(t3, t4, 1, 1, 1, true),
      // md2
      M(t1, t3, 2, 0, 2, true),
      M(t2, t4, 1, 0, 2, true),
      // md3(待采样)
      M(t1, t4, 0, 0, 3, false),
      M(t2, t3, 0, 0, 3, false),
    ];
  }
  return { ratings, eloMap, teamMeta, matchesByGroup };
}

describe('runMonteCarlo', () => {
  const { ratings, eloMap, teamMeta, matchesByGroup } = buildInputs();
  const cfg = { sims: 1500, seed: 99, targetStage: 'QF' as const };
  const out = runMonteCarlo(matchesByGroup, teamMeta, ratings, eloMap, cfg);

  it('产出 48 队前景 + 24 场第三轮对阵', () => {
    expect(out.teams).toHaveLength(48);
    expect(out.fixtures).toHaveLength(24);
    expect(out.fixtures.every((f) => f.played === false)).toBe(true);
  });

  it('逐 sim 精确不变量:出线/各轮人数总和', () => {
    const sum = (sel: (t: (typeof out.teams)[number]) => number) =>
      out.teams.reduce((s, t) => s + sel(t), 0);
    expect(sum((t) => t.overall.advance)).toBeCloseTo(32, 3); // 32 队出线
    expect(sum((t) => t.overall.r16)).toBeCloseTo(16, 3);
    expect(sum((t) => t.overall.qf)).toBeCloseTo(8, 3);
    expect(sum((t) => t.overall.sf)).toBeCloseTo(4, 3);
    expect(sum((t) => t.overall.final)).toBeCloseTo(2, 3);
    expect(sum((t) => t.overall.champion)).toBeCloseTo(1, 3); // 唯一冠军
  });

  it('每组名次分布:头名概率合计每组=1、全局=12', () => {
    const sumP1 = out.teams.reduce((s, t) => s + t.rankProbs.p1, 0);
    expect(sumP1).toBeCloseTo(12, 3);
    // 每队四个名次概率合计=1
    for (const t of out.teams) {
      const s =
        t.rankProbs.p1 + t.rankProbs.p2 + t.rankProbs.p3 + t.rankProbs.p4;
      expect(s).toBeCloseTo(1, 3);
    }
  });

  it('组内强队出线/夺冠概率高于弱队', () => {
    const by = Object.fromEntries(out.teams.map((t) => [t.norm, t]));
    expect(by['A1'].overall.advance).toBeGreaterThan(by['A4'].overall.advance);
    expect(by['A1'].overall.champion).toBeGreaterThan(
      by['A4'].overall.champion,
    );
  });

  it('未踢第三轮的队有最期望结果 + 条件分桶', () => {
    const t = out.teams.find((x) => !x.played3)!;
    expect(t.played3).toBe(false);
    expect(['W', 'D', 'L']).toContain(t.desired);
    expect(t.byResult.length).toBeGreaterThanOrEqual(1);
    // byResult 按 desirability(target)降序
    for (let i = 1; i < t.byResult.length; i++)
      expect(t.byResult[i - 1].target).toBeGreaterThanOrEqual(
        t.byResult[i].target,
      );
  });

  it('双视角默契:jointOutcome 仅在 mutualInterest 时出现', () => {
    for (const f of out.fixtures) {
      if (f.mutualInterest) expect(f.jointOutcome).toBeDefined();
      else expect(f.jointOutcome).toBeUndefined();
    }
  });

  it('detectRound3:round 标记缺失时按时间取最后两场(末轮进行中含已踢腿)', () => {
    const mk = (
      home: string,
      away: string,
      day: number,
      played: boolean,
    ): GroupMatch => ({
      group: 'A',
      home,
      away,
      played,
      homeGoals: played ? 1 : undefined,
      awayGoals: played ? 0 : undefined,
      commenceTime: `2026-06-${day}T18:00:00Z`,
      // 故意不设 round(模拟 UTC 截日导致 round 标错/缺失)
    });
    // 第三轮两场:一场已踢(A1-A4)、一场未踢(A2-A3),且为时间最晚的两场
    const list: GroupMatch[] = [
      mk('A1', 'A2', 12, true),
      mk('A3', 'A4', 12, true),
      mk('A1', 'A3', 18, true),
      mk('A2', 'A4', 18, true),
      mk('A1', 'A4', 24, true), // 第三轮已踢腿
      mk('A2', 'A3', 24, false), // 第三轮未踢腿
    ];
    const r3 = detectRound3(list);
    expect(r3).toHaveLength(2);
    const pairs = r3.map((m) => `${m.home}-${m.away}`).sort();
    expect(pairs).toEqual(['A1-A4', 'A2-A3']); // 已踢 + 未踢两腿都被圈出
  });

  it('同种子完全可复现', () => {
    const out2 = runMonteCarlo(matchesByGroup, teamMeta, ratings, eloMap, cfg);
    const pick = (o: typeof out) =>
      o.teams.map((t) => [t.norm, t.overall.champion, t.desired]);
    expect(pick(out2)).toEqual(pick(out));
  });
});
