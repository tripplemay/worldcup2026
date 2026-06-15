/**
 * 预测模型框架(可插拔,为未来交叉预测铺路)。
 * 每个模型实现 PredictionModel 接口并注册;预测页按模型逐行/逐列渲染,
 * 多模型时自动得到交叉对比 + 共识。统一输出 MatchPrediction。
 */
import type { TeamRating } from './types';

/** 一个赛果比分及其概率(如 "2-1" → 0.10)。 */
export interface ScoreProb {
  score: string;
  p: number;
}

/** 单模型对一场比赛的预测输出(统一结构)。 */
export interface MatchPrediction {
  modelId: string;
  matchId: string;
  homeWin: number; // 概率 0~1
  draw: number;
  awayWin: number;
  xgHome: number; // 本场预期进球 λ
  xgAway: number; // μ
  topScores: ScoreProb[]; // 最可能比分(降序,取前几)
  over25: number; // 大 2.5 球概率
  under25: number;
  btts: number; // 双方进球概率
  confidence: 'low' | 'medium' | 'high'; // 样本充足度
}

/** 预测上下文:比赛基本信息 + 数据访问器(模型按需取用)。 */
export interface PredictionContext {
  matchId: string;
  homeName: string;
  awayName: string;
  homeNorm: string; // 归一化队名
  awayNorm: string;
  neutral: boolean; // 中立场地(世界杯多数为是)
  /** 取球队评分(EWMA 结果);未收录返回 undefined。 */
  rating: (norm: string) => TeamRating | undefined;
}

/** 可插拔预测模型。 */
export interface PredictionModel {
  id: string; // 唯一标识(如 'poisson-xg')
  nameKey: string; // i18n 键(如 'predict.modelPoisson')
  /** 给定上下文产出预测;数据不足返回 null。 */
  predict(ctx: PredictionContext): MatchPrediction | null;
}
