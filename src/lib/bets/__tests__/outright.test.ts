import {
  isSameExacta,
  isSameChampion,
  parseExactaSelection,
  isWorldCup2026Competition,
  resolveOutrightLeg,
} from 'lib/bets/outright';

jest.mock('lib/espn/espn', () => ({
  espnProvider: {
    getStandings: jest.fn(),
    getBracket: jest.fn(),
  },
}));
jest.mock('lib/scenario/knockoutBracket', () => ({
  buildKnockoutBracket: jest.fn(),
}));

import { espnProvider } from 'lib/espn/espn';
import { buildKnockoutBracket } from 'lib/scenario/knockoutBracket';

const getStandings = espnProvider.getStandings as jest.Mock;
const getBracket = espnProvider.getBracket as jest.Mock;
const buildBracket = buildKnockoutBracket as jest.Mock;

const leg = (selection = '英格兰') => ({
  kind: 'outright' as const,
  competition: '世界杯2026(在加拿大、墨西哥&美国)',
  market: 'OUTRIGHT_WINNER' as const,
  selection,
  odds: 7.8,
});

beforeEach(() => {
  getStandings.mockReset().mockResolvedValue([]);
  getBracket.mockReset().mockResolvedValue([]);
  buildBracket.mockReset();
});

describe('世界杯冠军长期盘结算', () => {
  it('识别中英文世界杯名称并排除其他届次', () => {
    expect(isWorldCup2026Competition('世界杯2026(美国)')).toBe(true);
    expect(isWorldCup2026Competition('FIFA World Cup 2026')).toBe(true);
    expect(isWorldCup2026Competition('World Cup 2030')).toBe(false);
    expect(isWorldCup2026Competition('UEFA Euro 2026')).toBe(false);
  });

  it('中英文队名按别名归一比较', () => {
    expect(isSameChampion('英格兰', 'England')).toBe(true);
    expect(isSameChampion('英格兰', 'France')).toBe(false);
    expect(parseExactaSelection('法国 / 巴西')).toEqual({
      winner: '法国',
      runnerUp: '巴西',
    });
    expect(isSameExacta('法国 / 巴西', 'France', 'Brazil')).toBe(true);
    expect(isSameExacta('巴西 / 法国', 'France', 'Brazil')).toBe(false);
  });

  it('决赛未产生冠军时保持 pending', async () => {
    buildBracket.mockReturnValue({ nodes: [] });
    await expect(resolveOutrightLeg(leg())).resolves.toEqual({
      result: 'pending',
    });
  });

  it('冠亚军顺序盘:冠军和决赛负方均按顺序命中才赢', async () => {
    buildBracket.mockReturnValue({
      champion: { norm: 'france', name: 'France' },
      nodes: [
        {
          match: 104,
          decided: true,
          home: { norm: 'france', name: 'France' },
          away: { norm: 'brazil', name: 'Brazil' },
        },
      ],
    });
    await expect(
      resolveOutrightLeg({
        ...leg('法国 / 巴西'),
        market: 'OUTRIGHT_EXACTA',
      }),
    ).resolves.toEqual({
      result: 'won',
      winner: 'France',
      runnerUp: 'Brazil',
    });
    await expect(
      resolveOutrightLeg({
        ...leg('巴西 / 法国'),
        market: 'OUTRIGHT_EXACTA',
      }),
    ).resolves.toEqual({
      result: 'lost',
      winner: 'France',
      runnerUp: 'Brazil',
    });
  });

  it('冠亚军顺序盘:未能确定决赛负方时保持 pending', async () => {
    buildBracket.mockReturnValue({
      champion: { norm: 'france', name: 'France' },
      nodes: [{ match: 104, decided: false, home: {}, away: {} }],
    });
    await expect(
      resolveOutrightLeg({
        ...leg('法国 / 巴西'),
        market: 'OUTRIGHT_EXACTA',
      }),
    ).resolves.toEqual({
      result: 'pending',
      winner: 'France',
    });
  });

  it('冠亚军顺序盘:冠军候选已被淘汰时即时判输', async () => {
    getStandings.mockResolvedValue([
      {
        group: 'Group A',
        rows: [
          { team: 'Germany', played: 3, rank: 1 },
          { team: 'Paraguay', played: 3, rank: 2 },
          { team: 'Brazil', played: 3, rank: 3 },
          { team: 'France', played: 3, rank: 4 },
        ],
      },
    ]);
    buildBracket.mockReturnValue({
      nodes: [
        {
          match: 74,
          decided: true,
          home: { norm: 'germany', name: 'Germany', score: 1 },
          away: { norm: 'paraguay', name: 'Paraguay', score: 1, winner: true },
        },
      ],
    });
    await expect(
      resolveOutrightLeg({
        ...leg('德国 / 巴西'),
        market: 'OUTRIGHT_EXACTA',
      }),
    ).resolves.toEqual({ result: 'lost' });
  });

  it('冠亚军顺序盘:亚军候选决赛前出局时即时判输', async () => {
    getStandings.mockResolvedValue([
      {
        group: 'Group A',
        rows: [
          { team: 'Brazil', played: 3, rank: 1 },
          { team: 'Japan', played: 3, rank: 2 },
          { team: 'France', played: 3, rank: 3 },
          { team: 'Germany', played: 3, rank: 4 },
        ],
      },
    ]);
    buildBracket.mockReturnValue({
      nodes: [
        {
          match: 76,
          decided: true,
          home: { norm: 'brazil', name: 'Brazil', score: 2, winner: true },
          away: { norm: 'japan', name: 'Japan', score: 1 },
        },
      ],
    });
    await expect(
      resolveOutrightLeg({
        ...leg('法国 / 日本'),
        market: 'OUTRIGHT_EXACTA',
      }),
    ).resolves.toEqual({ result: 'lost' });
  });

  it('所选球队夺冠判赢,其他球队夺冠判输', async () => {
    buildBracket.mockReturnValue({ champion: { name: 'England' } });
    await expect(resolveOutrightLeg(leg())).resolves.toEqual({
      result: 'won',
      winner: 'England',
    });
    await expect(resolveOutrightLeg(leg('法国'))).resolves.toEqual({
      result: 'lost',
      winner: 'England',
    });
  });

  it('冠军盘:候选冠军已被淘汰时即时判输', async () => {
    getStandings.mockResolvedValue([
      {
        group: 'Group A',
        rows: [
          { team: 'Germany', played: 3, rank: 1 },
          { team: 'Paraguay', played: 3, rank: 2 },
          { team: 'Brazil', played: 3, rank: 3 },
          { team: 'France', played: 3, rank: 4 },
        ],
      },
    ]);
    buildBracket.mockReturnValue({
      nodes: [
        {
          match: 74,
          decided: true,
          home: { norm: 'germany', name: 'Germany', score: 1 },
          away: { norm: 'paraguay', name: 'Paraguay', score: 1, winner: true },
        },
      ],
    });
    await expect(resolveOutrightLeg(leg('德国'))).resolves.toEqual({
      result: 'lost',
    });
  });

  it('其他赛事转人工,数据源失败不误结', async () => {
    await expect(
      resolveOutrightLeg({
        ...leg(),
        competition: 'UEFA Euro 2028',
      }),
    ).resolves.toEqual({ result: 'unsupported' });
    getStandings.mockRejectedValue(new Error('network'));
    await expect(resolveOutrightLeg(leg())).resolves.toEqual({
      result: 'pending',
    });
  });
});
