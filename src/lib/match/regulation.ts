/**
 * 90 分钟(常规时间)口径的纯函数集 —— trade 结算 / bets 结算 / 90' 快照共享。
 * (原先 trade/settle.ts 与 bets/match.ts 各有一份近似实现,收敛到此单点维护。)
 *
 * 分类主信号 = 事件 period(ESPN keyEvents 自带:1/2=常规【含补时】,3/4=加时,5=点球),
 * 缺 period 时回退分钟解析("90'+4'"→90 计常规,"105'"→加时,NaN→点球/未知)。
 * period 主信号消除两类分钟解析风险:①理论上的裸 "93'" 补时记法误判加时;
 * ②点球大战依赖"分钟为 NaN"这种间接特征。
 */
import { normalizeTeam } from 'lib/match/normalize';
import type { MatchEvent, MatchStatus } from 'lib/espn/types';

/** 事件分钟(取前导整数;"90'+4'"→90,"105'"→105,缺失→NaN)。 */
export function minuteOf(e: MatchEvent): number {
  const n = parseInt(String(e.minute ?? '').trim(), 10);
  return Number.isFinite(n) ? n : NaN;
}

export const isGoal = (e: MatchEvent): boolean =>
  e.scoringPlay === true || /goal/i.test(e.type);

const hasPeriod = (e: MatchEvent): boolean =>
  e.period != null && Number.isFinite(e.period) && e.period > 0;

/** 事件属于常规时间(含补时)?period 主信号(≤2),缺 period 回退分钟 ≤90。 */
export function inRegulation(e: MatchEvent): boolean {
  if (hasPeriod(e)) return (e.period as number) <= 2;
  return minuteOf(e) <= 90; // NaN → false(点球/未知不计入常规)
}

/** 事件属于加时/点球?period 主信号(≥3),缺 period 回退分钟 >90。 */
export function beyondRegulation(e: MatchEvent): boolean {
  if (hasPeriod(e)) return (e.period as number) >= 3;
  return minuteOf(e) > 90;
}

/** 事件属于点球大战?period 主信号(≥5),缺 period 回退「无分钟」。 */
export function isShootout(e: MatchEvent): boolean {
  if (hasPeriod(e)) return (e.period as number) >= 5;
  return !Number.isFinite(minuteOf(e));
}

export interface RegulationResult {
  home: number; // 90' 比分:无加时进球取终分,有加时进球取常规时间重建
  away: number;
  /** 事件显示存在加时/点球进球(触发常规时间重建)。 */
  hasExtraTime: boolean;
  /**
   * 事件完整性:非点球进球「逐队合计 === 终分」。**恒计算**(不再因无加时短路)。
   * 这是「事件是否追上比分」的判据 —— 进行中比赛 ESPN header 比分常先于 keyEvents 更新,
   * 加时首球期间会出现「终分含加时球、事件未含」→ 此值为 false,守住即时捕获不冻错值。
   * 直接取终分的口径(post 无加时)可信度独立于此值(终分权威),由调用方按 isPost 处置。
   */
  eventsAccountForFinal: boolean;
}

/**
 * 90 分钟比分 + 完整性判据:
 * 无加时进球 → 取终分(post 时即 90' 比分,可信度不依赖事件);
 * 有加时进球 → 只数常规时间(含补时)进球重建;
 * eventsAccountForFinal 恒计算(非点球进球逐队合计是否恰好凑出终分)。
 */
export function regulationScoreChecked(
  events: MatchEvent[],
  homeTeam: string,
  awayTeam: string,
  finalHome: number,
  finalAway: number,
): RegulationResult {
  const goals = events.filter(isGoal);
  const hasExtraTime = goals.some(beyondRegulation);
  const hN = normalizeTeam(homeTeam);
  const aN = normalizeTeam(awayTeam);
  let regH = 0; // 常规时间(含补时)进球
  let regA = 0;
  let allH = 0; // 非点球进球全量(完整性校验:应恰好凑出终分)
  let allA = 0;
  for (const g of goals) {
    if (isShootout(g)) continue; // 点球大战不进终分,也不参与校验
    const t = normalizeTeam(g.team ?? '');
    const isH = t === hN;
    const isA = t === aN;
    if (!isH && !isA) continue; // 队名对不上:视作账不齐(下方校验自然不过)
    if (isH) allH += 1;
    else allA += 1;
    if (!inRegulation(g)) continue;
    if (isH) regH += 1;
    else regA += 1;
  }
  return {
    home: hasExtraTime ? regH : finalHome,
    away: hasExtraTime ? regA : finalAway,
    hasExtraTime,
    eventsAccountForFinal: allH === finalHome && allA === finalAway,
  };
}

/** 只取 90' 比分(不含判据字段)。 */
export function regulationScore(
  events: MatchEvent[],
  homeTeam: string,
  awayTeam: string,
  finalHome: number,
  finalAway: number,
): { home: number; away: number } {
  const { home, away } = regulationScoreChecked(
    events,
    homeTeam,
    awayTeam,
    finalHome,
    finalAway,
  );
  return { home, away };
}

/** 时钟字符串 → 已进行分钟数(取前导整数;"90'"→90,"105'"→105,"ET"/空→NaN)。 */
export function clockMinutes(clock?: string): number {
  const n = parseInt(String(clock ?? '').trim(), 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 分节比分:上半场 + 常规 90'(事件重建;半场归属 period 主信号,回退分钟 ≤45)。
 * 调用方用 ev90 与 90' 比分对账,账齐才采信 ht(半场波胆用)。
 */
export function periodScores(
  events: MatchEvent[],
  homeTeam: string,
  awayTeam: string,
): { ht: { h: number; a: number }; ev90: { h: number; a: number } } {
  const hN = normalizeTeam(homeTeam);
  const aN = normalizeTeam(awayTeam);
  let htH = 0;
  let htA = 0;
  let h90 = 0;
  let a90 = 0;
  for (const e of events) {
    if (!isGoal(e) || !inRegulation(e)) continue;
    const t = normalizeTeam(e.team ?? '');
    const isH = t === hN;
    const isA = t === aN;
    if (!isH && !isA) continue;
    const firstHalf = hasPeriod(e) ? e.period === 1 : minuteOf(e) <= 45;
    if (firstHalf) {
      if (isH) htH += 1;
      else htA += 1;
    }
    if (isH) h90 += 1;
    else a90 += 1;
  }
  return { ht: { h: htH, a: htA }, ev90: { h: h90, a: a90 } };
}

/** 「常规结束/加时/点球」状态名(ESPN status.type.name;枚举以真实赛事校准,正则容错)。 */
const PAST_REG_NAME =
  /END_OF_REGULATION|EXTRA[_ ]?TIME|OVERTIME|SHOOTOUT|PENALT|FULL[_ ]?TIME/i;

/**
 * 比赛是否已「打完常规 90 分钟」(多信号并联,任一成立即真):
 *  · 已完赛(post);
 *  · 进行中且 period ≥3(加时上/下或点球);
 *  · 进行中且状态名命中加时/点球/常规结束枚举;
 *  · 事件里已出现加时/点球事件(events 可选,scoreboard 无事件时不参与)。
 * 未开赛(pre)恒为 false。多信号全 miss → false(宁可等终场,不早判)。
 */
export function pastRegulation(
  m: { status: MatchStatus; period?: number; statusName?: string },
  events?: MatchEvent[],
): boolean {
  if (m.status === 'post') return true;
  if (m.status !== 'in') return false;
  if (m.period != null && m.period >= 3) return true;
  if (m.statusName && PAST_REG_NAME.test(m.statusName)) return true;
  if (events?.some(beyondRegulation)) return true;
  return false;
}
