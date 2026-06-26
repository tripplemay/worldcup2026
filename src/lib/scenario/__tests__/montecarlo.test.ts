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

  it('T3 resultImpact:每场未踢对阵带三结果连带,prob 合计≈1、覆盖同组 4 队、含本场双方', () => {
    for (const f of out.fixtures) {
      expect(f.resultImpact).toBeDefined();
      const ri = f.resultImpact!;
      expect(ri.reduce((s, r) => s + r.prob, 0)).toBeCloseTo(1, 3);
      for (const r of ri) {
        expect(['home', 'draw', 'away']).toContain(r.result);
        expect(r.teams).toHaveLength(4); // 同组 4 队
        const norms = r.teams.map((t) => t.norm);
        expect(norms).toContain(f.home);
        expect(norms).toContain(f.away);
        for (const tm of r.teams) {
          expect(tm.advance).toBeGreaterThanOrEqual(0);
          expect(tm.advance).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('T3 单调性:球队赢球时自身出线概率 ≥ 输球时', () => {
    const f = out.fixtures.find(
      (x) => x.group === 'A' && x.home === 'A1' && x.away === 'A4',
    )!;
    const home = f.resultImpact!.find((r) => r.result === 'home')!; // A1 胜
    const away = f.resultImpact!.find((r) => r.result === 'away')!; // A4 胜
    const adv = (ri: typeof home, norm: string) =>
      ri.teams.find((t) => t.norm === norm)!.advance;
    expect(adv(home, 'A1')).toBeGreaterThanOrEqual(adv(away, 'A1')); // A1 赢≥输
    expect(adv(away, 'A4')).toBeGreaterThanOrEqual(adv(home, 'A4')); // A4 赢≥输
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

  it('teamPath:强队挂逐轮对手(R16→决赛),按轮次顺序、prob∈(0,1],弱旅不挂', () => {
    const by = Object.fromEntries(out.teams.map((t) => [t.norm, t]));
    const a1 = by['A1']; // 必夺冠级强队 → 应有完整 R16/QF/SF/F 四步
    expect(a1.overall.qf).toBeGreaterThan(0.05);
    const rounds = (a1.path ?? []).map((s) => s.round);
    expect(rounds).toEqual(['R16', 'QF', 'SF', 'F']);
    const ORDER = ['R16', 'QF', 'SF', 'F'];
    for (let i = 0; i < (a1.path ?? []).length; i++) {
      const step = a1.path![i];
      expect(ORDER.indexOf(step.round)).toBe(i); // 严格按轮次顺序
      expect(step.opponentNorm).not.toBe('A1'); // 对手不是自己
      expect(step.prob).toBeGreaterThan(0);
      expect(step.prob).toBeLessThanOrEqual(1);
    }
    // 极弱旅(各轮达成率<阈值)无 path
    const weak = out.teams.find(
      (t) =>
        t.overall.r16 < 0.05 &&
        t.overall.qf < 0.05 &&
        t.overall.sf < 0.05 &&
        t.overall.final < 0.05,
    );
    if (weak) expect(weak.path).toBeUndefined();
  });

  it('teamPath:某轮达成率<阈值则不挂该轮(按 reach 门控)', () => {
    for (const t of out.teams) {
      const rounds = new Set((t.path ?? []).map((s) => s.round));
      if (rounds.has('F')) expect(t.overall.final).toBeGreaterThanOrEqual(0.05);
      if (rounds.has('SF')) expect(t.overall.sf).toBeGreaterThanOrEqual(0.05);
      if (rounds.has('QF')) expect(t.overall.qf).toBeGreaterThanOrEqual(0.05);
      if (rounds.has('R16')) expect(t.overall.r16).toBeGreaterThanOrEqual(0.05);
    }
  });
});
