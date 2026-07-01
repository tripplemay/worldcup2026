/**
 * Phase 10 · 多市场历史赔率模型(开盘 + 闭盘)。
 *
 * 与现有 LeagueClosing(仅闭盘 1X2)并存、不替换。落盘 league-<key>-oddsx.json,
 * 顶层 Record<matchKey, LeagueMatchOdds>;键仍用 matchKey(队名对+UTC日),但因 key
 * 排序丢主客方向,**记录体内必存 homeNorm/awayNorm** 承载亚盘等有向盘口。
 *
 * 当前为 football-data 免费层能给的子集(每市场一个开盘 + 一个闭盘快照);逐家 books[]
 * 与日内 intraday 时序留待付费源(P5)扩展,届时加字段即可,读端向后兼容。
 * 十进制赔率一律含水(>1);de-vig 交读端(trueIP3 等)。
 */

/** 1X2 十进制赔率(含水)。 */
export interface X2Odds {
  h: number;
  d: number;
  a: number;
}

/** 亚盘一条线(有向:line 为相对 home 的让球,负=home 让;.25/.75=四分盘)。 */
export interface AhOdds {
  line: number;
  home: number;
  away: number;
}

/** 大小球一条线(总进球)。 */
export interface TotalOdds {
  line: number;
  over: number;
  under: number;
}

/** 一个市场的开盘 + 闭盘两快照。 */
export interface OpenClose<T> {
  open?: T;
  close?: T;
}

/** 一场比赛的多市场历史赔率。 */
export interface LeagueMatchOdds {
  homeNorm: string; // 归一化主队(承载方向;勿从排序后的 matchKey 反推)
  awayNorm: string;
  kickoff: string; // ISO(UTC 日进 matchKey)
  source: string; // 'football-data' 等
  ingestedAt: number;
  x2?: OpenClose<X2Odds>;
  ah?: OpenClose<AhOdds>[]; // 每条盘线一项(P2a 暂不填;多市场引擎接入时填)
  totals?: OpenClose<TotalOdds>[];
}

/** 向后兼容:把新模型降解为旧 LeagueClosing({h,d,a}=闭盘 1X2);无闭盘 1X2 返回 null。 */
export function toLeagueClosing(
  m: LeagueMatchOdds,
): { h: number; d: number; a: number } | null {
  const c = m.x2?.close;
  return c ? { h: c.h, d: c.d, a: c.a } : null;
}
