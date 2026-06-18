/**
 * 球队杯赛 box-score 聚合(增量):遍历已结束的世界杯场次,
 * 逐场拉 ESPN summary 的控球/射门/角球/犯规/红黄牌等,按队累加进 team-stats.json。
 *
 * 已结束场次结果不变,故记录已处理的赛事 id,后续 cron 只抓「新结束」的场次。
 * 数据源纯 ESPN(免费,不耗赔率/Football 配额)。
 */
import { espnProvider } from './espn';
import { normalizeTeam } from 'lib/match/normalize';
import {
  loadTeamStats,
  saveTeamStats,
  type TeamStatAgg,
  type TeamStatsStore,
} from 'lib/db/store';
import type { TeamMatchStats } from './types';

const SEASON = process.env.WC_SEASON ?? '2026';
const WC_RANGE = `${SEASON}0611-${SEASON}0719`;
const CONCURRENCY = 5;

/** 取数字(去掉 % 等非数字字符);无效记 0。 */
function num(v?: string): number {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function emptyAgg(): TeamStatAgg {
  return {
    games: 0,
    possession: 0,
    shots: 0,
    sot: 0,
    corners: 0,
    fouls: 0,
    yellow: 0,
    red: 0,
    saves: 0,
    offsides: 0,
  };
}

/** 把单场某队 box-score 累加进聚合。 */
function addMatch(agg: TeamStatAgg, s: TeamMatchStats): void {
  agg.games += 1;
  agg.possession += num(s.possessionPct);
  agg.shots += num(s.totalShots);
  agg.sot += num(s.shotsOnTarget);
  agg.corners += num(s.wonCorners);
  agg.fouls += num(s.foulsCommitted);
  agg.yellow += num(s.yellowCards);
  agg.red += num(s.redCards);
  agg.saves += num(s.saves);
  agg.offsides += num(s.offsides);
}

/** 简单并发池(单项失败不影响其余)。 */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch {
        out[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * 增量聚合所有已结束世界杯场次的队级 box-score。
 * @returns 本次新处理场次数 + 累计涉及球队数
 */
export async function ingestTeamStats(): Promise<{
  added: number;
  teams: number;
}> {
  const store: TeamStatsStore = loadTeamStats();
  const fixtures = await espnProvider.getScoreboard(WC_RANGE);
  const fresh = fixtures.filter(
    (f) => f.status === 'post' && !store.events[f.id],
  );
  if (!fresh.length) return { added: 0, teams: Object.keys(store.teams).length };

  const summaries = await pool(fresh, CONCURRENCY, (f) =>
    espnProvider.getMatchSummary(f.id),
  );

  let added = 0;
  const bump = (team: string, s?: TeamMatchStats) => {
    if (!s) return;
    const key = normalizeTeam(team);
    if (!key) return;
    if (!store.teams[key]) store.teams[key] = emptyAgg();
    addMatch(store.teams[key], s);
  };
  summaries.forEach((sm, i) => {
    if (!sm) return;
    bump(sm.homeTeam, sm.homeStats);
    bump(sm.awayTeam, sm.awayStats);
    store.events[fresh[i].id] = true;
    added += 1;
  });

  store.updatedAt = Date.now();
  saveTeamStats(store);
  return { added, teams: Object.keys(store.teams).length };
}
