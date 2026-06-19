/**
 * 模型分歧分类(决策框架固化):看各模型在「市场热门方」上的离散度,判定分歧类型,
 * 供指令台 reasoning 标注 + 详情页"该如何分析"决策提示。纯函数,服务端/客户端共用。
 *  · CONSENSUS  四模型一致 → 高置信跟融合
 *  · R1_UNDERCONF 错配场泊松对热门欠自信(R1 伪差)→ 信 Elo/市场,勿买弱方"价值"
 *  · GOALS_FORM 进球泊松离群(近期状态/终结)而 xG 贴市场 → 以 xG/市场为准,进球当参考
 *  · SPLIT     分歧较大、无明确归因 → 降低置信
 */
export type Divergence = 'CONSENSUS' | 'R1_UNDERCONF' | 'GOALS_FORM' | 'SPLIT';

export interface Side3 {
  h: number;
  d: number;
  a: number;
}
export interface ModelSet {
  xg?: Side3;
  goals?: Side3;
  elo?: Side3;
  market?: Side3;
  ensemble?: Side3;
}

const KEYS = ['h', 'd', 'a'] as const;

export function modelsFromPredictions(
  predictions:
    | { modelId: string; homeWin: number; draw: number; awayWin: number }[]
    | undefined,
  ensemble?: { homeWin: number; draw: number; awayWin: number } | null,
): ModelSet {
  const get = (id: string): Side3 | undefined => {
    const p = predictions?.find((x) => x.modelId === id);
    return p ? { h: p.homeWin, d: p.draw, a: p.awayWin } : undefined;
  };
  return {
    xg: get('poisson-xg'),
    goals: get('poisson-goals'),
    elo: get('elo'),
    market: get('market'),
    ensemble: ensemble
      ? { h: ensemble.homeWin, d: ensemble.draw, a: ensemble.awayWin }
      : undefined,
  };
}

export function classifyDivergence(m: ModelSet): Divergence {
  const ref = m.market ?? m.ensemble; // 以市场为基准,无市场用融合
  if (!ref) return 'SPLIT';
  const favKey = KEYS.reduce((b, k) => (ref[k] > ref[b] ? k : b));
  const favRef = ref[favKey];
  const xgFav = m.xg?.[favKey];
  const goalsFav = m.goals?.[favKey];

  // R1:市场认定强热门(≥65%)但泊松对热门明显欠自信(≥12pt)
  if (m.market && favRef >= 0.65) {
    const under = Math.max(
      xgFav != null ? favRef - xgFav : 0,
      goalsFav != null ? favRef - goalsFav : 0,
    );
    if (under >= 0.12) return 'R1_UNDERCONF';
  }
  // 进球离群:进球远离基准(≥15pt)而 xG 贴基准(≤10pt)
  if (m.market && goalsFav != null && xgFav != null) {
    if (Math.abs(goalsFav - favRef) >= 0.15 && Math.abs(xgFav - favRef) <= 0.1)
      return 'GOALS_FORM';
  }
  // 共识:各模型在热门方都接近(极差 ≤10pt)
  const vals = [xgFav, goalsFav, m.elo?.[favKey], m.market?.[favKey], m.ensemble?.[favKey]].filter(
    (x): x is number => x != null,
  );
  if (vals.length >= 2 && Math.max(...vals) - Math.min(...vals) <= 0.1)
    return 'CONSENSUS';
  return 'SPLIT';
}
