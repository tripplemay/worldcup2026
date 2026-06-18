import {
  mapRange,
  attackScore,
  defenseScore,
  strengthScore,
  squadScore,
  momentumScore,
  fitnessScore,
  formScore,
  grade,
  gradeLetter,
} from '../score';

describe('mapRange', () => {
  it('线性映射并钳制 [0,100]', () => {
    expect(mapRange(50, 0, 100)).toBe(50);
    expect(mapRange(-10, 0, 100)).toBe(0);
    expect(mapRange(200, 0, 100)).toBe(100);
  });
});

describe('实力档案四轴', () => {
  it('进攻:xG/场 0→2.5 映射满分', () => {
    expect(attackScore(0)).toBe(0);
    expect(attackScore(1.25)).toBe(50);
    expect(attackScore(2.5)).toBe(100);
    expect(attackScore(5)).toBe(100); // 钳制
  });
  it('防守:xGA 越低越高分', () => {
    expect(defenseScore(0)).toBe(100);
    expect(defenseScore(1.0)).toBe(50);
    expect(defenseScore(2.0)).toBe(0);
    expect(defenseScore(3)).toBe(0); // 钳制
  });
  it('实力:Elo 1350→0,2050→100', () => {
    expect(strengthScore(1350)).toBe(0);
    expect(strengthScore(2050)).toBe(100);
    expect(strengthScore(1700)).toBeCloseTo(50, 0);
  });
  it('阵容:均评分 + 五大占比加成;无数据返回 null', () => {
    expect(squadScore(null)).toBeNull();
    expect(squadScore({ avgRating: 7, top5Share: 0.5, count: 0 })).toBeNull();
    // 6.8 → mapRange(6.2,7.4)=50;+12*0.5=6 → 56
    expect(squadScore({ avgRating: 6.8, top5Share: 0.5, count: 11 })).toBeCloseTo(56);
  });
});

describe('当前状态三轴', () => {
  it('动能:TMI 总分 [-1,1] → [0,100]', () => {
    expect(momentumScore(0)).toBe(50);
    expect(momentumScore(1)).toBe(100);
    expect(momentumScore(-1)).toBe(0);
  });
  it('体能:惩罚 0→100,-0.6→40', () => {
    expect(fitnessScore(0)).toBe(100);
    expect(fitnessScore(-0.2)).toBeCloseTo(80);
    expect(fitnessScore(-0.6)).toBeCloseTo(40);
  });
  it('近期走势:积分率;无场次记中性 50', () => {
    expect(formScore([])).toBe(50);
    expect(formScore(['', ''])).toBe(50); // 全未赛
    expect(formScore(['W', 'W', 'W'])).toBe(100);
    expect(formScore(['L', 'L'])).toBe(0);
    expect(formScore(['W', 'D', 'L'])).toBeCloseTo((4 / 9) * 100);
  });
});

describe('总评级(偏当前状态)', () => {
  it('按 动能50% 走势30% 体能20% 加权', () => {
    expect(grade({ momentum: 80, recentForm: 60, fitness: 100 })).toBe(78);
    expect(grade({ momentum: 0, recentForm: 0, fitness: 0 })).toBe(0);
    expect(grade({ momentum: 100, recentForm: 100, fitness: 100 })).toBe(100);
  });
  it('字母档', () => {
    expect(gradeLetter(80)).toBe('A');
    expect(gradeLetter(65)).toBe('B');
    expect(gradeLetter(50)).toBe('C');
    expect(gradeLetter(49)).toBe('D');
  });
});
