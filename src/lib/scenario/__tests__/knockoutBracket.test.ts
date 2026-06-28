/**
 * 缝合引擎测试:模板拓扑 + ESPN 真实身份/赛果 → 连通对阵树。
 * 用一个确定的第三名分配(满足 FIFA eligibility)合成完整 ESPN 对阵,验证:
 * M 映射、T3 反读、胜者传播、比分对齐(含 ESPN 主客翻转)、点球 flag、未匹配保留。
 */
import { buildKnockoutBracket } from '../knockoutBracket';
import { BRACKET } from '../bracket';
import { GROUP_LETTERS } from '../types';
import type { KnockoutRound, PosRef } from '../types';
import type { BracketMatch, GroupStanding } from 'lib/espn/types';

// 一个满足 THIRD_ELIGIBILITY 的合法「头名槽位 → 第三名所在组」分配(8 组出线)。
const SLOT_TO_GROUP: Record<string, string> = {
  '1A': 'C',
  '1B': 'G',
  '1D': 'B',
  '1E': 'D',
  '1G': 'A',
  '1I': 'F',
  '1K': 'E',
  '1L': 'H',
};

const ROUND_TIME: Record<KnockoutRound, string> = {
  R32: '2026-07-01T20:00:00Z',
  R16: '2026-07-05T20:00:00Z',
  QF: '2026-07-09T20:00:00Z',
  SF: '2026-07-13T20:00:00Z',
  P3: '2026-07-16T20:00:00Z',
  F: '2026-07-19T20:00:00Z',
};

/** 积分榜:每组 4 队 A1..A4(rank=1..4)。complete=false 模拟小组赛未踢完。 */
function standingsFor(complete = true): GroupStanding[] {
  return GROUP_LETTERS.map((g) => ({
    group: `Group ${g}`,
    rows: [1, 2, 3, 4].map((rank) => ({
      team: `${g}${rank}`,
      rank,
      played: complete ? 3 : 2,
      win: 0,
      draw: 0,
      loss: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 10 - rank,
    })),
  }));
}

/** 用合成种子把模板位置引用解析为具体队名(与 simulateKnockout 同构)。 */
function resolveSeed(
  ref: PosRef,
  winnerOf: Record<number, string>,
  loserOf: Record<number, string>,
): string {
  switch (ref.kind) {
    case 'W':
      return `${ref.group}1`;
    case 'R':
      return `${ref.group}2`;
    case 'T3':
      return `${SLOT_TO_GROUP[ref.slot]}3`;
    case 'WM':
      return winnerOf[ref.match];
    case 'LM':
      return loserOf[ref.match];
  }
}

/** 整树「主队恒胜」赛果(homeOf/awayOf/winnerOf/loserOf)。 */
function fullResult() {
  const winnerOf: Record<number, string> = {};
  const loserOf: Record<number, string> = {};
  const homeOf: Record<number, string> = {};
  const awayOf: Record<number, string> = {};
  for (const tpl of BRACKET) {
    const h = resolveSeed(tpl.home, winnerOf, loserOf);
    const a = resolveSeed(tpl.away, winnerOf, loserOf);
    homeOf[tpl.match] = h;
    awayOf[tpl.match] = a;
    winnerOf[tpl.match] = h; // 主队恒胜
    loserOf[tpl.match] = a;
  }
  return { winnerOf, loserOf, homeOf, awayOf };
}

interface EspnOpts {
  flip?: Set<number>; // 这些场次 ESPN 主客互换
  penaltyFlag?: Set<number>; // 平分但靠 winner flag 定胜负
  noDecide?: Set<number>; // 平分且无 flag → 未判
}

/** 生成指定轮次的 ESPN 真实对阵(主队恒胜)。 */
function espnMatches(
  rounds: Set<KnockoutRound>,
  opts: EspnOpts = {},
): BracketMatch[] {
  const { winnerOf, homeOf, awayOf } = fullResult();
  const out: BracketMatch[] = [];
  for (const tpl of BRACKET) {
    if (!rounds.has(tpl.round)) continue;
    let home = homeOf[tpl.match];
    let away = awayOf[tpl.match];
    if (opts.flip?.has(tpl.match)) [home, away] = [away, home];
    const winner = winnerOf[tpl.match];
    let homeScore = home === winner ? 2 : 1;
    let awayScore = away === winner ? 2 : 1;
    let homeWinner: boolean | undefined = home === winner || undefined;
    let awayWinner: boolean | undefined = away === winner || undefined;
    if (opts.penaltyFlag?.has(tpl.match)) {
      homeScore = 1;
      awayScore = 1;
    }
    if (opts.noDecide?.has(tpl.match)) {
      homeScore = 1;
      awayScore = 1;
      homeWinner = undefined;
      awayWinner = undefined;
    }
    out.push({
      id: `e${tpl.match}`,
      stage: 'knockout',
      homeTeam: home,
      awayTeam: away,
      commenceTime: ROUND_TIME[tpl.round],
      homeScore,
      awayScore,
      homeWinner,
      awayWinner,
      status: 'post',
    });
  }
  return out;
}

const ALL_ROUNDS: KnockoutRound[] = ['R32', 'R16', 'QF', 'SF', 'P3', 'F'];
const node = (b: ReturnType<typeof buildKnockoutBracket>, m: number) =>
  b.nodes.find((n) => n.match === m)!;

describe('buildKnockoutBracket', () => {
  it('空态:32 个节点全占位,无冠军', () => {
    const b = buildKnockoutBracket({ standings: [], matches: [], now: 1 });
    expect(b.nodes).toHaveLength(32);
    expect(b.champion).toBeUndefined();
    expect(b.unmapped).toHaveLength(0);
    // M73 = R(A) vs R(B):积分榜空 → 占位
    expect(node(b, 73).home.placeholder).toEqual({ kind: 'R', group: 'A' });
    expect(node(b, 73).away.placeholder).toEqual({ kind: 'R', group: 'B' });
    // M81 = W(D) vs T3(1D)
    expect(node(b, 81).home.placeholder).toEqual({ kind: 'W', group: 'D' });
    expect(node(b, 81).away.placeholder).toEqual({ kind: 'T3', slot: '1D' });
    // M89 = WM74 vs WM77
    expect(node(b, 89).home.placeholder).toEqual({ kind: 'WM', match: 74 });
    expect(node(b, 89).away.placeholder).toEqual({ kind: 'WM', match: 77 });
  });

  it('组完成但暂无淘汰赛对阵:头名/次名已定,T3 仍占位', () => {
    const b = buildKnockoutBracket({
      standings: standingsFor(true),
      matches: [],
      now: 1,
    });
    // M73 = R(A) vs R(B) → a2 / b2
    expect(node(b, 73).home.norm).toBe('a2');
    expect(node(b, 73).away.norm).toBe('b2');
    expect(node(b, 73).status).toBe('pre');
    expect(node(b, 73).decided).toBe(false);
    // M81 = W(D) vs T3(1D):头名已定,第三名未定(无 ESPN 反读)
    expect(node(b, 81).home.norm).toBe('d1');
    expect(node(b, 81).away.placeholder).toEqual({ kind: 'T3', slot: '1D' });
  });

  it('未完成的组不采信头名/次名(仍占位)', () => {
    const b = buildKnockoutBracket({
      standings: standingsFor(false),
      matches: [],
      now: 1,
    });
    expect(node(b, 73).home.placeholder).toEqual({ kind: 'R', group: 'A' });
    expect(node(b, 73).home.norm).toBeUndefined();
  });

  it('R32 全部踢完:映射 + T3 反读 + 比分/胜者,R16 经 WM 显队但未踢', () => {
    const b = buildKnockoutBracket({
      standings: standingsFor(true),
      matches: espnMatches(new Set(['R32'])),
      now: 1,
    });
    const m81 = node(b, 81);
    expect(m81.status).toBe('post');
    expect(m81.decided).toBe(true);
    expect(m81.home.norm).toBe('d1'); // W(D)
    expect(m81.away.norm).toBe('b3'); // T3(1D) 从 ESPN 反读 = B 组第三
    expect(m81.home.score).toBe(2);
    expect(m81.away.score).toBe(1);
    expect(m81.home.winner).toBe(true);
    expect(m81.away.winner).toBeFalsy();
    expect(m81.espnId).toBe('e81');
    // R16 M89 = WM74 vs WM77:主队恒胜 → e1(W E)/ i1(W I),队已显但未踢
    const m89 = node(b, 89);
    expect(m89.home.norm).toBe('e1');
    expect(m89.away.norm).toBe('i1');
    expect(m89.status).toBe('pre');
    expect(m89.decided).toBe(false);
    expect(b.unmapped).toHaveLength(0);
    expect(b.champion).toBeUndefined();
  });

  it('ESPN 主客翻转:比分仍按模板主客身份对齐', () => {
    const b = buildKnockoutBracket({
      standings: standingsFor(true),
      matches: espnMatches(new Set(['R32']), { flip: new Set([73]) }),
      now: 1,
    });
    const m73 = node(b, 73); // 模板 home=a2(恒胜)
    expect(m73.home.norm).toBe('a2');
    expect(m73.home.score).toBe(2);
    expect(m73.home.winner).toBe(true);
    expect(m73.away.norm).toBe('b2');
    expect(m73.away.score).toBe(1);
  });

  it('点球:平分但有 winner flag 仍判晋级并传播', () => {
    const b = buildKnockoutBracket({
      standings: standingsFor(true),
      matches: espnMatches(new Set(['R32']), { penaltyFlag: new Set([73]) }),
      now: 1,
    });
    const m73 = node(b, 73);
    expect(m73.home.score).toBe(1);
    expect(m73.away.score).toBe(1);
    expect(m73.decided).toBe(true);
    expect(m73.home.winner).toBe(true);
  });

  it('平分且无 flag:不臆断晋级方(保持未判)', () => {
    const b = buildKnockoutBracket({
      standings: standingsFor(true),
      matches: espnMatches(new Set(['R32']), { noDecide: new Set([73]) }),
      now: 1,
    });
    const m73 = node(b, 73);
    expect(m73.status).toBe('post');
    expect(m73.decided).toBe(false);
    expect(m73.home.winner).toBeFalsy();
    expect(m73.away.winner).toBeFalsy();
  });

  it('整届踢完:决出冠军,全部已判', () => {
    const { winnerOf } = fullResult();
    const b = buildKnockoutBracket({
      standings: standingsFor(true),
      matches: espnMatches(new Set(ALL_ROUNDS)),
      now: 1,
    });
    expect(b.champion).toBeDefined();
    expect(b.champion!.norm).toBe(winnerOf[104].toLowerCase());
    expect(b.champion!.name).toBe(winnerOf[104]);
    expect(node(b, 104).decided).toBe(true);
    expect(node(b, 104).status).toBe('post');
    expect(b.unmapped).toHaveLength(0);
  });

  it('未匹配的 ESPN 场次保留在 unmapped,不静默丢弃', () => {
    const extra: BracketMatch = {
      id: 'x-mystery',
      stage: 'knockout',
      homeTeam: 'Zland',
      awayTeam: 'Qland',
      commenceTime: '2026-07-01T20:00:00Z',
      homeScore: 1,
      awayScore: 0,
      homeWinner: true,
      status: 'post',
    };
    const b = buildKnockoutBracket({
      standings: standingsFor(true),
      matches: [...espnMatches(new Set(['R32'])), extra],
      now: 1,
    });
    expect(b.unmapped.map((u) => u.id)).toContain('x-mystery');
  });
});
