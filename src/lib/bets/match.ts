/**
 * 注单单腿 → 比赛 + 90' 比分 解析(Phase 9 自动结算第一步)。
 *
 * 数据源优先级:联赛赛果存档 → WC 赛果存档(+ESPN 90' 校正)→ ESPN 赛程窗口
 * → 遍历各联赛存档兜底。网络一律 try/catch,出错降级为 'pending'(下轮重试),
 * 绝不返回错值;对齐失败返回 'unmatched'(待人工绑定)。
 *
 * 注意:本地赛果存档含多年历史,只有在注单提供了可解析日期时才允许用存档按队名命中;
 * 缺日期/无效日期的 WC 注单先查本届 ESPN 赛程,避免同队历史交锋(如 2024 0:0)被误结算。
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
import { resolveRegulationScore } from 'lib/match/regulationSnapshot';
import { pastRegulation } from 'lib/match/regulation';
import { toCanonicalName } from './cnTeams';
import type { ResultMatch } from 'lib/predict/types';
import type { ScheduleMatch } from 'lib/espn/types';
import {
  isMatchLeg,
  type MatchBetLeg,
  type BetSlip,
  type LegResolution,
} from './types';

/** ISO 转 UTC 日(YYYY-MM-DD);非法日期返回空串。 */
function utcDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** 注单日期是否足够可靠到可约束历史赛果表。 */
function hasUsableMatchDate(approxDate?: string): approxDate is string {
  if (!approxDate) return false;
  return !Number.isNaN(new Date(approxDate).getTime());
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

/** ESPN → 90' 比分(赛事视角)+ 主队归一名;未过 90'(或事件账不齐)'pending'。 */
interface SummaryScore {
  status: 'matched' | 'pending';
  matchId?: string;
  homeGoals?: number;
  awayGoals?: number;
  homeNorm?: string;
  htHome?: number; // 上半场比分(赛事视角;仅事件齐全时)
  htAway?: number;
}
/**
 * 统一走 90' 快照 resolver:淘汰赛过 90'(进入加时/点球)即可 matched,
 * 90' 口径盘不再等整场打完;网络失败/账不齐 → pending(cron/守望者重试)。
 */
async function resolveViaSummary(eventId: string): Promise<SummaryScore> {
  const r = await resolveRegulationScore(eventId);
  if (r.status !== 'matched') return { status: 'pending' };
  return {
    status: 'matched',
    matchId: eventId,
    homeGoals: r.homeGoals,
    awayGoals: r.awayGoals,
    homeNorm: r.homeNorm,
    htHome: r.htHome,
    htAway: r.htAway,
  };
}

/**
 * 单腿赛果解析。比分统一转成**注单主客视角**。网络失败一律降级 'pending'。
 */
export async function resolveLeg(leg: MatchBetLeg): Promise<LegResolution> {
  const legHome = normalizeTeam(toCanonicalName(leg.homeName));
  const legAway = normalizeTeam(toCanonicalName(leg.awayName));
  const hasDate = hasUsableMatchDate(leg.matchDate);

  const matchedFrom = (
    matchId: string,
    fixHomeNorm: string,
    gh: number,
    ga: number,
    kickoff?: string,
    htH?: number,
    htA?: number,
  ): LegResolution => {
    const { home, away } = orientScore(legHome, fixHomeNorm, gh, ga);
    const r: LegResolution = {
      status: 'matched',
      matchId,
      kickoff,
      homeGoals: home,
      awayGoals: away,
    };
    if (htH != null && htA != null) {
      const o = orientScore(legHome, fixHomeNorm, htH, htA);
      r.htHome = o.home;
      r.htAway = o.away;
    }
    return r;
  };

  // 1) 已注册联赛:联赛存档即 90' 比分,无需 ESPN 校正
  const key = leagueKeyOf(leg.league);
  if (key) {
    // 俱乐部联赛同队反复交手,缺日期时直接按历史存档命中风险过高。
    if (!hasDate) return { status: 'unmatched' };
    const hit = findResultByName(
      loadLeagueResults(key),
      leg.homeName,
      leg.awayName,
      leg.matchDate,
    );
    return hit
      ? matchedFrom(
          hit.eventId,
          hit.homeNorm,
          hit.homeGoals,
          hit.awayGoals,
          hit.date,
        )
      : { status: 'unmatched' };
  }

  // 2)+3) WC(或未知):经 ESPN 赛程按队名解析真实 90' 比分。
  //   关键:results.json 的 eventId 是 API-Football id,ESPN summary 无法据以解析,
  //   故存档(wcHit)只用来提供可靠日期,以及「非 WC 赛程比赛」的兜底终分 ——
  //   必须走 ESPN scoreboard 按队名拿正确 ESPN id,才能真正做 90' 校正。
  const wcHit = hasDate
    ? findResultByName(loadResults(), leg.homeName, leg.awayName, leg.matchDate)
    : undefined;
  if (legHome && legAway) {
    // wcHit 的日期最可靠(存档已对齐);否则用识别日期
    const kickoffHint = wcHit?.date ?? (hasDate ? leg.matchDate : undefined);
    try {
      const season = process.env.WC_SEASON ?? '2026';
      const findFixture = (board: ScheduleMatch[]) =>
        board.find((m) => {
          const h = normalizeTeam(m.homeTeam);
          const a = normalizeTeam(m.awayTeam);
          return (
            (h === legHome && a === legAway) || (h === legAway && a === legHome)
          );
        });
      // 有日期:先用 ±1 天窗口(可区分罕见的重复对阵);未命中再回退整届 WC 范围,
      // 容忍识别把年份/日期读错(如把 2026 读成 2025)而错判 unmatched。
      const dayMs = 86_400_000;
      const t = kickoffHint ? new Date(kickoffHint).getTime() : NaN;
      let fixture: ScheduleMatch | undefined;
      if (!Number.isNaN(t)) {
        const from = compactDay(new Date(t - dayMs).toISOString());
        const to = compactDay(new Date(t + dayMs).toISOString());
        fixture = findFixture(
          await espnProvider.getScoreboard(`${from}-${to}`),
        );
      }
      if (!fixture)
        fixture = findFixture(
          await espnProvider.getScoreboard(`${season}0611-${season}0719`),
        );
      if (fixture) {
        // 已过 90'(post 或加时/点球进行中)才拉 summary 解析 90' 比分;常规时间内不徒劳拉取
        if (fixture.status === 'post' || pastRegulation(fixture)) {
          const via = await resolveViaSummary(fixture.id);
          if (via.status === 'matched')
            return matchedFrom(
              via.matchId as string,
              via.homeNorm as string,
              via.homeGoals as number,
              via.awayGoals as number,
              fixture.commenceTime,
              via.htHome,
              via.htAway,
            );
        }
        // 未过 90'(进行中/未开)或 90' 快照未就绪 → pending 重试
        return {
          status: 'pending',
          matchId: fixture.id,
          kickoff: fixture.commenceTime,
        };
      }
      // scoreboard 成功但 WC 赛程无此场 = 非 WC 比赛(WC 球队友谊赛/预选赛被 getRecentFixtures
      // 摄进 results.json)→ 必非淘汰赛,存档终分即 90' 比分,用它兜底结算(恢复旧行为)。
      if (wcHit)
        return matchedFrom(
          wcHit.eventId,
          wcHit.homeNorm,
          wcHit.homeGoals,
          wcHit.awayGoals,
          wcHit.date,
        );
    } catch {
      // 网络失败:无法确认是否淘汰赛(存档终分可能含加时)→ pending 重试,不冒错结风险
      return wcHit
        ? { status: 'pending', matchId: wcHit.eventId, kickoff: wcHit.date }
        : { status: 'pending' };
    }
  }

  // 4) 未知联赛兜底:遍历各联赛赛果存档
  if (hasDate) {
    for (const lg of listLeagues()) {
      const hit = findResultByName(
        loadLeagueResults(lg.key),
        leg.homeName,
        leg.awayName,
        leg.matchDate,
      );
      if (hit)
        return matchedFrom(
          hit.eventId,
          hit.homeNorm,
          hit.homeGoals,
          hit.awayGoals,
          hit.date,
        );
    }
  }

  // 5) 全部落空:待人工绑定
  return { status: 'unmatched' };
}

/**
 * 入库时回填各腿 matchId/kickoff(仅取开赛时间,不结算),
 * 让注单上的「比赛时间(UTC+8)」立刻可显示(否则要等结算扫描才回填)。
 * 单腿失败静默跳过,绝不阻断入库;只补 kickoff,不动比分/结果。
 */
export async function backfillLegKickoffs(slip: BetSlip): Promise<void> {
  for (const leg of slip.legs) {
    if (!isMatchLeg(leg)) continue;
    try {
      const r = await resolveLeg(leg);
      if (r.matchId && !leg.matchId) leg.matchId = r.matchId;
      if (r.kickoff) leg.kickoff = r.kickoff;
    } catch {
      /* 单腿对齐失败 → 保留识别 matchDate,显示层自动回退 */
    }
  }
}
