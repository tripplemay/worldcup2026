/**
 * Phase 9 注单变更器 + 盈亏聚合(仿 trade/signals.ts 的 load→改→save 模式)。
 * 金额一律以截图为准;系统只做结果匹配,故这里不重算赔率。
 */
import { loadBets, saveBets } from 'lib/db/store';
import { withBetsLock } from './lock';
import { genId } from './id';
import type { BetSlip, RecognizedSlip, Bettor } from './types';

/** 识别结果 → 新注单(pending,未归属)。 */
export function createBetFromRecognized(
  rec: RecognizedSlip,
  source?: BetSlip['source'],
): BetSlip {
  const now = Date.now();
  const slip: BetSlip = {
    id: genId('bet'),
    bettorId: null,
    stake: rec.stake,
    potentialReturn: rec.potentialReturn,
    legs: rec.legs,
    status: 'pending',
    pnl: null,
    confidence: rec.confidence,
    recognizedRaw: rec,
    createdAt: now,
    updatedAt: now,
  };
  if (rec.platform !== undefined) slip.platform = rec.platform;
  if (rec.currency !== undefined) slip.currency = rec.currency;
  if (source !== undefined) slip.source = source;
  return slip;
}

/** 落库(锁内 load→append→save,防与结算扫描互相覆盖)。 */
export function addBet(slip: BetSlip): Promise<void> {
  return withBetsLock(() => {
    saveBets([...loadBets(), slip]);
  });
}

export function getBet(id: string): BetSlip | undefined {
  return loadBets().find((b) => b.id === id);
}

/** 通用 patch(管理员改账);id/createdAt 不可改,updatedAt 自动刷新。命中返回 true。 */
export function updateBet(
  id: string,
  patch: Partial<BetSlip>,
): Promise<boolean> {
  return withBetsLock(() => {
    const list = loadBets();
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) return false;
    const merged: BetSlip = {
      ...list[i],
      ...patch,
      id: list[i].id,
      createdAt: list[i].createdAt,
      updatedAt: Date.now(),
    };
    saveBets([...list.slice(0, i), merged, ...list.slice(i + 1)]);
    return true;
  });
}

/** 归属到某投注人。 */
export function assignBettor(
  betId: string,
  bettorId: string,
): Promise<boolean> {
  return updateBet(betId, { bettorId });
}

/** 每名投注人盈亏聚合行。 */
export interface BettorPnl {
  bettorId: string;
  name: string;
  bets: number; // 注单总数(含未结)
  settled: number; // 已结算注数(won/lost/void)
  won: number;
  lost: number;
  staked: number; // 已结算注本金合计
  pnl: number; // 净盈亏合计
  pending: number; // 未结 / 待复核 / 未匹配 注数
}

const UNASSIGNED = '__unassigned__';

/** 是否计入「已结算」盈亏统计。 */
function isSettled(s: BetSlip): boolean {
  return (
    s.pnl != null &&
    (s.status === 'won' || s.status === 'lost' || s.status === 'void')
  );
}

/** 每名投注人的盈亏聚合(未归属归入「(未归属)」桶;只保留有注单的桶)。 */
export function perUserPnl(slips: BetSlip[], bettors: Bettor[]): BettorPnl[] {
  const blank = (bettorId: string, name: string): BettorPnl => ({
    bettorId,
    name,
    bets: 0,
    settled: 0,
    won: 0,
    lost: 0,
    staked: 0,
    pnl: 0,
    pending: 0,
  });
  const byId = new Map<string, BettorPnl>();
  for (const b of bettors) byId.set(b.id, blank(b.id, b.name));
  byId.set(UNASSIGNED, blank(UNASSIGNED, '(未归属)'));

  for (const s of slips) {
    const key = s.bettorId && byId.has(s.bettorId) ? s.bettorId : UNASSIGNED;
    const agg = byId.get(key) ?? blank(key, '(未知)');
    agg.bets += 1;
    if (isSettled(s)) {
      agg.settled += 1;
      agg.staked += s.stake;
      agg.pnl += s.pnl ?? 0;
      if (s.status === 'won') agg.won += 1;
      else if (s.status === 'lost') agg.lost += 1;
    } else {
      agg.pending += 1;
    }
    byId.set(key, agg);
  }
  return [...byId.values()].filter((a) => a.bets > 0);
}
