/**
 * 联赛水平分级(用 API-Football 稳定 league id):
 *  1 = 五大联赛;2 = 知名联赛;3 = 其他。
 * 用于在球员信息里标注"主战联赛档位",同样评分在不同联赛含金量不同。
 */
interface LeagueMeta {
  tier: 1 | 2;
  zh: string;
  en: string;
}

const MAP: Record<number, LeagueMeta> = {
  // 五大联赛
  39: { tier: 1, zh: '英超', en: 'EPL' },
  140: { tier: 1, zh: '西甲', en: 'La Liga' },
  135: { tier: 1, zh: '意甲', en: 'Serie A' },
  78: { tier: 1, zh: '德甲', en: 'Bundesliga' },
  61: { tier: 1, zh: '法甲', en: 'Ligue 1' },
  // 知名联赛
  94: { tier: 2, zh: '葡超', en: 'Primeira' },
  88: { tier: 2, zh: '荷甲', en: 'Eredivisie' },
  144: { tier: 2, zh: '比甲', en: 'Pro League' },
  203: { tier: 2, zh: '土超', en: 'Süper Lig' },
  307: { tier: 2, zh: '沙特联', en: 'Saudi PL' },
  71: { tier: 2, zh: '巴甲', en: 'Brasileirão' },
  128: { tier: 2, zh: '阿甲', en: 'Liga Arg' },
  253: { tier: 2, zh: '美职联', en: 'MLS' },
  40: { tier: 2, zh: '英冠', en: 'Championship' },
  179: { tier: 2, zh: '苏超', en: 'Scottish PL' },
  235: { tier: 2, zh: '俄超', en: 'RPL' },
  197: { tier: 2, zh: '希超', en: 'Greek SL' },
  218: { tier: 2, zh: '奥甲', en: 'Bundesliga AUT' },
  103: { tier: 2, zh: '挪超', en: 'Eliteserien' },
};

export interface LeagueLevel {
  tier: 1 | 2 | 3;
  label: string;
}

/** 联赛档位 + 短标签(按 locale);无 league id 返回 null(不显示徽章)。 */
export function leagueLevel(
  id: number | undefined,
  locale: string,
): LeagueLevel | null {
  if (!id) return null;
  const m = MAP[id];
  if (m) return { tier: m.tier, label: locale === 'zh' ? m.zh : m.en };
  return { tier: 3, label: locale === 'zh' ? '其他' : 'Other' };
}
