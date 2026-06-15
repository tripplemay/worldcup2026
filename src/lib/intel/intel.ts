/**
 * 情报服务:为即将比赛的球队抓相关新闻 → LLM 情感分 → 存 intel.json。
 * Path B 修正量 = score × confidence × MAX_IMPACT(默认 0.08),作旁注参考(不自动改主概率)。
 */
import { espnProvider } from 'lib/espn/espn';
import { normalizeTeam } from 'lib/match/normalize';
import { loadIntel, saveIntel } from 'lib/db/store';
import { fetchNews } from './rss';
import { analyzeSentiment, hasLlm } from './llm';
import type { TeamIntel, NewsItem } from './types';

const CN_OFFSET = 8 * 3600_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const MAX_IMPACT = Number(process.env.INTEL_MAX_IMPACT ?? 0.08);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 在新闻里找提及该队的最新一条(词边界匹配,避免短名误命中)。 */
function relevant(news: NewsItem[], team: string): NewsItem | undefined {
  let re: RegExp;
  try {
    re = new RegExp(`\\b${esc(team)}\\b`, 'i');
  } catch {
    return undefined;
  }
  const hits = news.filter((n) => re.test(`${n.title} ${n.summary}`));
  if (!hits.length) return undefined;
  return hits.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
}

/** 刷新未来 hoursAhead 小时内比赛球队的情报。返回涉及队数 + 实际分析(调用 LLM)条数。 */
export async function refreshIntel(
  hoursAhead = 36,
): Promise<{ teams: number; analyzed: number }> {
  if (!hasLlm()) return { teams: 0, analyzed: 0 };
  const today = new Date(Date.now() + CN_OFFSET);
  const end = new Date(today.getTime() + Math.ceil(hoursAhead / 24) * 86400_000);
  const fixtures = await espnProvider.getScoreboard(
    `${ymd(today)}-${ymd(end)}`,
  );
  const teams = new Map<string, string>(); // norm → 展示名
  for (const f of fixtures) {
    if (f.status !== 'pre') continue; // 只关注未开赛
    teams.set(normalizeTeam(f.homeTeam), f.homeTeam);
    teams.set(normalizeTeam(f.awayTeam), f.awayTeam);
  }
  if (!teams.size) return { teams: 0, analyzed: 0 };

  const news = await fetchNews();
  const store = loadIntel();
  let analyzed = 0;
  for (const [norm, team] of teams) {
    const item = relevant(news, team);
    if (!item) continue;
    if (store[norm]?.news.link === item.link) continue; // 同一条已分析过,省钱
    const s = await analyzeSentiment(team, item);
    if (!s) continue;
    store[norm] = {
      norm,
      team,
      news: item,
      sentiment: s,
      modifier: +(s.score * s.confidence * MAX_IMPACT).toFixed(4),
      updatedAt: Date.now(),
    };
    analyzed++;
  }
  saveIntel(store);
  return { teams: teams.size, analyzed };
}

export function getIntel(norm: string): TeamIntel | undefined {
  return loadIntel()[norm];
}
