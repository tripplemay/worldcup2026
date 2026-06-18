import { computeTmi, normalizeScores } from '../engine';
import type { HistMatch, ResultMatch, TeamRating } from 'lib/predict/types';

const result = (
  eventId: string,
  date: string,
  homeNorm: string,
  awayNorm: string,
  homeGoals: number,
  awayGoals: number,
): ResultMatch => ({ eventId, date, homeNorm, awayNorm, homeGoals, awayGoals });

const hist = (
  eventId: string,
  date: string,
  homeNorm: string,
  awayNorm: string,
  homeXg: number,
  awayXg: number,
): HistMatch => ({
  eventId,
  date,
  homeName: homeNorm,
  awayName: awayNorm,
  homeNorm,
  awayNorm,
  homeGoals: 0,
  awayGoals: 0,
  homeSoT: 0,
  homeShots: 0,
  awaySoT: 0,
  awayShots: 0,
  homeXg,
  awayXg,
});

describe('normalizeScores', () => {
  it('士气分按 50 归一并钳制到 [-1,1]', () => {
    expect(normalizeScores(25, 0, null).mentalScore).toBeCloseTo(0.5);
    expect(normalizeScores(50, 0, null).mentalScore).toBeCloseTo(1);
    expect(normalizeScores(999, 0, null).mentalScore).toBe(1); // 钳制
    expect(normalizeScores(-999, 0, null).mentalScore).toBe(-1);
  });

  it('战术分按 1.5 归一', () => {
    expect(normalizeScores(0, 0.75, null).tacticalScore).toBeCloseTo(0.5);
    expect(normalizeScores(0, 1.5, null).tacticalScore).toBeCloseTo(1);
  });

  it('体能惩罚仅在休息 ≤3 天时触发(休3扣0.2/休2扣0.4/休1扣0.6)', () => {
    expect(normalizeScores(0, 0, 3).fatiguePenalty).toBeCloseTo(-0.2);
    expect(normalizeScores(0, 0, 2).fatiguePenalty).toBeCloseTo(-0.4);
    expect(normalizeScores(0, 0, 1).fatiguePenalty).toBeCloseTo(-0.6);
    expect(normalizeScores(0, 0, 4).fatiguePenalty).toBe(0);
    expect(normalizeScores(0, 0, null).fatiguePenalty).toBe(0); // 无记录不罚
  });

  it('总分 = 0.4·士气 + 0.6·战术 + 体能,并钳制', () => {
    expect(normalizeScores(50, 1.5, null).total).toBeCloseTo(1); // 0.4+0.6
    expect(normalizeScores(25, 0.75, 3).total).toBeCloseTo(0.4 * 0.5 + 0.6 * 0.5 - 0.2);
  });
});

describe('computeTmi', () => {
  const WC = '2026-06-11';
  const now = Date.parse('2026-06-18T00:00:00Z'); // 比赛都设在 T00:00Z,天数干净
  const d = (s: string) => `${s}T00:00:00.000Z`;

  // 赛果:bbb 只在开赛前出现(非参赛队);aaa/ccc/ddd 开赛后登场
  const results: Record<string, ResultMatch> = {
    p1: result('p1', d('2026-06-01'), 'aaa', 'bbb', 1, 0), // 开赛前(给 aaa 一个基线)
    c1: result('c1', d('2026-06-12'), 'aaa', 'ccc', 2, 0),
    c2: result('c2', d('2026-06-16'), 'aaa', 'ccc', 1, 0),
    c3: result('c3', d('2026-06-14'), 'aaa', 'ddd', 0, 0),
  };
  // 杯赛射门:aaa/ccc 有 2 场(走杯赛口径);ddd 无 → 回退近期
  const historical: Record<string, HistMatch> = {
    c1: hist('c1', d('2026-06-12'), 'aaa', 'ccc', 2.0, 0.3),
    c2: hist('c2', d('2026-06-16'), 'aaa', 'ccc', 1.5, 0.5),
  };
  const ratings: Record<string, TeamRating> = {
    aaa: {
      norm: 'aaa',
      name: 'Team A',
      xgFor: 1.8,
      xgAgainst: 0.6,
      goalsFor: 2,
      goalsAgainst: 0.5,
      elo: 1800,
      sample: 10,
      updatedAt: 0,
    },
    ddd: {
      norm: 'ddd',
      name: 'Team D',
      xgFor: 1.2,
      xgAgainst: 0.7,
      goalsFor: 1,
      goalsAgainst: 1,
      elo: 1600,
      sample: 8,
      updatedAt: 0,
    },
  };

  const snap = computeTmi({ results, historical, ratings }, { wcStart: WC, now });
  const byId = Object.fromEntries(snap.teams.map((t) => [t.teamId, t]));

  it('参赛队仅含开赛后登场的球队(剔除只在赛前出现的 bbb)', () => {
    const ids = snap.teams.map((t) => t.teamId).sort();
    expect(ids).toEqual(['aaa', 'ccc', 'ddd']);
  });

  it('影子 Elo 只反映杯赛期间净变化(连胜为正、连败为负)', () => {
    expect(byId.aaa.raw.shadowEloDiff).toBeGreaterThan(0);
    expect(byId.ccc.raw.shadowEloDiff).toBeLessThan(0);
  });

  it('杯赛样本≥2 走杯赛 xG;不足回退近期 EWMA', () => {
    expect(byId.aaa.xgSource).toBe('cup');
    expect(byId.aaa.raw.xgMomentumPerMatch).toBeCloseTo(((2.0 - 0.3) + (1.5 - 0.5)) / 2);
    expect(byId.ddd.xgSource).toBe('season');
    expect(byId.ddd.raw.xgMomentumPerMatch).toBeCloseTo(1.2 - 0.7);
  });

  it('杯赛场次计数正确', () => {
    expect(byId.aaa.raw.matchesPlayed).toBe(3);
    expect(byId.ccc.raw.matchesPlayed).toBe(2);
    expect(byId.ddd.raw.matchesPlayed).toBe(1);
  });

  it('休息天数取最近一场,并据此判罚体能', () => {
    expect(byId.aaa.raw.restDays).toBe(2); // 最近 06-16 → 离 06-18 两天
    expect(byId.aaa.normalized.fatiguePenalty).toBeCloseTo(-0.4);
    expect(byId.ddd.raw.restDays).toBe(4); // 最近 06-14 → 四天,不罚
    expect(byId.ddd.normalized.fatiguePenalty).toBe(0);
  });

  it('按总分降序,展示名取 ratings(缺失回退队 id)', () => {
    for (let i = 1; i < snap.teams.length; i++) {
      expect(snap.teams[i - 1].total).toBeGreaterThanOrEqual(snap.teams[i].total);
    }
    expect(byId.aaa.teamName).toBe('Team A');
    expect(byId.ccc.teamName).toBe('ccc'); // 无 ratings → 回退归一化键
    expect(snap.teams[0].teamId).toBe('aaa'); // 强队连胜应居首
  });

  it('快照含 wcStart 与 lastUpdated', () => {
    expect(snap.wcStart).toBe(WC);
    expect(snap.lastUpdated).toBe(new Date(now).toISOString());
  });
});
