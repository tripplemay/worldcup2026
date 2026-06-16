/**
 * 实时全市场的中文化:① 市场名称(odds-api.io 英文 → 中文);② 结果 label 里的
 * 队名 + 结构性英文词。队名复用 teams.ts 的 teamName。
 *
 * 市场名优先查显式词典;未收录的(新市场)走逐词回退翻译,保证不留整串英文。
 */
import { teamName } from './teams';

const MARKET_ZH: Record<string, string> = {
  // 主要
  ML: '胜平负',
  'Draw No Bet': '平局退款',
  'Double Chance': '双重机会',
  'Half Time Result': '半场赛果',
  'Both Teams To Score': '双方进球',
  'Both Teams To Score HT': '半场双方进球',
  'Both Teams To Score 2H': '下半场双方进球',
  // 让球·大小
  Spread: '让球',
  'Spread HT': '半场让球',
  Totals: '大小球',
  'Totals HT': '半场大小球',
  'Goals Over/Under': '进球大小',
  'European Handicap': '欧洲让球',
  '1st Half Handicap': '上半场让球',
  'Alternative Asian Handicap': '可选亚洲让球',
  'Alternative Goal Line': '可选进球盘',
  'Alternative Total Goals': '可选进球总数',
  'Number of Goals In Match': '全场进球数',
  'Exact Total Goals': '精确进球总数',
  'Team Total Goals Home': '主队进球数',
  'Team Total Goals Away': '客队进球数',
  'Goal Method': '进球方式',
  'First 10 Minutes (00:00 - 09:59)': '前 10 分钟(00:00-09:59)',
  Specials: '特别投注',
  // 波胆
  'Correct Score': '波胆(正确比分)',
  // 角球
  Corners: '角球',
  'Corners Spread': '角球让球',
  'Corner Handicap': '角球让球',
  'Corners Totals': '角球大小',
  'Corners Totals HT': '半场角球大小',
  'Corners 2-Way': '角球两项',
  'Corners Race': '角球竞速',
  'Total Corners': '角球总数',
  'Alternative Corners': '可选角球',
  'Team Corners Home': '主队角球',
  'Team Corners Away': '客队角球',
  // 牌
  'Bookings Spread': '罚牌让分',
  'Bookings Totals': '罚牌大小',
  'Card Handicap': '黄牌让分',
  'Number of Cards In Match': '全场牌数',
  'Team Cards Home': '主队牌数',
  'Team Cards Away': '客队牌数',
  // 球员
  'Anytime Goalscorer': '任意时间进球',
  'Team Goalscorer': '球队进球者',
  'Multi Scorers': '多人进球',
  'Player To Score or Assist': '球员进球或助攻',
  'Player of the Match': '全场最佳',
  'Player Shots': '球员射门',
  'Player Shots on Target': '球员射正',
  'Player Shots on Target Outside Box': '球员禁区外射正',
  'Player Headed Shots on Target': '球员头球射正',
  'Player Tackles': '球员抢断',
  'Player Passes': '球员传球',
  'Player Fouls Committed': '球员犯规',
  'Player To Be Fouled': '球员被犯规',
  'Player to be Booked': '球员被罚牌',
  'Player Cards': '球员牌',
  'Goalkeeper Saves': '门将扑救',
  // 全场/球队统计
  'Team Shots Home': '主队射门',
  'Team Shots Away': '客队射门',
  'Team Shots on Target Home': '主队射正',
  'Team Shots on Target Away': '客队射正',
  'Team Tackles Home': '主队抢断',
  'Team Tackles Away': '客队抢断',
  'Team Offsides Home': '主队越位',
  'Team Offsides Away': '客队越位',
  'Match Shots': '全场射门',
  'Match Shots on Target': '全场射正',
  'Match Tackles': '全场抢断',
  'Match Offsides': '全场越位',
};

// 逐词回退(市场名 + label 通用结构词)。顺序敏感:长词在前。
const WORD_ZH: [RegExp, string][] = [
  [/\bShots on Target\b/gi, '射正'],
  [/\bor More\b/gi, '或更多'],
  [/\bTo Win From Behind\b/gi, '落后翻盘'],
  [/\bHalf Time\b/gi, '半场'],
  [/\bGoalscorer\b/gi, '进球者'],
  [/\bAnytime\b/gi, '任意时间'],
  [/\bDraw\b/g, '平局'],
  [/\bTie\b/g, '平局'],
  [/\bOver\b/g, '大于'],
  [/\bUnder\b/g, '小于'],
  [/\bYes\b/g, '是'],
  [/\bNo\b/g, '否'],
  [/\bBoth\b/gi, '两队'],
  [/\bGoals?\b/gi, '球'],
  [/\bCorners?\b/gi, '角球'],
  [/\bCards?\b/gi, '牌'],
  [/\bShots?\b/gi, '射门'],
  [/\bTackles?\b/gi, '抢断'],
  [/\bOffsides?\b/gi, '越位'],
  [/\bSaves?\b/gi, '扑救'],
  [/\bPasses\b/gi, '传球'],
  [/\bFouls?\b/gi, '犯规'],
  [/\bBooked\b/gi, '被罚牌'],
  [/\bAssist\b/gi, '助攻'],
  [/\bScore\b/gi, '进球'],
  [/\bFirst\b/gi, '首'],
  [/\bTeam\b/gi, '球队'],
  [/\bPlayer\b/gi, '球员'],
  [/\bMatch\b/gi, '全场'],
  [/\bHome\b/gi, '主队'],
  [/\bAway\b/gi, '客队'],
  [/\bor\b/g, '或'],
];

function wordTranslate(s: string): string {
  let out = s;
  for (const [re, zh] of WORD_ZH) out = out.replace(re, zh);
  return out;
}

/** 市场名称中文化(显式词典优先,未收录走逐词回退)。 */
export function localizeMarket(name: string, locale: string): string {
  if (locale !== 'zh' || !name) return name;
  return MARKET_ZH[name] ?? wordTranslate(name);
}

/** 结果 label 中文化:先替换本场两队队名,再逐词翻译结构性英文(球员名等专有名词保留)。 */
export function localizeLabel(
  label: string,
  locale: string,
  home?: string,
  away?: string,
): string {
  if (locale !== 'zh' || !label) return label;
  let out = label;
  for (const team of [home, away]) {
    if (team) out = out.split(team).join(teamName(team, 'zh'));
  }
  return wordTranslate(out);
}
