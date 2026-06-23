/**
 * 中文/简写队名 → 规范英文名映射(Phase 9 注单识别用)。
 *
 * 视觉 LLM 识别他平台截图时,队名可能是中文或博彩简写;
 * 这里把它折叠成规范英文名,再交给 normalizeTeam 做跨源对齐。
 * 仅预置常见样例,可持续扩充(国家队 + 主流俱乐部)。
 */

/** 中文/简写名(已 trim)→ 规范英文名。可持续扩充。 */
export const CN_TEAM_MAP: Record<string, string> = {
  // ── 国家队(世界杯)──
  巴西: 'Brazil',
  法国: 'France',
  阿根廷: 'Argentina',
  德国: 'Germany',
  英格兰: 'England',
  // ── 俱乐部(主流联赛)──
  拜仁慕尼黑: 'Bayern Munich',
  曼联: 'Manchester United',
  皇马: 'Real Madrid',
  // 注:覆盖不到的队名会原样透传,由人工核对补登。
};

/**
 * 把识别到的原始队名折叠成规范英文名;未登记的原样返回(交给归一化兜底)。
 */
export function toCanonicalName(raw: string): string {
  return CN_TEAM_MAP[raw?.trim()] ?? raw;
}
