/**
 * TMI 引擎:用一套固定基准权重,把现有的赛果/射门/评分数据合成「杯赛状态动能」排行榜。
 *
 * 三因子(全部来自现有 JSON,零新增 API 调用):
 *  · 士气(Elo):影子 Elo 净变化 = 自算Elo(全部赛果) − 自算Elo(开赛日前赛果)。只看杯赛期间的涨跌。
 *  · 战术(xG):杯赛场均 xG 净胜;杯赛样本 < 2 时回退近期全局 EWMA(ratings.json)。
 *  · 体能(休息天数):距上一场比赛 ≤3 天触发惩罚(代理指标,免拉阵容 API)。
 *
 * 该分数独立于胜率预测(ensemble),仅供观测/看盘参考。
 */
import { computeElo, type GameLike } from 'lib/predict/ratings';
import { loadResults, loadHistorical, loadRatings } from 'lib/db/store';
import type { HistMatch, ResultMatch, TeamRating } from 'lib/predict/types';
import type { TeamTmi, TmiSnapshot } from './types';
import {
  WEIGHT_ELO,
  WEIGHT_XG,
  ELO_FULL_SCALE,
  XG_FULL_SCALE,
  REST_THRESHOLD,
  FATIGUE_STEP,
  ELO_START,
  DEFAULT_WC_START,
} from './constants';

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));
const dateKey = (iso: string) => iso.slice(0, 10); // ISO → YYYY-MM-DD

/** 三因子归一化 + 加权合成总分(纯函数,供前后端/测试复用)。 */
export function normalizeScores(
  shadowEloDiff: number,
  xgMomentumPerMatch: number,
  restDays: number | null,
): {
  mentalScore: number;
  tacticalScore: number;
  fatiguePenalty: number;
  total: number;
} {
  const mentalScore = clamp1(shadowEloDiff / ELO_FULL_SCALE);
  const tacticalScore = clamp1(xgMomentumPerMatch / XG_FULL_SCALE);
  const fatiguePenalty =
    restDays != null && restDays <= REST_THRESHOLD
      ? -((REST_THRESHOLD + 1 - restDays) * FATIGUE_STEP)
      : 0;
  const total = clamp1(
    WEIGHT_ELO * mentalScore + WEIGHT_XG * tacticalScore + fatiguePenalty,
  );
  return { mentalScore, tacticalScore, fatiguePenalty, total };
}

interface TmiInput {
  results: Record<string, ResultMatch>;
  historical: Record<string, HistMatch>;
  ratings: Record<string, TeamRating>;
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
  const { results, historical, ratings } = input;
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

  // 杯赛 xG 净胜累计(开赛日后有射门数据的场次)
  const cupXgSum = new Map<string, number>();
  const cupXgN = new Map<string, number>();
  const addXg = (team: string, diff: number) => {
    cupXgSum.set(team, (cupXgSum.get(team) ?? 0) + diff);
    cupXgN.set(team, (cupXgN.get(team) ?? 0) + 1);
  };
  for (const h of Object.values(historical)) {
    if (dateKey(h.date) < wcStart) continue;
    addXg(h.homeNorm, h.homeXg - h.awayXg);
    addXg(h.awayNorm, h.awayXg - h.homeXg);
  }

  const teams: TeamTmi[] = [];
  for (const t of participants) {
    const shadowEloDiff = +(
      (eloAll.get(t) ?? ELO_START) - (eloBase.get(t) ?? ELO_START)
    ).toFixed(1);

    // xG 动能:杯赛样本 ≥2 用杯赛口径,否则回退近期全局 EWMA
    const n = cupXgN.get(t) ?? 0;
    const r = ratings[t];
    let xgMomentum: number;
    let xgSource: 'cup' | 'season';
    if (n >= 2) {
      xgMomentum = +((cupXgSum.get(t) ?? 0) / n).toFixed(3);
      xgSource = 'cup';
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

    const { mentalScore, tacticalScore, fatiguePenalty, total } =
      normalizeScores(shadowEloDiff, xgMomentum, restDays);

    teams.push({
      teamId: t,
      teamName: r?.name ?? t,
      raw: {
        matchesPlayed: cupCount.get(t) ?? 0,
        shadowEloDiff,
        xgMomentumPerMatch: xgMomentum,
        restDays,
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

/** 读取 JSON 存储并计算 TMI 快照(供 API 路由调用)。 */
export function loadTmiSnapshot(): TmiSnapshot {
  const wcStart = process.env.WC_START?.trim() || DEFAULT_WC_START;
  return computeTmi(
    {
      results: loadResults(),
      historical: loadHistorical(),
      ratings: loadRatings(),
    },
    { wcStart, now: Date.now() },
  );
}
