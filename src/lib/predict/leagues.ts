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
  /** ESPN soccer 联赛 slug(eng.1/esp.1/ger.1/ita.1/fra.1)——实时赛程/比分/详情。 */
  espnSlug: string;
  /** The Odds API 联赛 key(soccer_epl 等)——实时盘前赔率(市场模型,联赛 in-season 用)。 */
  oddsKey: string;
}

const LEAGUES: Record<string, LeagueDef> = {
  epl: {
    comp: 'epl',
    key: 'epl-2025',
    name: 'Premier League',
    afId: 39,
    fdCode: 'E0',
    espnSlug: 'eng.1',
    oddsKey: 'soccer_epl',
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
    espnSlug: 'esp.1',
    oddsKey: 'soccer_spain_la_liga',
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
    espnSlug: 'ger.1',
    oddsKey: 'soccer_germany_bundesliga',
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
    espnSlug: 'ita.1',
    oddsKey: 'soccer_italy_serie_a',
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
    espnSlug: 'fra.1',
    oddsKey: 'soccer_france_ligue_one',
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

// ── 竞赛(WC / 联赛)预测引擎配置 ────────────────────────────
/**
 * 按竞赛分流的预测引擎参数(Phase 2:去 WC 硬编码,WC 一套/联赛各一套)。
 * 联赛值来自 Phase 1.5 多联赛泛化验证(经对抗验证),见
 * `docs/分析报告:多联赛校准泛化验证...md` §5。
 */
export interface CompetitionConfig {
  /** R1 修复:错配场放开 λ 压缩(0=关,联赛 ~100-150;WC 必须 0)。 */
  shrinkEloScale: number;
  /** O1 进球阻尼:λ/μ 向联赛均值收缩(<1 抑制大比分高估)。 */
  goalShrink: number;
  /** Dixon-Coles ρ(平局/低分校准)。 */
  dcRho: number;
  /** 主场 Elo 加成(联赛 flat、每个主场;WC 这里=0,改走 predict 的承办国 per-match 逻辑)。 */
  hfaElo: number;
  /** 主场进球乘子(主 λ×、客 μ÷;1=中立)。 */
  hfaMult: number;
  /** ensemble 市场隐含锚定权重(其余在 poisson↔elo 间按 |ΔElo| 动态分配)。 */
  marketWeight: number;
}

/**
 * 世界杯配置 = 现状默认(中立 + WC 安全):shrinkEloScale 0、HFA flat 0
 * (WC 主场走 predict.ts 承办国 per-match 逻辑)、market 锚定 0.2。改动 Phase 2 前后 WC 行为一致。
 */
export const WC_CONFIG: CompetitionConfig = {
  shrinkEloScale: 0,
  goalShrink: 0.6,
  dcRho: -0.14,
  hfaElo: 0,
  hfaMult: 1,
  marketWeight: 0.2,
};

/**
 * 各联赛验证后校准(comp → 配置)。goalShrink/dcRho 与 WC 默认同(联赛无需改);
 * 差异在 shrinkEloScale(R1)、hfaElo/hfaMult(主场)、marketWeight(市场最强)。
 * marketWeight 由 ensemble 权重 sweep 定(见报告 §5 专项 sweep)。
 */
const CALIB: Record<string, CompetitionConfig> = {
  epl: {
    shrinkEloScale: 100,
    goalShrink: 0.6,
    dcRho: -0.14,
    hfaElo: 65,
    hfaMult: 1.12,
    marketWeight: 0.4,
  },
  laliga: {
    shrinkEloScale: 150,
    goalShrink: 0.6,
    dcRho: -0.14,
    hfaElo: 85,
    hfaMult: 1.12,
    marketWeight: 0.4,
  },
  bundesliga: {
    shrinkEloScale: 120,
    goalShrink: 0.6,
    dcRho: -0.14,
    hfaElo: 65,
    hfaMult: 1.12,
    marketWeight: 0.4,
  },
  // 意甲:2 季确认无主场 edge → hfaElo 0 / mult 1.0
  seriea: {
    shrinkEloScale: 100,
    goalShrink: 0.6,
    dcRho: -0.14,
    hfaElo: 0,
    hfaMult: 1.0,
    marketWeight: 0.4,
  },
  ligue1: {
    shrinkEloScale: 100,
    goalShrink: 0.6,
    dcRho: -0.14,
    hfaElo: 65,
    hfaMult: 1.12,
    marketWeight: 0.4,
  },
};

/** 取竞赛配置:comp 命中联赛取其 calib,否则(WC/未知)取 WC 配置。 */
export function getCompetitionConfig(comp: string): CompetitionConfig {
  return CALIB[comp] ?? WC_CONFIG;
}

/** 按存储 key(如 'laliga' / 'epl-2025')取竞赛配置;无匹配回退 WC。 */
export function getCompetitionConfigByKey(key: string): CompetitionConfig {
  const lg = listLeagues().find((l) => l.key === key);
  return lg ? getCompetitionConfig(lg.comp) : WC_CONFIG;
}
