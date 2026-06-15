/**
 * EspnProvider 抽象接口。
 * ESPN 隐藏 API 一站式提供赛程/比分/积分/球队/事件/对阵/详情。
 */
import type {
  ScheduleMatch,
  GroupStanding,
  Team,
  MatchEvent,
  BracketMatch,
  MatchSummary,
  EventStats,
} from './types';

export interface EspnProvider {
  getScoreboard(dates: string): Promise<ScheduleMatch[]>;
  getStandings(): Promise<GroupStanding[]>;
  getTeams(): Promise<Team[]>;
  getMatchEvents(eventId: string): Promise<MatchEvent[]>;
  getBracket(): Promise<BracketMatch[]>;
  /** 单场详情:比分/状态/队徽 + 统计 + 阵容 + 事件。 */
  getMatchSummary(eventId: string): Promise<MatchSummary>;
  /** 任意一场比赛的射门/进球统计(预测系统摄取历史用)。 */
  getEventStats(eventId: string): Promise<EventStats>;
}
