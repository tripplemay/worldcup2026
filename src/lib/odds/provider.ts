/**
 * OddsProvider 抽象接口。
 * 当前实现:TheOddsApiProvider。保留可插拔能力(日后可接 OddsPapi 等做聚合/备用)。
 */
import type { MatchOdds, WinnerMarket } from './types';

export interface OddsProvider {
  /** 世界杯单场胜平负赔率(各家博彩 + 全场最优)。 */
  getMatches(): Promise<MatchOdds[]>;
  /** 夺冠赔率榜(按最被看好升序)。 */
  getWinnerOdds(): Promise<WinnerMarket>;
}
