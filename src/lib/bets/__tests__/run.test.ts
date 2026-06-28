/**
 * settlePendingBets 回填行为:串关即时判输后,仍继续回填剩余腿的真实胜负(展示用),
 * 但绝不改动整单已定的 lost 状态 / 盈亏 / 结算时间;普通 pending 单结算照旧。
 */
import type { BetLeg, BetSlip } from 'lib/bets/types';

jest.mock('lib/bets/match', () => ({ resolveLeg: jest.fn() }));
jest.mock('lib/db/store', () => {
  let db: unknown[] = [];
  return {
    loadBets: () => JSON.parse(JSON.stringify(db)),
    saveBets: (list: unknown[]) => {
      db = JSON.parse(JSON.stringify(list));
    },
    __setDb: (x: unknown[]) => {
      db = JSON.parse(JSON.stringify(x));
    },
    __getDb: () => db,
  };
});

import { settlePendingBets } from 'lib/bets/run';
import { resolveLeg } from 'lib/bets/match';
import * as store from 'lib/db/store';

const setDb = (x: BetSlip[]) => (store as unknown as { __setDb: (x: BetSlip[]) => void }).__setDb(x);
const getDb = () => (store as unknown as { __getDb: () => BetSlip[] }).__getDb();
const mockResolve = resolveLeg as jest.MockedFunction<typeof resolveLeg>;

function leg(over: Partial<BetLeg> = {}): BetLeg {
  return { homeName: 'H', awayName: 'A', market: '1X2', selection: 'home', ...over };
}
function slip(over: Partial<BetSlip> = {}): BetSlip {
  return {
    id: 's',
    bettorId: 'b1',
    stake: 100,
    potentialReturn: 500,
    legs: [],
    status: 'pending',
    pnl: null,
    confidence: 0.9,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

beforeEach(() => mockResolve.mockReset());

describe('settlePendingBets — 串关已判输后的剩余腿回填', () => {
  it('整单已 lost:回填剩余腿真实结果,不改 lost/盈亏/结算时间', async () => {
    mockResolve.mockImplementation(async (lg: BetLeg) => {
      if (lg.homeName === 'B')
        return {
          status: 'matched',
          matchId: 'mB',
          kickoff: '2026-06-28T00:00:00Z',
          homeGoals: 2,
          awayGoals: 0,
        };
      if (lg.homeName === 'C')
        return { status: 'pending', kickoff: '2026-06-29T00:00:00Z' };
      return { status: 'unmatched' };
    });
    setDb([
      slip({
        id: 's1',
        status: 'lost',
        pnl: -100,
        settledAt: 123,
        legs: [
          leg({ homeName: 'A', result: 'lost', homeGoals: 0, awayGoals: 1, matchId: 'mA' }),
          leg({ homeName: 'B', result: 'pending' }),
          leg({ homeName: 'C', result: 'pending' }),
        ],
      }),
    ]);

    const { settled } = await settlePendingBets();
    expect(settled).toBe(0); // 回填不算新结算

    const out = getDb()[0];
    expect(out.status).toBe('lost');
    expect(out.pnl).toBe(-100);
    expect(out.settledAt).toBe(123);
    expect(out.legs[0].result).toBe('lost'); // 已终结腿保持
    expect(out.legs[1].result).toBe('won'); // 回填:B 场赢了,照常展示
    expect(out.legs[1].homeGoals).toBe(2);
    expect(out.legs[2].result).toBe('pending'); // C 未踢,保持待定
    // 已终结的 A 腿不再走网络解析
    expect(mockResolve).not.toHaveBeenCalledWith(
      expect.objectContaining({ homeName: 'A' }),
    );
  });

  it('lost 单所有腿都已终结:快照排除,不再处理', async () => {
    setDb([
      slip({
        id: 's2',
        status: 'lost',
        pnl: -100,
        settledAt: 5,
        legs: [leg({ homeName: 'A', result: 'lost' }), leg({ homeName: 'B', result: 'won' })],
      }),
    ]);
    const { settled } = await settlePendingBets();
    expect(settled).toBe(0);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(getDb()[0].settledAt).toBe(5);
  });

  it('回归:普通 pending 串单仍正常聚合结算', async () => {
    mockResolve.mockImplementation(async (lg: BetLeg) => {
      if (lg.homeName === 'A')
        return { status: 'matched', matchId: 'mA', kickoff: 'k', homeGoals: 2, awayGoals: 0 };
      if (lg.homeName === 'B')
        return { status: 'matched', matchId: 'mB', kickoff: 'k', homeGoals: 0, awayGoals: 3 };
      return { status: 'unmatched' };
    });
    setDb([
      slip({
        id: 's3',
        status: 'pending',
        legs: [leg({ homeName: 'A', selection: 'home' }), leg({ homeName: 'B', selection: 'home' })],
      }),
    ]);
    const { settled } = await settlePendingBets();
    expect(settled).toBe(1);
    const out = getDb()[0];
    expect(out.status).toBe('lost'); // B 0-3 输 → 整单输
    expect(out.pnl).toBe(-100);
    expect(out.legs[0].result).toBe('won');
    expect(out.legs[1].result).toBe('lost');
  });
});
