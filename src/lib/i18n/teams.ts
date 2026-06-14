/**
 * 国家队名中文映射。key 用 normalizeTeam 归一化后的形式(去变音 + 别名),
 * 因此 Türkiye/Turkey、Côte d'Ivoire/Ivory Coast 等变体都能命中。
 */
import { normalizeTeam } from 'lib/match/normalize';

const ZH: Record<string, string> = {
  // 欧洲
  germany: '德国',
  france: '法国',
  spain: '西班牙',
  england: '英格兰',
  portugal: '葡萄牙',
  netherlands: '荷兰',
  belgium: '比利时',
  italy: '意大利',
  croatia: '克罗地亚',
  switzerland: '瑞士',
  denmark: '丹麦',
  austria: '奥地利',
  sweden: '瑞典',
  norway: '挪威',
  poland: '波兰',
  ukraine: '乌克兰',
  serbia: '塞尔维亚',
  'czech republic': '捷克',
  romania: '罗马尼亚',
  hungary: '匈牙利',
  greece: '希腊',
  turkey: '土耳其',
  scotland: '苏格兰',
  wales: '威尔士',
  'bosnia herzegovina': '波黑',
  russia: '俄罗斯',
  slovenia: '斯洛文尼亚',
  slovakia: '斯洛伐克',
  ireland: '爱尔兰',
  iceland: '冰岛',
  albania: '阿尔巴尼亚',
  // 南美
  brazil: '巴西',
  argentina: '阿根廷',
  uruguay: '乌拉圭',
  colombia: '哥伦比亚',
  ecuador: '厄瓜多尔',
  peru: '秘鲁',
  chile: '智利',
  paraguay: '巴拉圭',
  venezuela: '委内瑞拉',
  bolivia: '玻利维亚',
  // 中北美
  mexico: '墨西哥',
  usa: '美国',
  canada: '加拿大',
  'costa rica': '哥斯达黎加',
  panama: '巴拿马',
  honduras: '洪都拉斯',
  jamaica: '牙买加',
  haiti: '海地',
  curacao: '库拉索',
  // 亚洲
  japan: '日本',
  'south korea': '韩国',
  iran: '伊朗',
  'saudi arabia': '沙特阿拉伯',
  australia: '澳大利亚',
  qatar: '卡塔尔',
  iraq: '伊拉克',
  jordan: '约旦',
  uzbekistan: '乌兹别克斯坦',
  china: '中国',
  'united arab emirates': '阿联酋',
  // 大洋洲
  'new zealand': '新西兰',
  // 非洲
  morocco: '摩洛哥',
  senegal: '塞内加尔',
  'ivory coast': '科特迪瓦',
  ghana: '加纳',
  nigeria: '尼日利亚',
  cameroon: '喀麦隆',
  egypt: '埃及',
  tunisia: '突尼斯',
  algeria: '阿尔及利亚',
  'cape verde': '佛得角',
  'south africa': '南非',
  mali: '马里',
  'dr congo': '刚果（金）',
};

/** 按语言本地化国家队名(非中文或无映射时返回原名)。 */
export function teamName(name: string, locale: string): string {
  if (locale !== 'zh' || !name) return name;
  return ZH[normalizeTeam(name)] ?? name;
}
