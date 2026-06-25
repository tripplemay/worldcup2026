/**
 * 微信归属交互(无内联按钮 → 文字「回复序号/姓名」)。纯函数,便于单测。
 */
import type { Bettor } from 'lib/bets/types';

type NamedBettor = Pick<Bettor, 'id' | 'name'>;

/** 归属提示文案:编号列表 + 回复说明。 */
export function assignPrompt(bettors: NamedBettor[]): string {
  const lines = bettors.map((b, i) => `${i + 1}) ${b.name}`);
  return ['这是谁的单?回复序号(或直接回复姓名)指定归属:', ...lines].join('\n');
}

/**
 * 解析管理员回复的归属选择(序号优先,其次姓名精确匹配,大小写不敏感)。
 * bettors 顺序须与 assignPrompt 一致(序号 1 = bettors[0])。无法解析返回 null。
 */
export function resolveAssignChoice(
  text: string,
  bettors: NamedBettor[],
): string | null {
  const t = text.trim();
  if (!t) return null;
  // 序号
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n >= 1 && n <= bettors.length) return bettors[n - 1].id;
    return null;
  }
  // 姓名(精确,大小写不敏感)
  const exact = bettors.find((b) => b.name.trim() === t);
  if (exact) return exact.id;
  const low = t.toLowerCase();
  const ci = bettors.find((b) => b.name.trim().toLowerCase() === low);
  return ci ? ci.id : null;
}
