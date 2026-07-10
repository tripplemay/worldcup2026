/**
 * TMI 引擎:用一套固定基准权重,把现有的赛果/射门/评分数据合成「杯赛状态动能」排行榜。
 *
 * 三因子(全部来自现有 JSON,零新增 API 调用):
 *  · 士气(Elo):影子 Elo 净变化 = 自算Elo(全部赛果) − 自算Elo(开赛日前赛果)。只看杯赛期间的涨跌。
 *  · 战术(xG):杯赛场均 xG 净胜 + 对手强度校正(对手基线 Elo 相对参赛队均值,
 *    /XG_SOS_ELO_SCALE 折算 xG 当量 —— 对弱旅刷 xG 不再等价于对强队打出内容);
 *    杯赛样本 < 2 时回退近期全局 EWMA(ratings.json,不做校正:赛季口径对手已平均化)。
 *  · 体能:核心 13 人近 8 天累计分钟按【年龄加权】折算负荷(30+ 恢复更慢),缺分钟
 *    数据回退休息天数;另加【旅途惩罚】(最近两场场馆大圆距离 + 跨时区数,2026 美加墨
 *    特有的体能变量);合并封顶 −0.6。
 *
 * 该分数独立于胜率预测(ensemble),仅供观测/看盘参考。
 */
import { computeElo, type GameLike } from 'lib/predict/ratings';
import {
  loadResults,
  loadHistorical,
  loadRatings,
  loadPlayerMinutes,
  type PlayerMinutesStore,
} from 'lib/db/store';
import { coreLoad } from 'lib/predict/playerMinutes';
import { lookupWcVenue, haversineKm } from 'lib/data/venues2026';
import type { HistMatch, ResultMatch, TeamRating } from 'lib/predict/types';
import type { TeamTmi, TmiSnapshot } from './types';
import {
  WEIGHT_ELO,
  WEIGHT_XG,
  ELO_FULL_SCALE,
  XG_FULL_SCALE,
  REST_THRESHOLD,
  FATIGUE_STEP,
  FATIGUE_FLOOR,
  ELO_START,
  DEFAULT_WC_START,
  XG_SOS_ELO_SCALE,
  TRAVEL_KM_STEP,
  TRAVEL_TZ_STEP,
  TRAVEL_MAX_PENALTY,
  TRAVEL_RECENT_DAYS,
} from './constants';

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));
const dateKey = (iso: string) => iso.slice(0, 10); // ISO → YYYY-MM-DD

/** 休息天数 → 体能惩罚(回退口径:无真实分钟数据时用)。 */
export function restDaysFatigue(restDays: number | null): number {
  return restDays != null && restDays <= REST_THRESHOLD
    ? -((REST_THRESHOLD + 1 - restDays) * FATIGUE_STEP)
    : 0;
}

/** 三因子归一化 + 加权合成总分(纯函数;fatiguePenalty 由调用方决定来源)。 */
export function normalizeScores(
  shadowEloDiff: number,
  xgMomentumPerMatch: number,
  fatiguePenalty: number,
): {
  mentalScore: number;
  tacticalScore: number;
  fatiguePenalty: number;
  total: number;
} {
  const mentalScore = clamp1(shadowEloDiff / ELO_FULL_SCALE);
  const tacticalScore = clamp1(xgMomentumPerMatch / XG_FULL_SCALE);
  const total = clamp1(
    WEIGHT_ELO * mentalScore + WEIGHT_XG * tacticalScore + fatiguePenalty,
  );
  return { mentalScore, tacticalScore, fatiguePenalty, total };
}

interface TmiInput {
  results: Record<string, ResultMatch>;
  historical: Record<string, HistMatch>;
  ratings: Record<string, TeamRating>;
  playerMinutes?: PlayerMinutesStore; // 真实分钟(体能);缺省回退休息天数
}

interface TmiOpts {
  wcStart: string; // YYYY-MM-DD cutoff(含当天)
  now: number; // 当前时间(ms),用于算休息天数
}

const DAY = 86_400_000;

/**
 * 计算 TMI 快照(纯函数,不触碰文件系统)。
 * 参赛队 = 在开赛日后赛果中出现过的球队(已登场才有动能);按总分降序。
 */
export function computeTmi(input: TmiInput, opts: TmiOpts): TmiSnapshot {
  const { results, historical, ratings, playerMinutes } = input;
  const { wcStart, now } = opts;
  const allGames: GameLike[] = Object.values(results);

  // 影子 Elo:全部赛果 vs 仅开赛日前赛果,同一把自算尺,差值即杯赛期间净变化
  const eloAll = computeElo(allGames);
  const eloBase = computeElo(allGames.filter((g) => dateKey(g.date) < wcStart));

  // 每队:最近一场日期(全部赛果,算休息天数)+ 杯赛场次计数
  const lastMatch = new Map<string, string>();
  const cupCount = new Map<string, number>();
  const bumpLast = (team: string, date: string) => {
    const cur = lastMatch.get(team);
    if (!cur || date > cur) lastMatch.set(team, date);
  };
  const participants = new Set<string>();
  for (const g of allGames) {
    bumpLast(g.homeNorm, g.date);
    bumpLast(g.awayNorm, g.date);
    if (dateKey(g.date) >= wcStart) {
      participants.add(g.homeNorm);
      participants.add(g.awayNorm);
      cupCount.set(g.homeNorm, (cupCount.get(g.homeNorm) ?? 0) + 1);
      cupCount.set(g.awayNorm, (cupCount.get(g.awayNorm) ?? 0) + 1);
    }
  }

  // 参赛队基线 Elo 均值(对手强度校正的零点:对手强于/弱于"平均参赛队"多少)
  const baseEloOf = (t: string) => eloBase.get(t) ?? ELO_START;
  let fieldEloSum = 0;
  for (const t of participants) fieldEloSum += baseEloOf(t);
  const fieldMeanElo = participants.size
    ? fieldEloSum / participants.size
    : ELO_START;

  // 杯赛 xG 净胜累计(开赛日后有射门数据的场次)+ 对手基线 Elo 累计(强度校正用)
  const cupXgSum = new Map<string, number>();
  const cupXgN = new Map<string, number>();
  const cupOppEloSum = new Map<string, number>();
  const addXg = (team: string, diff: number, opp: string) => {
    cupXgSum.set(team, (cupXgSum.get(team) ?? 0) + diff);
    cupXgN.set(team, (cupXgN.get(team) ?? 0) + 1);
    cupOppEloSum.set(team, (cupOppEloSum.get(team) ?? 0) + baseEloOf(opp));
  };
  for (const h of Object.values(historical)) {
    if (dateKey(h.date) < wcStart) continue;
    addXg(h.homeNorm, h.homeXg - h.awayXg, h.awayNorm);
    addXg(h.awayNorm, h.awayXg - h.homeXg, h.homeNorm);
  }

  // 每队杯赛比赛的场馆城市序列(按日期升序;旅途惩罚 = 最近两场场馆距离+跨时区)
  const cupVenues = new Map<string, { date: string; city: string }[]>();
  for (const g of Object.values(results)) {
    if (dateKey(g.date) < wcStart || !g.venueCity) continue;
    for (const t of [g.homeNorm, g.awayNorm]) {
      const list = cupVenues.get(t) ?? [];
      list.push({ date: g.date, city: g.venueCity });
      cupVenues.set(t, list);
    }
  }

  const teams: TeamTmi[] = [];
  for (const t of participants) {
    const shadowEloDiff = +(
      (eloAll.get(t) ?? ELO_START) - (eloBase.get(t) ?? ELO_START)
    ).toFixed(1);

    // xG 动能:杯赛样本 ≥2 用杯赛口径 + 对手强度校正,否则回退近期全局 EWMA(不校正)
    const n = cupXgN.get(t) ?? 0;
    const r = ratings[t];
    let xgMomentum: number;
    let xgSource: 'cup' | 'season';
    let avgOppElo: number | undefined;
    let oppAdjPerMatch: number | undefined;
    if (n >= 2) {
      xgMomentum = +((cupXgSum.get(t) ?? 0) / n).toFixed(3);
      xgSource = 'cup';
      // 对手强度校正:对手基线 Elo 高于参赛队均值 → 正向补偿(对强队打出的内容更值钱)
      avgOppElo = +((cupOppEloSum.get(t) ?? 0) / n).toFixed(0);
      oppAdjPerMatch = +((avgOppElo - fieldMeanElo) / XG_SOS_ELO_SCALE).toFixed(
        3,
      );
    } else if (r) {
      xgMomentum = +(r.xgFor - r.xgAgainst).toFixed(3);
      xgSource = 'season';
    } else {
      xgMomentum = 0;
      xgSource = 'season';
    }

    const last = lastMatch.get(t);
    const restDays = last
      ? Math.max(0, Math.floor((now - Date.parse(last)) / DAY))
      : null;

    // 体能①负荷:优先真实「核心 13 人近期累计分钟」(年龄加权),缺失回退休息天数
    const pm = playerMinutes?.teams[t];
    const load = pm
      ? coreLoad(pm.matches, now, playerMinutes?.ages)
      : { penalty: null, coreAvgAge: null };
    const basePenalty =
      load.penalty != null ? load.penalty : restDaysFatigue(restDays);

    // 体能②旅途:最近两场场馆的大圆距离 + 跨时区(城市可识别且距上一场 ≤7 天才计)
    let travelKm: number | undefined;
    let travelTz: number | undefined;
    let travelPenalty = 0;
    const venues = (cupVenues.get(t) ?? []).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    if (
      venues.length >= 2 &&
      restDays != null &&
      restDays <= TRAVEL_RECENT_DAYS
    ) {
      const from = lookupWcVenue(venues[venues.length - 2].city);
      const to = lookupWcVenue(venues[venues.length - 1].city);
      if (from && to && from.key !== to.key) {
        travelKm = haversineKm(from, to);
        travelTz = Math.abs(from.tz - to.tz);
        travelPenalty = -Math.min(
          TRAVEL_MAX_PENALTY,
          (travelKm / 1000) * TRAVEL_KM_STEP + travelTz * TRAVEL_TZ_STEP,
        );
      }
    }
    const fatigue = Math.max(FATIGUE_FLOOR, basePenalty + travelPenalty);

    const { mentalScore, tacticalScore, fatiguePenalty, total } =
      normalizeScores(shadowEloDiff, xgMomentum + (oppAdjPerMatch ?? 0), fatigue);

    teams.push({
      teamId: t,
      teamName: r?.name ?? t,
      raw: {
        matchesPlayed: cupCount.get(t) ?? 0,
        shadowEloDiff,
        xgMomentumPerMatch: xgMomentum,
        restDays,
        ...(avgOppElo != null ? { avgOppElo } : {}),
        ...(oppAdjPerMatch != null ? { oppAdjPerMatch } : {}),
        ...(travelKm != null ? { travelKm, travelTz } : {}),
        ...(load.coreAvgAge != null ? { coreAvgAge: load.coreAvgAge } : {}),
      },
      normalized: { mentalScore, tacticalScore, fatiguePenalty },
      total,
      xgSource,
    });
  }

  teams.sort((a, b) => b.total - a.total);
  return {
    lastUpdated: new Date(now).toISOString(),
    wcStart,
    teams,
  };
}

/**
 * 点位截断(回测用):把输入数据裁到 asOf 时刻之前(严格 <,当场比赛不入内),
 * 与 now=asOf 搭配即可还原「那一刻的动能榜」。纯函数。
 * 诚实注记:ratings(赛季回退口径,仅杯赛 xG 样本 <2 的队会用到)无点位历史,
 * 仍用当前值 —— 杯赛中后期几乎不触发,触发时该队会标「(赛季)」提示口径。
 */
export function sliceTmiInput(input: TmiInput, asOfMs: number): TmiInput {
  const before = (d: string) => Date.parse(d) < asOfMs;
  const pm = input.playerMinutes;
  return {
    results: Object.fromEntries(
      Object.entries(input.results).filter(([, r]) => before(r.date)),
    ),
    historical: Object.fromEntries(
      Object.entries(input.historical).filter(([, h]) => before(h.date)),
    ),
    ratings: input.ratings,
    ...(pm
      ? {
          playerMinutes: {
            ...pm,
            teams: Object.fromEntries(
              Object.entries(pm.teams).map(([t, rec]) => [
                t,
                { matches: rec.matches.filter((m) => before(m.date)) },
              ]),
            ),
          },
        }
      : {}),
  };
}

/** 读取 JSON 存储并计算 TMI 快照(供 API 路由调用);asOf 传 ISO 时刻则做点位回测。 */
export function loadTmiSnapshot(asOf?: string): TmiSnapshot {
  const wcStart = process.env.WC_START?.trim() || DEFAULT_WC_START;
  const input: TmiInput = {
    results: loadResults(),
    historical: loadHistorical(),
    ratings: loadRatings(),
    playerMinutes: loadPlayerMinutes(),
  };
  const asOfMs = asOf ? Date.parse(asOf) : NaN;
  if (Number.isFinite(asOfMs))
    return computeTmi(sliceTmiInput(input, asOfMs), { wcStart, now: asOfMs });
  return computeTmi(input, { wcStart, now: Date.now() });
}
