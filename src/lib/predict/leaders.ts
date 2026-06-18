/**
 * 射手榜摄取:engine cron 拉 API-Football topscorers → leaders.json。
 */
import { hasApiFootball, getTopScorers } from './apifootball';
import { loadLeaders, saveLeaders } from 'lib/db/store';

export async function ingestLeaders(): Promise<{ scorers: number }> {
  if (!hasApiFootball()) return { scorers: 0 };
  const scorers = await getTopScorers();
  if (scorers.length) saveLeaders({ updatedAt: Date.now(), scorers });
  return { scorers: scorers.length };
}

export { loadLeaders };
