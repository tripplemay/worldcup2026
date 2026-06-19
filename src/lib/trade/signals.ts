/**
 * 交易指令合成(Copilot,Phase 8):把基本面(EV 路由选出的最优注)与资金面(雷达异动)
 * 拧成 4 级人工跟单指令,持久化到 trading-signals.json,由人在「指令台」审查后手动跟单。
 *  · L1 绝对共振:有 +EV 选项 + 雷达同向 steam/破线 → 满额(1/4 Kelly)
 *  · L2 价值洼地:有 +EV 选项,市场平静 → 半额(1/8 Kelly)
 *  · L3 风控否决:有 +EV 选项,但雷达 RLM 市场拒绝 → 仓位 0(放弃)
 *  · L4 纯投机:无 EV 但强 steam 动量(默认关闭,违背只下正 EV 原则)
 * 不自动扣款;与自动模拟盘共存(共用同一次扫描/赔率拉取,见 prematch.ts)。
 */
import {
  loadSignals,
  saveSignals,
  type TradingSignal,
  type SignalLevel,
  type SignalStatus,
} from 'lib/db/store';
import { getRadarAlerts, hasActiveRlm, type RadarAlert } from 'lib/odds/radar';
import { stakeFor } from './ev';
import { KELLY_FRACTION, MAX_STAKE_PCT, MIN_STAKE } from './config';
import { classifyDivergence, type ModelSet } from 'lib/predict/divergence';
import type { BetCandidate } from './types';

const RESONANCE_MS = 2 * 3_600_000; // 共振判定:近 2 小时的异动
const MAX_SIGNALS = 200;

/** 同向共振:雷达异动方向与最优注一致(1X2 按 side;亚盘按破线)。 */
function resonates(best: BetCandidate, alerts: RadarAlert[]): boolean {
  return alerts.some(
    (a) =>
      (a.type === 'STEAM' && a.side === best.selection) ||
      (a.type === 'BREAKOUT' &&
        (best.selection === 'home' || best.selection === 'away')),
  );
}

/** 为一场已选出最优注的比赛合成并落库指令(幂等:该场已有 UNREAD 不重复)。 */
export function emitSignal(input: {
  matchId: string;
  match: string;
  best: BetCandidate;
  balance: number;
  now: number;
  models?: ModelSet; // 各模型 1X2,用于分歧分类
}): void {
  const { matchId, match, best, balance, now, models } = input;
  const signals = loadSignals();
  if (signals.some((s) => s.matchId === matchId && s.status === 'UNREAD'))
    return;

  const recent = getRadarAlerts().filter(
    (a) => a.matchId === matchId && now - a.ts < RESONANCE_MS,
  );
  const rlm =
    recent.some((a) => a.type === 'RLM') || hasActiveRlm(matchId, now);
  const reson = !rlm && resonates(best, recent);
  const level: SignalLevel = rlm ? 'L3' : reson ? 'L1' : 'L2';
  const fraction = level === 'L1' ? KELLY_FRACTION : KELLY_FRACTION / 2;
  const suggestedStake =
    level === 'L3'
      ? 0
      : stakeFor(best.kelly, balance, {
          fraction,
          maxPct: MAX_STAKE_PCT,
          minStake: MIN_STAKE,
        });

  const sig: TradingSignal = {
    id: `${matchId}-${now}`,
    ts: now,
    matchId,
    match,
    level,
    market: best.market,
    selection: best.selection,
    line: best.line,
    odds: best.odds,
    ev: +best.ev.toFixed(4),
    pWin: +best.pWin.toFixed(4),
    kelly: +best.kelly.toFixed(4),
    suggestedStake,
    resonance: reson,
    divergence: models ? classifyDivergence(models) : undefined,
    status: 'UNREAD',
  };
  signals.unshift(sig);
  saveSignals(signals.slice(0, MAX_SIGNALS));
}

/** 更新指令状态(已跟单/忽略)。 */
export function setSignalStatus(id: string, status: SignalStatus): boolean {
  const signals = loadSignals();
  const s = signals.find((x) => x.id === id);
  if (!s) return false;
  s.status = status;
  saveSignals(signals);
  return true;
}

export function unreadSignals(): number {
  return loadSignals().filter((s) => s.status === 'UNREAD').length;
}
