/**
 * Phase 9 结算核心测试:judgeLeg 各盘口判定 + settleSlip 串关/单注聚合。
 * 覆盖整数盘走盘、四分盘半赢半输,以及串关里走盘/半赢致 needs_review 的所有分支。
 */
import { judgeLeg, settleSlip } from 'lib/bets/settle';
import type { BetLeg, LegResult } from 'lib/bets/types';

/** 构造一条最小可结算腿(只有 settleSlip 用到的字段无关紧要时占位)。 */
function leg(over: Partial<BetLeg> = {}): BetLeg {
  return {
    homeName: 'H',
    awayName: 'A',
    market: '1X2',
    selection: 'home',
    ...over,
  };
}

describe('judgeLeg —— 基础盘口', () => {
  it('1X2 主胜:主队领先判 won,所选 away 判 lost', () => {
    expect(judgeLeg('1X2', 'home', undefined, 2, 1)).toBe('won');
    expect(judgeLeg('1X2', 'away', undefined, 2, 1)).toBe('lost');
  });

  it('1X2 平局:所选 draw 判 won', () => {
    expect(judgeLeg('1X2', 'draw', undefined, 1, 1)).toBe('won');
    expect(judgeLeg('1X2', 'home', undefined, 1, 1)).toBe('lost');
  });

  it('1X2 客胜:所选 away 判 won', () => {
    expect(judgeLeg('1X2', 'away', undefined, 0, 2)).toBe('won');
  });

  it('OU Over/Under 正常判定', () => {
    expect(judgeLeg('OU', 'Over', 2.5, 2, 1)).toBe('won');
    expect(judgeLeg('OU', 'Under', 2.5, 2, 1)).toBe('lost');
    expect(judgeLeg('OU', 'Under', 2.5, 1, 0)).toBe('won');
  });

  it('OU 整数盘命中线 → 走盘 void', () => {
    expect(judgeLeg('OU', 'Over', 3, 2, 1)).toBe('void');
    expect(judgeLeg('OU', 'Under', 3, 2, 1)).toBe('void');
  });

  it('BTTS 双方进球 Yes/No', () => {
    expect(judgeLeg('BTTS', 'Yes', undefined, 1, 1)).toBe('won');
    expect(judgeLeg('BTTS', 'No', undefined, 1, 1)).toBe('lost');
    expect(judgeLeg('BTTS', 'No', undefined, 2, 0)).toBe('won');
  });

  it('DC 双重机会 1X/12/X2', () => {
    expect(judgeLeg('DC', '1X', undefined, 1, 1)).toBe('won'); // 非客胜
    expect(judgeLeg('DC', '1X', undefined, 0, 1)).toBe('lost');
    expect(judgeLeg('DC', '12', undefined, 2, 0)).toBe('won'); // 非平
    expect(judgeLeg('DC', '12', undefined, 1, 1)).toBe('lost');
    expect(judgeLeg('DC', 'X2', undefined, 0, 2)).toBe('won'); // 非主胜
    expect(judgeLeg('DC', 'X2', undefined, 2, 0)).toBe('lost');
  });

  it('DNB 平局退款 → void;否则按主/客胜判', () => {
    expect(judgeLeg('DNB', 'home', undefined, 1, 1)).toBe('void');
    expect(judgeLeg('DNB', 'home', undefined, 2, 1)).toBe('won');
    expect(judgeLeg('DNB', 'home', undefined, 0, 1)).toBe('lost');
  });
});

describe('judgeLeg —— 亚盘(AH)', () => {
  it('整数盘命中 → 走盘 void', () => {
    // home -1,主胜 1 球:margin = (1-0) + (-1) = 0 → void
    expect(judgeLeg('AH', 'home', -1, 1, 0)).toBe('void');
  });

  it('整数盘赢/输', () => {
    expect(judgeLeg('AH', 'home', -1, 2, 0)).toBe('won');
    expect(judgeLeg('AH', 'home', -1, 1, 1)).toBe('lost');
  });

  it('半盘无走盘,只有 won/lost', () => {
    // home -0.5,主胜:margin=0.5 → won
    expect(judgeLeg('AH', 'home', -0.5, 1, 0)).toBe('won');
    // home -0.5,平局:margin=-0.5 → lost
    expect(judgeLeg('AH', 'home', -0.5, 1, 1)).toBe('lost');
  });

  it('四分盘 -0.75 主胜 1 球 → half_won(半盘 -1 走盘 + 半盘 -0.5 赢)', () => {
    expect(judgeLeg('AH', 'home', -0.75, 1, 0)).toBe('half_won');
  });

  it('四分盘 -0.75 主胜 2 球 → won(两半皆赢)', () => {
    expect(judgeLeg('AH', 'home', -0.75, 2, 0)).toBe('won');
  });

  it('四分盘 -0.75 平局 → lost(两半皆输)', () => {
    expect(judgeLeg('AH', 'home', -0.75, 1, 1)).toBe('lost');
  });

  it('四分盘 -0.25 平局 → half_lost(半盘 -0.5 输 + 半盘 0 走盘)', () => {
    expect(judgeLeg('AH', 'home', -0.25, 1, 1)).toBe('half_lost');
  });

  it('四分盘 +0.25 平局 → half_won(半盘 0 走盘 + 半盘 +0.5 赢)', () => {
    expect(judgeLeg('AH', 'home', 0.25, 1, 1)).toBe('half_won');
  });

  it('四分盘 +0.25 输 1 球 → lost(两半皆输)', () => {
    expect(judgeLeg('AH', 'home', 0.25, 0, 1)).toBe('lost');
  });

  it('四分盘 +0.25 赢 → won(两半皆赢)', () => {
    expect(judgeLeg('AH', 'home', 0.25, 1, 0)).toBe('won');
  });

  it('客方四分盘 away +0.25:客负 1 球但 +0.25 → half_lost 由半盘组合产生', () => {
    // away +0.25 → lowHalf 0, highHalf 0.5;客负1球(gf=1,ga=0)
    // margin = (ga-gf)+point = -1+point;@0 = -1 lost;@0.5 = -0.5 lost → lost
    expect(judgeLeg('AH', 'away', 0.25, 1, 0)).toBe('lost');
    // away +0.25 平局:margin@0 = 0 void;@0.5 = 0.5 won → half_won
    expect(judgeLeg('AH', 'away', 0.25, 1, 1)).toBe('half_won');
  });
});

describe('settleSlip —— 串关聚合', () => {
  const slip = {
    stake: 100,
    potentialReturn: 350,
    legs: [leg(), leg(), leg()],
  };

  it('全赢 → won,pnl = potentialReturn(可盈=净盈利)', () => {
    const r: LegResult[] = ['won', 'won', 'won'];
    expect(settleSlip(slip, r)).toEqual({ status: 'won', pnl: 350 });
  });

  it('有一腿输 → lost,pnl = −stake', () => {
    const r: LegResult[] = ['won', 'lost', 'won'];
    expect(settleSlip(slip, r)).toEqual({ status: 'lost', pnl: -100 });
  });

  it('一腿走盘其余赢 → needs_review(截图金额失真)', () => {
    const r: LegResult[] = ['won', 'void', 'won'];
    expect(settleSlip(slip, r)).toEqual({ status: 'needs_review', pnl: null });
  });

  it('有一腿 pending → pending,pnl null', () => {
    const r: LegResult[] = ['won', 'pending', 'won'];
    expect(settleSlip(slip, r)).toEqual({ status: 'pending', pnl: null });
  });

  it('有一腿 unmatched → unmatched(优先于 pending)', () => {
    const r: LegResult[] = ['pending', 'unmatched', 'won'];
    expect(settleSlip(slip, r)).toEqual({ status: 'unmatched', pnl: null });
  });

  it('有 half_won → needs_review', () => {
    const r: LegResult[] = ['won', 'half_won', 'won'];
    expect(settleSlip(slip, r)).toEqual({ status: 'needs_review', pnl: null });
  });

  it('有 half_lost → needs_review(优先于 lost 判断)', () => {
    const r: LegResult[] = ['lost', 'half_lost', 'won'];
    expect(settleSlip(slip, r)).toEqual({ status: 'needs_review', pnl: null });
  });

  it('含不支持盘口 → needs_review(优先于一切)', () => {
    const r: LegResult[] = ['won', 'unsupported', 'lost'];
    expect(settleSlip(slip, r)).toEqual({ status: 'needs_review', pnl: null });
  });
});

describe('judgeLeg —— 不支持的盘口(波胆/半场等)', () => {
  it('OTHER / 非 6 码 → unsupported(不臆造)', () => {
    expect(judgeLeg('OTHER', '1-1', undefined, 2, 1)).toBe('unsupported');
    expect(judgeLeg('CS', '2-0', undefined, 0, 0)).toBe('unsupported');
  });
});

describe('settleSlip —— 单注', () => {
  const single = { stake: 50, potentialReturn: 130, legs: [leg()] };

  it('won → pnl = potentialReturn(可盈=净盈利)', () => {
    expect(settleSlip(single, ['won'])).toEqual({ status: 'won', pnl: 130 });
  });

  it('lost → pnl = −stake', () => {
    expect(settleSlip(single, ['lost'])).toEqual({ status: 'lost', pnl: -50 });
  });

  it('void(走盘)→ 整单退本,pnl 0', () => {
    expect(settleSlip(single, ['void'])).toEqual({ status: 'void', pnl: 0 });
  });

  it('half_won → needs_review(单注金额无法表达半赢)', () => {
    expect(settleSlip(single, ['half_won'])).toEqual({
      status: 'needs_review',
      pnl: null,
    });
  });

  it('half_lost → needs_review', () => {
    expect(settleSlip(single, ['half_lost'])).toEqual({
      status: 'needs_review',
      pnl: null,
    });
  });

  it('pending → pending', () => {
    expect(settleSlip(single, ['pending'])).toEqual({
      status: 'pending',
      pnl: null,
    });
  });

  it('unmatched → unmatched', () => {
    expect(settleSlip(single, ['unmatched'])).toEqual({
      status: 'unmatched',
      pnl: null,
    });
  });
});
