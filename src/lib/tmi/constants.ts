/**
 * TMI 固定基准权重与归一化标尺(纯常量,客户端/服务端共用,无 Node 依赖)。
 */
export const WEIGHT_ELO = 0.4;
export const WEIGHT_XG = 0.6;
export const ELO_FULL_SCALE = 50; // 杯赛涨 50 分自算 Elo ≈ 极限爆冷,记满分
export const XG_FULL_SCALE = 1.5; // 场均净胜 1.5 个 xG ≈ 满分
export const REST_THRESHOLD = 3; // 休息 ≤3 天触发体能惩罚
export const FATIGUE_STEP = 0.2; // 每少休息 1 天扣 0.2(休3扣0.2 / 休2扣0.4 / 休1扣0.6)
export const ELO_START = 1500; // 与自算 Elo 起始分一致(回退默认)
export const DEFAULT_WC_START = '2026-06-11'; // 2026 世界杯开赛日
