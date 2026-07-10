/**
 * TMI 固定基准权重与归一化标尺(纯常量,客户端/服务端共用,无 Node 依赖)。
 */
export const WEIGHT_ELO = 0.4;
export const WEIGHT_XG = 0.6;
export const ELO_FULL_SCALE = 50; // 杯赛涨 50 分自算 Elo ≈ 极限爆冷,记满分
export const XG_FULL_SCALE = 1.5; // 场均净胜 1.5 个 xG ≈ 满分
export const REST_THRESHOLD = 3; // 休息 ≤3 天触发体能惩罚
export const FATIGUE_STEP = 0.2; // 每少休息 1 天扣 0.2(休3扣0.2 / 休2扣0.4 / 休1扣0.6)
export const FATIGUE_FLOOR = -0.6; // 体能惩罚合并封顶(负荷/休息 + 旅途 之和不越过)
export const ELO_START = 1500; // 与自算 Elo 起始分一致(回退默认)
export const DEFAULT_WC_START = '2026-06-11'; // 2026 世界杯开赛日

// ── TMI v2(2026-07 用户反馈):对手强度校正 + 旅途时区 ──────────────
// 战术因子对手强度校正:对手基线 Elo 高于参赛队均值 300 分 ≈ +1.0 xG 当量
// (Elo 差 300 ≈ 期望胜率 85% ≈ 约 1 球优势;与预测引擎 SOS_ELO_SCALE 同标尺)
export const XG_SOS_ELO_SCALE = 300;
export const TRAVEL_KM_STEP = 0.04; // 旅途:每 1000km 扣 0.04
export const TRAVEL_TZ_STEP = 0.04; // 旅途:每跨 1 个时区扣 0.04
export const TRAVEL_MAX_PENALTY = 0.2; // 旅途惩罚封顶(如 温哥华→纽约 ≈4000km+3时区 → 封顶)
export const TRAVEL_RECENT_DAYS = 7; // 距上一场 ≤7 天才计旅途(杯赛节奏内;久休无残留)
