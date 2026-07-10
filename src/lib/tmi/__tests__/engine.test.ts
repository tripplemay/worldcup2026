import { computeTmi, normalizeScores, restDaysFatigue } from '../engine';
import { coreLoadPenalty, coreLoad, ageFactor } from 'lib/predict/playerMinutes';
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

// ── TMI v2(2026-07 用户反馈):对手强度校正 / 旅途 / 年龄 ──────────────

describe('战术因子对手强度校正(v2)', () => {
  const WC = '2026-06-11';
  const at = Date.parse('2026-06-20T00:00:00Z');
  // 赛前实力分层:strong 连胜 weak1/weak2 建立基线 Elo 差
  const preResults: ResultMatch[] = [];
  let id = 0;
  for (let i = 0; i < 10; i++) {
    preResults.push(result(`p${id++}`, `2026-0${1 + (i % 5)}-0${1 + (i % 9)}T12:00:00Z`, 'strong', 'weak1', 3, 0));
    preResults.push(result(`p${id++}`, `2026-0${1 + (i % 5)}-1${(i % 9)}T12:00:00Z`, 'strong', 'weak2', 2, 0));
    preResults.push(result(`p${id++}`, `2026-0${1 + (i % 5)}-2${(i % 8)}T12:00:00Z`, 'weak1', 'weak2', 1, 1));
  }
  // 杯赛:a 打 strong 两场、b 打 weak1/weak2 两场,xG 净胜完全相同
  const cupResults = [
    result('c1', '2026-06-13T12:00:00Z', 'a', 'strong', 1, 1),
    result('c2', '2026-06-16T12:00:00Z', 'a', 'strong', 1, 1),
    result('c3', '2026-06-13T12:00:00Z', 'b', 'weak1', 1, 1),
    result('c4', '2026-06-16T12:00:00Z', 'b', 'weak2', 1, 1),
  ];
  const cupHist = [
    hist('c1', '2026-06-13T12:00:00Z', 'a', 'strong', 1.5, 1.0),
    hist('c2', '2026-06-16T12:00:00Z', 'a', 'strong', 1.5, 1.0),
    hist('c3', '2026-06-13T12:00:00Z', 'b', 'weak1', 1.5, 1.0),
    hist('c4', '2026-06-16T12:00:00Z', 'b', 'weak2', 1.5, 1.0),
  ];
  const input = {
    results: Object.fromEntries(
      [...preResults, ...cupResults].map((r) => [r.eventId, r]),
    ),
    historical: Object.fromEntries(cupHist.map((h) => [h.eventId, h])),
    ratings: {} as Record<string, TeamRating>,
  };

  it('同样的 xG 净胜,打强队的校正后战术分更高;裸数据透出 avgOppElo 与校正量', () => {
    const snap = computeTmi(input, { wcStart: WC, now: at });
    const a = snap.teams.find((t) => t.teamId === 'a')!;
    const b = snap.teams.find((t) => t.teamId === 'b')!;
    // 未校正裸值相同
    expect(a.raw.xgMomentumPerMatch).toBeCloseTo(b.raw.xgMomentumPerMatch, 6);
    // a 的对手(strong)基线 Elo 高于 b 的对手(weak)→ 正向校正差
    expect(a.raw.avgOppElo!).toBeGreaterThan(b.raw.avgOppElo!);
    expect(a.raw.oppAdjPerMatch!).toBeGreaterThan(b.raw.oppAdjPerMatch!);
    expect(a.normalized.tacticalScore).toBeGreaterThan(
      b.normalized.tacticalScore,
    );
  });

  it('赛季回退口径(样本<2)不做对手校正,不透出 avgOppElo', () => {
    const one = {
      ...input,
      historical: { c1: cupHist[0] }, // a 只有 1 场 xG
      ratings: {
        a: {
          norm: 'a', name: 'A', xgFor: 1.2, xgAgainst: 1.0,
          goalsFor: 1, goalsAgainst: 1, elo: 1500, sample: 5, updatedAt: 0,
        },
      } as Record<string, TeamRating>,
    };
    const snap = computeTmi(one, { wcStart: WC, now: at });
    const a = snap.teams.find((t) => t.teamId === 'a')!;
    expect(a.xgSource).toBe('season');
    expect(a.raw.avgOppElo).toBeUndefined();
    expect(a.raw.oppAdjPerMatch).toBeUndefined();
  });
});

describe('旅途惩罚(v2:场馆距离 + 跨时区)', () => {
  const WC = '2026-06-11';
  const at = Date.parse('2026-06-19T00:00:00Z');
  const mk = (city1: string, city2: string) => ({
    results: {
      r1: {
        ...result('r1', '2026-06-13T12:00:00Z', 'x', 'y', 1, 0),
        venueCity: city1,
      },
      r2: {
        ...result('r2', '2026-06-17T12:00:00Z', 'x', 'z', 1, 0),
        venueCity: city2,
      },
    },
    historical: {},
    ratings: {} as Record<string, TeamRating>,
  });

  it('温哥华→迈阿密(跨洲+3 时区)→ 旅途惩罚封顶 0.2,且透出 travelKm/travelTz', () => {
    const snap = computeTmi(mk('Vancouver', 'Miami'), { wcStart: WC, now: at });
    const x = snap.teams.find((t) => t.teamId === 'x')!;
    expect(x.raw.travelKm!).toBeGreaterThan(4000);
    expect(x.raw.travelTz).toBe(3);
    // 休息 2 天(回退口径 −0.4)+ 旅途封顶 −0.2 = −0.6(合并封顶内)
    expect(x.normalized.fatiguePenalty).toBeCloseTo(-0.6);
  });

  it('同城连战 → 无旅途惩罚;未知城市 → 诚实降级不计', () => {
    const same = computeTmi(mk('Houston', 'Houston'), { wcStart: WC, now: at });
    expect(same.teams.find((t) => t.teamId === 'x')!.raw.travelKm)
      .toBeUndefined();
    const unknown = computeTmi(mk('Atlantis', 'Miami'), { wcStart: WC, now: at });
    expect(unknown.teams.find((t) => t.teamId === 'x')!.raw.travelKm)
      .toBeUndefined();
  });
});

describe('年龄加权负荷(v2)', () => {
  const at = Date.parse('2026-06-18T00:00:00Z');
  const dd = (s: string) => `${s}T00:00:00.000Z`;
  const fullXI = () => {
    const m: Record<string, number> = {};
    for (let i = 1; i <= 11; i++) m[String(i)] = 90;
    return m;
  };
  // 近 8 天两个满场 = 超出 1 个满场 → 基础惩罚 −0.4(未加权时)
  const twoFull = [
    { date: dd('2026-06-13'), mins: fullXI() },
    { date: dd('2026-06-16'), mins: fullXI() },
  ];

  it('ageFactor:≤29 不加权;每高 1 岁 +5%,35+ 封顶 1.3;U21 ×0.95;缺龄 = 1', () => {
    expect(ageFactor(25)).toBe(1);
    expect(ageFactor(29)).toBe(1);
    expect(ageFactor(31)).toBeCloseTo(1.1);
    expect(ageFactor(36)).toBeCloseTo(1.3);
    expect(ageFactor(20)).toBeCloseTo(0.95);
    expect(ageFactor(undefined)).toBe(1);
  });

  it('同样分钟,老龄核心(33 岁)比年轻核心(24 岁)惩罚更重;coreAvgAge 透出', () => {
    const old: Record<string, number> = {};
    const young: Record<string, number> = {};
    for (let i = 1; i <= 11; i++) {
      old[String(i)] = 33;
      young[String(i)] = 24;
    }
    const o = coreLoad(twoFull, at, old);
    const y = coreLoad(twoFull, at, young);
    expect(o.coreAvgAge).toBe(33);
    expect(y.coreAvgAge).toBe(24);
    expect(o.penalty!).toBeLessThan(y.penalty!); // 更负 = 惩罚更重
    // 33 岁 → ×1.2:2 满场×1.2=2.4 → 超 1.4 满场 → −0.56;年轻 → −0.4
    expect(o.penalty!).toBeCloseTo(-0.56, 5);
    expect(y.penalty!).toBeCloseTo(-0.4, 5);
  });

  it('无年龄表 → 与旧口径完全一致(行为中性回退)', () => {
    expect(coreLoad(twoFull, at).penalty).toBeCloseTo(
      coreLoadPenalty(twoFull, at)!,
      10,
    );
    expect(coreLoad(twoFull, at).coreAvgAge).toBeNull();
  });
});
