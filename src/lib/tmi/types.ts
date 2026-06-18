/**
 * TMI(杯赛状态动能 / Tournament Momentum Index)领域类型。
 * 一个独立的「球队状态强弱排行榜」指标,仅供观测参考,不进入胜率预测公式。
 */

/** 单队裸数据(供研究员核对 API 数据准确性)。 */
export interface TmiRawStats {
  matchesPlayed: number; // 杯赛已踢场次(开赛日后)
  shadowEloDiff: number; // 影子 Elo 净变化 = 自算Elo(全部) − 自算Elo(开赛日前)
  xgMomentumPerMatch: number; // 场均 xG 净胜(杯赛;样本不足回退近期 EWMA)
  restDays: number | null; // 距上一场比赛天数(无记录为 null)
}

/** 单队归一化得分(各因子 [-1,1],体能为 ≤0 的惩罚)。 */
export interface TmiNormalized {
  mentalScore: number; // 士气分:shadowEloDiff 归一
  tacticalScore: number; // 战术分:xg 动能归一
  fatiguePenalty: number; // 体能惩罚:休息天数驱动
}

/** 单队 TMI 完整记录。 */
export interface TeamTmi {
  teamId: string; // 归一化队名(key)
  teamName: string; // 展示名
  raw: TmiRawStats;
  normalized: TmiNormalized;
  total: number; // 综合动能分 [-1,1]
  xgSource: 'cup' | 'season'; // xG 口径:杯赛 / 全局 EWMA 回退
}

/** 观测台快照。 */
export interface TmiSnapshot {
  lastUpdated: string; // ISO
  wcStart: string; // 开赛日 cutoff(YYYY-MM-DD)
  teams: TeamTmi[]; // 按 total 降序
}
