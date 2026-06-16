/**
 * 实时全市场分组(把 odds-api.io 的 ~70 个市场按类别归入标签页)。
 * 每个市场按名称匹配,首个命中的类别生效(优先级:球员→角球→牌→波胆→让球大小→主要→其他)。
 */
import type { LiveMarket, LiveMarketGroup } from './types';

/** 标签页顺序(UI 按此渲染,空组不显示)。 */
export const GROUP_ORDER = [
  'main',
  'lines',
  'score',
  'corners',
  'cards',
  'players',
  'other',
] as const;
export type GroupKey = (typeof GROUP_ORDER)[number];

// 这些市场虽不以 "Player" 开头,但本质是球员盘
const PLAYER_MARKETS = new Set([
  'Anytime Goalscorer',
  'Team Goalscorer',
  'Multi Scorers',
  'Player To Score or Assist',
  'Goalkeeper Saves',
]);
const MAIN_MARKETS = new Set([
  'ML',
  'Draw No Bet',
  'Double Chance',
  'Half Time Result',
]);

function categoryOf(name: string): GroupKey {
  if (name.startsWith('Player') || PLAYER_MARKETS.has(name)) return 'players';
  if (/corner/i.test(name)) return 'corners';
  if (/book|card/i.test(name)) return 'cards';
  if (name === 'Correct Score') return 'score';
  if (/spread|total|handicap|over\/under|goal line|number of goals/i.test(name))
    return 'lines';
  if (MAIN_MARKETS.has(name) || /both teams to score/i.test(name))
    return 'main';
  return 'other';
}

/** 把市场数组分组并按 GROUP_ORDER 排序(只保留非空组)。 */
export function groupLiveMarkets(markets: LiveMarket[]): LiveMarketGroup[] {
  const buckets = new Map<GroupKey, LiveMarket[]>();
  for (const m of markets) {
    const k = categoryOf(m.name);
    const arr = buckets.get(k) ?? [];
    arr.push(m);
    buckets.set(k, arr);
  }
  return GROUP_ORDER.filter((k) => buckets.get(k)?.length).map((k) => ({
    key: k,
    markets: buckets.get(k)!,
  }));
}
