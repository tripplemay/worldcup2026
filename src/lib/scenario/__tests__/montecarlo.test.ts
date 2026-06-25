import { runMonteCarlo, detectRound3 } from '../montecarlo';
import { THIRD_ELIGIBILITY } from '../bracket';
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

  // ── C 聚合:第三名出线 / 路径 / 自洽夺冠路径 ──

  it('thirdRace 覆盖 12 组,∑qualifyProb≈8(8 个出线席)', () => {
    expect(out.thirdRace).toHaveLength(12);
    const sumQ = out.thirdRace.reduce((s, r) => s + r.qualifyProb, 0);
    expect(sumQ).toBeCloseTo(8, 3);
    // 按出线概率降序
    for (let i = 1; i < out.thirdRace.length; i++)
      expect(out.thirdRace[i - 1].qualifyProb).toBeGreaterThanOrEqual(
        out.thirdRace[i].qualifyProb,
      );
  });

  it('thirdRace:每组 slotProbs 合计≈1,且槽位满足 Annex C eligibility', () => {
    for (const r of out.thirdRace) {
      if (!r.slotProbs) continue;
      const s = r.slotProbs.reduce((a, b) => a + b.prob, 0);
      expect(s).toBeCloseTo(1, 3);
      for (const sp of r.slotProbs)
        expect(THIRD_ELIGIBILITY[sp.slot]).toContain(r.group);
    }
  });

  it('teamPath:强队挂路线(R16/QF 众数对手),弱旅不挂', () => {
    const by = Object.fromEntries(out.teams.map((t) => [t.norm, t]));
    const a1 = by['A1'];
    expect(a1.overall.qf).toBeGreaterThan(0.05);
    expect(a1.path && a1.path.length).toBeGreaterThanOrEqual(1);
    for (const step of a1.path ?? []) {
      expect(['R16', 'QF']).toContain(step.round);
      expect(step.prob).toBeGreaterThan(0);
      expect(step.prob).toBeLessThanOrEqual(1);
    }
    // 极弱旅(qf<阈值)无 path
    const weak = out.teams.find((t) => t.overall.qf < 0.05);
    if (weak) expect(weak.path).toBeUndefined();
  });

  it('topPaths:≤6 条、冠军去重、∑prob==topPathsCovered≤1', () => {
    expect(out.topPaths.length).toBeLessThanOrEqual(6);
    const champs = out.topPaths.map((p) => p.champion);
    expect(new Set(champs).size).toBe(champs.length); // 去重
    const sum = out.topPaths.reduce((s, p) => s + p.prob, 0);
    expect(out.topPathsCovered).toBeCloseTo(sum, 6);
    expect(out.topPathsCovered).toBeLessThanOrEqual(1 + 1e-9);
    // championProb(夺冠概率)≥ 单条路线 prob,且与该队 overall.champion 一致
    const byNorm = Object.fromEntries(out.teams.map((t) => [t.norm, t]));
    for (const p of out.topPaths) {
      expect(p.championProb).toBeGreaterThanOrEqual(p.prob);
      expect(p.championProb).toBeCloseTo(
        byNorm[p.champion].overall.champion,
        6,
      );
    }
  });

  it('topPaths:legs 自洽——按轮次升序、A1 路线对手为其实际对手', () => {
    const RANK: Record<string, number> = {
      R32: 1,
      R16: 2,
      QF: 3,
      SF: 4,
      P3: 4,
      F: 5,
    };
    for (const p of out.topPaths) {
      for (let i = 1; i < p.legs.length; i++)
        expect(RANK[p.legs[i].round]).toBeGreaterThanOrEqual(
          RANK[p.legs[i - 1].round],
        );
      // 对手非冠军自己,matchNo 在淘汰赛区间
      for (const leg of p.legs) {
        expect(leg.opponentNorm).not.toBe(p.champion);
        expect(leg.matchNo).toBeGreaterThanOrEqual(73);
        expect(leg.matchNo).toBeLessThanOrEqual(104);
      }
    }
  });
});
