/**
 * 盘口快照 → 评分后的下注候选。
 * 赔率源:apifootball(主)→ 缺失回退 The Odds API 缓存快照。两源都归一成 MarketSnapshot,
 * 再由 candidatesFromSnapshot 用泊松投影(市场无关)算 pWin/EV/Kelly。
 */
import { getCached, cached } from 'lib/cache';
import { findMatch, normalizeTeam } from 'lib/match/normalize';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { projectOverUnder, projectAsianHandicap } from './projection';
import { scoreCandidate } from './router';
import { afMarketSnapshot } from './afOdds';
import { ODDS_SOURCE, ODDS_TTL_MS, PREMATCH_FETCH } from './config';
import type { BetCandidate, MarketSnapshot } from './types';
import type { MatchOdds, MatchMarkets } from 'lib/odds/types';

interface BuildParams {
  home: string;
  away: string;
  commenceTime: string;
  matrix: number[][];
  mw: { home: number; draw: number; away: number }; // 市场无关 1X2
}

/** 快照 + 矩阵 → 候选(纯投影 + 评分)。 */
export function candidatesFromSnapshot(
  matrix: number[][],
  mw: { home: number; draw: number; away: number },
  snap: MarketSnapshot,
): BetCandidate[] {
  const out: Omit<BetCandidate, 'ev' | 'kelly'>[] = [];

  const h = snap.h2h;
  if (h?.home)
    out.push({ market: '1X2', selection: 'home', odds: h.home.price, book: h.home.book, pWin: mw.home, pPush: 0 });
  if (h?.draw)
    out.push({ market: '1X2', selection: 'draw', odds: h.draw.price, book: h.draw.book, pWin: mw.draw, pPush: 0 });
  if (h?.away)
    out.push({ market: '1X2', selection: 'away', odds: h.away.price, book: h.away.book, pWin: mw.away, pPush: 0 });

  for (const tl of snap.totals) {
    const pr = projectOverUnder(matrix, tl.point);
    if (tl.over)
      out.push({ market: 'OU', selection: 'Over', line: tl.point, odds: tl.over.price, book: tl.over.book, pWin: pr.over, pPush: pr.push });
    if (tl.under)
      out.push({ market: 'OU', selection: 'Under', line: tl.point, odds: tl.under.price, book: tl.under.book, pWin: pr.under, pPush: pr.push });
  }

  for (const sp of snap.spreads) {
    const pr =
      sp.side === 'home'
        ? projectAsianHandicap(matrix, sp.point)
        : projectAsianHandicap(matrix, -sp.point);
    out.push({
      market: 'AH',
      selection: sp.side,
      line: sp.point,
      odds: sp.pick.price,
      book: sp.pick.book,
      pWin: sp.side === 'home' ? pr.homeCover : pr.awayCover,
      pPush: pr.push,
    });
  }

  return out.map(scoreCandidate);
}

/** The Odds API 快照(h2h 读 odds:matches;让球/大小球读已缓存,缺失且开启赛前拉取则拉一次)。 */
async function theOddsApiSnapshot(
  home: string,
  away: string,
  commenceTime: string,
): Promise<MarketSnapshot | null> {
  const snap = getCached<{ matches: MatchOdds[] }>('odds:matches');
  const mo = snap ? findMatch(snap.matches, home, away, commenceTime) : undefined;
  if (!mo) return null;

  const result: MarketSnapshot = { totals: [], spreads: [] };
  result.h2h = {};
  if (mo.best.home) result.h2h.home = { price: mo.best.home.price, book: mo.best.home.bookmaker };
  if (mo.best.draw) result.h2h.draw = { price: mo.best.draw.price, book: mo.best.draw.bookmaker };
  if (mo.best.away) result.h2h.away = { price: mo.best.away.price, book: mo.best.away.bookmaker };

  let mm = getCached<MatchMarkets>(`odds:markets:${mo.id}:handicap`);
  if (!mm && PREMATCH_FETCH) {
    try {
      mm = await cached(`odds:markets:${mo.id}:handicap`, ODDS_TTL_MS, () =>
        theOddsApiProvider.getMatchMarkets(mo.id),
      );
    } catch (e) {
      console.error('[paper] The Odds API 盘口拉取失败', mo.id, e);
    }
  }
  if (mm) {
    const homeNorm = normalizeTeam(mm.homeTeam);
    const tot = new Map<number, { over?: { price: number; book: string }; under?: { price: number; book: string } }>();
    const sp = new Map<string, { side: 'home' | 'away'; point: number; pick: { price: number; book: string } }>();
    for (const bk of mm.bookmakers) {
      for (const tl of bk.totals ?? []) {
        const e = tot.get(tl.point) ?? {};
        const side = tl.type.toLowerCase().startsWith('o') ? 'over' : 'under';
        const cur = e[side];
        if (!cur || tl.price > cur.price) e[side] = { price: tl.price, book: bk.title };
        tot.set(tl.point, e);
      }
      for (const s of bk.spreads ?? []) {
        const side = normalizeTeam(s.team) === homeNorm ? 'home' : 'away';
        const k = `${side}|${s.point}`;
        const cur = sp.get(k);
        if (!cur || s.price > cur.pick.price) sp.set(k, { side, point: s.point, pick: { price: s.price, book: bk.title } });
      }
    }
    result.totals = [...tot.entries()].map(([point, e]) => ({ point, ...e }));
    result.spreads = [...sp.values()];
  }
  return result;
}

/** 取盘口快照(AF 主源 → The Odds API 兜底)→ 投影成候选。 */
export async function buildCandidates(params: BuildParams): Promise<BetCandidate[]> {
  const { home, away, commenceTime, matrix, mw } = params;
  let snap: MarketSnapshot | null = null;
  if (ODDS_SOURCE === 'apifootball') snap = await afMarketSnapshot(home, away, commenceTime);
  if (!snap) snap = await theOddsApiSnapshot(home, away, commenceTime);
  if (!snap) return [];
  return candidatesFromSnapshot(matrix, mw, snap);
}
