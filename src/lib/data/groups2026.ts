/**
 * 2026 世界杯小组抽签(队 → 组)静态兜底。
 *
 * 引擎运行时优先用 ESPN 实时积分榜推导队→组(getStandings 的 group 字段);
 * 本表仅作兜底/校验(积分榜未就绪或对齐失败时)。键为归一化队名。
 *
 * 来源:2025-12-05 华盛顿决赛抽签 + 2026-03-31 附加赛结果(经研究 workflow 校验,高置信)。
 * 6 个抽签时占位已定:A4=捷克(UEFA-D)、B2=波黑(UEFA-A)、D4=土耳其(UEFA-C)、
 * F3=瑞典(UEFA-B)、I3=伊拉克(洲际附加 2)、K2=刚果金(洲际附加 1)。东道主种子:墨西哥 A1、加拿大 B1、美国 D1。
 * 队名用英文常用拼写(经 normalizeTeam + ALIASES 与 ESPN/赔率源对齐)。
 */
import { normalizeTeam } from 'lib/match/normalize';
import type { GroupLetter } from 'lib/scenario/types';

/** 组字母 → 该组 4 队展示名(英文)。 */
export const GROUPS_2026: Partial<Record<GroupLetter, string[]>> = {
  A: ['Mexico', 'South Africa', 'South Korea', 'Czech Republic'],
  B: ['Canada', 'Bosnia and Herzegovina', 'Qatar', 'Switzerland'],
  C: ['Brazil', 'Morocco', 'Haiti', 'Scotland'],
  D: ['United States', 'Paraguay', 'Australia', 'Turkey'],
  E: ['Germany', 'Curacao', 'Ivory Coast', 'Ecuador'],
  F: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'],
  G: ['Belgium', 'Egypt', 'Iran', 'New Zealand'],
  H: ['Spain', 'Cape Verde', 'Saudi Arabia', 'Uruguay'],
  I: ['France', 'Senegal', 'Iraq', 'Norway'],
  J: ['Argentina', 'Algeria', 'Austria', 'Jordan'],
  K: ['Portugal', 'DR Congo', 'Uzbekistan', 'Colombia'],
  L: ['England', 'Croatia', 'Ghana', 'Panama'],
};

/** 归一化队名 → 组字母(由 GROUPS_2026 反建)。 */
const TEAM_GROUP: Record<string, GroupLetter> = (() => {
  const out: Record<string, GroupLetter> = {};
  for (const [g, teams] of Object.entries(GROUPS_2026)) {
    for (const t of teams ?? []) out[normalizeTeam(t)] = g as GroupLetter;
  }
  return out;
})();

/** 查队所属组(归一化队名);未收录返回 undefined。 */
export function groupOf(norm: string): GroupLetter | undefined {
  return TEAM_GROUP[norm];
}

/** 是否已填入官方抽签。 */
export function hasDraw(): boolean {
  return Object.keys(GROUPS_2026).length > 0;
}
