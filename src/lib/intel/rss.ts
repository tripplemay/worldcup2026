/**
 * RSS 抓取 + 解析(免费,无原生依赖,正则解析)。
 * 盯防高信噪比源:BBC / ESPN / Sky Sports 足球。
 */
import type { NewsItem } from './types';

const FEEDS: { url: string; source: string }[] = [
  { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC' },
  { url: 'https://www.espn.com/espn/rss/soccer/news', source: 'ESPN' },
  { url: 'https://www.skysports.com/rss/12040', source: 'Sky' },
];

function strip(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? strip(m[1]) : '';
}

function parseFeed(xml: string, source: string): NewsItem[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return items.map((block) => ({
    title: tag(block, 'title'),
    summary: tag(block, 'description'),
    source,
    link: tag(block, 'link'),
    date: (() => {
      const d = tag(block, 'pubDate');
      const t = d ? Date.parse(d) : NaN;
      return Number.isFinite(t) ? new Date(t).toISOString() : '';
    })(),
  }));
}

/** 抓取所有源的最新新闻(单源失败忽略)。 */
export async function fetchNews(): Promise<NewsItem[]> {
  const results = await Promise.all(
    FEEDS.map(async ({ url, source }) => {
      try {
        const res = await fetch(url, {
          cache: 'no-store',
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return [];
        return parseFeed(await res.text(), source);
      } catch {
        return [];
      }
    }),
  );
  return results.flat().filter((n) => n.title);
}
