/**
 * 预测模型框架(可插拔,为未来交叉预测铺路)。
 * 每个模型实现 PredictionModel 接口并注册;预测页按模型逐行/逐列渲染,
 * 多模型时自动得到交叉对比 + 共识。统一输出 MatchPrediction。
 */
import type { TeamRating } from './types';
import type { Tuning } from './tuning';

/** 一个赛果比分及其概率(如 "2-1" → 0.10)。 */
export interface ScoreProb {
  score: string;
  p: number;
}

/** 单模型对一场比赛的预测输出(统一结构)。
 * 胜平负 + 置信度为通用必填;进球类细节(xG/比分/大小球)仅泊松等模型产出,可选。 */
export interface MatchPrediction {
  modelId: string;
  matchId: string;
  homeWin: number; // 概率 0~1
  draw: number;
  awayWin: number;
  confidence: 'low' | 'medium' | 'high'; // 样本充足度
  xgHome?: number; // 本场预期进球 λ(仅泊松)
  xgAway?: number; // μ
  topScores?: ScoreProb[]; // 最可能比分(降序,取前几)
  over25?: number; // 大 2.5 球概率
  under25?: number;
  btts?: number; // 双方进球概率
}

/** 预测上下文:比赛基本信息 + 数据访问器(模型按需取用)。 */
export interface PredictionContext {
  matchId: string;
  homeName: string;
  awayName: string;
  homeNorm: string; // 归一化队名
  awayNorm: string;
  neutral: boolean; // 中立场地(世界杯多数为是)
  homeAdvantage: number; // Elo 主场优势分 H(中立 0;美加墨主场 +100,客方为东道主则 −100)
  leagueAvg: number; // 联赛基准:全体球队场均 xG 均值(xG 泊松归一化用)
  leagueAvgGoals: number; // 联赛基准:全体球队场均实际进球均值(进球泊松归一化用)
  /** 该场各家最优 h2h 赔率(市场隐含模型用;缺失则该模型跳过)。 */
  marketOdds?: { home?: number; draw?: number; away?: number };
  /** 取球队 xG 评分(EWMA);未收录返回 undefined。 */
  rating: (norm: string) => TeamRating | undefined;
  /** 取球队权威 Elo(eloratings.net,覆盖全部队);未收录返回 undefined。 */
  eloOf: (norm: string) => number | undefined;
  /** 可选调参覆盖(回测扫描用;生产留空走默认)。 */
  tuning?: Tuning;
}

/** 可插拔预测模型。 */
export interface PredictionModel {
  id: string; // 唯一标识(如 'poisson-xg')
  nameKey: string; // i18n 键(如 'predict.modelPoisson')
  /** 给定上下文产出预测;数据不足返回 null。 */
  predict(ctx: PredictionContext): MatchPrediction | null;
}
