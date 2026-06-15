/**
 * LLM 情感量化(经 AIGC 网关,OpenAI 兼容 HTTP)。
 * 给定一条新闻 + 目标球队,强制输出结构化 JSON 情感分。
 * 未配置 AIGC_API_KEY 时返回 null(功能禁用)。
 */
import type { NewsItem, Sentiment } from './types';

const BASE = process.env.AIGC_BASE ?? 'https://aigc.guangai.ai/v1';
const MODEL = process.env.INTEL_LLM_MODEL ?? 'gpt-4o-mini';

const SYSTEM = `你是顶级量化体育分析师。阅读关于足球比赛的新闻,量化它对"指定球队"赛前胜率的影响。
只输出 JSON,格式:{"event_type":"injury|morale|weather|tactics|other","sentiment_score":-1到1的数,"confidence":0到1的数,"reasoning":"一句话中文理由"}
sentiment_score:-1 极负面(核心重伤/内讧),+1 极正面(核心复出/士气大涨),0 中性或与该队无关。
新闻与该队无关时 sentiment_score 必须为 0。`;

export function hasLlm(): boolean {
  return !!process.env.AIGC_API_KEY;
}

/** 分析一条新闻对某队的情感影响;失败/未配置返回 null。 */
export async function analyzeSentiment(
  team: string,
  news: NewsItem,
): Promise<Sentiment | null> {
  const key = process.env.AIGC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `目标球队:${team}\n新闻标题:${news.title}\n新闻摘要:${news.summary}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const j = JSON.parse(content) as {
      event_type?: string;
      sentiment_score?: number;
      confidence?: number;
      reasoning?: string;
    };
    const score = Number(j.sentiment_score);
    const conf = Number(j.confidence);
    if (!Number.isFinite(score)) return null;
    return {
      eventType: j.event_type ?? 'other',
      score: Math.max(-1, Math.min(1, score)),
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
      reasoning: j.reasoning ?? '',
    };
  } catch {
    return null;
  }
}
