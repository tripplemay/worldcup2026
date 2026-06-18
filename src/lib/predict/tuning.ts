/**
 * 预测模型可调参数(集中管理)。
 * 默认值 = 当前行为(改动中性);env 可覆盖;回测端点经 ctx.tuning 临时扫描以经验定参。
 */
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// O1 进球阻尼:λ/μ 向联赛均值收缩(<1 抑制「强队×弱旅」的大比分高估;1=不变)。
export const GOAL_SHRINK = num(process.env.PREDICT_GOAL_SHRINK, 1.0);
// O2 平局校准:Dixon-Coles 低分相关 ρ(更负=更多平局/低分);Elo 平局基准缩放(>1=更多平局)。
export const DC_RHO = num(process.env.PREDICT_DC_RHO, -0.1);
export const ELO_DRAW_SCALE = num(process.env.PREDICT_ELO_DRAW_SCALE, 1.0);

/** 每场预测可选的调参覆盖(回测扫描用;生产留空走上面默认)。 */
export interface Tuning {
  goalShrink?: number;
  dcRho?: number;
  eloDrawScale?: number;
}
