/**
 * recognize 模块单测:聚焦纯函数 parseRecognizedSlip(校验/清洗,无网络)。
 * hasVision 的 env 守卫一并覆盖。
 */
import { hasVision, parseRecognizedSlip } from 'lib/bets/recognize';

describe('parseRecognizedSlip — 赛事冠军长期盘', () => {
  it('识别世界杯冠军盘且不要求主客队', () => {
    const slip = parseRecognizedSlip({
      stake: 200,
      potentialReturn: 1360,
      currency: 'CNY',
      confidence: 0.98,
      legs: [
        {
          kind: 'outright',
          competition: '世界杯2026(在加拿大、墨西哥&美国)',
          market: 'OUTRIGHT_WINNER',
          selection: '英格兰',
          odds: 7.8,
          settleAt: '2026-07-20 03:00:00',
          homeName: null,
          awayName: null,
        },
      ],
    });
    expect(slip).not.toBeNull();
    expect(slip!.legs[0]).toEqual(
      expect.objectContaining({
        kind: 'outright',
        competition: '世界杯2026(在加拿大、墨西哥&美国)',
        market: 'OUTRIGHT_WINNER',
        selection: '英格兰',
        odds: 7.8,
        settleAt: '2026-07-20 03:00:00',
      }),
    );
    expect(slip!.potentialReturn).toBe(1360);
    expect(slip!.legs[0].homeName).toBeUndefined();
    expect(slip!.legs[0].awayName).toBeUndefined();
  });

  it('识别冠亚军顺序盘并保留顺序', () => {
    const slip = parseRecognizedSlip({
      stake: 500,
      potentialReturn: 12500,
      confidence: 0.93,
      legs: [
        {
          kind: 'outright',
          competition: '世界杯2026(在加拿大、墨西哥&美国)',
          market: 'OUTRIGHT_EXACTA',
          selection: '法国 / 巴西',
          odds: 26,
          rawText: '最终正确排名第一 / 第二',
        },
      ],
    });
    expect(slip).not.toBeNull();
    expect(slip!.legs[0]).toEqual(
      expect.objectContaining({
        kind: 'outright',
        market: 'OUTRIGHT_EXACTA',
        selection: '法国 / 巴西',
      }),
    );
  });

  it('兼容历史 OTHER + 最终正确排名第一/第二,从 home/away 拼成冠亚军顺序盘', () => {
    const slip = parseRecognizedSlip({
      stake: 500,
      potentialReturn: 12500,
      legs: [
        {
          homeName: '法国',
          awayName: '巴西',
          league: '世界杯 2026(在加拿大、墨西哥&美国)',
          market: 'OTHER',
          selection: '法国 / 巴西',
          odds: 26,
          rawText: '欧洲盘 最终正确排名第一 / 第二',
        },
      ],
    });
    expect(slip).not.toBeNull();
    expect(slip!.legs[0]).toEqual(
      expect.objectContaining({
        kind: 'outright',
        competition: '世界杯 2026(在加拿大、墨西哥&美国)',
        market: 'OUTRIGHT_EXACTA',
        selection: '法国 / 巴西',
      }),
    );
  });

  it('兼容模型输出 champion 别名,但缺赛事或冠军选择时丢弃', () => {
    const ok = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 50,
      legs: [
        {
          market: 'champion',
          competition: 'FIFA World Cup 2026',
          selection: 'England',
        },
      ],
    });
    expect(ok!.legs[0].market).toBe('OUTRIGHT_WINNER');
    expect(
      parseRecognizedSlip({
        stake: 10,
        potentialReturn: 50,
        legs: [
          { kind: 'outright', market: 'OUTRIGHT_WINNER', selection: 'England' },
        ],
      }),
    ).toBeNull();
  });
});

describe('parseRecognizedSlip — 完整有效对象', () => {
  it('应清洗数字、归一可选字段、保留多腿', () => {
    const slip = parseRecognizedSlip({
      stake: 100,
      potentialReturn: 350,
      currency: 'CNY',
      platform: 'Bet365',
      confidence: 0.8,
      legs: [
        {
          homeName: 'Arsenal',
          awayName: 'Chelsea',
          league: 'epl',
          matchDate: '2026-08-15',
          market: 'AH',
          selection: 'home',
          line: -0.5,
          odds: 1.9,
        },
        {
          homeName: 'Real Madrid',
          awayName: 'Barcelona',
          market: 'OU',
          selection: 'Over',
          line: 2.5,
          odds: 2.05,
        },
      ],
    });
    expect(slip).not.toBeNull();
    expect(slip!.stake).toBe(100);
    expect(slip!.potentialReturn).toBe(350);
    expect(slip!.currency).toBe('CNY');
    expect(slip!.platform).toBe('Bet365');
    expect(slip!.confidence).toBeCloseTo(0.8);
    expect(slip!.legs).toHaveLength(2);
    expect(slip!.legs[0].market).toBe('AH');
    expect(slip!.legs[0].line).toBe(-0.5);
    expect(slip!.legs[1].selection).toBe('Over');
  });
});

describe('parseRecognizedSlip — confidence 处理', () => {
  it('缺失时默认 0.5', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        { homeName: 'A', awayName: 'B', market: '1X2', selection: 'home' },
      ],
    });
    expect(slip!.confidence).toBe(0.5);
  });

  it.each([
    [1.7, 1],
    [-0.3, 0],
    [0.42, 0.42],
  ])('值 %p 钳到 %p', (input, expected) => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      confidence: input,
      legs: [
        { homeName: 'A', awayName: 'B', market: '1X2', selection: 'home' },
      ],
    });
    expect(slip!.confidence).toBeCloseTo(expected);
  });

  it('NaN 字符串 confidence 回退 0.5', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      confidence: 'abc',
      legs: [
        { homeName: 'A', awayName: 'B', market: '1X2', selection: 'home' },
      ],
    });
    expect(slip!.confidence).toBe(0.5);
  });
});

describe('parseRecognizedSlip — 字符串数字强转', () => {
  it('"12.5" 等字符串经 Number 强转', () => {
    const slip = parseRecognizedSlip({
      stake: '12.5',
      potentialReturn: '40',
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: 'OU',
          selection: 'Under',
          line: '2.5',
          odds: '1.85',
        },
      ],
    });
    expect(slip!.stake).toBeCloseTo(12.5);
    expect(slip!.potentialReturn).toBe(40);
    expect(slip!.legs[0].line).toBeCloseTo(2.5);
    expect(slip!.legs[0].odds).toBeCloseTo(1.85);
  });
});

describe('parseRecognizedSlip — 无效输入返回 null', () => {
  it('legs 为空数组 → null', () => {
    expect(
      parseRecognizedSlip({ stake: 10, potentialReturn: 20, legs: [] }),
    ).toBeNull();
  });

  it('stake 非数字 → null', () => {
    expect(
      parseRecognizedSlip({
        stake: 'NaN',
        potentialReturn: 20,
        legs: [
          { homeName: 'A', awayName: 'B', market: '1X2', selection: 'home' },
        ],
      }),
    ).toBeNull();
  });

  it('potentialReturn 缺失 → null', () => {
    expect(
      parseRecognizedSlip({
        stake: 10,
        legs: [
          { homeName: 'A', awayName: 'B', market: '1X2', selection: 'home' },
        ],
      }),
    ).toBeNull();
  });

  it('legs 非数组 → null', () => {
    expect(
      parseRecognizedSlip({ stake: 10, potentialReturn: 20, legs: 'oops' }),
    ).toBeNull();
  });

  it('非对象 / null → null', () => {
    expect(parseRecognizedSlip(null)).toBeNull();
    expect(parseRecognizedSlip('x')).toBeNull();
    expect(parseRecognizedSlip(42)).toBeNull();
  });
});

describe('parseRecognizedSlip — 可选字段与脏腿清洗', () => {
  it('currency/line/odds 为 null → undefined', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      currency: null,
      platform: null,
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: '1X2',
          selection: 'home',
          line: null,
          odds: null,
          league: null,
          matchDate: null,
        },
      ],
    });
    expect(slip!.currency).toBeUndefined();
    expect(slip!.platform).toBeUndefined();
    expect(slip!.legs[0].line).toBeUndefined();
    expect(slip!.legs[0].odds).toBeUndefined();
    expect(slip!.legs[0].league).toBeUndefined();
    expect(slip!.legs[0].matchDate).toBeUndefined();
  });

  it('缺 homeName 的腿被丢弃,其余保留', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        { awayName: 'B', market: '1X2', selection: 'home' }, // 无 homeName → drop
        { homeName: 'C', awayName: 'D', market: '1X2', selection: 'away' },
      ],
    });
    expect(slip!.legs).toHaveLength(1);
    expect(slip!.legs[0].homeName).toBe('C');
  });

  it('所有腿都被丢弃 → null', () => {
    expect(
      parseRecognizedSlip({
        stake: 10,
        potentialReturn: 20,
        legs: [{ awayName: 'B', market: '1X2', selection: 'home' }],
      }),
    ).toBeNull();
  });

  it('字符串字段被 trim', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      currency: '  USD  ',
      legs: [
        {
          homeName: '  A  ',
          awayName: ' B ',
          market: '1X2',
          selection: ' home ',
        },
      ],
    });
    expect(slip!.currency).toBe('USD');
    expect(slip!.legs[0].homeName).toBe('A');
    expect(slip!.legs[0].selection).toBe('home');
  });
});

describe('parseRecognizedSlip — 市场码大小写归一', () => {
  it('小写/变体市场码归一为大写并保留(不误判 OTHER)', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        { homeName: 'A', awayName: 'B', market: 'cs', selection: '2-1' },
        {
          homeName: 'C',
          awayName: 'D',
          market: 'ou',
          selection: 'Over',
          line: 2.5,
        },
        { homeName: 'E', awayName: 'F', market: '1x2', selection: 'home' },
        { homeName: 'G', awayName: 'H', market: 'cs2h', selection: '1-1' },
      ],
    });
    expect(slip!.legs.map((l) => l.market)).toEqual([
      'CS',
      'OU',
      '1X2',
      'CS2H',
    ]);
  });

  it('真未知盘口仍归为 OTHER', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: 'corners',
          selection: 'over 9.5',
        },
      ],
    });
    expect(slip!.legs[0].market).toBe('OTHER');
  });
});

describe('parseRecognizedSlip — 同场组合盘 COMBO', () => {
  it('解析 COMBO 子盘(子 market 大小写归一,line 保留)', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        {
          homeName: 'Switzerland',
          awayName: 'Canada',
          market: 'combo',
          selection: '和局 & 小2.5',
          parts: [
            { market: '1x2', selection: 'draw' },
            { market: 'ou', selection: 'Under', line: 2.5 },
          ],
        },
      ],
    });
    const leg = slip!.legs[0];
    expect(leg.market).toBe('COMBO');
    expect(leg.parts).toEqual([
      { market: '1X2', selection: 'draw' },
      { market: 'OU', selection: 'Under', line: 2.5 },
    ]);
  });

  it('子盘含不支持盘口 → 整组降为 OTHER', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: 'COMBO',
          selection: '主胜 & 角球大',
          parts: [
            { market: '1X2', selection: 'home' },
            { market: 'corners', selection: 'over 9.5' },
          ],
        },
      ],
    });
    expect(slip!.legs[0].market).toBe('OTHER');
    expect(slip!.legs[0].parts).toBeUndefined();
  });

  it('不足两段 → 降为 OTHER', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: 'COMBO',
          selection: 'x',
          parts: [{ market: '1X2', selection: 'home' }],
        },
      ],
    });
    expect(slip!.legs[0].market).toBe('OTHER');
  });
});

describe('parseRecognizedSlip — 滚球 live / 下注时比分基线', () => {
  it('live=true + baseHome/baseAway 整数保留', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: 'AH',
          selection: 'home',
          line: -0.5,
          live: true,
          baseHome: 1,
          baseAway: 0,
        },
      ],
    });
    const leg = slip!.legs[0];
    expect(leg.live).toBe(true);
    expect(leg.baseHome).toBe(1);
    expect(leg.baseAway).toBe(0);
  });

  it('"true" 字符串也识别为 live;字符串数字基线强转', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: 'OU',
          selection: 'Over',
          line: 2.5,
          live: 'true',
          baseHome: '2',
          baseAway: '1',
        },
      ],
    });
    expect(slip!.legs[0].live).toBe(true);
    expect(slip!.legs[0].baseHome).toBe(2);
    expect(slip!.legs[0].baseAway).toBe(1);
  });

  it('赛前单:live 缺省/false 时不带 live,base 为空', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: 'AH',
          selection: 'home',
          line: -1,
          live: false,
          baseHome: null,
          baseAway: null,
        },
      ],
    });
    expect(slip!.legs[0].live).toBeUndefined();
    expect(slip!.legs[0].baseHome).toBeUndefined();
    expect(slip!.legs[0].baseAway).toBeUndefined();
  });

  it('滚球但缺一侧比分 → base 不保留(结算层将转人工)', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: 'AH',
          selection: 'home',
          line: -0.5,
          live: true,
          baseHome: 1,
          baseAway: null,
        },
      ],
    });
    expect(slip!.legs[0].live).toBe(true);
    expect(slip!.legs[0].baseHome).toBeUndefined();
    expect(slip!.legs[0].baseAway).toBeUndefined();
  });

  it('非整数 / 负数比分基线被丢弃', () => {
    const slip = parseRecognizedSlip({
      stake: 10,
      potentialReturn: 20,
      legs: [
        {
          homeName: 'A',
          awayName: 'B',
          market: 'AH',
          selection: 'home',
          line: -0.5,
          live: true,
          baseHome: 1.5,
          baseAway: -1,
        },
      ],
    });
    expect(slip!.legs[0].baseHome).toBeUndefined();
    expect(slip!.legs[0].baseAway).toBeUndefined();
  });
});

describe('hasVision — env 守卫', () => {
  const orig = process.env.AIGC_API_KEY;
  afterEach(() => {
    if (orig === undefined) delete process.env.AIGC_API_KEY;
    else process.env.AIGC_API_KEY = orig;
  });

  it('无 key → false', () => {
    delete process.env.AIGC_API_KEY;
    expect(hasVision()).toBe(false);
  });

  it('有 key → true', () => {
    process.env.AIGC_API_KEY = 'sk-test';
    expect(hasVision()).toBe(true);
  });
});
