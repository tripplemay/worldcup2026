/**
 * EspnProvider 抽象接口。
 * ESPN 隐藏 API 一站式提供赛程/比分/积分/球队/事件/对阵。
 * 非官方端点:实现层负责缓存与容错降级。
 */
import type {
  ScheduleMatch,
  GroupStanding,
  Team,
  MatchEvent,
  BracketMatch,
} from './types';

export interface EspnProvider {
  /** 赛程 + 实时比分。dates:'YYYYMMDD' 或 'YYYYMMDD-YYYYMMDD'。 */
  getScoreboard(dates: string): Promise<ScheduleMatch[]>;
  /** 12 小组积分榜。 */
  getStandings(): Promise<GroupStanding[]>;
  /** 48 强球队。 */
  getTeams(): Promise<Team[]>;
  /** 单场进球/红黄牌事件时间线。 */
  getMatchEvents(eventId: string): Promise<MatchEvent[]>;
  /** 淘汰赛对阵(赛段非 group-stage 的比赛)。 */
  getBracket(): Promise<BracketMatch[]>;
}
