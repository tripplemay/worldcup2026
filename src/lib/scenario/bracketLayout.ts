/**
 * 淘汰赛对阵树「像素级布局」(纯计算,无 React)。
 *
 * 拓扑固定(bracket.ts BRACKET 的 WM 连接),故布局是常量:
 *  - 由决赛 M104 沿 WM feeder 递归,DFS 叶子序 = R32 列自上而下的顺序;
 *  - 每个内部节点纵坐标 = 其两个子节点纵坐标的均值(子节点居中);
 *  - 季军赛(M103)置于决赛列下方,冠军槽位于决赛右侧一列。
 * 坐标系原点 (0,0) 在画板左上;y 为卡片「中心」。
 */
import { BRACKET, MATCH_BY_NUM } from './bracket';

export const CARD_W = 156;
export const CARD_H = 52;
const COL_GAP = 34;
export const COL_W = CARD_W + COL_GAP; // 一列(卡片+间距)的水平步距
const PITCH = 66; // 相邻 R32 叶子中心的纵向步距

export const ROUND_COL: Record<string, number> = {
  R32: 0,
  R16: 1,
  QF: 2,
  SF: 3,
  F: 4,
};
export const CHAMP_COL = 5;

/** 某场的 WM(胜者)上游场次(R32 叶子返回空)。 */
function wmFeeders(m: number): number[] {
  const t = MATCH_BY_NUM[m];
  const out: number[] = [];
  for (const s of [t.home, t.away]) if (s.kind === 'WM') out.push(s.match);
  return out;
}

// DFS 叶子序(R32 自上而下)
const leafOrder: number[] = [];
(function dfs(m: number) {
  const ch = wmFeeders(m);
  if (!ch.length) {
    leafOrder.push(m);
    return;
  }
  ch.forEach(dfs);
})(104);

const yByMatch = new Map<number, number>();
leafOrder.forEach((m, i) => yByMatch.set(m, i * PITCH + PITCH / 2));
function yOf(m: number): number {
  const hit = yByMatch.get(m);
  if (hit != null) return hit;
  const ch = wmFeeders(m);
  const v = ch.reduce((s, c) => s + yOf(c), 0) / ch.length;
  yByMatch.set(m, v);
  return v;
}
for (const t of BRACKET) if (t.match !== 103) yOf(t.match);

const treeHeight = leafOrder.length * PITCH; // 16 * 66 = 1056
const finalY = yOf(104);
const P3_Y = treeHeight + CARD_H / 2; // 季军赛在主树下方

export interface Pos {
  x: number;
  y: number;
  col: number;
}

export const posByMatch = new Map<number, Pos>();
for (const t of BRACKET) {
  if (t.match === 103) continue;
  const col = ROUND_COL[t.round];
  posByMatch.set(t.match, { col, x: col * COL_W, y: yOf(t.match) });
}
posByMatch.set(103, { col: ROUND_COL.F, x: ROUND_COL.F * COL_W, y: P3_Y });

export const champPos: Pos = { x: CHAMP_COL * COL_W, y: finalY, col: CHAMP_COL };

export interface Connector {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
}

export const connectors: Connector[] = [];
for (const t of BRACKET) {
  if (t.match === 103) continue;
  const ch = wmFeeders(t.match);
  if (!ch.length) continue;
  const p = posByMatch.get(t.match)!;
  for (const c of ch) {
    const cp = posByMatch.get(c)!;
    connectors.push({ x1: cp.x + CARD_W, y1: cp.y, x2: p.x, y2: p.y });
  }
}
// 决赛 → 冠军
connectors.push({
  x1: posByMatch.get(104)!.x + CARD_W,
  y1: finalY,
  x2: champPos.x,
  y2: finalY,
});
// 半决赛负者 → 季军赛(虚线)
for (const sf of [101, 102]) {
  const sp = posByMatch.get(sf)!;
  const pp = posByMatch.get(103)!;
  connectors.push({ x1: sp.x + CARD_W, y1: sp.y, x2: pp.x, y2: pp.y, dashed: true });
}

export const BOARD_W = CHAMP_COL * COL_W + CARD_W;
export const BOARD_H = P3_Y + CARD_H / 2;

/** 各列表头:列索引 → i18n round key。 */
export const COLUMN_HEADERS: { col: number; key: string }[] = [
  { col: 0, key: 'r32' },
  { col: 1, key: 'r16' },
  { col: 2, key: 'qf' },
  { col: 3, key: 'sf' },
  { col: 4, key: 'final' },
  { col: CHAMP_COL, key: 'champion' },
];
