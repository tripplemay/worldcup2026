/**
 * 预测模型可调参数(集中管理)。
 * 默认值 = 当前行为(改动中性);env 可覆盖;回测端点经 ctx.tuning 临时扫描以经验定参。
 */
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// O1 进球阻尼:λ/μ 向联赛均值收缩(<1 抑制「强队×弱旅」的大比分高估)。
// 0.6 由 24 场 walk-forward 回测定参:场均预测进球 3.94→3.36(实 3.21),保守不过拟合。
export const GOAL_SHRINK = num(process.env.PREDICT_GOAL_SHRINK, 0.6);
// O2 平局校准:Dixon-Coles ρ(更负=更多平局/低分);Elo 平局基准缩放(>1=更多平局)。
// rho -0.18 + drawscale 1.5:平均预测平局 22%→28%(校准到合理基准,不追本届 33% 异常);
// Brier 0.59→0.577、LogLoss 0.987→0.948,1X2 命中率不变。
export const DC_RHO = num(process.env.PREDICT_DC_RHO, -0.18);
export const ELO_DRAW_SCALE = num(process.env.PREDICT_ELO_DRAW_SCALE, 1.5);

/** 每场预测可选的调参覆盖(回测扫描用;生产留空走上面默认)。 */
export interface Tuning {
  goalShrink?: number;
  dcRho?: number;
  eloDrawScale?: number;
}
