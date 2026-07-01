import {
  projectMatchWinner,
  projectOverUnder,
  projectBtts,
  projectAsianHandicap,
} from '../projection';
import { expectedValue, kelly, stakeFor } from '../ev';
import { scoreCandidate, selectBest } from '../router';
import { candidatesFromSnapshot } from '../odds';
import { outcome, pnlFor, regulationScore, settleOutcome } from '../settle';
import type { BetCandidate, Trade, MarketSnapshot } from '../types';
import type { MatchEvent } from 'lib/espn/types';

// 手工 3×3 矩阵(和为 1):m[主][客]
const M = [
  [0.1, 0.1, 0.0],
  [0.2, 0.3, 0.0],
  [0.3, 0.0, 0.0],
];

describe('泊松投影', () => {
  it('胜平负边际', () => {
    const r = projectMatchWinner(M);
    expect(r.home).toBeCloseTo(0.5); // (1,0)+(2,0)
    expect(r.draw).toBeCloseTo(0.4); // (0,0)+(1,1)
    expect(r.away).toBeCloseTo(0.1); // (0,1)
  });
  it('大小球半盘(无走盘)与整数盘(有走盘)', () => {
    const half = projectOverUnder(M, 1.5);
    expect(half.over).toBeCloseTo(0.6); // 总进球≥2
    expect(half.under).toBeCloseTo(0.4);
    expect(half.push).toBeCloseTo(0);
    const whole = projectOverUnder(M, 2);
    expect(whole.push).toBeCloseTo(0.6); // 总进球==2
    expect(whole.over).toBeCloseTo(0);
    expect(whole.under).toBeCloseTo(0.4);
  });
  it('双方进球', () => {
    expect(projectBtts(M).yes).toBeCloseTo(0.3); // (1,1)
  });
  it('亚盘:主-1.5 与 平手盘走盘', () => {
    const minus15 = projectAsianHandicap(M, -1.5);
    expect(minus15.homeCover).toBeCloseTo(0.3); // 净胜≥2 → (2,0)
    expect(minus15.awayCover).toBeCloseTo(0.7);
    const level = projectAsianHandicap(M, 0);
    expect(level.homeCover).toBeCloseTo(0.5);
    expect(level.push).toBeCloseTo(0.4);
    expect(level.awayCover).toBeCloseTo(0.1);
  });
});

describe('快照 → 候选(投影映射)', () => {
  it('1X2/大小球/亚盘 候选的 pWin 取自矩阵投影', () => {
    const snap: MarketSnapshot = {
      h2h: { home: { price: 2, book: 'x' }, away: { price: 3, book: 'x' } },
      totals: [
        {
          point: 1.5,
          over: { price: 1.9, book: 'x' },
          under: { price: 1.9, book: 'x' },
        },
      ],
      spreads: [{ side: 'home', point: -1.5, pick: { price: 2.4, book: 'x' } }],
    };
    const cs = candidatesFromSnapshot(
      M,
      { home: 0.5, draw: 0.4, away: 0.1 },
      snap,
    );
    const get = (m: string, sel: string) =>
      cs.find((c) => c.market === m && c.selection === sel);
    expect(get('1X2', 'home')?.pWin).toBeCloseTo(0.5);
    expect(get('1X2', 'away')?.pWin).toBeCloseTo(0.1);
    expect(get('1X2', 'draw')).toBeUndefined(); // h2h 无 draw 报价
    // G2:不押「大球」——Over 候选被 candidatesFromSnapshot 刻意剔除(over25 系统性高估,见 odds.ts);
    // 只保留 Under(偏保守、安全)。
    expect(get('OU', 'Over')).toBeUndefined();
    expect(get('OU', 'Under')?.pWin).toBeCloseTo(0.4); // 总进球≤1
    expect(get('AH', 'home')?.pWin).toBeCloseTo(0.3); // 净胜≥2
  });
});

describe('EV / Kelly / 注金', () => {
  it('EV 与 Kelly(含走盘)', () => {
    expect(expectedValue(0.6, 2.0)).toBeCloseTo(0.2);
    expect(kelly(0.6, 2.0)).toBeCloseTo(0.2);
    expect(expectedValue(0.5, 2.0)).toBeCloseTo(0); // 公平盘无优势
    expect(expectedValue(0.5, 2.0, 0.2)).toBeCloseTo(0.2); // 走盘 0.2
  });
  it('四分之一凯利 + 上限 + 最低额', () => {
    const opt = { fraction: 0.25, maxPct: 0.05, minStake: 10 };
    expect(stakeFor(0.2, 1000, opt)).toBe(50); // min(50, cap50)
    expect(stakeFor(0.02, 1000, opt)).toBe(0); // 低于最低额
    expect(stakeFor(0, 1000, opt)).toBe(0); // 无优势
  });
});

describe('智能路由', () => {
  const mk = (selection: string, pWin: number, odds: number): BetCandidate =>
    scoreCandidate({
      market: '1X2',
      selection,
      odds,
      book: 'x',
      pWin,
      pPush: 0,
    });

  it('过滤低胜率/非正EV,按凯利取最优', () => {
    const cands = [
      mk('a', 0.6, 2.0), // ev0.2 kelly0.2 ✓
      mk('b', 0.25, 5.0), // pWin<0.3 ✗
      mk('c', 0.5, 2.0), // ev0 ✗
      mk('d', 0.55, 2.0), // ev0.1 kelly0.1 ✓
    ];
    const best = selectBest(cands);
    expect(best?.selection).toBe('a');
  });
  it('无合格候选返回 null', () => {
    expect(selectBest([mk('c', 0.5, 2.0)])).toBeNull();
  });

  it('可注入阈值覆盖默认(研究引擎 sweep 用)', () => {
    // 收紧 minEv 到 0.25 → ev0.2 的正常项被剔除
    expect(selectBest([mk('a', 0.6, 2.0)], { minEv: 0.25 })).toBeNull();
    // 放宽 maxEv → 原本被上限剔除的离谱项通过
    expect(selectBest([mk('x', 0.96, 28)], { maxEv: 30 })?.selection).toBe('x');
    // 放宽 minProb → 低胜率项通过(ev=0.25 在 (0.03,0.30] 内)
    expect(selectBest([mk('b', 0.25, 5.0)], { minProb: 0.2 })?.selection).toBe(
      'b',
    );
  });

  it('EV 高得离谱(赔率/口径错配)被上限剔除', () => {
    // pWin 0.96 @ 28.0 → EV≈25.9,真实市场不可能,应弃用
    const absurd = mk('x', 0.96, 28);
    expect(absurd.ev).toBeGreaterThan(1);
    expect(selectBest([absurd])).toBeNull();
    // 正常 +EV 与离谱项并存时,只取正常项
    expect(selectBest([absurd, mk('a', 0.6, 2.0)])?.selection).toBe('a');
  });
});

describe('结算判定', () => {
  const T = (
    market: Trade['market'],
    selection: string,
    line?: number,
  ): Trade => ({
    tradeId: 't',
    matchId: 'm',
    homeTeam: 'H',
    awayTeam: 'A',
    date: '2026-06-12T00:00:00Z',
    market,
    selection,
    line,
    odds: 2,
    modelProb: 0.5,
    ev: 0.1,
    stake: 100,
    status: 'pending',
    result: null,
    pnl: null,
    placedAt: 0,
  });

  it('1X2', () => {
    expect(outcome(T('1X2', 'home'), 2, 1)).toBe('won');
    expect(outcome(T('1X2', 'home'), 1, 1)).toBe('lost');
    expect(outcome(T('1X2', 'draw'), 1, 1)).toBe('won');
  });
  it('大小球(含整数走盘)', () => {
    expect(outcome(T('OU', 'Over', 2.5), 2, 1)).toBe('won'); // 3>2.5
    expect(outcome(T('OU', 'Over', 2.5), 1, 1)).toBe('lost'); // 2<2.5
    expect(outcome(T('OU', 'Over', 2), 1, 1)).toBe('void'); // 2==2
  });
  it('亚盘(含走盘)', () => {
    expect(outcome(T('AH', 'home', -1.5), 2, 0)).toBe('won'); // 2-0-1.5>0
    expect(outcome(T('AH', 'home', -1.5), 1, 0)).toBe('lost');
    expect(outcome(T('AH', 'home', -1), 1, 0)).toBe('void'); // 1-0-1==0
    expect(outcome(T('AH', 'away', 0.5), 0, 0)).toBe('won'); // 0-0+0.5>0
  });
  it('盈亏', () => {
    const t = T('1X2', 'home');
    expect(pnlFor(t, 'won')).toBeCloseTo(100); // 100*(2-1)
    expect(pnlFor(t, 'lost')).toBeCloseTo(-100);
    expect(pnlFor(t, 'void')).toBe(0);
  });

  // ── 亚盘四分盘(.25/.75):settleOutcome 拆 line±0.25 两条相邻半盘再聚合 ──
  it('四分盘结算:主 -0.75(赢1=半赢 / 赢2=全赢 / 平=全输)', () => {
    expect(settleOutcome(T('AH', 'home', -0.75), 1, 0)).toBe('half_won');
    expect(settleOutcome(T('AH', 'home', -0.75), 2, 0)).toBe('won');
    expect(settleOutcome(T('AH', 'home', -0.75), 1, 1)).toBe('lost');
  });
  it('四分盘结算:主 -0.25 平=半输;主 +0.25 平=半赢、输1=全输', () => {
    expect(settleOutcome(T('AH', 'home', -0.25), 1, 1)).toBe('half_lost');
    expect(settleOutcome(T('AH', 'home', 0.25), 1, 1)).toBe('half_won');
    expect(settleOutcome(T('AH', 'home', 0.25), 0, 1)).toBe('lost');
  });
  it('四分盘结算:客 +1.25 输1球=半赢(拆 +1 走盘 / +1.5 赢)', () => {
    expect(settleOutcome(T('AH', 'away', 1.25), 2, 1)).toBe('half_won');
  });
  it('整数/半盘经 settleOutcome 回归 outcome', () => {
    expect(settleOutcome(T('AH', 'home', -1), 1, 0)).toBe('void');
    expect(settleOutcome(T('AH', 'home', -0.5), 0, 0)).toBe('lost');
    expect(settleOutcome(T('1X2', 'home'), 2, 1)).toBe('won');
  });
  it('四分盘盈亏映射(odds2/stake100:半赢 +50、半输 −50)', () => {
    const t = T('AH', 'home', -0.75);
    expect(pnlFor(t, 'half_won')).toBeCloseTo(50);
    expect(pnlFor(t, 'half_lost')).toBeCloseTo(-50);
    expect(pnlFor(t, 'won')).toBeCloseTo(100);
    expect(pnlFor(t, 'lost')).toBeCloseTo(-100);
  });
});

describe('90 分钟结算口径(加时/点球不计)', () => {
  const goal = (minute: string, team: string): MatchEvent => ({
    minute,
    type: 'Goal',
    team,
    scoringPlay: true,
  });

  it('未进加时:直接取终分(不依赖事件完整性)', () => {
    const ev = [goal("23'", 'H'), goal("67'", 'A')];
    expect(regulationScore(ev, 'H', 'A', 2, 1)).toEqual({ home: 2, away: 1 });
  });

  it('进加时:剔除 >90 分钟进球,只算 90 分钟比分', () => {
    // 常规 1-1(40\'主、80\'客),加时 105\' 主再入 → 终分 2-1,但 90\' 为 1-1
    const ev = [goal("40'", 'H'), goal("80'", 'A'), goal("105'", 'H')];
    expect(regulationScore(ev, 'H', 'A', 2, 1)).toEqual({ home: 1, away: 1 });
  });

  it("含补时(90'+X)仍计入 90 分钟", () => {
    const ev = [goal("45'+2'", 'H'), goal("90'+4'", 'H'), goal("113'", 'A')];
    // 终分 2-1;90\' 应为 2-0(补时算,加时不算)
    expect(regulationScore(ev, 'H', 'A', 2, 1)).toEqual({ home: 2, away: 0 });
  });

  it('点球大战(无分钟)不计入', () => {
    // 常规 1-1 + 加时无进球(检测不到加时进球)→ 走终分回退路径,终分即 1-1
    const ev = [goal("30'", 'H'), goal("88'", 'A')];
    expect(regulationScore(ev, 'H', 'A', 1, 1)).toEqual({ home: 1, away: 1 });
  });
});
