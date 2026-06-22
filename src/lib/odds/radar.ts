/**
 * 微观异动雷达(Phase C):在赔率时序上检测三类信号(全部基于去水 True_IP)。
 *  · STEAM 闪崩/线动:1X2 去水概率 ~3min 内突涨 ≥ 2.5pt
 *  · BREAKOUT 关键线击穿:亚盘主线跨越关键数且新去水概率 > 0.48(防诱盘)
 *  · RLM 市场拒绝:临场(≤1h)我方头条 >60% 但市场去水显著更低且仍在下滑 → 风控
 * 状态挂 globalThis;poller 每拍调 detectAnomalies。alert 去重(冷却)。
 */
import { trueIP3, trueIP2 } from './trueIP';
import { getOddsSeries, type OddsSnapshot } from './oddsSeries';
import { loadPredictionLog } from 'lib/db/store';
import type { MatchOdds } from './types';

export type RadarType = 'STEAM' | 'BREAKOUT' | 'RLM';
export interface RadarAlert {
  id: string;
  matchId: string;
  teams: string;
  ts: number;
  type: RadarType;
  severity: 'high' | 'medium';
  message: string;
  side?: 'home' | 'draw' | 'away'; // 异动方向(供信号合成判同向共振)
  spark: number[]; // 最近 True_IP 走势(相关项),供 sparkline
}

interface RadarState {
  alerts: RadarAlert[];
  lastFired: Record<string, number>;
}
const g = globalThis as unknown as { __wcRadar?: RadarState };
const rs: RadarState = (g.__wcRadar ??= { alerts: [], lastFired: {} });

const MAX_ALERTS = 120;
const STEAM_DELTA = 0.025;
// 滑窗去重不变式:每个检测器的 cooldown 必须 ≥ 它的回看窗口。否则"现值 vs 窗口前值"
// 的比较在一次穿越后整个窗口期内持续为真;cooldown(若 < 窗口)到期、而窗口尚未滑过
// 穿越点时,会把【同一次穿越】重复报一遍(实测 BREAKOUT 同场 ~11min 重复即此因)。
export const STEAM_WINDOW = 180_000; // 3min
export const STEAM_COOLDOWN = 600_000; // 10min(> 窗口 ✓)
export const BREAKOUT_WINDOW = 900_000; // 15min 回看(慢速线动也能捕捉)
export const BREAKOUT_COOLDOWN = 1_200_000; // 20min(> 回看窗口;原误复用 STEAM 的 10min<15min)
export const RLM_WINDOW = 3_600_000; // 临场 1h
export const RLM_REFIRE = 3_600_000; // 触发去重 ≥ 窗口(每场每窗最多 1 条 RLM)
const RLM_COOLDOWN = 1_800_000; // 30min:hasActiveRlm 风控"近期活跃"窗(与触发去重解耦)
const KEY_LINES = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];

function snapBefore(
  series: OddsSnapshot[],
  targetTs: number,
): OddsSnapshot | undefined {
  let r: OddsSnapshot | undefined;
  for (const s of series) {
    if (s[0] <= targetTs) r = s;
    else break;
  }
  return r;
}
function cooled(key: string, now: number, ms: number): boolean {
  const last = rs.lastFired[key];
  if (last != null && now - last < ms) return false;
  rs.lastFired[key] = now;
  return true;
}
function sparkFor(
  series: OddsSnapshot[],
  side: 'home' | 'draw' | 'away',
): number[] {
  return series.slice(-30).map((s) => {
    const ip = trueIP3(s[1], s[2], s[3]);
    return ip ? +ip[side].toFixed(3) : 0;
  });
}
function push(a: RadarAlert): void {
  rs.alerts.unshift(a);
  if (rs.alerts.length > MAX_ALERTS) rs.alerts.length = MAX_ALERTS;
}

export function getRadarAlerts(): RadarAlert[] {
  return rs.alerts;
}
/** 模拟盘风控:该场是否有近 30min 内的 RLM 警报(有则拦截下注)。 */
export function hasActiveRlm(matchId: string, now = Date.now()): boolean {
  return rs.alerts.some(
    (a) =>
      a.type === 'RLM' && a.matchId === matchId && now - a.ts < RLM_COOLDOWN,
  );
}

export function detectAnomalies(matches: MatchOdds[], now: number): void {
  const predLog = loadPredictionLog();
  for (const m of matches) {
    const series = getOddsSeries(m.id);
    if (!series || series.length < 2) continue;
    const cur = series[series.length - 1];
    const teams = `${m.homeTeam}-${m.awayTeam}`;
    const ipCur = trueIP3(cur[1], cur[2], cur[3]);

    // ① STEAM:1X2 去水概率 3min 内突涨
    if (ipCur) {
      const past = snapBefore(series, now - STEAM_WINDOW);
      const ipPast = past && trueIP3(past[1], past[2], past[3]);
      if (ipPast && past) {
        const sides: ['home' | 'draw' | 'away', string, number, number][] = [
          ['home', '主胜', ipCur.home - ipPast.home, 1],
          ['draw', '平局', ipCur.draw - ipPast.draw, 2],
          ['away', '客胜', ipCur.away - ipPast.away, 3],
        ];
        const top = sides.sort((a, b) => b[2] - a[2])[0];
        if (
          top[2] >= STEAM_DELTA &&
          cooled(`${m.id}:STEAM`, now, STEAM_COOLDOWN)
        ) {
          push({
            id: `${m.id}-STEAM-${now}`,
            matchId: m.id,
            teams,
            ts: now,
            type: 'STEAM',
            severity: top[2] >= 0.04 ? 'high' : 'medium',
            message: `${top[1]}去水概率 3 分钟内 +${(top[2] * 100).toFixed(
              1,
            )}%(赔率 ${past[top[3]]}→${cur[top[3]]})`,
            side: top[0],
            spark: sparkFor(series, top[0]),
          });
        }
      }
    }

    // ② BREAKOUT:亚盘主线跨越关键数 + 新去水 > 0.48(防诱盘)
    const curLine = cur[4];
    if (curLine != null) {
      const past15 = snapBefore(series, now - BREAKOUT_WINDOW);
      const pastLine = past15?.[4];
      if (pastLine != null && pastLine !== curLine) {
        const crossed = KEY_LINES.some(
          (k) =>
            (pastLine < k && k <= curLine) || (curLine <= k && k < pastLine),
        );
        const ah = trueIP2(cur[5], cur[6]);
        if (
          crossed &&
          ah &&
          Math.max(ah.a, ah.b) > 0.48 &&
          cooled(`${m.id}:BREAKOUT:${curLine}`, now, BREAKOUT_COOLDOWN)
        ) {
          push({
            id: `${m.id}-BREAKOUT-${now}`,
            matchId: m.id,
            teams,
            ts: now,
            type: 'BREAKOUT',
            severity: 'medium',
            message: `让球线击穿关键线 ${pastLine}→${curLine}(去水 ${(
              Math.max(ah.a, ah.b) * 100
            ).toFixed(0)}%)`,
            side: curLine < pastLine ? 'home' : 'away',
            spark: [],
          });
        }
      }
    }

    // ③ RLM:临场市场拒绝我方头条
    const snap = predLog[m.id];
    const ct = Date.parse(m.commenceTime);
    if (
      snap &&
      ipCur &&
      Number.isFinite(ct) &&
      now < ct &&
      ct - now <= RLM_WINDOW
    ) {
      const ens = { home: snap.pHome, draw: snap.pDraw, away: snap.pAway };
      const favKey = (['home', 'draw', 'away'] as const).reduce((b, k) =>
        ens[k] > ens[b] ? k : b,
      );
      if (ens[favKey] > 0.6) {
        const drift = ens[favKey] - ipCur[favKey];
        const pastHr = snapBefore(series, now - RLM_WINDOW) ?? series[0];
        const ipPastHr = trueIP3(pastHr[1], pastHr[2], pastHr[3]);
        const falling = ipPastHr
          ? ipCur[favKey] < ipPastHr[favKey] - 0.005
          : false;
        if (drift >= 0.1 && falling && cooled(`${m.id}:RLM`, now, RLM_REFIRE)) {
          const label =
            favKey === 'home' ? '主' : favKey === 'away' ? '客' : '平';
          push({
            id: `${m.id}-RLM-${now}`,
            matchId: m.id,
            teams,
            ts: now,
            type: 'RLM',
            severity: 'high',
            message: `头条看好${label}胜 ${(ens[favKey] * 100).toFixed(
              0,
            )}%,但临场真实仅 ${(ipCur[favKey] * 100).toFixed(
              0,
            )}% 且在下滑——市场拒绝,建议放弃`,
            side: favKey,
            spark: sparkFor(series, favKey),
          });
        }
      }
    }
  }
}
