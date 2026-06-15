/** 场外情报领域类型。 */

/** 一条新闻。 */
export interface NewsItem {
  title: string;
  summary: string;
  source: string; // BBC / ESPN / Sky
  link: string;
  date: string; // ISO(可空)
}

/** LLM 量化的情感分析(对某队)。 */
export interface Sentiment {
  eventType: string; // injury / morale / weather / tactics / other
  score: number; // -1 ~ +1
  confidence: number; // 0 ~ 1
  reasoning: string;
}

/** 某队的最新情报(新闻 + 情感 + 修正量)。 */
export interface TeamIntel {
  norm: string; // 归一化队名
  team: string; // 展示名
  news: NewsItem;
  sentiment: Sentiment;
  modifier: number; // Path B 修正量 = score × confidence × MAX_IMPACT
  updatedAt: number;
}
