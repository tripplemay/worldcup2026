/**
 * 2026 世界杯淘汰赛 bracket 模板(承重墙)。
 *
 * 来源:FIFA 官方对阵表 / Wikipedia「2026 FIFA World Cup knockout stage」,
 * 已交叉验证(美国=D 组头 1D → 迎战 B/E/F/I/J 第三名,对应 M81)。
 * bracket 在赛前固定,不随小组赛结果重抽;小组名次只决定各槽位填入谁。
 *
 * R32(73–88):8 场「头名 vs 最佳第三名」+ 4 场「头名 vs 次名」+ 4 场「次名 vs 次名」。
 * 之后 R16(89–96)→ 1/4(97–100)→ 半决(101–102)→ 三四名(103)→ 决赛(104)。
 */
import type {
  BracketMatchTpl,
  GroupLetter,
  KnockoutRound,
  WinnerSlot,
} from './types';

/** 8 个迎战最佳第三名的头名槽位。 */
export const WINNER_SLOTS: WinnerSlot[] = [
  '1A', '1B', '1D', '1E', '1G', '1I', '1K', '1L',
];

/**
 * 每个头名槽位「可迎战的第三名来自哪些小组」(FIFA 设计为排除该头名本组,避免重赛)。
 * 给定哪 8 个组的第三名出线,即在此约束下做一一分配(见 thirdPlace.ts)。
 */
export const THIRD_ELIGIBILITY: Record<WinnerSlot, GroupLetter[]> = {
  '1A': ['C', 'E', 'F', 'H', 'I'],
  '1B': ['E', 'F', 'G', 'I', 'J'],
  '1D': ['B', 'E', 'F', 'I', 'J'],
  '1E': ['A', 'B', 'C', 'D', 'F'],
  '1G': ['A', 'E', 'H', 'I', 'J'],
  '1I': ['C', 'D', 'F', 'G', 'H'],
  '1K': ['D', 'E', 'I', 'J', 'L'],
  '1L': ['E', 'H', 'I', 'J', 'K'],
};

const W = (group: GroupLetter) => ({ kind: 'W' as const, group });
const R = (group: GroupLetter) => ({ kind: 'R' as const, group });
const T3 = (slot: WinnerSlot) => ({
  kind: 'T3' as const,
  slot,
  eligible: THIRD_ELIGIBILITY[slot],
});
const WM = (match: number) => ({ kind: 'WM' as const, match });
const LM = (match: number) => ({ kind: 'LM' as const, match });

/** 完整 bracket 模板(73–104)。 */
export const BRACKET: BracketMatchTpl[] = [
  // ── Round of 32(73–88)──
  { match: 73, round: 'R32', home: R('A'), away: R('B') },
  { match: 74, round: 'R32', home: W('E'), away: T3('1E') },
  { match: 75, round: 'R32', home: W('F'), away: R('C') },
  { match: 76, round: 'R32', home: W('C'), away: R('F') },
  { match: 77, round: 'R32', home: W('I'), away: T3('1I') },
  { match: 78, round: 'R32', home: R('E'), away: R('I') },
  { match: 79, round: 'R32', home: W('A'), away: T3('1A') },
  { match: 80, round: 'R32', home: W('L'), away: T3('1L') },
  { match: 81, round: 'R32', home: W('D'), away: T3('1D') },
  { match: 82, round: 'R32', home: W('G'), away: T3('1G') },
  { match: 83, round: 'R32', home: R('K'), away: R('L') },
  { match: 84, round: 'R32', home: W('H'), away: R('J') },
  { match: 85, round: 'R32', home: W('B'), away: T3('1B') },
  { match: 86, round: 'R32', home: W('J'), away: R('H') },
  { match: 87, round: 'R32', home: W('K'), away: T3('1K') },
  { match: 88, round: 'R32', home: R('D'), away: R('G') },
  // ── Round of 16(89–96)──
  { match: 89, round: 'R16', home: WM(74), away: WM(77) },
  { match: 90, round: 'R16', home: WM(73), away: WM(75) },
  { match: 91, round: 'R16', home: WM(76), away: WM(78) },
  { match: 92, round: 'R16', home: WM(79), away: WM(80) },
  { match: 93, round: 'R16', home: WM(83), away: WM(84) },
  { match: 94, round: 'R16', home: WM(81), away: WM(82) },
  { match: 95, round: 'R16', home: WM(86), away: WM(88) },
  { match: 96, round: 'R16', home: WM(85), away: WM(87) },
  // ── Quarter-finals(97–100)──
  { match: 97, round: 'QF', home: WM(89), away: WM(90) },
  { match: 98, round: 'QF', home: WM(93), away: WM(94) },
  { match: 99, round: 'QF', home: WM(91), away: WM(92) },
  { match: 100, round: 'QF', home: WM(95), away: WM(96) },
  // ── Semi-finals(101–102)──
  { match: 101, round: 'SF', home: WM(97), away: WM(98) },
  { match: 102, round: 'SF', home: WM(99), away: WM(100) },
  // ── 三四名 + 决赛 ──
  { match: 103, round: 'P3', home: LM(101), away: LM(102) },
  { match: 104, round: 'F', home: WM(101), away: WM(102) },
];

/** match number → 模板(预建索引)。 */
export const MATCH_BY_NUM: Record<number, BracketMatchTpl> = Object.fromEntries(
  BRACKET.map((m) => [m.match, m]),
);

export const R32_MATCHES = BRACKET.filter((m) => m.round === 'R32');

/** 该轮的「负者达到的阶段」(用于晋级深度;决赛胜者另算 CHAMPION)。 */
export const LOSER_STAGE: Record<KnockoutRound, string> = {
  R32: 'R32',
  R16: 'R16',
  QF: 'QF',
  SF: 'SF',
  P3: 'SF', // 三四名两队均已达半决赛
  F: 'FINAL',
};
