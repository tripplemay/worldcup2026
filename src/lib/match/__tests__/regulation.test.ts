/** 90' 口径纯函数单测:period 主信号 / 分钟回退 / 完整性守卫 / 过-90 判定。 */
import {
  inRegulation,
  beyondRegulation,
  isShootout,
  regulationScoreChecked,
  regulationScore,
  periodScores,
  pastRegulation,
} from '../regulation';
import type { MatchEvent } from 'lib/espn/types';

const g = (
  minute: string | undefined,
  team: string,
  period?: number,
): MatchEvent => ({ minute, team, period, type: 'Goal', scoringPlay: true });

describe('事件分类:period 主信号,分钟回退', () => {
  it('period 优先:裸 "93\'" 补时 + period=2 → 常规(分钟解析会误判,period 纠正)', () => {
    const e = g("93'", 'H', 2);
    expect(inRegulation(e)).toBe(true);
    expect(beyondRegulation(e)).toBe(false);
  });

  it('缺 period 回退分钟:"90\'+4\'"→常规;"105\'"→加时;无分钟→点球', () => {
    expect(inRegulation(g("90'+4'", 'H'))).toBe(true);
    expect(beyondRegulation(g("105'", 'H'))).toBe(true);
    expect(isShootout(g(undefined, 'H'))).toBe(true);
  });

  it('period=5 即点球(即使带分钟);period=3/4 加时', () => {
    expect(isShootout(g("120'", 'H', 5))).toBe(true);
    expect(beyondRegulation(g("95'", 'H', 3))).toBe(true);
    expect(beyondRegulation(g("115'", 'H', 4))).toBe(true);
  });
});

describe('regulationScoreChecked(完整性判据)', () => {
  it('无加时进球 → 取终分;eventsAccountForFinal 反映事件是否追上终分', () => {
    // 事件齐(1 粒)对齐终分 1-0 → accounted=true
    expect(regulationScoreChecked([g("23'", 'H')], 'H', 'A', 1, 0)).toEqual({
      home: 1,
      away: 0,
      hasExtraTime: false,
      eventsAccountForFinal: true,
    });
    // 无加时但事件滞后(终分 2-1,事件仅见 1-1)→ 取终分但 accounted=false(供 live 守卫拦截)
    const lag = regulationScoreChecked(
      [g("40'", 'H'), g("80'", 'A')],
      'H',
      'A',
      2,
      1,
    );
    expect(lag).toEqual({
      home: 2,
      away: 1,
      hasExtraTime: false,
      eventsAccountForFinal: false,
    });
  });

  it("加时重建账齐 → 90' 比分正确,accounted=true", () => {
    const ev = [g("40'", 'H', 2), g("80'", 'A', 2), g("105'", 'H', 3)];
    expect(regulationScoreChecked(ev, 'H', 'A', 2, 1)).toEqual({
      home: 1,
      away: 1,
      hasExtraTime: true,
      eventsAccountForFinal: true,
    });
  });

  it("事件缺一粒 90' 前进球 → accounted=false(重建值不可信,调用方按纪律处置)", () => {
    const ev = [g("40'", 'H', 2), g("105'", 'H', 3)];
    const r = regulationScoreChecked(ev, 'H', 'A', 2, 1);
    expect(r.eventsAccountForFinal).toBe(false);
  });

  it('加时球分钟解析失败(NaN)但带 period=3 → 仍正确剔除且账能对齐(隐患 a)', () => {
    const ev = [g("40'", 'H', 2), g("80'", 'A', 2), g('AET', 'H', 3)];
    expect(regulationScoreChecked(ev, 'H', 'A', 2, 1)).toMatchObject({
      home: 1,
      away: 1,
      hasExtraTime: true,
      eventsAccountForFinal: true,
    });
  });

  it('点球大战事件(period=5)不进终分账,也不污染重建', () => {
    const ev = [
      g("30'", 'H', 2),
      g("88'", 'A', 2),
      g("100'", 'H', 3), // 加时球 → 终分 2-1
      g(undefined, 'H', 5), // 点球大战
      g(undefined, 'A', 5),
    ];
    expect(regulationScoreChecked(ev, 'H', 'A', 2, 1)).toMatchObject({
      home: 1,
      away: 1,
      hasExtraTime: true,
      eventsAccountForFinal: true,
    });
  });

  it("regulationScore 只取 90' 比分", () => {
    expect(regulationScore([g("23'", 'H')], 'H', 'A', 1, 0)).toEqual({
      home: 1,
      away: 0,
    });
  });
});

describe('periodScores(半场归属 period 主信号)', () => {
  it('上半场超长补时进球("47\'" period=1)归上半场(分钟回退会误归下半场)', () => {
    const ev = [g("47'", 'H', 1), g("60'", 'A', 2)];
    const r = periodScores(ev, 'H', 'A');
    expect(r.ht).toEqual({ h: 1, a: 0 });
    expect(r.ev90).toEqual({ h: 1, a: 1 });
  });
});

describe('pastRegulation(过-90 多信号判定)', () => {
  it('post → true;pre → false;进行中常规(period≤2)→ false', () => {
    expect(pastRegulation({ status: 'post' })).toBe(true);
    expect(pastRegulation({ status: 'pre', period: 4 })).toBe(false);
    expect(pastRegulation({ status: 'in', period: 2 })).toBe(false);
  });

  it('进行中:period≥3 / 状态名 / 加时事件,任一信号即真', () => {
    expect(pastRegulation({ status: 'in', period: 3 })).toBe(true);
    expect(pastRegulation({ status: 'in', period: 5 })).toBe(true);
    expect(
      pastRegulation({ status: 'in', statusName: 'STATUS_END_OF_REGULATION' }),
    ).toBe(true);
    expect(
      pastRegulation({ status: 'in', statusName: 'STATUS_SHOOTOUT' }),
    ).toBe(true);
    expect(pastRegulation({ status: 'in' }, [g("95'", 'H', 3)])).toBe(true);
    expect(pastRegulation({ status: 'in' }, [g("55'", 'H', 2)])).toBe(false);
  });
});
