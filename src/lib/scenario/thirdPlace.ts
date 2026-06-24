/**
 * 最佳第三名:跨组排序取最好的 8 个 + 把这 8 个第三名一一分配到 8 个头名槽位。
 *
 * ⚠️ 分配是 FIFA 官方手工固定表(Annex C,见 thirdPlaceTable.ts),**不是算法**:
 * 每种 8 组组合都有多个 eligibility 合法的完美匹配,FIFA 只钦定其中一个;贪心/字典序/匈牙利
 * 等任何算法都无法逐行复刻(经研究 workflow 三源交叉验证)。故 assignThirds 一律逐行查表;
 * eligibility(THIRD_ELIGIBILITY)仅作校验护栏,绝不用作选择规则。matchAssign 仅作表缺失时
 * 的防御兜底(表已 495 行全覆盖,正常不触发)。
 */
import { WINNER_SLOTS, THIRD_ELIGIBILITY } from './bracket';
import { ANNEX_C } from './thirdPlaceTable';
import type { GroupLetter, GroupRow, WinnerSlot } from './types';

/** 组合键:出线第三名所在组字母排序拼接(如 ['C','A','F'] → "ACF")。 */
export function comboKey(groups: GroupLetter[]): string {
  return [...groups].sort().join('');
}

/** 是否对某组合持有官方表行(495 行全覆盖,合法 8 组组合恒为 true)。 */
export function hasOfficialAssignment(groups: GroupLetter[]): boolean {
  return comboKey(groups) in ANNEX_C;
}

/**
 * 跨组排序 12 个小组第三名(最好→最差)。
 * 2026 第三名排序:积分 → 总净胜球 → 总进球 →(公平竞赛分:模拟无牌数据,略)→ FIFA 排名。
 * 末位用组字母保证确定性(实际为抽签)。
 */
export function rankThirds(
  thirds: GroupRow[],
  fifaRankOf: (norm: string) => number | undefined,
): GroupRow[] {
  const fr = (norm: string) => fifaRankOf(norm) ?? 9999; // 排名越小越强
  return [...thirds].sort(
    (a, b) =>
      b.points - a.points ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      fr(a.team) - fr(b.team) ||
      a.group.localeCompare(b.group),
  );
}

/** 取成绩最好的 8 个小组第三名,返回其所在组字母。 */
export function bestEightThirdGroups(
  thirds: GroupRow[],
  fifaRankOf: (norm: string) => number | undefined,
): GroupLetter[] {
  return rankThirds(thirds, fifaRankOf)
    .slice(0, 8)
    .map((r) => r.group);
}

/**
 * 防御兜底:确定性二分匹配(Kuhn 增广路径)。仅在官方表意外缺失某组合时使用,
 * 产出一个 eligibility 合法的完美匹配(未必等于 FIFA 钦定行)。正常路径不会走到这里。
 */
function matchAssign(
  quals: GroupLetter[],
): Partial<Record<GroupLetter, WinnerSlot>> | null {
  const slotTaker: Partial<Record<WinnerSlot, GroupLetter>> = {};
  const groupToSlot: Partial<Record<GroupLetter, WinnerSlot>> = {};

  const augment = (g: GroupLetter, seen: Set<WinnerSlot>): boolean => {
    for (const slot of WINNER_SLOTS) {
      if (!THIRD_ELIGIBILITY[slot].includes(g)) continue;
      if (seen.has(slot)) continue;
      seen.add(slot);
      const taker = slotTaker[slot];
      if (taker === undefined || augment(taker, seen)) {
        slotTaker[slot] = g;
        groupToSlot[g] = slot;
        return true;
      }
    }
    return false;
  };

  for (const g of [...quals].sort()) {
    if (!augment(g, new Set())) return null;
  }
  return groupToSlot;
}

/**
 * 给定 8 个出线第三名所在组,返回「组字母 → 迎战的头名槽位」分配(逐行查官方 Annex C 表)。
 * 入参非 8 个 / 有重复 / 含非法组字母返回 null;表意外缺失时回退匹配算法(并告警)。
 */
export function assignThirds(
  quals: GroupLetter[],
): Partial<Record<GroupLetter, WinnerSlot>> | null {
  if (quals.length !== 8 || new Set(quals).size !== 8) return null;
  const official = ANNEX_C[comboKey(quals)];
  if (official) return { ...official };
  // 不应发生(495 行全覆盖):防御兜底
  console.error('[scenario] Annex C 缺失组合,回退匹配算法:', comboKey(quals));
  return matchAssign(quals);
}
