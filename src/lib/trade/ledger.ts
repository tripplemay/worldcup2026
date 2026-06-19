/**
 * 虚拟账本:下注扣款/锁定、赛后结算解冻回款。
 * 下单与结算来自不同 cron 请求,用进程内互斥锁序列化对 wallet/trades 的读-改-写,防并发竞争。
 */
import { loadWallet, saveWallet, loadTrades, saveTrades } from 'lib/db/store';
import { INITIAL_BALANCE } from './config';
import type { Wallet, Trade, BetCandidate, TradeTier } from './types';

// ── 进程内互斥(单实例 PM2)──────────────────────────────
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => T): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}

function freshWallet(): Wallet {
  return {
    initialBalance: INITIAL_BALANCE,
    currentBalance: INITIAL_BALANCE,
    lockedBalance: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    updatedAt: Date.now(),
  };
}

export function getWallet(): Wallet {
  return loadWallet() ?? freshWallet();
}

/** 重置账本:清空流水 + 钱包归零到初始本金(管理用)。 */
export function resetLedger(): Promise<void> {
  return withLock(() => {
    saveWallet(freshWallet());
    saveTrades([]);
  });
}

let seq = 0;
const newId = () => `tr_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/** 该场是否已下过注(幂等)。 */
export function hasBet(matchId: string): boolean {
  return loadTrades().some((t) => t.matchId === matchId);
}

export interface PlaceInput {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  candidate: BetCandidate;
  stake: number;
  tier?: TradeTier;
}

/** 下注:扣余额→锁定 + 写 pending 流水(加锁;已下注/余额不足返回 null)。 */
export function placeBet(input: PlaceInput): Promise<Trade | null> {
  return withLock(() => {
    const trades = loadTrades();
    if (trades.some((t) => t.matchId === input.matchId)) return null;
    const w = getWallet();
    if (input.stake <= 0 || input.stake > w.currentBalance) return null;
    const c = input.candidate;
    const trade: Trade = {
      tradeId: newId(),
      matchId: input.matchId,
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      date: input.date,
      market: c.market,
      selection: c.selection,
      line: c.line,
      odds: c.odds,
      modelProb: c.pWin,
      ev: c.ev,
      stake: input.stake,
      status: 'pending',
      result: null,
      pnl: null,
      placedAt: Date.now(),
      tier: input.tier ?? 'value',
    };
    w.currentBalance = +(w.currentBalance - input.stake).toFixed(2);
    w.lockedBalance = +(w.lockedBalance + input.stake).toFixed(2);
    w.totalTrades += 1;
    w.updatedAt = Date.now();
    saveTrades([...trades, trade]);
    saveWallet(w);
    return trade;
  });
}

/** 结算一笔:解冻锁定金,赢则回本+利,走盘退本,输则不回(加锁)。 */
export function settleTrade(
  tradeId: string,
  result: 'won' | 'lost' | 'void',
  pnl: number,
): Promise<void> {
  return withLock(() => {
    const trades = loadTrades();
    const t = trades.find((x) => x.tradeId === tradeId);
    if (!t || t.status !== 'pending') return;
    const w = getWallet();
    w.lockedBalance = +Math.max(0, w.lockedBalance - t.stake).toFixed(2);
    const payout =
      result === 'won' ? t.stake + pnl : result === 'void' ? t.stake : 0;
    w.currentBalance = +(w.currentBalance + payout).toFixed(2);
    if (result === 'won') w.wins += 1;
    else if (result === 'lost') w.losses += 1;
    w.updatedAt = Date.now();
    t.status = result;
    t.result = result;
    t.pnl = +pnl.toFixed(2);
    t.settledAt = Date.now();
    saveTrades(trades);
    saveWallet(w);
  });
}
