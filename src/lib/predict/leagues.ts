/**
 * 联赛注册表(Phase 1 多联赛校准 / Phase 2 直播底座共用)。
 *
 * 每个联赛集中三件事:API-Football 联赛 id、football-data.co.uk 赛季 CSV 代码、
 * 以及 football-data 简称 → AF 规范名的别名表(用于把闭盘赔率按 matchKey 对齐到 AF 赛果)。
 * 摄取端点据此一个 comp 参数即可推导 AF id + CSV URL + alias,免去逐次手传。
 *
 * 全部独立于世界杯数据(各联赛存 league-<key>-*.json),WC 路径完全不受影响。
 * alias 的 key 是 football-data 原始简称(归一化前),value 是 AF 原始规范名;
 * 二者归一化后一致的队(去标点/变音后相同)无需登记。
 */

export interface LeagueDef {
  /** 短代号:摄取/回测端点的 comp 参数。 */
  comp: string;
  /** 存储键(league-<key>-*.json)。EPL 沿用历史键 epl-2025;其余 = comp。 */
  key: string;
  /** 展示名。 */
  name: string;
  /** API-Football 联赛 id。 */
  afId: number;
  /** football-data.co.uk 代码(E0=英超 / SP1=西甲 / D1=德甲 / I1=意甲 / F1=法甲)。 */
  fdCode: string;
  /** football-data 简称 → AF 规范名(其余已一致;经实摄取 name-diff 校正)。 */
  fdAlias: Record<string, string>;
}

const LEAGUES: Record<string, LeagueDef> = {
  epl: {
    comp: 'epl',
    key: 'epl-2025',
    name: 'Premier League',
    afId: 39,
    fdCode: 'E0',
    fdAlias: {
      'Man City': 'Manchester City',
      'Man United': 'Manchester United',
      "Nott'm Forest": 'Nottingham Forest',
    },
  },
  laliga: {
    comp: 'laliga',
    key: 'laliga',
    name: 'La Liga',
    afId: 140,
    fdCode: 'SP1',
    fdAlias: {
      'Ath Madrid': 'Atletico Madrid',
      'Ath Bilbao': 'Athletic Club',
      Sociedad: 'Real Sociedad',
      Espanol: 'Espanyol',
      Vallecano: 'Rayo Vallecano',
      Betis: 'Real Betis',
      Celta: 'Celta Vigo',
      Granada: 'Granada CF',
    },
  },
  bundesliga: {
    comp: 'bundesliga',
    key: 'bundesliga',
    name: 'Bundesliga',
    afId: 78,
    fdCode: 'D1',
    fdAlias: {
      Dortmund: 'Borussia Dortmund',
      Leverkusen: 'Bayer Leverkusen',
      Freiburg: 'SC Freiburg',
      'Ein Frankfurt': 'Eintracht Frankfurt',
      Wolfsburg: 'VfL Wolfsburg',
      Mainz: 'FSV Mainz 05',
      "M'gladbach": 'Borussia Monchengladbach',
      Hoffenheim: '1899 Hoffenheim',
      Stuttgart: 'VfB Stuttgart',
      Augsburg: 'FC Augsburg',
      Bochum: 'VfL Bochum',
      'FC Koln': '1. FC Köln',
      Hamburg: 'Hamburger SV',
      Darmstadt: 'SV Darmstadt 98',
      'St Pauli': 'FC St. Pauli',
      // 注:Bayern(München/Munich)与 Heidenheim 的 AF 跨赛季异名在 normalize.ts 折叠
    },
  },
  seriea: {
    comp: 'seriea',
    key: 'seriea',
    name: 'Serie A',
    afId: 135,
    fdCode: 'I1',
    fdAlias: {
      Milan: 'AC Milan',
      Verona: 'Hellas Verona',
      Roma: 'AS Roma',
    },
  },
  ligue1: {
    comp: 'ligue1',
    key: 'ligue1',
    name: 'Ligue 1',
    afId: 61,
    fdCode: 'F1',
    fdAlias: {
      'Paris SG': 'Paris Saint Germain',
      'St Etienne': 'Saint Etienne',
      Clermont: 'Clermont Foot',
      Brest: 'Stade Brestois 29',
    },
  },
};

/** 取联赛定义(未知返回 undefined)。 */
export function getLeague(comp: string): LeagueDef | undefined {
  return LEAGUES[comp];
}

/** 全部已注册联赛。 */
export function listLeagues(): LeagueDef[] {
  return Object.values(LEAGUES);
}

/**
 * 起始年 → football-data 赛季代码(2024 → "2425",2025 → "2526")。
 * football-data 用「两位起始年+两位结束年」标识赛季目录。
 */
export function fdSeasonCode(season: number): string {
  const a = String(season % 100).padStart(2, '0');
  const b = String((season + 1) % 100).padStart(2, '0');
  return `${a}${b}`;
}

/** football-data.co.uk 某联赛某赛季 CSV URL。 */
export function fdCsvUrl(fdCode: string, season: number): string {
  return `https://www.football-data.co.uk/mmz4281/${fdSeasonCode(
    season,
  )}/${fdCode}.csv`;
}
