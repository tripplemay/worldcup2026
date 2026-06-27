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

  it('确输优先于 half_lost:有确输腿 → 即时判输 lost', () => {
    const r: LegResult[] = ['lost', 'half_lost', 'won'];
    expect(settleSlip(slip, r)).toEqual({ status: 'lost', pnl: -100 });
  });

  it('确输优先于不支持盘口:含确输腿 → 即时判输 lost(不再 needs_review)', () => {
    const r: LegResult[] = ['won', 'unsupported', 'lost'];
    expect(settleSlip(slip, r)).toEqual({ status: 'lost', pnl: -100 });
  });

  it('含不支持腿但无确输 → needs_review(无法定论)', () => {
    const r: LegResult[] = ['won', 'unsupported', 'won'];
    expect(settleSlip(slip, r)).toEqual({ status: 'needs_review', pnl: null });
  });
});

describe('settleSlip —— 串关即时判输(每场收官即时结算)', () => {
  const slip = {
    stake: 100,
    potentialReturn: 350,
    legs: [leg(), leg(), leg()],
  };

  it('一腿已输、其余腿还未结 → 立刻判输(不等其余腿)', () => {
    expect(settleSlip(slip, ['lost', 'pending', 'pending'])).toEqual({
      status: 'lost',
      pnl: -100,
    });
  });

  it('一腿已输、另一腿不支持 → 立刻判输(确输使不支持腿无关)', () => {
    expect(settleSlip(slip, ['lost', 'unsupported', 'pending'])).toEqual({
      status: 'lost',
      pnl: -100,
    });
  });

  it('一腿已输、另一腿未匹配 → 立刻判输', () => {
    expect(settleSlip(slip, ['lost', 'unmatched', 'won'])).toEqual({
      status: 'lost',
      pnl: -100,
    });
  });

  it('无确输腿、含不支持 + 未结 → 保持 pending(留待定论,避免过早转人工)', () => {
    expect(settleSlip(slip, ['won', 'unsupported', 'pending'])).toEqual({
      status: 'pending',
      pnl: null,
    });
  });

  it('无确输腿、仅未结 → pending(赢需全中,继续等)', () => {
    expect(settleSlip(slip, ['won', 'won', 'pending'])).toEqual({
      status: 'pending',
      pnl: null,
    });
  });
});

describe('judgeLeg —— 不支持的盘口', () => {
  it('OTHER / 未知码(角球等)→ unsupported(不臆造)', () => {
    expect(judgeLeg('OTHER', '1-1', undefined, 2, 1)).toBe('unsupported');
    expect(judgeLeg('CORNERS', 'over', undefined, 0, 0)).toBe('unsupported');
  });
});

describe('judgeLeg —— 波胆(正确比分)', () => {
  it('全场 CS:命中=won,不中=lost', () => {
    expect(judgeLeg('CS', '2-0', undefined, 2, 0)).toBe('won');
    expect(judgeLeg('CS', '2-0', undefined, 1, 0)).toBe('lost');
    expect(judgeLeg('CS', '1-1', undefined, 1, 1)).toBe('won');
  });
  it('比分无法解析 → unsupported(转人工)', () => {
    expect(judgeLeg('CS', '大比分', undefined, 2, 0)).toBe('unsupported');
  });
  it('上半场 CS1H:按上半场比分判;缺半场比分 → unsupported', () => {
    // 上半场 2-0,全场 3-1
    expect(judgeLeg('CS1H', '2-0', undefined, 3, 1, { h: 2, a: 0 })).toBe(
      'won',
    );
    expect(judgeLeg('CS1H', '1-0', undefined, 3, 1, { h: 2, a: 0 })).toBe(
      'lost',
    );
    expect(judgeLeg('CS1H', '2-0', undefined, 3, 1)).toBe('unsupported');
  });
  it('下半场 CS2H:全场−上半场;缺半场比分 → unsupported', () => {
    // 全场 3-1,上半场 2-0 → 下半场 1-1
    expect(judgeLeg('CS2H', '1-1', undefined, 3, 1, { h: 2, a: 0 })).toBe(
      'won',
    );
    expect(judgeLeg('CS2H', '0-1', undefined, 3, 1, { h: 2, a: 0 })).toBe(
      'lost',
    );
    expect(judgeLeg('CS2H', '1-1', undefined, 3, 1)).toBe('unsupported');
  });
});

describe('judgeLeg —— 滚球剩余赛程口径(base)', () => {
  // 第 7 个参数 parts 占位 undefined,第 8 个参数 base 为下注时比分(注单主客视角)
  const J = (
    market: string,
    sel: string,
    line: number | undefined,
    gf: number,
    ga: number,
    base: { h: number; a: number },
  ) => judgeLeg(market, sel, line, gf, ga, undefined, undefined, base);

  it('剩余让球:对「下注后净增比分」判定(下注 1-0,终分 2-0 → 增量 1-0)', () => {
    // 增量 1-0,AH home -0.5 → 净胜0.5 → won
    expect(J('AH', 'home', -0.5, 2, 0, { h: 1, a: 0 })).toBe('won');
  });

  it('与全场口径背离:同样终分 2-0,基线 1-0 下 -1.5 应判输(全场会判赢)', () => {
    // 剩余:增量 1-0,margin = 1 - 1.5 = -0.5 → lost
    expect(J('AH', 'home', -1.5, 2, 0, { h: 1, a: 0 })).toBe('lost');
    // 对照:全场口径 2-0 让 -1.5 → margin 0.5 → won
    expect(judgeLeg('AH', 'home', -1.5, 2, 0)).toBe('won');
  });

  it('剩余大小:只算下注后进球(下注 1-1,终分 2-2 → 增量总分 2)', () => {
    expect(J('OU', 'Over', 2.5, 2, 2, { h: 1, a: 1 })).toBe('lost'); // 增量总分 2 < 2.5
    expect(J('OU', 'Under', 2.5, 2, 2, { h: 1, a: 1 })).toBe('won');
    // 对照:全场总分 4 > 2.5 → Over won
    expect(judgeLeg('OU', 'Over', 2.5, 2, 2)).toBe('won');
  });

  it('剩余四分盘:增量上套半盘/四分盘逻辑(基线 1-0,终分 2-0 → 增量 1-0,-0.75 半赢)', () => {
    expect(J('AH', 'home', -0.75, 2, 0, { h: 1, a: 0 })).toBe('half_won');
  });

  it('全场赛果型盘(1X2/BTTS/DNB)即便带 base 也忽略基线、按全场终分结算', () => {
    // 关键回归:领先方保持比分到终场不能被增量重置成平/输
    // 1X2:下注 1-0 买 home、终分 1-0 → 全场主胜 → won(错按增量会判 lost)
    expect(J('1X2', 'home', undefined, 1, 0, { h: 1, a: 0 })).toBe('won');
    // 1X2:下注 0-1 买 home、终分 1-1 → 全场平 → home lost(错按增量 1-0 会判 won)
    expect(J('1X2', 'home', undefined, 1, 1, { h: 0, a: 1 })).toBe('lost');
    // BTTS:下注 1-0 买 Yes、终分 1-1 → 全场双方都进 → won(错按增量 0-1 会判 lost)
    expect(J('BTTS', 'Yes', undefined, 1, 1, { h: 1, a: 0 })).toBe('won');
    // DNB:下注 1-0 买 home、终分 1-1 → 全场平 → 退本 void(错按增量会判 lost)
    expect(J('DNB', 'home', undefined, 1, 1, { h: 1, a: 0 })).toBe('void');
  });

  it('终分 < 基线(改分/数据异常)→ unsupported,绝不臆算(仅 AH/OU 走增量)', () => {
    expect(J('AH', 'home', -0.5, 1, 0, { h: 2, a: 0 })).toBe('unsupported');
    expect(J('OU', 'Over', 1.5, 1, 1, { h: 1, a: 2 })).toBe('unsupported');
  });

  it('波胆/半场带 base 也忽略基线、按全场判(非 AH/OU 无剩余口径)', () => {
    // CS:base 1-0、终分 2-0 → 按全场 2-0(非增量 1-0)→ 选 1-0 lost、选 2-0 won
    expect(J('CS', '1-0', undefined, 2, 0, { h: 1, a: 0 })).toBe('lost');
    expect(J('CS', '2-0', undefined, 2, 0, { h: 1, a: 0 })).toBe('won');
    // 上半场波胆:带 base 仍按上半场比分判(全场口径子周期),给 ht 才可判
    expect(
      judgeLeg('CS1H', '1-0', undefined, 2, 0, { h: 1, a: 0 }, undefined, {
        h: 1,
        a: 0,
      }),
    ).toBe('won');
  });

  it('无 base 时行为不变(全场口径回归)', () => {
    expect(judgeLeg('AH', 'home', -1.5, 2, 0)).toBe('won');
    expect(judgeLeg('OU', 'Over', 2.5, 2, 2)).toBe('won');
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
