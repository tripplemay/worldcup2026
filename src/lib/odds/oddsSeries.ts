/**
 * 赔率时序底座(Phase A):每拍把在跟踪比赛的 1X2 + 亚盘主线快照存入内存环形缓冲,
 * 5min 异步落盘;并在开赛瞬间把「最后一拍赛前赔率」write-once 写为闭盘价(CLV 真值靶基础)。
 * 状态挂 globalThis(与 livePoller 同模式,避免双实例分叉)。几乎零新增上游配额(只保留每拍已拉数据)。
 */
import type { MatchOdds, LiveMarket } from './types';
import {
  loadClosingOdds,
  saveClosingOdds,
  loadOddsSnapshots,
  saveOddsSnapshots,
} from 'lib/db/store';

// [ts, h, d, a, ahLine, ahH, ahA](紧凑;null 表缺失)
export type OddsSnapshot = [
  number,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

const MAX_POINTS = 200; // 每场最多保留(≈2 小时 36s 级)
const FLUSH_MS = 300_000; // 5min 落盘

interface SeriesState {
  series: Record<string, OddsSnapshot[]>;
  lastPre: Record<
    string,
    { snap: OddsSnapshot; commenceTime: number }
  >; // 各场最新「赛前」快照,开赛冻结为闭盘
  flushTimer: ReturnType<typeof setInterval> | null;
  loaded: boolean;
}
const g = globalThis as unknown as { __wcOddsSeries?: SeriesState };
const st: SeriesState = (g.__wcOddsSeries ??= {
  series: {},
  lastPre: {},
  flushTimer: null,
  loaded: false,
});

/** 亚盘主线:取 handicap/spread 盘里 home/away 皆有、最均势(价差最小)的一行。 */
function ahMain(
  markets?: LiveMarket[],
): { line: number; h: number; a: number } | null {
  if (!markets) return null;
  const m = markets.find((mk) => /handicap|spread/i.test(mk.name));
  if (!m) return null;
  let best: { line: number; h: number; a: number } | null = null;
  let gap = Infinity;
  for (const r of m.rows) {
    if (r.hdp == null || r.home == null || r.away == null) continue;
    const g2 = Math.abs(r.home - r.away);
    if (g2 < gap) {
      gap = g2;
      best = { line: r.hdp, h: r.home, a: r.away };
    }
  }
  return best;
}

/** 每拍调用:append 快照(环形)+ 维护赛前最新 + 开赛冻结闭盘。 */
export function recordTick(
  matches: MatchOdds[],
  marketsById: Record<string, LiveMarket[]>,
  now: number,
): void {
  for (const m of matches) {
    const ah = ahMain(marketsById[m.id]);
    const snap: OddsSnapshot = [
      now,
      m.best.home?.price ?? null,
      m.best.draw?.price ?? null,
      m.best.away?.price ?? null,
      ah?.line ?? null,
      ah?.h ?? null,
      ah?.a ?? null,
    ];
    const arr = (st.series[m.id] ??= []);
    arr.push(snap);
    if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
    const ct = Date.parse(m.commenceTime);
    if (Number.isFinite(ct) && now < ct) {
      st.lastPre[m.id] = { snap, commenceTime: ct };
    }
  }
  // 闭盘 write-once:已开赛且尚未记录 → 把最后一拍赛前快照定为闭盘
  const closing = loadClosingOdds();
  let added = false;
  for (const [id, lp] of Object.entries(st.lastPre)) {
    if (now >= lp.commenceTime && !closing[id]) {
      const [ts, h, d, a, ahLine, ahH, ahA] = lp.snap;
      closing[id] = { capturedAt: ts, h, d, a, ahLine, ahH, ahA };
      added = true;
      delete st.lastPre[id];
    }
  }
  if (added) saveClosingOdds(closing);
}

export function getOddsSeries(matchId: string): OddsSnapshot[] | undefined {
  return st.series[matchId];
}
export function getAllOddsSeries(): Record<string, OddsSnapshot[]> {
  return st.series;
}

/** 把内存时序落盘(write,非阻塞由调用方/定时器保证)。 */
export function flushOddsSeries(now: number): void {
  const matches: Record<string, { snapshots: (number | null)[][] }> = {};
  for (const [id, snaps] of Object.entries(st.series)) {
    matches[id] = { snapshots: snaps };
  }
  saveOddsSnapshots({ lastFlushed: now, matches });
}

/** 启动 5min 落盘定时器(幂等);首次载回上次快照以保留重启前历史。 */
export function startSeriesFlush(): void {
  if (st.flushTimer) return;
  if (!st.loaded) {
    try {
      const d = loadOddsSnapshots();
      for (const [id, v] of Object.entries(d.matches ?? {})) {
        st.series[id] = (v.snapshots ?? []) as OddsSnapshot[];
      }
    } catch {
      /* 忽略:首次无文件 */
    }
    st.loaded = true;
  }
  const t = setInterval(() => {
    try {
      flushOddsSeries(Date.now());
    } catch (e) {
      console.error('[odds-series] flush 失败', e);
    }
  }, FLUSH_MS);
  if (typeof t.unref === 'function') t.unref();
  st.flushTimer = t;
}
