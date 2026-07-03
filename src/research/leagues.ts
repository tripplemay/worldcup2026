/**
 * Phase 10 · 联赛注册表(多联赛研究的唯一真相源)。
 * 每联赛:key(store 文件命名空间/API 参数)+ football-data 代码 + 名称 + 全季场次期望
 * (null=联赛规模逐季变动,摄取只做宽松校验)+ 队名别名(仅跨源对齐需要;纯 football-data
 * 来源的联赛内部自洽,无需别名)。新增联赛 = 在此加一行 + 摄取数据,机制全复用。
 */
export interface LeagueDef {
  key: string; // store 命名空间(league-<key>-*.json / research-<key>-*.json)
  fd: string; // football-data 代码(mmz4281/<season>/<fd>.csv)
  nameZh: string;
  nameEn: string;
  expectRows: number | null; // 全季场次(null=逐季变动,跳过硬断言)
  alias: Record<string, string>; // football-data 简称 → 规范名(跨源对齐才需要)
}

export const LEAGUES: LeagueDef[] = [
  {
    key: 'epl-2025',
    fd: 'E0',
    nameZh: '英超',
    nameEn: 'Premier League',
    expectRows: 380,
    // EPL 的 results/hist 有 API-Football 真 xG 条目,需别名对齐两源队名
    alias: {
      'Man City': 'Manchester City',
      'Man United': 'Manchester United',
      "Nott'm Forest": 'Nottingham Forest',
    },
  },
  { key: 'e1', fd: 'E1', nameZh: '英冠', nameEn: 'Championship', expectRows: 552, alias: {} },
  { key: 'sc0', fd: 'SC0', nameZh: '苏超', nameEn: 'Scottish Premiership', expectRows: 228, alias: {} },
  { key: 't1', fd: 'T1', nameZh: '土超', nameEn: 'Süper Lig', expectRows: null, alias: {} },
  { key: 'p1', fd: 'P1', nameZh: '葡超', nameEn: 'Primeira Liga', expectRows: 306, alias: {} },
  { key: 'n1', fd: 'N1', nameZh: '荷甲', nameEn: 'Eredivisie', expectRows: 306, alias: {} },
  { key: 'b1', fd: 'B1', nameZh: '比甲', nameEn: 'Pro League', expectRows: null, alias: {} },
  { key: 'g1', fd: 'G1', nameZh: '希超', nameEn: 'Super League Greece', expectRows: null, alias: {} },
  { key: 'f1', fd: 'F1', nameZh: '法甲', nameEn: 'Ligue 1', expectRows: null, alias: {} },
];

export const DEFAULT_LEAGUE = 'epl-2025';

export function leagueOf(key: string): LeagueDef | undefined {
  return LEAGUES.find((l) => l.key === key);
}
/** 校验并归一 API 传入的联赛 key(未知 → 默认)。 */
export function safeLeagueKey(raw: string | null | undefined): string {
  return raw && LEAGUES.some((l) => l.key === raw) ? raw : DEFAULT_LEAGUE;
}
