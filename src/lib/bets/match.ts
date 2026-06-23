/**
 * 注单单腿 → 比赛 + 90' 比分 解析(Phase 9 自动结算第一步)。
 *
 * 数据源优先级:联赛赛果存档 → WC 赛果存档(+ESPN 90' 校正)→ ESPN 赛程窗口
 * → 遍历各联赛存档兜底。网络一律 try/catch,出错降级为 'pending'(下轮重试),
 * 绝不返回错值;对齐失败返回 'unmatched'(待人工绑定)。
 *
 * 【方向纠正】存档/ESPN 的比分是「赛事主客」视角,注单选项(home/away)是「注单主客」视角。
 * 两者可能相反(平台常把所跟的队列前)。resolveLeg **统一把比分转成注单视角**返回,
 * 否则 1X2/AH/DC/DNB 会判反(赢↔输)。orientScore 是这层纠正的纯函数,全量单测。
 *
 * 纯 helper(findResultByName / sameUtcDay / orientScore / leagueKeyOf)是对外契约,全量单测;
 * resolveLeg 的网络路径不做单测。
 */
import { normalizeTeam } from 'lib/match/normalize';
import { loadResults, loadLeagueResults } from 'lib/db/store';
import { getLeague, listLeagues } from 'lib/predict/leagues';
import { espnProvider } from 'lib/espn/espn';
import { regulationScore } from 'lib/trade/settle';
import { toCanonicalName } from './cnTeams';
import type { ResultMatch } from 'lib/predict/types';
import type { BetLeg, LegResolution } from './types';

/** ISO 转 UTC 日(YYYY-MM-DD);非法日期返回空串。 */
function utcDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** 两个日期是否落在 ±tolDays 天窗口内(按绝对时差比较)。 */
export function sameUtcDay(
  isoA: string,
  approxDate: string,
  tolDays = 1,
): boolean {
  const a = new Date(isoA).getTime();
  const b = new Date(approxDate).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  const dayMs = 86_400_000;
  return Math.abs(a - b) <= tolDays * dayMs;
}

/**
 * 把「赛事主客」比分转成「注单主客」视角(方向纠正)。
 * fixHomeNorm===legHomeNorm 表示同向(原样);否则注单主客与赛事相反,交换比分。
 */
export function orientScore(
  legHomeNorm: string,
  fixHomeNorm: string,
  homeGoals: number,
  awayGoals: number,
): { home: number; away: number } {
  return fixHomeNorm === legHomeNorm
    ? { home: homeGoals, away: awayGoals }
    : { home: awayGoals, away: homeGoals };
}

/**
 * 在赛果表里按归一化队名查一场比赛(纯函数)。
 * - 正向(主客一致)优先;否则反向(注单主客与存档相反)兜底。
 * - 给了 approxDate 时只取落在 ±1 天窗口内者,且在多candidate中取**时间最近**的一场
 *   (防同对阵两回合/背靠背友谊赛 ±2 天内误匹配)。
 * - **返回原样存档**(不交换比分);方向纠正由 resolveLeg/orientScore 负责。
 */
export function findResultByName(
  map: Record<string, ResultMatch>,
  homeName: string,
  awayName: string,
  approxDate?: string,
): ResultMatch | undefined {
  const nh = normalizeTeam(toCanonicalName(homeName));
  const na = normalizeTeam(toCanonicalName(awayName));
  if (!nh || !na) return undefined;
  const rows = Object.values(map);
  const within = (r: ResultMatch) =>
    !approxDate || sameUtcDay(r.date, approxDate, 1);
  const dist = (r: ResultMatch) =>
    approxDate
      ? Math.abs(new Date(r.date).getTime() - new Date(approxDate).getTime())
      : 0;
  const nearest = (cands: ResultMatch[]) =>
    cands.length
      ? cands.reduce((best, r) => (dist(r) < dist(best) ? r : best))
      : undefined;

  const fwd = nearest(
    rows.filter((r) => r.homeNorm === nh && r.awayNorm === na && within(r)),
  );
  if (fwd) return fwd;
  return nearest(
    rows.filter((r) => r.homeNorm === na && r.awayNorm === nh && within(r)),
  );
}

/**
 * leg.league 字符串 → 联赛存储 key(loadLeagueResults 用)。
 * 命中已注册联赛(epl/laliga/... 或其 comp 别名)返回其 .key;WC/未知/空 返回 undefined。
 */
export function leagueKeyOf(league?: string): string | undefined {
  if (!league) return undefined;
  const lg = getLeague(league.trim().toLowerCase());
  return lg ? lg.key : undefined;
}

/** YYYYMMDD(ESPN scoreboard dates 用);非法日期返回空串。 */
function compactDay(iso: string): string {
  return utcDay(iso).replace(/-/g, '');
}

/** ESPN summary → 90' 比分(赛事视角)+ 主队归一名;未完赛 'pending';出错→null。 */
interface SummaryScore {
  status: 'matched' | 'pending';
  matchId?: string;
  homeGoals?: number;
  awayGoals?: number;
  homeNorm?: string;
}
async function resolveViaSummary(eventId: string): Promise<SummaryScore | null> {
  try {
    const s = await espnProvider.getMatchSummary(eventId);
    if (!s) return null;
    if (s.status !== 'post' || s.homeScore == null || s.awayScore == null) {
      return { status: 'pending' };
    }
    const { home, away } = regulationScore(
      s.events,
      s.homeTeam,
      s.awayTeam,
      s.homeScore,
      s.awayScore,
    );
    return {
      status: 'matched',
      matchId: eventId,
      homeGoals: home,
      awayGoals: away,
      homeNorm: normalizeTeam(s.homeTeam),
    };
  } catch {
    return null; // 网络/解析失败:交给调用方降级
  }
}

/**
 * 单腿赛果解析。比分统一转成**注单主客视角**。网络失败一律降级 'pending'。
 */
export async function resolveLeg(leg: BetLeg): Promise<LegResolution> {
  const legHome = normalizeTeam(toCanonicalName(leg.homeName));
  const legAway = normalizeTeam(toCanonicalName(leg.awayName));

  const matchedFrom = (
    matchId: string,
    fixHomeNorm: string,
    gh: number,
    ga: number,
  ): LegResolution => {
    const { home, away } = orientScore(legHome, fixHomeNorm, gh, ga);
    return { status: 'matched', matchId, homeGoals: home, awayGoals: away };
  };

  // 1) 已注册联赛:联赛存档即 90' 比分,无需 ESPN 校正
  const key = leagueKeyOf(leg.league);
  if (key) {
    const hit = findResultByName(
      loadLeagueResults(key),
      leg.homeName,
      leg.awayName,
      leg.matchDate,
    );
    return hit
      ? matchedFrom(hit.eventId, hit.homeNorm, hit.homeGoals, hit.awayGoals)
      : { status: 'unmatched' };
  }

  // 2) WC(或未知):先查 WC 赛果存档 → ESPN 90' 校正
  const wcHit = findResultByName(
    loadResults(),
    leg.homeName,
    leg.awayName,
    leg.matchDate,
  );
  if (wcHit) {
    const via = await resolveViaSummary(wcHit.eventId);
    if (via?.status === 'matched')
      return matchedFrom(
        via.matchId as string,
        via.homeNorm as string,
        via.homeGoals as number,
        via.awayGoals as number,
      );
    if (via?.status === 'pending') return { status: 'pending' };
    // ESPN 失败:回退用存档比分(WC 存档为终分;作为兜底)
    return matchedFrom(
      wcHit.eventId,
      wcHit.homeNorm,
      wcHit.homeGoals,
      wcHit.awayGoals,
    );
  }

  // 3) WC 存档未命中:在 matchDate ±1 天窗口里查 ESPN 赛程
  if (leg.matchDate && legHome && legAway) {
    try {
      const dayMs = 86_400_000;
      const t = new Date(leg.matchDate).getTime();
      if (!Number.isNaN(t)) {
        const from = compactDay(new Date(t - dayMs).toISOString());
        const to = compactDay(new Date(t + dayMs).toISOString());
        if (from && to) {
          const board = await espnProvider.getScoreboard(`${from}-${to}`);
          const fixture = board.find((m) => {
            const h = normalizeTeam(m.homeTeam);
            const a = normalizeTeam(m.awayTeam);
            return (
              (h === legHome && a === legAway) ||
              (h === legAway && a === legHome)
            );
          });
          if (fixture) {
            if (fixture.status === 'post') {
              const via = await resolveViaSummary(fixture.id);
              if (via?.status === 'matched')
                return matchedFrom(
                  via.matchId as string,
                  via.homeNorm as string,
                  via.homeGoals as number,
                  via.awayGoals as number,
                );
              return { status: 'pending' }; // ESPN 详情暂失败:下轮重试
            }
            return { status: 'pending' }; // 尚未完赛
          }
        }
      }
    } catch {
      return { status: 'pending' }; // 网络失败:下轮重试,不误判
    }
  }

  // 4) 未知联赛兜底:遍历各联赛赛果存档
  for (const lg of listLeagues()) {
    const hit = findResultByName(
      loadLeagueResults(lg.key),
      leg.homeName,
      leg.awayName,
      leg.matchDate,
    );
    if (hit)
      return matchedFrom(hit.eventId, hit.homeNorm, hit.homeGoals, hit.awayGoals);
  }

  // 5) 全部落空:待人工绑定
  return { status: 'unmatched' };
}
