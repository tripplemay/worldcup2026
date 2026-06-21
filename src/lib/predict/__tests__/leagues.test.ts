import {
  getLeague,
  listLeagues,
  fdSeasonCode,
  fdCsvUrl,
  getCompetitionConfig,
  getCompetitionConfigByKey,
  WC_CONFIG,
} from '../leagues';

describe('leagues registry', () => {
  it('解析已注册联赛', () => {
    const la = getLeague('laliga');
    expect(la?.afId).toBe(140);
    expect(la?.fdCode).toBe('SP1');
    expect(la?.key).toBe('laliga');
    expect(getLeague('epl')?.key).toBe('epl-2025'); // 沿用历史存储键
    expect(getLeague('nope')).toBeUndefined();
  });

  it('注册五大联赛且 afId/fdCode 唯一', () => {
    const all = listLeagues();
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(new Set(all.map((l) => l.afId)).size).toBe(all.length);
    expect(new Set(all.map((l) => l.fdCode)).size).toBe(all.length);
    expect(new Set(all.map((l) => l.key)).size).toBe(all.length);
  });

  it('football-data 赛季代码:起始年 → 两位+两位', () => {
    expect(fdSeasonCode(2024)).toBe('2425');
    expect(fdSeasonCode(2025)).toBe('2526');
    expect(fdSeasonCode(2023)).toBe('2324');
    expect(fdSeasonCode(1999)).toBe('9900'); // 跨世纪边界
  });

  it('拼 football-data CSV URL', () => {
    expect(fdCsvUrl('SP1', 2024)).toBe(
      'https://www.football-data.co.uk/mmz4281/2425/SP1.csv',
    );
    expect(fdCsvUrl('E0', 2025)).toBe(
      'https://www.football-data.co.uk/mmz4281/2526/E0.csv',
    );
  });
});

describe('竞赛配置(Phase 2)', () => {
  it('WC 配置中立(R1 关、HFA 0、market 0.2)——保证 WC 行为不变', () => {
    expect(WC_CONFIG.shrinkEloScale).toBe(0);
    expect(WC_CONFIG.hfaElo).toBe(0);
    expect(WC_CONFIG.hfaMult).toBe(1);
    expect(WC_CONFIG.marketWeight).toBe(0.2);
  });

  it('未知 comp 回退 WC 配置', () => {
    expect(getCompetitionConfig('wc')).toEqual(WC_CONFIG);
    expect(getCompetitionConfig('nope')).toEqual(WC_CONFIG);
  });

  it('联赛 calib:R1 开、market 抬高;意甲无主场、西甲主场最强', () => {
    const la = getCompetitionConfig('laliga');
    expect(la.shrinkEloScale).toBeGreaterThan(0);
    expect(la.marketWeight).toBeGreaterThan(0.2);
    expect(la.hfaElo).toBe(85); // 西甲主场最强
    expect(getCompetitionConfig('seriea').hfaElo).toBe(0); // 意甲无主场 edge(2 季确认)
    expect(getCompetitionConfig('seriea').hfaMult).toBe(1.0);
  });

  it('按存储 key 解析(epl-2025 → epl calib;未知 → WC)', () => {
    expect(getCompetitionConfigByKey('epl-2025').hfaElo).toBe(65);
    expect(getCompetitionConfigByKey('laliga').hfaElo).toBe(85);
    expect(getCompetitionConfigByKey('unknown-key')).toEqual(WC_CONFIG);
  });
});
