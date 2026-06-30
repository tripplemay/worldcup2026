/**
 * resolveLeg 网络路径回归测试。
 * 生产事故:缺 matchDate 的 WC 注单曾按队名命中多年历史 results.json,
 * 把 2026 未开赛 Mexico vs Ecuador 错结算成 2024 0:0。
 */
import type { MatchBetLeg } from 'lib/bets/types';

jest.mock('lib/db/store', () => ({
  loadResults: jest.fn(() => ({
    old_mex_ecu: {
      eventId: '1146315',
      date: '2024-07-01T00:00:00+00:00',
      homeNorm: 'mexico',
      awayNorm: 'ecuador',
      homeGoals: 0,
      awayGoals: 0,
    },
  })),
  loadLeagueResults: jest.fn(() => ({})),
}));

jest.mock('lib/espn/espn', () => ({
  espnProvider: {
    getScoreboard: jest.fn(async () => [
      {
        id: '760491',
        homeTeam: 'Mexico',
        awayTeam: 'Ecuador',
        commenceTime: '2026-07-01T01:00Z',
        status: 'pre',
      },
    ]),
    getMatchSummary: jest.fn(),
  },
}));

import { resolveLeg } from 'lib/bets/match';
import { espnProvider } from 'lib/espn/espn';

const getScoreboard = espnProvider.getScoreboard as jest.MockedFunction<
  typeof espnProvider.getScoreboard
>;

function wcLeg(over: Partial<MatchBetLeg> = {}): MatchBetLeg {
  return {
    kind: 'match',
    homeName: '墨西哥',
    awayName: '厄瓜多尔',
    league: '世界杯 2026(在加拿大、墨西哥&美国)',
    market: 'AH',
    selection: 'home',
    line: -0.5,
    odds: 2.29,
    rawText: '墨西哥 -0.5 欧洲盘 全场让球',
    ...over,
  };
}

describe('resolveLeg — WC 缺日期不能命中历史赛果', () => {
  beforeEach(() => {
    getScoreboard.mockClear();
  });

  it('缺 matchDate 时优先查本届赛程,返回 2026 未开赛 pending', async () => {
    await expect(resolveLeg(wcLeg())).resolves.toEqual({
      status: 'pending',
      matchId: '760491',
      kickoff: '2026-07-01T01:00Z',
    });
    expect(getScoreboard).toHaveBeenCalledWith('20260611-20260719');
  });

  it('不可解析 matchDate 时也不使用历史 2024 0:0', async () => {
    await expect(
      resolveLeg(wcLeg({ matchDate: '07 月 01 日 09:00' })),
    ).resolves.toEqual({
      status: 'pending',
      matchId: '760491',
      kickoff: '2026-07-01T01:00Z',
    });
    expect(getScoreboard).toHaveBeenCalledWith('20260611-20260719');
  });
});
