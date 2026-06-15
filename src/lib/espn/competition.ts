/**
 * 把 ESPN 赛事性质(英文,来自 leagueName/competitionName)映射为简短标签。
 * 资格赛规则排在对应正赛之前(避免 "World Cup Qualifying" 被 "World Cup" 抢匹配)。
 * 未知则去掉开头年份后原样返回。
 */
const RULES: Array<{ re: RegExp; zh: string; en: string }> = [
  { re: /world cup qualif/i, zh: '世预赛', en: 'WC Qual.' },
  { re: /world cup/i, zh: '世界杯', en: 'World Cup' },
  { re: /(european|euro).*qualif/i, zh: '欧预赛', en: 'Euro Qual.' },
  { re: /european championship|\beuros?\b/i, zh: '欧洲杯', en: 'Euros' },
  { re: /nations league/i, zh: '国家联赛', en: 'Nations L.' },
  { re: /copa am[eé]rica/i, zh: '美洲杯', en: 'Copa Am.' },
  { re: /gold cup/i, zh: '金杯赛', en: 'Gold Cup' },
  { re: /asian cup/i, zh: '亚洲杯', en: 'Asian Cup' },
  { re: /africa cup|afcon/i, zh: '非洲杯', en: 'AFCON' },
  { re: /confederations/i, zh: '联合会杯', en: 'Confed.' },
  { re: /friendly/i, zh: '友谊赛', en: 'Friendly' },
];

export function competitionLabel(
  raw: string | undefined,
  locale: string,
): string {
  if (!raw) return '';
  for (const r of RULES) {
    if (r.re.test(raw)) return locale === 'zh' ? r.zh : r.en;
  }
  // 未知赛事:去掉开头 4 位年份(如 "2026 ..."),原样返回
  return raw.replace(/^\s*\d{4}\s+/, '').trim();
}
