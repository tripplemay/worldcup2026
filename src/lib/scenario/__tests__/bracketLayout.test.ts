/** 对阵树静态布局不变量(拓扑固定,坐标应自洽)。 */
import {
  posByMatch,
  champPos,
  connectors,
  COLUMN_HEADERS,
  CHAMP_COL,
  BOARD_W,
  BOARD_H,
  ROUND_COL,
} from '../bracketLayout';
import { BRACKET, MATCH_BY_NUM } from '../bracket';

describe('bracketLayout', () => {
  it('全部 32 场都有坐标,列号符合轮次', () => {
    expect(posByMatch.size).toBe(32);
    for (const t of BRACKET) {
      const p = posByMatch.get(t.match)!;
      expect(p).toBeDefined();
      const expectCol = t.match === 103 ? ROUND_COL.F : ROUND_COL[t.round];
      expect(p.col).toBe(expectCol);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('R32 恰 16 场在第 0 列', () => {
    const r32 = [...posByMatch.values()].filter((p) => p.col === 0);
    expect(r32).toHaveLength(16);
  });

  it('内部节点纵坐标 = 两上游均值(子节点居中)', () => {
    for (const t of BRACKET) {
      const wm = [t.home, t.away].filter((s) => s.kind === 'WM') as {
        match: number;
      }[];
      if (wm.length !== 2) continue;
      const p = posByMatch.get(t.match)!;
      const mid =
        (posByMatch.get(wm[0].match)!.y + posByMatch.get(wm[1].match)!.y) / 2;
      expect(p.y).toBeCloseTo(mid, 5);
    }
  });

  it('连接线坐标有限且在画板内;冠军列与表头齐备', () => {
    for (const c of connectors) {
      for (const v of [c.x1, c.y1, c.x2, c.y2]) expect(Number.isFinite(v)).toBe(true);
      expect(c.x1).toBeGreaterThanOrEqual(0);
      expect(c.x2).toBeLessThanOrEqual(BOARD_W);
    }
    expect(champPos.col).toBe(CHAMP_COL);
    expect(BOARD_W).toBeGreaterThan(0);
    expect(BOARD_H).toBeGreaterThan(0);
    expect(COLUMN_HEADERS).toHaveLength(6);
    // 决赛(M104)与季军赛(M103)各 1 场,皆在 F 列
    expect(MATCH_BY_NUM[104].round).toBe('F');
  });
});
