/**
 * dry-run 预生成只返回草稿单,不得落 wallet/trade_logs/signals。
 */
import type { BetCandidate } from '../types';

jest.mock('lib/predict/predict', () => ({ predictUpcoming: jest.fn() }));
jest.mock('lib/predict/ensemble', () => ({ ensemble: jest.fn() }));
jest.mock('lib/db/store', () => ({
  loadElo: jest.fn(),
  saveWallet: jest.fn(),
  saveTrades: jest.fn(),
  saveSignals: jest.fn(),
  savePredictionLog: jest.fn(),
}));
jest.mock('lib/odds/radar', () => ({ hasActiveRlm: jest.fn() }));
jest.mock('lib/predict/divergence', () => ({
  modelsFromPredictions: jest.fn(),
  classifyDivergence: jest.fn(),
}));
jest.mock('../odds', () => ({ buildCandidates: jest.fn() }));
jest.mock('../ledger', () => ({
  getWallet: jest.fn(),
  hasBet: jest.fn(),
  placeBet: jest.fn(),
}));
jest.mock('../signals', () => ({ emitSignal: jest.fn() }));

import { dryRunPreMatchBetting } from '../dryRun';
import { predictUpcoming } from 'lib/predict/predict';
import { ensemble } from 'lib/predict/ensemble';
import {
  loadElo,
  savePredictionLog,
  saveSignals,
  saveTrades,
  saveWallet,
} from 'lib/db/store';
import { hasActiveRlm } from 'lib/odds/radar';
import {
  classifyDivergence,
  modelsFromPredictions,
} from 'lib/predict/divergence';
import { buildCandidates } from '../odds';
import { getWallet, hasBet, placeBet } from '../ledger';
import { emitSignal } from '../signals';

const mockPredictUpcoming = predictUpcoming as jest.MockedFunction<
  typeof predictUpcoming
>;
const mockEnsemble = ensemble as jest.MockedFunction<typeof ensemble>;
const mockLoadElo = loadElo as jest.MockedFunction<typeof loadElo>;
const mockHasActiveRlm = hasActiveRlm as jest.MockedFunction<
  typeof hasActiveRlm
>;
const mockModelsFromPredictions = modelsFromPredictions as jest.MockedFunction<
  typeof modelsFromPredictions
>;
const mockClassifyDivergence = classifyDivergence as jest.MockedFunction<
  typeof classifyDivergence
>;
const mockBuildCandidates = buildCandidates as jest.MockedFunction<
  typeof buildCandidates
>;
const mockGetWallet = getWallet as jest.MockedFunction<typeof getWallet>;
const mockHasBet = hasBet as jest.MockedFunction<typeof hasBet>;
const mockPlaceBet = placeBet as jest.MockedFunction<typeof placeBet>;
const mockEmitSignal = emitSignal as jest.MockedFunction<typeof emitSignal>;
const mockSaveWallet = saveWallet as jest.MockedFunction<typeof saveWallet>;
const mockSaveTrades = saveTrades as jest.MockedFunction<typeof saveTrades>;
const mockSaveSignals = saveSignals as jest.MockedFunction<typeof saveSignals>;
const mockSavePredictionLog = savePredictionLog as jest.MockedFunction<
  typeof savePredictionLog
>;

const NOW = Date.parse('2026-07-01T00:00:00Z');

const candidate = (over: Partial<BetCandidate> = {}): BetCandidate => ({
  market: '1X2',
  selection: 'home',
  odds: 2,
  book: 'book',
  pWin: 0.6,
  pPush: 0,
  ev: 0.2,
  kelly: 0.2,
  ...over,
});

const match = (id: string, over: Record<string, unknown> = {}) => ({
  matchId: id,
  homeTeam: `Home ${id}`,
  awayTeam: `Away ${id}`,
  commenceTime: '2026-07-01T12:00:00Z',
  status: 'pre',
  predictions: [
    { modelId: 'poisson-xg', homeWin: 0.6, draw: 0.25, awayWin: 0.15 },
  ],
  ensemble: {
    modelId: 'ensemble',
    matchId: id,
    homeWin: 0.6,
    draw: 0.25,
    awayWin: 0.15,
    confidence: 'medium',
    xgHome: 1.6,
    xgAway: 0.9,
  },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadElo.mockReturnValue({});
  mockGetWallet.mockReturnValue({
    initialBalance: 10000,
    currentBalance: 10000,
    lockedBalance: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    updatedAt: NOW,
  });
  mockHasBet.mockReturnValue(false);
  mockHasActiveRlm.mockReturnValue(false);
  mockModelsFromPredictions.mockReturnValue({
    market: { h: 0.5, d: 0.25, a: 0.25 },
    ensemble: { h: 0.6, d: 0.25, a: 0.15 },
  });
  mockClassifyDivergence.mockReturnValue('CONSENSUS');
  mockEnsemble.mockReturnValue({
    modelId: 'ensemble',
    matchId: 'm',
    homeWin: 0.6,
    draw: 0.25,
    awayWin: 0.15,
    confidence: 'medium',
  });
});

describe('dryRunPreMatchBetting', () => {
  it('生成 value 草稿单但不调用落库/信号函数', async () => {
    mockPredictUpcoming.mockResolvedValue([match('m1') as any]);
    mockBuildCandidates.mockResolvedValue([candidate()]);

    const out = await dryRunPreMatchBetting({ matchIds: ['m1'], now: NOW });

    expect(out.summary).toEqual(
      expect.objectContaining({
        requested: 1,
        scanned: 1,
        generated: 1,
        value: 1,
      }),
    );
    expect(out.slips[0]).toEqual(
      expect.objectContaining({
        dryRun: true,
        status: 'pending',
        tier: 'value',
        stake: 500,
        balanceBefore: 10000,
        balanceAfter: 9500,
      }),
    );
    expect(mockPlaceBet).not.toHaveBeenCalled();
    expect(mockEmitSignal).not.toHaveBeenCalled();
    expect(mockSaveWallet).not.toHaveBeenCalled();
    expect(mockSaveTrades).not.toHaveBeenCalled();
    expect(mockSaveSignals).not.toHaveBeenCalled();
    expect(mockSavePredictionLog).not.toHaveBeenCalled();
  });

  it('无合格 value 时按融合热门方生成 coverage 草稿', async () => {
    mockPredictUpcoming.mockResolvedValue([match('m1') as any]);
    mockBuildCandidates.mockResolvedValue([
      candidate({ selection: 'home', pWin: 0.5, ev: 0, kelly: 0 }),
    ]);

    const out = await dryRunPreMatchBetting({ matchIds: ['m1'], now: NOW });

    expect(out.slips[0]).toEqual(
      expect.objectContaining({
        tier: 'coverage',
        stake: 50,
        selection: 'home',
      }),
    );
  });

  it('已真实下注的比赛会跳过', async () => {
    mockPredictUpcoming.mockResolvedValue([match('m1') as any]);
    mockHasBet.mockReturnValue(true);

    const out = await dryRunPreMatchBetting({ matchIds: ['m1'], now: NOW });

    expect(out.slips).toHaveLength(0);
    expect(out.skipped[0]).toEqual(
      expect.objectContaining({ matchId: 'm1', reason: 'already_bet' }),
    );
  });

  it('RLM 风控会否决 value 并允许 coverage fallback', async () => {
    mockPredictUpcoming.mockResolvedValue([match('m1') as any]);
    mockBuildCandidates.mockResolvedValue([
      candidate({ selection: 'away', pWin: 0.6, ev: 0.2, kelly: 0.2 }),
      candidate({ selection: 'home', pWin: 0.5, ev: 0, kelly: 0 }),
    ]);
    mockHasActiveRlm.mockReturnValue(true);

    const out = await dryRunPreMatchBetting({ matchIds: ['m1'], now: NOW });

    expect(out.slips[0]).toEqual(
      expect.objectContaining({
        tier: 'coverage',
        selection: 'home',
        veto: 'RLM',
      }),
    );
  });

  it('R1 弱侧 value 会被否决并允许 coverage fallback', async () => {
    mockPredictUpcoming.mockResolvedValue([match('m1') as any]);
    mockBuildCandidates.mockResolvedValue([
      candidate({ selection: 'away', pWin: 0.6, ev: 0.2, kelly: 0.2 }),
      candidate({ selection: 'home', pWin: 0.5, ev: 0, kelly: 0 }),
    ]);
    mockModelsFromPredictions.mockReturnValue({
      market: { h: 0.7, d: 0.2, a: 0.1 },
      ensemble: { h: 0.6, d: 0.25, a: 0.15 },
    });
    mockClassifyDivergence.mockReturnValue('R1_UNDERCONF');

    const out = await dryRunPreMatchBetting({ matchIds: ['m1'], now: NOW });

    expect(out.slips[0]).toEqual(
      expect.objectContaining({
        tier: 'coverage',
        selection: 'home',
        veto: 'R1_UNDERCONF',
      }),
    );
  });

  it('多场草稿用本地余额顺序递减计算 stake', async () => {
    mockPredictUpcoming.mockResolvedValue([
      match('m1') as any,
      match('m2') as any,
    ]);
    mockBuildCandidates.mockResolvedValue([candidate()]);

    const out = await dryRunPreMatchBetting({
      matchIds: ['m1', 'm2'],
      now: NOW,
    });

    expect(out.slips.map((x) => x.stake)).toEqual([500, 475]);
    expect(out.balance).toEqual({ start: 10000, end: 9025 });
  });

  it('按真实扫描的开赛时间顺序模拟余额,不受请求顺序影响', async () => {
    mockPredictUpcoming.mockResolvedValue([
      match('late', { commenceTime: '2026-07-01T18:00:00Z' }) as any,
      match('early', { commenceTime: '2026-07-01T10:00:00Z' }) as any,
    ]);
    mockBuildCandidates.mockResolvedValue([candidate()]);

    const out = await dryRunPreMatchBetting({
      matchIds: ['late', 'early'],
      now: NOW,
    });

    expect(out.slips.map((x) => x.matchId)).toEqual(['early', 'late']);
    expect(out.slips.map((x) => x.stake)).toEqual([500, 475]);
  });

  it('未找到的比赛返回 not_found', async () => {
    mockPredictUpcoming.mockResolvedValue([]);

    const out = await dryRunPreMatchBetting({
      matchIds: ['missing'],
      now: NOW,
    });

    expect(out.skipped[0]).toEqual(
      expect.objectContaining({ matchId: 'missing', reason: 'not_found' }),
    );
  });
});
