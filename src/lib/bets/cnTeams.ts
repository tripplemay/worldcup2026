/**
 * 中文队名 → 规范英文名(投注单识别多为中文,需先折英文再 normalizeTeam 对齐赛果)。
 * 值用英文名,经 normalizeTeam + ALIASES(lib/match/normalize)最终归一,故这里只需给到
 * 「能被 normalize/别名解析成系统存储归一名」的英文写法即可(如 美国→USA、韩国→South Korea)。
 * 覆盖世界杯常见国家队 + 五大联赛部分豪门;可持续扩充。未命中者原样透传,匹配失败则待人工。
 */
export const CN_TEAM_MAP: Record<string, string> = {
  // ── 南美 ──
  巴西: 'Brazil',
  阿根廷: 'Argentina',
  乌拉圭: 'Uruguay',
  哥伦比亚: 'Colombia',
  厄瓜多尔: 'Ecuador',
  秘鲁: 'Peru',
  智利: 'Chile',
  巴拉圭: 'Paraguay',
  委内瑞拉: 'Venezuela',
  玻利维亚: 'Bolivia',
  // ── 欧洲 ──
  法国: 'France',
  英格兰: 'England',
  西班牙: 'Spain',
  德国: 'Germany',
  葡萄牙: 'Portugal',
  荷兰: 'Netherlands',
  比利时: 'Belgium',
  意大利: 'Italy',
  克罗地亚: 'Croatia',
  奥地利: 'Austria',
  瑞士: 'Switzerland',
  丹麦: 'Denmark',
  瑞典: 'Sweden',
  挪威: 'Norway',
  波兰: 'Poland',
  塞尔维亚: 'Serbia',
  土耳其: 'Turkey',
  乌克兰: 'Ukraine',
  威尔士: 'Wales',
  苏格兰: 'Scotland',
  捷克: 'Czech Republic',
  匈牙利: 'Hungary',
  希腊: 'Greece',
  罗马尼亚: 'Romania',
  斯洛伐克: 'Slovakia',
  斯洛文尼亚: 'Slovenia',
  俄罗斯: 'Russia',
  爱尔兰: 'Ireland',
  北爱尔兰: 'Northern Ireland',
  冰岛: 'Iceland',
  阿尔巴尼亚: 'Albania',
  波黑: 'Bosnia Herzegovina',
  北马其顿: 'North Macedonia',
  芬兰: 'Finland',
  // ── 亚洲 ──
  日本: 'Japan',
  韩国: 'South Korea',
  伊朗: 'Iran',
  沙特阿拉伯: 'Saudi Arabia',
  沙特: 'Saudi Arabia',
  澳大利亚: 'Australia',
  卡塔尔: 'Qatar',
  伊拉克: 'Iraq',
  阿联酋: 'United Arab Emirates',
  乌兹别克斯坦: 'Uzbekistan',
  约旦: 'Jordan',
  阿曼: 'Oman',
  中国: 'China',
  朝鲜: 'North Korea',
  巴林: 'Bahrain',
  叙利亚: 'Syria',
  黎巴嫩: 'Lebanon',
  印度: 'India',
  泰国: 'Thailand',
  越南: 'Vietnam',
  // ── 非洲 ──
  摩洛哥: 'Morocco',
  塞内加尔: 'Senegal',
  突尼斯: 'Tunisia',
  阿尔及利亚: 'Algeria',
  埃及: 'Egypt',
  尼日利亚: 'Nigeria',
  加纳: 'Ghana',
  喀麦隆: 'Cameroon',
  科特迪瓦: 'Ivory Coast',
  马里: 'Mali',
  南非: 'South Africa',
  刚果民主共和国: 'DR Congo',
  民主刚果: 'DR Congo',
  '刚果(金)': 'DR Congo',
  布基纳法索: 'Burkina Faso',
  佛得角: 'Cape Verde',
  几内亚: 'Guinea',
  // ── 中北美及加勒比 ──
  墨西哥: 'Mexico',
  美国: 'USA',
  加拿大: 'Canada',
  哥斯达黎加: 'Costa Rica',
  巴拿马: 'Panama',
  洪都拉斯: 'Honduras',
  牙买加: 'Jamaica',
  库拉索: 'Curacao',
  海地: 'Haiti',
  萨尔瓦多: 'El Salvador',
  危地马拉: 'Guatemala',
  特立尼达和多巴哥: 'Trinidad and Tobago',
  // ── 大洋洲 ──
  新西兰: 'New Zealand',
  // ── 五大联赛部分豪门(联赛单据备用)──
  拜仁慕尼黑: 'Bayern Munich',
  多特蒙德: 'Borussia Dortmund',
  曼联: 'Manchester United',
  曼城: 'Manchester City',
  利物浦: 'Liverpool',
  阿森纳: 'Arsenal',
  切尔西: 'Chelsea',
  热刺: 'Tottenham',
  皇马: 'Real Madrid',
  巴萨: 'Barcelona',
  巴塞罗那: 'Barcelona',
  马竞: 'Atletico Madrid',
  尤文: 'Juventus',
  国际米兰: 'Inter',
  AC米兰: 'AC Milan',
  那不勒斯: 'Napoli',
  巴黎圣日耳曼: 'Paris Saint Germain',
  巴黎: 'Paris Saint Germain',
};

// 识别常见冗余后缀(截图识别常带,如「佛得角共和国」「巴西队」);剥后缀重查,未命中不吐半剥名
const CN_SUFFIXES = ['共和国', '共和國', '国家队', '代表队', '足球队', '队'];

/**
 * 中文/简称队名 → 规范英文。精确命中优先;失败则剥常见后缀(至多两层,如「共和国队」)
 * 重查映射;仍未命中原样透传(交人工,绝不返回剥了一半的名字)。
 */
export function toCanonicalName(raw: string): string {
  const s = (raw ?? '').trim();
  if (CN_TEAM_MAP[s]) return CN_TEAM_MAP[s];
  let candidates = [s];
  for (let pass = 0; pass < 2; pass++) {
    const next: string[] = [];
    for (const c of candidates)
      for (const suf of CN_SUFFIXES)
        if (c.endsWith(suf) && c.length > suf.length) {
          const base = c.slice(0, -suf.length).trim();
          if (CN_TEAM_MAP[base]) return CN_TEAM_MAP[base];
          next.push(base);
        }
    candidates = next;
    if (!candidates.length) break;
  }
  return s;
}
