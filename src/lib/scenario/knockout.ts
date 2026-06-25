/**
 * 淘汰赛解析 + 整树传播。
 *
 * 由 12 组名次 + 最佳 8 第三名分配,把 R32(73–88)各槽位填入具体球队,再沿固定 bracket
 * 树(89–104)逐场判出胜者直到夺冠;记录每队走到的最远阶段(stageReached)。
 *
 * 单场胜负由注入的 play(home,away,rng)→胜者 决定(调用方负责采样比分 + 平局点球),
 * 本模块只管结构与传播,便于独立测试。
 */
import { BRACKET, LOSER_STAGE } from './bracket';
import { bestEightThirdGroups, assignThirds } from './thirdPlace';
import type { Rng } from './rng';
import type {
  GroupLetter,
  GroupPositionsLike,
  KnockoutRound,
  PosRef,
  Stage,
  WinnerSlot,
} from './types';

/** 已解析队伍的 bracket 种子(R32 各槽位 → 具体球队归一化名)。 */
export interface BracketSeed {
  W: Record<string, string>; // 组字母 → 头名队
  R: Record<string, string>; // 组字母 → 次名队
  T3bySlot: Partial<Record<WinnerSlot, string>>; // 头名槽位 → 迎战的第三名队
  qualifiedThirds: GroupLetter[]; // 出线的 8 个第三名所在组
  groupToSlot: Partial<Record<GroupLetter, WinnerSlot>>; // 出线第三名所在组 → 迎战的头名槽位(=T3bySlot 的逆,直接透出免反查)
}

/** 单场判胜(返回胜者归一化名);平局点球由实现内部处理。 */
export type PlayMatch = (home: string, away: string, rng: Rng) => string;

export interface KnockoutResult {
  champion: string;
  stage: Record<string, Stage>; // 队 → 最远阶段(仅淘汰赛参与者)
  winnerOf: Record<number, string>;
  loserOf: Record<number, string>;
  homeOf: Record<number, string>; // 场次号 → 主位实际球队(供整树/路径聚合)
  awayOf: Record<number, string>; // 场次号 → 客位实际球队
  r32Opponent: Record<string, string>; // 队 → 其 R32 对手
}

/** 各轮「踢到即达到」的阶段(决赛胜者另升 CHAMPION)。 */
const PLAYED_STAGE: Record<KnockoutRound, Stage> = {
  R32: 'R32',
  R16: 'R16',
  QF: 'QF',
  SF: 'SF',
  P3: 'SF',
  F: 'FINAL',
};

const STAGE_RANK: Record<Stage, number> = {
  OUT: 0,
  R32: 1,
  R16: 2,
  QF: 3,
  SF: 4,
  FINAL: 5,
  CHAMPION: 6,
};

/**
 * 由小组名次构建 bracket 种子(选最佳 8 第三名 + 分配到头名槽位)。
 * 第三名不足 8 或无完美匹配返回 null。
 */
export function buildBracketSeed(
  pos: GroupPositionsLike,
  fifaRankOf: (team: string) => number | undefined,
): BracketSeed | null {
  const quals = bestEightThirdGroups(pos.thirds, fifaRankOf);
  if (quals.length !== 8) return null;
  const assign = assignThirds(quals);
  if (!assign) return null;

  const thirdByGroup: Record<string, string> = {};
  for (const r of pos.thirds) thirdByGroup[r.group] = r.team;

  const T3bySlot: Partial<Record<WinnerSlot, string>> = {};
  for (const [g, slot] of Object.entries(assign)) {
    if (!slot) continue;
    T3bySlot[slot] = thirdByGroup[g];
  }
  const W: Record<string, string> = {};
  const R: Record<string, string> = {};
  for (const [g, row] of Object.entries(pos.winners)) W[g] = row.team;
  for (const [g, row] of Object.entries(pos.runners)) R[g] = row.team;

  return {
    W,
    R,
    T3bySlot,
    qualifiedThirds: quals,
    groupToSlot: assign as Partial<Record<GroupLetter, WinnerSlot>>,
  };
}

/** 解析一个位置引用为具体球队(尚不可解析返回 undefined)。 */
function resolveRef(
  ref: PosRef,
  seed: BracketSeed,
  winnerOf: Record<number, string>,
  loserOf: Record<number, string>,
): string | undefined {
  switch (ref.kind) {
    case 'W':
      return seed.W[ref.group];
    case 'R':
      return seed.R[ref.group];
    case 'T3':
      return seed.T3bySlot[ref.slot];
    case 'WM':
      return winnerOf[ref.match];
    case 'LM':
      return loserOf[ref.match];
  }
}

/** 模拟整个淘汰赛,返回冠军 + 各队最远阶段。 */
export function simulateKnockout(
  seed: BracketSeed,
  play: PlayMatch,
  rng: Rng,
): KnockoutResult {
  const winnerOf: Record<number, string> = {};
  const loserOf: Record<number, string> = {};
  const homeOf: Record<number, string> = {};
  const awayOf: Record<number, string> = {};
  const stage: Record<string, Stage> = {};
  const r32Opponent: Record<string, string> = {};

  const bump = (team: string, s: Stage) => {
    if (!stage[team] || STAGE_RANK[s] > STAGE_RANK[stage[team]])
      stage[team] = s;
  };

  let champion = '';
  for (const m of BRACKET) {
    const home = resolveRef(m.home, seed, winnerOf, loserOf);
    const away = resolveRef(m.away, seed, winnerOf, loserOf);
    if (!home || !away) {
      // 理论上不应发生(种子完整 + 顺序处理);防御性跳过
      continue;
    }
    homeOf[m.match] = home;
    awayOf[m.match] = away;
    if (m.round === 'R32') {
      r32Opponent[home] = away;
      r32Opponent[away] = home;
    }
    const played = PLAYED_STAGE[m.round];
    bump(home, played);
    bump(away, played);

    const winner = play(home, away, rng);
    const loser = winner === home ? away : home;
    winnerOf[m.match] = winner;
    loserOf[m.match] = loser;

    if (m.round === 'F') {
      champion = winner;
      bump(winner, 'CHAMPION');
    }
  }

  return { champion, stage, winnerOf, loserOf, homeOf, awayOf, r32Opponent };
}
