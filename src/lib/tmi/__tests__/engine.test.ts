import { computeTmi, normalizeScores, restDaysFatigue } from '../engine';
import { coreLoadPenalty } from 'lib/predict/playerMinutes';
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
    expect(normalizeScores(25, 0, 0).mentalScore).toBeCloseTo(0.5);
    expect(normalizeScores(50, 0, 0).mentalScore).toBeCloseTo(1);
    expect(normalizeScores(999, 0, 0).mentalScore).toBe(1); // 钳制
    expect(normalizeScores(-999, 0, 0).mentalScore).toBe(-1);
  });

  it('战术分按 1.5 归一', () => {
    expect(normalizeScores(0, 0.75, 0).tacticalScore).toBeCloseTo(0.5);
    expect(normalizeScores(0, 1.5, 0).tacticalScore).toBeCloseTo(1);
  });

  it('总分 = 0.4·士气 + 0.6·战术 + 体能惩罚,并钳制', () => {
    expect(normalizeScores(50, 1.5, 0).total).toBeCloseTo(1); // 0.4+0.6
    expect(normalizeScores(25, 0.75, -0.2).total).toBeCloseTo(
      0.4 * 0.5 + 0.6 * 0.5 - 0.2,
    );
    expect(normalizeScores(999, 1.5, 0).total).toBe(1); // 钳制
  });
});

describe('restDaysFatigue(回退口径)', () => {
  it('休息 ≤3 天触发(休3扣0.2/休2扣0.4/休1扣0.6),否则 0', () => {
    expect(restDaysFatigue(3)).toBeCloseTo(-0.2);
    expect(restDaysFatigue(2)).toBeCloseTo(-0.4);
    expect(restDaysFatigue(1)).toBeCloseTo(-0.6);
    expect(restDaysFatigue(4)).toBe(0);
    expect(restDaysFatigue(null)).toBe(0);
  });
});

describe('coreLoadPenalty(真实分钟体能)', () => {
  const at = Date.parse('2026-06-18T00:00:00Z');
  const dd = (s: string) => `${s}T00:00:00.000Z`;
  const fullXI = () => {
    const m: Record<string, number> = {};
    for (let i = 1; i <= 11; i++) m[String(i)] = 90;
    return m;
  };
  it('窗口内 1 个满场负荷 → 不罚', () => {
    expect(
      coreLoadPenalty([{ date: dd('2026-06-15'), mins: fullXI() }], at),
    ).toBeCloseTo(0);
  });
  it('窗口内 2 个满场 → −0.4', () => {
    const ms = [
      { date: dd('2026-06-13'), mins: fullXI() },
      { date: dd('2026-06-16'), mins: fullXI() },
    ];
    expect(coreLoadPenalty(ms, at)).toBeCloseTo(-0.4);
  });
  it('窗口外比赛(主力休整)不计入 → 不罚', () => {
    expect(
      coreLoadPenalty([{ date: dd('2026-06-01'), mins: fullXI() }], at),
    ).toBeCloseTo(0);
  });
  it('无比赛记录 → null(回退休息天数)', () => {
    expect(coreLoadPenalty([], at)).toBeNull();
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

  const snap = computeTmi(
    { results, historical, ratings },
    { wcStart: WC, now },
  );
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
    expect(byId.aaa.raw.xgMomentumPerMatch).toBeCloseTo(
      (2.0 - 0.3 + (1.5 - 0.5)) / 2,
    );
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
      expect(snap.teams[i - 1].total).toBeGreaterThanOrEqual(
        snap.teams[i].total,
      );
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
