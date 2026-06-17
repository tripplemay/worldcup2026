/**
 * 队名归一化 + 比赛对齐
 *
 * The Odds API 与 ESPN 各自独立、没有共享的 match id,
 * 需要按「归一化队名 + UTC 开赛日期」把赔率挂到对应比赛上。
 *
 * 归一化:去变音符 + 小写 + 去标点 + 别名映射。
 * 对阵键:两队归一化名排序 + UTC 日期(小组赛同一对阵一天唯一)。
 */

/** 已知的跨源队名差异(归一化后的 key → 统一值)。可持续扩充。 */
const ALIASES: Record<string, string> = {
  'cote divoire': 'ivory coast',
  'cote d ivoire': 'ivory coast',
  turkiye: 'turkey',
  'korea republic': 'south korea',
  'republic of korea': 'south korea',
  'ir iran': 'iran',
  'china pr': 'china',
  'united states': 'usa',
  'united states of america': 'usa',
  'bosnia and herzegovina': 'bosnia herzegovina',
  czechia: 'czech republic',
  'congo dr': 'dr congo', // ESPN "Congo DR" ↔ The Odds API "DR Congo"
};

// 进程内缓存:队名恒定(48 队 + 对手),命中率≈100%,省掉重复 NFD+正则
const _normCache = new Map<string, string>();

/** 归一化单个队名:去变音 → 小写 → 标点转空格 → 别名(带缓存)。 */
export function normalizeTeam(name: string): string {
  const hit = _normCache.get(name);
  if (hit !== undefined) return hit;
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // 去除变音符(Curaçao→Curacao, Türkiye→Turkiye)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const out = ALIASES[base] ?? base;
  _normCache.set(name, out);
  return out;
}

/** UTC 日期(YYYY-MM-DD),用于对齐同一天的对阵。 */
function utcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * 对阵键:两队归一化名(排序,忽略主客方向)+ UTC 日期。
 * 用于跨源匹配——小组赛同一对阵在同一天唯一。
 */
export function matchKey(
  teamA: string,
  teamB: string,
  commenceTimeISO: string,
): string {
  const pair = [normalizeTeam(teamA), normalizeTeam(teamB)].sort().join(' v ');
  return `${pair}__${utcDate(commenceTimeISO)}`;
}

/**
 * 在候选列表中按对阵键查找匹配项。
 * @returns 匹配到的元素,或 undefined(对齐失败时调用方应降级,不显示错值)。
 */
export function findMatch<
  T extends { homeTeam: string; awayTeam: string; commenceTime: string },
>(
  items: T[],
  home: string,
  away: string,
  commenceTimeISO: string,
): T | undefined {
  const key = matchKey(home, away, commenceTimeISO);
  return items.find(
    (it) => matchKey(it.homeTeam, it.awayTeam, it.commenceTime) === key,
  );
}
