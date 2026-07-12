/** 90' 快照 resolver 单测(依赖全注入):write-once / 守卫拒绝 / post 兜底 / 半场账齐。 */
import { resolveRegulationScore } from '../regulationSnapshot';
import type { RegulationScoreStore } from 'lib/db/store';
import type { MatchSummary, MatchEvent } from 'lib/espn/types';

const g = (minute: string, team: string, period?: number): MatchEvent => ({
  minute,
  team,
  period,
  type: 'Goal',
  scoringPlay: true,
});

/** 最小 summary 桩。 */
const summary = (over: Partial<MatchSummary>): MatchSummary =>
  ({
    id: 'e1',
    commenceTime: '2026-07-11T20:00:00Z',
    homeTeam: 'H',
    awayTeam: 'A',
    homeScore: 2,
    awayScore: 1,
    status: 'in',
    events: [],
    homeRoster: [],
    awayRoster: [],
    homeForm: [],
    awayForm: [],
    h2h: [],
    ...over,
  } as MatchSummary);

const mkDeps = (store: RegulationScoreStore = {}) => {
  const saved: RegulationScoreStore[] = [];
  return {
    store,
    saved,
    deps: {
      load: () => store,
      // 模型化真实 saveRegulationScores 的「整表替换」语义(含删键),而非 merge:
      // 先清空再写入,保持 store 引用稳定供断言,同时与生产 write 行为一致
      save: (s: RegulationScoreStore) => {
        saved.push(s);
        for (const k of Object.keys(store)) delete store[k];
        Object.assign(store, s);
      },
      fetchSummary: async () => null, // 桩:单测绝不触网(preFetched 缺省时走这里)
      now: () => 1_000,
    },
  };
};

describe('resolveRegulationScore', () => {
  it("加时进行中 + 事件账齐 → 即时捕获 90' 比分并 write-once 落盘(source=live)", async () => {
    const { store, saved, deps } = mkDeps();
    const s = summary({
      status: 'in',
      period: 3,
      events: [g("40'", 'H', 2), g("80'", 'A', 2), g("100'", 'H', 3)],
    });
    const r = await resolveRegulationScore('e1', s, deps);
    expect(r).toMatchObject({ status: 'matched', homeGoals: 1, awayGoals: 1 });
    expect(saved).toHaveLength(1);
    expect(store.e1).toMatchObject({
      homeGoals: 1,
      awayGoals: 1,
      source: 'live',
      complete: true,
    });
    // 二次调用:直接命中快照,不再需要 summary(传 null 也 matched)
    const r2 = await resolveRegulationScore('e1', null, deps);
    expect(r2.status).toBe('matched');
    expect(saved).toHaveLength(1); // 未再写
  });

  it('加时进行中但事件账不齐 → pending,不落值(宁等终场,绝不错结)', async () => {
    const { store, deps } = mkDeps();
    const s = summary({
      status: 'in',
      period: 3,
      events: [g("40'", 'H', 2), g("100'", 'H', 3)], // 漏了 1 粒 → 账不齐
    });
    const r = await resolveRegulationScore('e1', s, deps);
    expect(r.status).toBe('pending');
    expect(store.e1).toBeUndefined();
  });

  it("常规时间进行中(period=2)→ pending(未过 90' 不捕获)", async () => {
    const { deps } = mkDeps();
    const s = summary({ status: 'in', period: 2, events: [g("40'", 'H', 2)] });
    expect((await resolveRegulationScore('e1', s, deps)).status).toBe(
      'pending',
    );
  });

  it('终场(post)无加时但事件滞后 → 仍按终分结算(终分权威,不依赖事件完整性)', async () => {
    // 终分 2-1,事件只见 1-1(post 后事件应齐,但即便不齐,post 无加时时终分即 90')
    const { store, deps } = mkDeps();
    const s = summary({
      status: 'post',
      events: [g("40'", 'H', 2), g("80'", 'A', 2)],
    });
    const r = await resolveRegulationScore('e1', s, deps);
    expect(r).toMatchObject({ status: 'matched', homeGoals: 2, awayGoals: 1 });
    expect(store.e1.source).toBe('post');
  });

  it('终场(post)加时重建账不齐 → 推迟结算(pending),不冻结疑值(105 修复)', async () => {
    // 终分 2-1 含 105' 加时球,但事件漏了主队一粒常规球 → 重建 0-1 不可信
    const { store, deps } = mkDeps();
    const s = summary({
      status: 'post',
      events: [g("80'", 'A', 2), g("105'", 'H', 3)],
    });
    const r = await resolveRegulationScore('e1', s, deps);
    expect(r.status).toBe('pending');
    expect(store.e1).toBeUndefined();
  });

  it('加时首球期间 header 领先于事件(killer bug):终分含加时球、事件未含 → pending', async () => {
    // 90' 战平 1-1 进加时,91' 主队进球 header 已 2-1 但 keyEvents 未收录
    const { store, deps } = mkDeps();
    const s = summary({
      status: 'in',
      period: 3,
      clock: "91'",
      homeScore: 2,
      awayScore: 1,
      events: [g("40'", 'H', 2), g("80'", 'A', 2)], // 无加时球,账不齐(2≠2+? → allH=1≠2)
    });
    const r = await resolveRegulationScore('e1', s, deps);
    expect(r.status).toBe('pending'); // 不把含加时球的 2-1 冻成 90' 比分
    expect(store.e1).toBeUndefined();
  });

  it('过 90 分钟(无加时球)+ 时钟≥90 佐证 + 账齐 → 冻结 90 分钟比分', async () => {
    // 90'=2-1,加时刚开哨,尚无加时球;时钟 90' 佐证过-90
    const { store, deps } = mkDeps();
    const s = summary({
      status: 'in',
      period: 3,
      clock: "90'",
      homeScore: 2,
      awayScore: 1,
      events: [g("30'", 'H', 2), g("55'", 'H', 2), g("80'", 'A', 2)],
    });
    const r = await resolveRegulationScore('e1', s, deps);
    expect(r).toMatchObject({ status: 'matched', homeGoals: 2, awayGoals: 1 });
    expect(store.e1.source).toBe('live');
  });

  it('period 抖动误报为加时(clock 仍 <90、无加时事件、状态名非加时)→ 不冻结', async () => {
    // 70' 比分 1-0,period 被误报为 3,但时钟 70' 揭穿:不佐证 → pending
    const { store, deps } = mkDeps();
    const s = summary({
      status: 'in',
      period: 3,
      clock: "70'",
      statusName: 'STATUS_SECOND_HALF',
      homeScore: 1,
      awayScore: 0,
      events: [g("40'", 'H', 2)],
    });
    const r = await resolveRegulationScore('e1', s, deps);
    expect(r.status).toBe('pending');
    expect(store.e1).toBeUndefined();
  });

  it('半场比分:事件账齐才随快照给出(账齐例)', async () => {
    const { store, deps } = mkDeps();
    const s = summary({
      status: 'post',
      homeScore: 2,
      awayScore: 1,
      events: [g("20'", 'H', 1), g("40'", 'A', 1), g("70'", 'H', 2)],
    });
    const r = await resolveRegulationScore('e1', s, deps);
    expect(r).toMatchObject({ htHome: 1, htAway: 1 });
    expect(store.e1).toMatchObject({ htHome: 1, htAway: 1 });
  });

  it('write-once:已有快照时新值不覆盖(返回旧值)', async () => {
    const { deps } = mkDeps({
      e1: {
        capturedAt: 1,
        homeGoals: 0,
        awayGoals: 0,
        homeTeamNorm: 'h',
        awayTeamNorm: 'a',
        source: 'live',
        complete: true,
      },
    });
    const s = summary({ status: 'post', events: [] });
    const r = await resolveRegulationScore('e1', s, deps);
    expect(r).toMatchObject({ homeGoals: 0, awayGoals: 0 });
  });

  it('summary 缺失/比分缺失 → pending', async () => {
    const { deps } = mkDeps();
    expect((await resolveRegulationScore('e1', null, deps)).status).toBe(
      'pending',
    );
    const s = summary({ status: 'in', period: 3, homeScore: undefined });
    expect((await resolveRegulationScore('e1', s, deps)).status).toBe(
      'pending',
    );
  });
});
