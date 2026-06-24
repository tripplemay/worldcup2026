/**
 * 脱 feed 的单对阵预测(供「沙盘」Monte-Carlo 模拟用)。
 *
 * 复用注册的预测模型 + 融合,但:数据预加载后注入(评分 + 权威 Elo),不碰 ESPN/赔率 feed;
 * 不接市场模型(模拟海量假想对阵,无赛前赔率且要省 The Odds API 配额)→ 融合退化为
 * 泊松 + Elo(与 walk-forward 回测同口径)。给两个归一化队名即得胜平负 + λ/μ + 比分分布。
 */
import { getModels } from './registry';
import { ensemble } from './ensemble';
import './models'; // 副作用:注册所有模型
import type { MatchPrediction, PredictionContext } from './model';
import type { TeamRating } from './types';

export interface PairContext {
  ratings: Record<string, TeamRating>;
  eloMap: Record<string, number>;
  leagueAvg: number;
  leagueAvgGoals: number;
  /** 中立场(默认 true,世界杯多数为是)。 */
  neutral?: boolean;
  /** 主队 Elo 主场优势分(东道主在本国 +100;默认 0)。 */
  homeAdvantage?: number;
  /** 主队泊松进球乘子(默认 1=中立)。 */
  homeGoalMult?: number;
}

/** 由评分表算联赛基准(全体场均 xG / 实际进球均值)。 */
export function leagueAverages(ratings: Record<string, TeamRating>): {
  leagueAvg: number;
  leagueAvgGoals: number;
} {
  const vals = Object.values(ratings);
  if (!vals.length) return { leagueAvg: 1.35, leagueAvgGoals: 1.35 };
  const mean = (sel: (r: TeamRating) => number) =>
    Math.max(0.6, vals.reduce((s, r) => s + sel(r), 0) / vals.length);
  return {
    leagueAvg: mean((r) => r.xgFor),
    leagueAvgGoals: mean((r) => r.goalsFor),
  };
}

/**
 * 预测一对球队(归一化名)的融合胜平负 + 进球分布。
 * 评分/Elo 缺失致所有模型弃权时返回 null(调用方应有兜底)。
 */
export function predictPair(
  homeNorm: string,
  awayNorm: string,
  c: PairContext,
): MatchPrediction | null {
  const ha = c.homeAdvantage ?? 0;
  const ctx: PredictionContext = {
    matchId: 'sim',
    homeName: homeNorm,
    awayName: awayNorm,
    homeNorm,
    awayNorm,
    neutral: c.neutral ?? ha === 0,
    homeAdvantage: ha,
    homeGoalMult: c.homeGoalMult ?? 1,
    leagueAvg: c.leagueAvg,
    leagueAvgGoals: c.leagueAvgGoals,
    marketOdds: undefined, // 不接市场(省配额 + 假想对阵无赔率)
    rating: (n) => c.ratings[n],
    eloOf: (n) => c.eloMap[n],
  };
  const preds = getModels()
    .map((m) => m.predict(ctx))
    .filter((p): p is MatchPrediction => p !== null);
  const eh = c.eloMap[homeNorm];
  const ea = c.eloMap[awayNorm];
  const eloDiff =
    Number.isFinite(eh) && Number.isFinite(ea) ? Math.abs(eh - ea) : undefined;
  return ensemble(preds, 'sim', eloDiff);
}
