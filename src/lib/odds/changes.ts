/**
 * 赔率变动检测(服务端)。
 * 对比上一份持久化快照,算出每场每个赛果(主/平/客,及各家)的"最近一次变化":
 * 方向 + 幅度 + 时间。结果随 /api/worldcup/matches 返回,全设备一致、刷新/部署不丢。
 *
 * 语义:箭头表示"相对上一次赔率刷新"的方向;价格不变时沿用上一次方向(持续显示),
 * 直到下一次真正变动;超过 TTL(默认 48h)未变动则不再显示(避免陈旧误导)。
 */
import type { MatchOdds } from './types';

export type OddsDir = 'up' | 'down';

/** 单赛果最近一次变化:方向 + 带符号幅度(保留 2 位)+ 发生时间(ms)。 */
export interface OutcomeChange {
  dir: OddsDir;
  delta: number;
  at: number;
}
export interface OutcomeChangeSet {
  home?: OutcomeChange;
  draw?: OutcomeChange;
  away?: OutcomeChange;
}
/** 一场比赛的变化:最优三路 + 各家(books[bookmakerKey])。 */
export interface MatchChange extends OutcomeChangeSet {
  books?: Record<string, OutcomeChangeSet>;
}
export type OddsChangeMap = Record<string, MatchChange>;

// ── 持久化快照:基准价 + 最近一次变化(跨刷新/部署保留)──────────
interface OutcomeState {
  price: number;
  dir?: OddsDir;
  delta?: number;
  at?: number;
}
interface ThreeWayState {
  home?: OutcomeState;
  draw?: OutcomeState;
  away?: OutcomeState;
}
interface MatchState {
  best: ThreeWayState;
  books: Record<string, ThreeWayState>;
}
export type OddsSnap = Record<string, MatchState>;

/** 最近一次变化的保留时长;超过则不再显示箭头。默认 48h。 */
export const ODDS_CHANGE_TTL_MS = 172_800_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 用上次状态推进到当前价:
 *  · 无当前价 → 沿用旧状态(可能为空)
 *  · 无旧基准(首见)→ 仅记基准价,不产出方向
 *  · 价格变化 → 更新方向/幅度/时间
 *  · 价格不变 → 沿用旧状态(保留"最近一次"方向)
 */
function step(
  prev: OutcomeState | undefined,
  cur: number | undefined,
  now: number,
): OutcomeState | undefined {
  if (cur == null) return prev;
  if (prev == null) return { price: cur };
  if (cur === prev.price) return prev;
  const delta = round2(cur - prev.price);
  return { price: cur, dir: delta > 0 ? 'up' : 'down', delta, at: now };
}

function stepThree(
  prev: ThreeWayState | undefined,
  h: number | undefined,
  d: number | undefined,
  a: number | undefined,
  now: number,
): ThreeWayState {
  return {
    home: step(prev?.home, h, now),
    draw: step(prev?.draw, d, now),
    away: step(prev?.away, a, now),
  };
}

function toChange(
  s: OutcomeState | undefined,
  now: number,
  ttl: number,
): OutcomeChange | undefined {
  if (!s || s.dir == null || s.at == null) return undefined;
  if (now - s.at > ttl) return undefined;
  return { dir: s.dir, delta: s.delta ?? 0, at: s.at };
}

function toChangeSet(s: ThreeWayState, now: number, ttl: number): OutcomeChangeSet {
  return {
    home: toChange(s.home, now, ttl),
    draw: toChange(s.draw, now, ttl),
    away: toChange(s.away, now, ttl),
  };
}

const hasAny = (s: OutcomeChangeSet) => !!(s.home || s.draw || s.away);

/**
 * 对比上一份快照与本次最新赔率,产出变化图 + 新快照(供持久化)。
 * 只保留本次出现的比赛(自动剪除已结束/下架场次,快照不膨胀)。
 */
export function computeChanges(
  prev: OddsSnap,
  matches: MatchOdds[],
  now: number,
  ttl: number = ODDS_CHANGE_TTL_MS,
): { changes: OddsChangeMap; snap: OddsSnap } {
  const snap: OddsSnap = {};
  const changes: OddsChangeMap = {};

  for (const m of matches) {
    const pm = prev[m.id];
    const best = stepThree(
      pm?.best,
      m.best.home?.price,
      m.best.draw?.price,
      m.best.away?.price,
      now,
    );
    const books: Record<string, ThreeWayState> = {};
    for (const b of m.bookmakers) {
      books[b.key] = stepThree(pm?.books?.[b.key], b.home, b.draw, b.away, now);
    }
    snap[m.id] = { best, books };

    const bestCh = toChangeSet(best, now, ttl);
    const bookCh: Record<string, OutcomeChangeSet> = {};
    for (const key of Object.keys(books)) {
      const cs = toChangeSet(books[key], now, ttl);
      if (hasAny(cs)) bookCh[key] = cs;
    }
    const mc: MatchChange = { ...bestCh };
    if (Object.keys(bookCh).length) mc.books = bookCh;
    if (hasAny(mc) || mc.books) changes[m.id] = mc;
  }

  return { changes, snap };
}
