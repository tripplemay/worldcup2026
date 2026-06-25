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
import type { BetLeg, LegResult } from './types';

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
  status: ReturnType<typeof settleSlip>['status'];
  pnl: number | null;
  note?: string;
}

/** needs_review 的人工原因(便于管理员判断如何改账)。 */
function reviewNote(results: LegResult[]): string {
  if (results.some((r) => r === 'unsupported'))
    return '含波胆/半场/组合等不支持自动结算的盘口,请按实际结果手填盈亏';
  if (results.some((r) => r === 'half_won' || r === 'half_lost'))
    return '四分盘半赢/半输,截图金额无法表达,请人工核对';
  if (results.some((r) => r === 'void'))
    return '含走盘腿,截图可赢金额已失真,请人工核对';
  return '需人工核对';
}

export async function settlePendingBets(): Promise<{ settled: number }> {
  // 1) 锁外:对快照里的未决注单做赛果解析(网络)
  const snapshot = loadBets().filter(
    (b) => b.status === 'pending' || b.status === 'unmatched',
  );
  if (!snapshot.length) return { settled: 0 };

  const updates: SlipUpdate[] = [];
  for (const slip of snapshot) {
    const legResults: LegResult[] = [];
    const legPatches: LegPatch[] = [];
    for (const leg of slip.legs) {
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
        const r = judgeLeg(
          leg.market,
          leg.selection,
          leg.line,
          res.homeGoals,
          res.awayGoals,
          ht,
          leg.parts,
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
    const { status, pnl } = settleSlip(slip, legResults);
    const upd: SlipUpdate = { id: slip.id, legPatches, status, pnl };
    if (status === 'needs_review') upd.note = reviewNote(legResults);
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
      if (slip.status !== 'pending' && slip.status !== 'unmatched') continue;

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

      if (u.status !== slip.status || u.pnl !== slip.pnl) {
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
