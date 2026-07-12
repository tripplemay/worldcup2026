/**
 * 赛后结算管线:pending 交易对应比赛过 90' → 按盘口判 won/lost/void → 解冻回款。
 *
 * 结算口径:**博彩通用 90 分钟(常规时间)**,无论小组赛或淘汰赛——加时进球不计、点球大战不计。
 * 取分统一走 90' 快照 resolver(lib/match/regulationSnapshot):淘汰赛进入加时即
 * write-once 捕获 90' 比分,90' 口径盘**不再等加时/点球打完**即可结算;小组赛
 * 行为不变(终场即 90')。纯口径函数收敛在 lib/match/regulation(单点维护)。
 */
import { loadTrades } from 'lib/db/store';
import { resolveRegulationScore } from 'lib/match/regulationSnapshot';
import { isQuarterLine } from './projection';
import { settleTrade } from './ledger';
import type { Trade, SettleResult } from './types';

// 兼容 re-export(既有测试/调用方从本模块导入)
export { regulationScore, regulationScoreChecked } from 'lib/match/regulation';

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

  // 每个比赛只解析一次 90' 比分(同场多注共用;快照命中即免拉 summary)
  const byMatch = new Map<
    string,
    Awaited<ReturnType<typeof resolveRegulationScore>>
  >();
  const resolveOnce = async (matchId: string) => {
    const cached = byMatch.get(matchId);
    if (cached) return cached;
    // 90' 快照 resolver:淘汰赛过 90' 即可结(纸上市场全部为 90' 口径);
    // 未过 90' / 事件账不齐 → pending,由守望者与 cron 重试
    const r = await resolveRegulationScore(matchId);
    byMatch.set(matchId, r);
    return r;
  };

  let settled = 0;
  for (const t of pending) {
    const r = await resolveOnce(t.matchId);
    if (r.status !== 'matched') continue;
    const result = settleOutcome(
      t,
      r.homeGoals as number,
      r.awayGoals as number,
    );
    await settleTrade(t.tradeId, result, pnlFor(t, result));
    settled += 1;
  }
  return { settled };
}
