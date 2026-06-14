/** 比赛过程信息中文映射:事件类型、比赛状态、球员位置。非中文或无映射时返回原文。 */

const EVENT_ZH: Record<string, string> = {
  Goal: '进球',
  'Own Goal': '乌龙球',
  Penalty: '点球',
  'Penalty Goal': '点球',
  'Penalty - Scored': '点球命中',
  'Penalty - Missed': '点球未进',
  'Yellow Card': '黄牌',
  'Red Card': '红牌',
  'Yellow-Red Card': '两黄变红',
  'Yellow Red Card': '两黄变红',
  Substitution: '换人',
  VAR: 'VAR',
};

const STATUS_ZH: Record<string, string> = {
  FT: '完场',
  'Full Time': '完场',
  HT: '中场',
  'Half Time': '中场',
  AET: '加时赛后',
  'After Extra Time': '加时赛后',
  'Pen.': '点球大战',
  Penalties: '点球大战',
  Scheduled: '未开赛',
  Postponed: '推迟',
  Canceled: '取消',
  Cancelled: '取消',
};

const POS_ZH: Record<string, string> = {
  G: '门将',
  GK: '门将',
  D: '后卫',
  DEF: '后卫',
  CB: '中卫',
  LB: '左后卫',
  RB: '右后卫',
  M: '中场',
  MID: '中场',
  CM: '中场',
  DM: '后腰',
  AM: '前腰',
  LM: '左前卫',
  RM: '右前卫',
  F: '前锋',
  FWD: '前锋',
  ST: '前锋',
  CF: '中锋',
  LW: '左边锋',
  RW: '右边锋',
  W: '边锋',
  'CD-R': '右中卫',
  'CD-L': '左中卫',
  CD: '中卫',
  LF: '左前锋',
  RF: '右前锋',
  SUB: '替补',
};

export function eventType(type: string, locale: string): string {
  return locale === 'zh' ? EVENT_ZH[type] ?? type : type;
}
export function statusText(s: string, locale: string): string {
  return locale === 'zh' ? STATUS_ZH[s] ?? s : s;
}
export function position(p: string, locale: string): string {
  return locale === 'zh' ? POS_ZH[p] ?? p : p;
}
