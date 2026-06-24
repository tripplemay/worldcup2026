/**
 * recognize 模块单测:聚焦纯函数 parseRecognizedSlip(校验/清洗,无网络)。
 * hasVision 的 env 守卫一并覆盖。
 */
import { hasVision, parseRecognizedSlip } from 'lib/bets/recognize';

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
