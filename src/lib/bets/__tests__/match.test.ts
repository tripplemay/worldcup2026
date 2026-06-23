/**
 * 注单单腿匹配 纯 helper 单测(无网络)。
 * 覆盖:toCanonicalName 映射/透传;findResultByName 命中/日期窗口/反向兜底/未命中;
 * leagueKeyOf 已知联赛→key、WC/垃圾→undefined;sameUtcDay 窗口边界。
 */
import { toCanonicalName, CN_TEAM_MAP } from 'lib/bets/cnTeams';
import {
  findResultByName,
  leagueKeyOf,
  sameUtcDay,
  orientScore,
} from 'lib/bets/match';
import type { ResultMatch } from 'lib/predict/types';

/** 构造一条赛果(归一化名按 normalizeTeam 规则手动给定)。 */
function r(
  eventId: string,
  homeNorm: string,
  awayNorm: string,
  date: string,
  homeGoals = 2,
  awayGoals = 1,
): ResultMatch {
  return { eventId, homeNorm, awayNorm, date, homeGoals, awayGoals };
}

describe('toCanonicalName 队名折叠', () => {
  it('中文国家队名 → 规范英文名', () => {
    expect(toCanonicalName('巴西')).toBe('Brazil');
    expect(toCanonicalName('法国')).toBe('France');
  });

  it('中文俱乐部名 → 规范英文名', () => {
    expect(toCanonicalName('拜仁慕尼黑')).toBe('Bayern Munich');
    expect(toCanonicalName('曼联')).toBe('Manchester United');
  });

  it('两侧空白被 trim 后仍命中', () => {
    expect(toCanonicalName('  巴西  ')).toBe('Brazil');
  });

  it('未登记的队名原样透传', () => {
    expect(toCanonicalName('Liverpool')).toBe('Liverpool');
    expect(toCanonicalName('某不存在队')).toBe('某不存在队');
  });

  it('映射表至少预置 8 条', () => {
    expect(Object.keys(CN_TEAM_MAP).length).toBeGreaterThanOrEqual(8);
  });
});

describe('sameUtcDay 日期窗口', () => {
  it('同一天 → true', () => {
    expect(sameUtcDay('2026-06-20T18:00:00Z', '2026-06-20')).toBe(true);
  });

  it('相邻一天(±1 内)→ true', () => {
    expect(sameUtcDay('2026-06-20T00:00:00Z', '2026-06-21T00:00:00Z')).toBe(
      true,
    );
  });

  it('相隔两天 → false', () => {
    expect(sameUtcDay('2026-06-20T00:00:00Z', '2026-06-22T12:00:00Z')).toBe(
      false,
    );
  });

  it('非法日期 → false', () => {
    expect(sameUtcDay('not-a-date', '2026-06-20')).toBe(false);
  });
});

describe('findResultByName 赛果匹配', () => {
  const map: Record<string, ResultMatch> = {
    e1: r('e1', 'brazil', 'france', '2026-06-20T18:00:00Z', 3, 0),
    e2: r('e2', 'manchester united', 'liverpool', '2026-05-01T14:00:00Z'),
  };

  it('归一化队名正向命中', () => {
    const hit = findResultByName(map, 'Brazil', 'France');
    expect(hit?.eventId).toBe('e1');
  });

  it('中文名经折叠+归一化后命中', () => {
    const hit = findResultByName(map, '巴西', '法国');
    expect(hit?.eventId).toBe('e1');
  });

  it('日期在 ±1 天窗口内 → 命中', () => {
    const hit = findResultByName(map, 'Brazil', 'France', '2026-06-21');
    expect(hit?.eventId).toBe('e1');
  });

  it('日期超出窗口 → 不命中', () => {
    const hit = findResultByName(map, 'Brazil', 'France', '2026-06-25');
    expect(hit).toBeUndefined();
  });

  it('反向主客兜底命中,比分按存档原样返回(方向纠正交给 orientScore)', () => {
    // 注单写成 France(主) vs Brazil(客),存档是 Brazil 主 3-0
    const hit = findResultByName(map, 'France', 'Brazil');
    expect(hit?.eventId).toBe('e1');
    expect(hit?.homeGoals).toBe(3);
    expect(hit?.awayGoals).toBe(0);
  });

  it('窗口内多场同对阵 → 取时间最近的一场', () => {
    const m: Record<string, ResultMatch> = {
      a: r('a', 'spain', 'italy', '2026-06-19T18:00:00Z', 1, 0),
      b: r('b', 'spain', 'italy', '2026-06-20T18:00:00Z', 2, 2),
    };
    const hit = findResultByName(m, 'Spain', 'Italy', '2026-06-20T12:00:00Z');
    expect(hit?.eventId).toBe('b'); // 距 06-20 更近
  });

  it('完全对不上 → undefined', () => {
    const hit = findResultByName(map, 'Spain', 'Italy');
    expect(hit).toBeUndefined();
  });

  it('纯中文等归一化为空的队名 → undefined(不误匹配)', () => {
    const hit = findResultByName(map, '未知队', '另一队');
    expect(hit).toBeUndefined();
  });
});

describe('orientScore 主客视角纠正', () => {
  it('同向(注单主=赛事主)→ 比分原样', () => {
    expect(orientScore('brazil', 'brazil', 3, 0)).toEqual({ home: 3, away: 0 });
  });

  it('反向(注单主=赛事客)→ 比分交换,避免赢↔输判反', () => {
    // 注单 France(主),赛事 Brazil(主)3-0 → France 视角应为 0-3
    expect(orientScore('france', 'brazil', 3, 0)).toEqual({ home: 0, away: 3 });
  });
});

describe('leagueKeyOf 联赛键映射', () => {
  it.each([
    ['epl', 'epl-2025'],
    ['laliga', 'laliga'],
    ['bundesliga', 'bundesliga'],
    ['seriea', 'seriea'],
    ['ligue1', 'ligue1'],
  ])('已知联赛 %s → key %s', (alias, key) => {
    expect(leagueKeyOf(alias)).toBe(key);
  });

  it('大小写/空白不敏感', () => {
    expect(leagueKeyOf('  EPL ')).toBe('epl-2025');
  });

  it('WC → undefined', () => {
    expect(leagueKeyOf('wc')).toBeUndefined();
  });

  it('垃圾/未知 → undefined', () => {
    expect(leagueKeyOf('garbage')).toBeUndefined();
    expect(leagueKeyOf(undefined)).toBeUndefined();
    expect(leagueKeyOf('')).toBeUndefined();
  });
});
