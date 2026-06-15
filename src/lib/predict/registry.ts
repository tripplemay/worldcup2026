/**
 * 预测模型注册表。
 * 新模型实现 PredictionModel 后在此注册即可被预测页/接口自动纳入(交叉预测)。
 * Phase 1 暂为空;Phase 2 注册 PoissonXgModel。
 */
import type { PredictionModel } from './model';

const models: PredictionModel[] = [];

export function registerModel(model: PredictionModel): void {
  if (!models.some((m) => m.id === model.id)) models.push(model);
}

export function getModels(): PredictionModel[] {
  return models;
}

export function getModel(id: string): PredictionModel | undefined {
  return models.find((m) => m.id === id);
}
