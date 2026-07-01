/**
 * 赛后结算管线:pending 交易对应比赛已 FT → 按盘口判 won/lost/void → 解冻回款。
 *
 * 结算口径:**博彩通用 90 分钟(常规时间)**,无论小组赛或淘汰赛——加时进球不计、点球大战不计。
 * 实现:仅当检测到加时进球(分钟>90)时,用进球事件重建 90' 比分(只数 ≤90' 的进球);
 * 未进加时的常见情形直接用 ESPN 终分(此时终分即 90' 比分),避免依赖事件完整性。
 */
import { espnProvider } from 'lib/espn/espn';
import { loadTrades } from 'lib/db/store';
import { normalizeTeam } from 'lib/match/normalize';
import { isQuarterLine } from './projection';
import { settleTrade } from './ledger';
import type { Trade, SettleResult } from './types';
import type { MatchEvent } from 'lib/espn/types';

/** 事件分钟(取前导整数;"90'+4'"→90,"105'"→105,缺失→NaN)。 */
function minuteOf(e: MatchEvent): number {
  const n = parseInt(String(e.minute ?? '').trim(), 10);
  return Number.isFinite(n) ? n : NaN;
}
const isGoal = (e: MatchEvent): boolean =>
  e.scoringPlay === true || /goal/i.test(e.type);

/**
 * 90 分钟比分:无加时进球则取终分;有加时进球则只数分钟 ≤90 的进球(剔除加时/点球)。
 */
export function regulationScore(
  events: MatchEvent[],
  homeTeam: string,
  awayTeam: string,
  finalHome: number,
  finalAway: number,
): { home: number; away: number } {
  const goals = events.filter(isGoal);
  const hasExtraTime = goals.some((g) => minuteOf(g) > 90);
  if (!hasExtraTime) return { home: finalHome, away: finalAway };

  const hN = normalizeTeam(homeTeam);
  const aN = normalizeTeam(awayTeam);
  let home = 0;
  let away = 0;
  for (const g of goals) {
    if (!(minuteOf(g) <= 90)) continue; // NaN(点球大战)或 >90(加时)排除
    const t = normalizeTeam(g.team ?? '');
    if (t === hN) home += 1;
    else if (t === aN) away += 1;
  }
  return { home, away };
}

/** 纯判定:给定 90' 比分,返回该笔交易结果(含走盘 void)。 */
export function outcome(
  t: Trade,
  gf: number,
  ga: number,
): 'won' | 'lost' | 'void' {
  if (t.market === '1X2') {
    const r = gf > ga ? 'home' : gf < ga ? 'away' : 'draw';
    return t.selection === r ? 'won' : 'lost';
  }
  if (t.market === 'OU') {
    const tot = gf + ga;
    const line = t.line ?? 2.5;
    if (tot === line) return 'void';
    const over = tot > line;
    return (t.selection === 'Over') === over ? 'won' : 'lost';
  }
  if (t.market === 'BTTS') {
    const both = gf >= 1 && ga >= 1;
    return (t.selection === 'Yes') === both ? 'won' : 'lost';
  }
  if (t.market === 'DC') {
    // 1X=非客胜;12=非平;X2=非主胜
    const r = gf > ga ? 'home' : gf < ga ? 'away' : 'draw';
    const win =
      t.selection === '1X'
        ? r !== 'away'
        : t.selection === '12'
        ? r !== 'draw'
        : r !== 'home';
    return win ? 'won' : 'lost';
  }
  if (t.market === 'DNB') {
    // 平局退款(void);否则按所选主/客胜判定
    if (gf === ga) return 'void';
    const r = gf > ga ? 'home' : 'away';
    return t.selection === r ? 'won' : 'lost';
  }
  // AH:让分施加于所选队
  const point = t.line ?? 0;
  const margin = t.selection === 'home' ? gf - ga + point : ga - gf + point;
  if (Math.abs(margin) < 1e-9) return 'void';
  return margin > 0 ? 'won' : 'lost';
}

/**
 * 结算细分:亚盘四分盘(±.25/.75)拆 line±0.25 两条相邻半盘(一条整数可走盘、一条 .5 永不走盘)
 * 各判再聚合;因两半相差 0.5,至多一条走盘 → 只会出现 won/lost/half_won/half_lost。
 * 其余市场 / 整数盘 / 半盘直接委托 outcome(won/lost/void)。
 */
export function settleOutcome(t: Trade, gf: number, ga: number): SettleResult {
  if (t.market === 'AH' && isQuarterLine(t.line)) {
    const line = t.line as number;
    const a = outcome({ ...t, line: line - 0.25 }, gf, ga);
    const b = outcome({ ...t, line: line + 0.25 }, gf, ga);
    if (a === 'won' && b === 'won') return 'won';
    if (a === 'lost' && b === 'lost') return 'lost';
    if (a === 'won' || b === 'won') return 'half_won'; // 赢 + 走盘
    return 'half_lost'; // 输 + 走盘
  }
  return outcome(t, gf, ga);
}

/** 结果 → 盈亏(全赢=stake·b,半赢=stake·b/2,走盘=0,半输=−stake/2,全输=−stake;b=odds−1)。 */
export function pnlFor(t: Trade, result: SettleResult): number {
  const b = t.odds - 1;
  switch (result) {
    case 'won':
      return t.stake * b;
    case 'half_won':
      return (t.stake * b) / 2;
    case 'half_lost':
      return -t.stake / 2;
    case 'lost':
      return -t.stake;
    default:
      return 0; // void
  }
}

export async function runSettlement(): Promise<{ settled: number }> {
  const pending = loadTrades().filter((t) => t.status === 'pending');
  if (!pending.length) return { settled: 0 };

  let settled = 0;
  for (const t of pending) {
    const s = await espnProvider.getMatchSummary(t.matchId);
    if (!s || s.status !== 'post' || s.homeScore == null || s.awayScore == null)
      continue;
    const { home, away } = regulationScore(
      s.events,
      s.homeTeam,
      s.awayTeam,
      s.homeScore,
      s.awayScore,
    );
    const result = settleOutcome(t, home, away);
    await settleTrade(t.tradeId, result, pnlFor(t, result));
    settled += 1;
  }
  return { settled };
}
