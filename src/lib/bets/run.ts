/**
 * Phase 9 结算编排:遍历未决注单 → 逐腿匹配赛果(resolveLeg)→ 判定(judgeLeg)
 * → 串关聚合(settleSlip)→ 回填状态/盈亏。幂等;由 settleWatcher + cron 调用。
 *
 * 仅处理 pending / unmatched(让晚到的赛果或新增队名别名能补结);
 * needs_review / 已结(won/lost/void)不自动重算,交人工。
 *
 * 并发安全:赛果解析(含网络)在锁外完成,只把「计算结果」拿进锁里、对**重新读取的**
 * 最新列表按 id 套用,避免长时间持锁阻塞 webhook 落单,也避免 load→save 丢更新。
 */
import { loadBets, saveBets } from 'lib/db/store';
import { withBetsLock } from './lock';
import { resolveLeg } from './match';
import { judgeLeg, settleSlip, VALID_MARKETS } from './settle';
import type { BetLeg, BetStatus, LegResult } from './types';

/** 已「终结」的腿(不再需要解析)。回填模式下跳过,避免重复网络判定 / 改动既定结果。 */
const TERMINAL_LEG: readonly LegResult[] = [
  'won',
  'lost',
  'void',
  'half_won',
  'half_lost',
  'unsupported',
];
const isTerminalLeg = (r?: LegResult): boolean =>
  r != null && TERMINAL_LEG.includes(r);

interface LegPatch {
  matchId?: string;
  kickoff?: string;
  homeGoals?: number;
  awayGoals?: number;
  htHome?: number;
  htAway?: number;
  result: LegResult;
}
interface SlipUpdate {
  id: string;
  legPatches: LegPatch[];
  status: BetStatus;
  pnl: number | null;
  note?: string;
  /** 仅回填剩余腿真实结果,不改整单已定的 lost 状态/盈亏(展示用)。 */
  backfillOnly?: boolean;
}

/**
 * needs_review 的人工原因(便于管理员判断如何改账)。
 * 判断顺序与 settleSlip 的 needs_review 分支一致(half_* > void > unsupported),
 * 使注记指向**实际触发转人工的那条腿**;滚球缺基线作为更具体的 unsupported 原因前置。
 */
function reviewNote(results: LegResult[], legs: BetLeg[]): string {
  if (results.some((r) => r === 'half_won' || r === 'half_lost'))
    return '四分盘半赢/半输,截图金额无法表达,请人工核对';
  if (results.some((r) => r === 'void'))
    return '含走盘腿,截图可赢金额已失真,请人工核对';
  // 滚球 AH/OU 缺下注时比分 → 无法按剩余赛程结算(比泛化"不支持"更具体,前置)
  const liveNoBase = legs.some(
    (lg, i) =>
      lg.live &&
      (lg.market === 'AH' || lg.market === 'OU') &&
      (lg.baseHome == null || lg.baseAway == null) &&
      results[i] === 'unsupported',
  );
  if (liveNoBase)
    return '滚球单未识别到下注时比分,无法按剩余赛程结算,请重新识别或人工手填盈亏';
  if (results.some((r) => r === 'unsupported'))
    return '含波胆/半场/组合等不支持自动结算的盘口,请按实际结果手填盈亏';
  return '需人工核对';
}

export async function settlePendingBets(): Promise<{ settled: number }> {
  // 1) 锁外:对快照里的未决注单做赛果解析(网络)。
  //    pending/unmatched 走完整结算;已即时判输(lost)但仍有腿未终结的,继续「回填」剩余腿
  //    真实结果(展示用 —— 即便整单已输,用户也要看到其余各场的实际胜负),不改已定的 lost。
  const snapshot = loadBets().filter(
    (b) =>
      b.status === 'pending' ||
      b.status === 'unmatched' ||
      (b.status === 'lost' && b.legs.some((l) => !isTerminalLeg(l.result))),
  );
  if (!snapshot.length) return { settled: 0 };

  const updates: SlipUpdate[] = [];
  for (const slip of snapshot) {
    // 整单已判输 → 仅回填剩余腿,不重算整单状态/盈亏。
    const backfillOnly = slip.status === 'lost';
    const legResults: LegResult[] = [];
    const legPatches: LegPatch[] = [];
    for (const leg of slip.legs) {
      // 回填模式下,已终结的腿保持原样(不重复网络解析,也不改动既定结果)。
      if (backfillOnly && isTerminalLeg(leg.result)) {
        legResults.push(leg.result as LegResult);
        legPatches.push({
          matchId: leg.matchId,
          kickoff: leg.kickoff,
          homeGoals: leg.homeGoals,
          awayGoals: leg.awayGoals,
          htHome: leg.htHome,
          htAway: leg.htAway,
          result: leg.result as LegResult,
        });
        continue;
      }
      const res = await resolveLeg(leg);
      // 不支持的盘口(波胆/半场等):立即标 unsupported → 转人工,不臆造结果
      if (!VALID_MARKETS.includes(leg.market)) {
        legResults.push('unsupported');
        legPatches.push({
          matchId: res.matchId,
          kickoff: res.kickoff,
          result: 'unsupported',
        });
      } else if (
        res.status === 'matched' &&
        res.homeGoals != null &&
        res.awayGoals != null
      ) {
        const ht =
          res.htHome != null && res.htAway != null
            ? { h: res.htHome, a: res.htAway }
            : undefined;
        // 滚球(剩余赛程口径):仅 AH/OU 用「下注后净增」结算,需下注时比分基线
        const base =
          leg.live && leg.baseHome != null && leg.baseAway != null
            ? { h: leg.baseHome, a: leg.baseAway }
            : undefined;
        // 仅滚球 AH/OU 必须有基线;缺基线 → 转人工,绝不按全场静默错算(剩余口径)。
        // 其余滚球盘(1X2/BTTS/DNB/波胆等)为全场口径,无需基线,judgeLeg 会忽略 base 按全场判。
        const restNeedsBase =
          leg.live && (leg.market === 'AH' || leg.market === 'OU');
        const r: LegResult =
          restNeedsBase && !base
            ? 'unsupported'
            : judgeLeg(
                leg.market,
                leg.selection,
                leg.line,
                res.homeGoals,
                res.awayGoals,
                ht,
                leg.parts,
                base,
              );
        legResults.push(r);
        legPatches.push({
          matchId: res.matchId,
          kickoff: res.kickoff,
          homeGoals: res.homeGoals,
          awayGoals: res.awayGoals,
          htHome: res.htHome,
          htAway: res.htAway,
          result: r,
        });
      } else if (res.status === 'pending') {
        legResults.push('pending');
        legPatches.push({ kickoff: res.kickoff, result: 'pending' });
      } else {
        legResults.push('unmatched');
        legPatches.push({ result: 'unmatched' });
      }
    }
    // 回填模式保持整单已定的 lost / pnl;否则按各腿聚合定状态。
    const { status, pnl } = backfillOnly
      ? { status: slip.status, pnl: slip.pnl }
      : settleSlip(slip, legResults);
    const upd: SlipUpdate = {
      id: slip.id,
      legPatches,
      status,
      pnl,
      backfillOnly,
    };
    if (!backfillOnly && status === 'needs_review')
      upd.note = reviewNote(legResults, slip.legs);
    updates.push(upd);
  }

  // 2) 锁内:重读最新列表,按 id 套用(只动仍未决的注单),原子保存
  let settled = 0;
  await withBetsLock(() => {
    const list = loadBets();
    let dirty = false;
    for (const u of updates) {
      const slip = list.find((b) => b.id === u.id);
      if (!slip) continue;
      if (u.backfillOnly) {
        if (slip.status !== 'lost') continue; // 期间被人工改账 → 跳过回填
      } else if (slip.status !== 'pending' && slip.status !== 'unmatched') {
        continue;
      }

      let changed = false;
      u.legPatches.forEach((lp, i) => {
        const leg: BetLeg | undefined = slip.legs[i];
        if (!leg) return;
        if (
          leg.result !== lp.result ||
          leg.homeGoals !== lp.homeGoals ||
          leg.awayGoals !== lp.awayGoals ||
          (lp.kickoff !== undefined && leg.kickoff !== lp.kickoff)
        ) {
          if (lp.matchId !== undefined) leg.matchId = lp.matchId;
          if (lp.kickoff !== undefined) leg.kickoff = lp.kickoff;
          if (lp.homeGoals !== undefined) leg.homeGoals = lp.homeGoals;
          if (lp.awayGoals !== undefined) leg.awayGoals = lp.awayGoals;
          if (lp.htHome !== undefined) leg.htHome = lp.htHome;
          if (lp.htAway !== undefined) leg.htAway = lp.htAway;
          leg.result = lp.result;
          changed = true;
        }
      });

      // 回填模式不动整单状态/盈亏/结算时间,只更新各腿结果(上面的 legPatches)。
      if (!u.backfillOnly && (u.status !== slip.status || u.pnl !== slip.pnl)) {
        slip.status = u.status;
        slip.pnl = u.pnl;
        if (u.note) slip.note = u.note;
        if (u.status === 'won' || u.status === 'lost' || u.status === 'void') {
          slip.settledAt = Date.now();
          settled += 1;
        }
        changed = true;
      }
      if (changed) {
        slip.updatedAt = Date.now();
        dirty = true;
      }
    }
    if (dirty) saveBets(list);
  });

  return { settled };
}
