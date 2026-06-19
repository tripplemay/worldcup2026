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
// 已正则化向先验收:rho -0.14 + drawscale 1.2(原 -0.18/1.5 是按虚高且在回归的本届平局率
// ~40%调的,有过拟合风险——回测显示 Brier 随 drawscale 一路降到 2.0+ 无稳定最优=在追基准率)。
// 现值取温和加成:Brier 0.578→0.571、LogLoss 0.97→0.951,drawPicked 仍为 0、命中/大小球不变;
// 若平局率回归到历史 ~26% 也不反噬。小组赛后(~6/27)样本翻倍再用 /backtest?detail=1 复评。
export const DC_RHO = num(process.env.PREDICT_DC_RHO, -0.14);
export const ELO_DRAW_SCALE = num(process.env.PREDICT_ELO_DRAW_SCALE, 1.2);

/** 每场预测可选的调参覆盖(回测扫描用;生产留空走上面默认)。 */
export interface Tuning {
  goalShrink?: number;
  dcRho?: number;
  eloDrawScale?: number;
}
