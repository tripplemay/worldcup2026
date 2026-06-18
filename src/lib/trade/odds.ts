/**
 * 把市场赔率快照 + 模型投影 → 评分后的下注候选。
 *  · 1X2:odds:matches(h2h,通常已热)
 *  · 大小球 / 亚盘:odds:markets:{id}:handicap(由 ensureMatchMarkets 赛前轻量拉一次)
 */
import { getCached, cached } from 'lib/cache';
import { findMatch, normalizeTeam } from 'lib/match/normalize';
import { theOddsApiProvider } from 'lib/odds/theoddsapi';
import { projectOverUnder, projectAsianHandicap } from './projection';
import { scoreCandidate } from './router';
import { ODDS_TTL_MS } from './config';
import type { BetCandidate } from './types';
import type { MatchOdds, MatchMarkets } from 'lib/odds/types';

/**
 * 赛前轻量拉取:把该场让球/大小球盘口拉进共享缓存(与详情页同键复用);
 * 复用 cached() 的 TTL 做窗口内去重;失败静默(降级到只用已有 1X2)。
 */
export async function ensureMatchMarkets(
  home: string,
  away: string,
  commenceTime: string,
): Promise<void> {
  const snap = getCached<{ matches: MatchOdds[] }>('odds:matches');
  const mo = snap
    ? findMatch(snap.matches, home, away, commenceTime)
    : undefined;
  if (!mo) return;
  try {
    await cached(`odds:markets:${mo.id}:handicap`, ODDS_TTL_MS, () =>
      theOddsApiProvider.getMatchMarkets(mo.id),
    );
  } catch (e) {
    console.error('[paper] 赛前拉取盘口失败', mo.id, e);
  }
}

interface BuildParams {
  home: string;
  away: string;
  commenceTime: string;
  matrix: number[][];
  mw: { home: number; draw: number; away: number }; // 市场无关 1X2
}

export function buildCandidates(params: BuildParams): BetCandidate[] {
  const { home, away, commenceTime, matrix, mw } = params;
  const out: Omit<BetCandidate, 'ev' | 'kelly'>[] = [];

  const snap = getCached<{ matches: MatchOdds[] }>('odds:matches');
  const mo = snap
    ? findMatch(snap.matches, home, away, commenceTime)
    : undefined;
  if (!mo) return [];

  // ── 1X2(市场无关概率 vs 市场最优价)──
  if (mo.best.home)
    out.push({
      market: '1X2',
      selection: 'home',
      odds: mo.best.home.price,
      book: mo.best.home.bookmaker,
      pWin: mw.home,
      pPush: 0,
    });
  if (mo.best.draw)
    out.push({
      market: '1X2',
      selection: 'draw',
      odds: mo.best.draw.price,
      book: mo.best.draw.bookmaker,
      pWin: mw.draw,
      pPush: 0,
    });
  if (mo.best.away)
    out.push({
      market: '1X2',
      selection: 'away',
      odds: mo.best.away.price,
      book: mo.best.away.bookmaker,
      pWin: mw.away,
      pPush: 0,
    });

  // ── 大小球 / 亚盘(仅当该场盘口快照已缓存)──
  const mm = getCached<MatchMarkets>(`odds:markets:${mo.id}:handicap`);
  if (mm) {
    const homeNorm = normalizeTeam(mm.homeTeam);
    // 聚合各家最优价
    const ou = new Map<
      number,
      { over?: { p: number; b: string }; under?: { p: number; b: string } }
    >();
    const ah = new Map<
      string,
      { team: string; point: number; p: number; b: string }
    >();
    for (const bk of mm.bookmakers) {
      for (const tl of bk.totals ?? []) {
        const e = ou.get(tl.point) ?? {};
        const side = tl.type.toLowerCase().startsWith('o') ? 'over' : 'under';
        const cur = e[side];
        if (!cur || tl.price > cur.p) e[side] = { p: tl.price, b: bk.title };
        ou.set(tl.point, e);
      }
      for (const sp of bk.spreads ?? []) {
        const key = `${normalizeTeam(sp.team)}|${sp.point}`;
        const cur = ah.get(key);
        if (!cur || sp.price > cur.p)
          ah.set(key, {
            team: sp.team,
            point: sp.point,
            p: sp.price,
            b: bk.title,
          });
      }
    }
    // 大小球候选
    for (const [point, e] of ou) {
      const pr = projectOverUnder(matrix, point);
      if (e.over)
        out.push({
          market: 'OU',
          selection: 'Over',
          line: point,
          odds: e.over.p,
          book: e.over.b,
          pWin: pr.over,
          pPush: pr.push,
        });
      if (e.under)
        out.push({
          market: 'OU',
          selection: 'Under',
          line: point,
          odds: e.under.p,
          book: e.under.b,
          pWin: pr.under,
          pPush: pr.push,
        });
    }
    // 亚盘候选(让分施加于该队)
    for (const { team, point, p, b } of ah.values()) {
      const isHome = normalizeTeam(team) === homeNorm;
      const pr = isHome
        ? projectAsianHandicap(matrix, point)
        : projectAsianHandicap(matrix, -point);
      out.push({
        market: 'AH',
        selection: isHome ? 'home' : 'away',
        line: point,
        odds: p,
        book: b,
        pWin: isHome ? pr.homeCover : pr.awayCover,
        pPush: pr.push,
      });
    }
  }

  return out.map(scoreCandidate);
}
