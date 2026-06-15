/**
 * 预测系统领域类型。
 * 历史比赛(含洗出的单场 xG)+ 球队动态评分(EWMA 结果)。
 */

/** 一场历史比赛的射门/进球数据 + 洗出的单场 xG(按 event 唯一)。 */
export interface HistMatch {
  eventId: string;
  date: string; // ISO
  homeName: string;
  awayName: string;
  homeNorm: string; // 归一化队名(对齐用)
  awayNorm: string;
  homeGoals: number;
  awayGoals: number;
  homeSoT: number; // 射正
  homeShots: number; // 总射门
  awaySoT: number;
  awayShots: number;
  homeXg: number; // 该队本场创造 xG = SoT×0.3 + (总射门−SoT)×0.05
  awayXg: number;
}

/** 球队动态评分(近期比赛 EWMA 结果);按归一化队名索引。 */
export interface TeamRating {
  norm: string; // 归一化队名(key)
  name: string; // 展示名
  xgFor: number; // 场均创造 xG(进攻)
  xgAgainst: number; // 场均丢失 xG(防守)
  goalsFor: number; // 场均进球(实际)
  goalsAgainst: number;
  sample: number; // 参与计算的场数
  updatedAt: number;
}
