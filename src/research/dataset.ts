/**
 * 联赛研究数据装载(server-only):优先 store(部署已播种数据目录),为空回退 seed/ via fs。
 * research/run 与 research GET(成绩单惰性自愈)共用,避免复制粘贴。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadLeagueHistorical,
  loadLeagueResults,
  loadLeagueOddsX,
} from 'lib/db/store';
import type { EngineDataset, MatchOddsView } from './engine';

export function loadLeagueDataset(key: string): EngineDataset {
  let allHist = Object.values(loadLeagueHistorical(key));
  let allRes = Object.values(loadLeagueResults(key));
  let odds = loadLeagueOddsX(key) as Record<string, MatchOddsView>;
  if (!allRes.length || !Object.keys(odds).length) {
    try {
      const seed = (n: string) =>
        JSON.parse(readFileSync(join(process.cwd(), 'seed/leagues', n), 'utf8'));
      allHist = Object.values(seed(`league-${key}-historical.json`));
      allRes = Object.values(seed(`league-${key}-results.json`));
      odds = seed(`league-${key}-oddsx.json`);
    } catch {
      /* seed 不可读 → 保持 store 结果 */
    }
  }
  return { allHist, allRes, odds };
}
