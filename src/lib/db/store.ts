/**
 * 轻量 JSON 文件存储(预测系统用)。
 * 数据量小(48 队评分 + 数百场历史),无需数据库;零原生模块、零运维。
 * 落在 WC_DATA_DIR(默认本地 .data/,生产 /opt/apps/worldcup-data/,部署不丢)。
 * 日后若快照量大或需复杂查询,可平滑升级 SQLite。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { HistMatch, TeamRating, ResultMatch } from 'lib/predict/types';
import type { TeamIntel } from 'lib/intel/types';

const DATA_DIR = process.env.WC_DATA_DIR ?? '.data';
const PREDICT_DIR = join(DATA_DIR, 'predict');

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(PREDICT_DIR, file), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  try {
    mkdirSync(PREDICT_DIR, { recursive: true });
    writeFileSync(join(PREDICT_DIR, file), JSON.stringify(data, null, 2));
  } catch (e) {
    // 写失败不抛(避免阻断请求);记录到 stderr
    console.error('[store] 写入失败', file, e);
  }
}

// ── 历史比赛(按 eventId 唯一)──────────────────────────
type HistMap = Record<string, HistMatch>;

export function loadHistorical(): HistMap {
  return readJson<HistMap>('historical.json', {});
}
export function saveHistorical(map: HistMap): void {
  writeJson('historical.json', map);
}

// ── 球队评分(按归一化队名)──────────────────────────────
type RatingMap = Record<string, TeamRating>;

export function loadRatings(): RatingMap {
  return readJson<RatingMap>('ratings.json', {});
}
export function saveRatings(map: RatingMap): void {
  writeJson('ratings.json', map);
}

// ── 权威 Elo(eloratings.net,覆盖全部国家队)────────────
type EloMap = Record<string, number>; // 归一化队名 → Elo

export function loadElo(): EloMap {
  return readJson<EloMap>('elo.json', {});
}
export function saveElo(map: EloMap): void {
  writeJson('elo.json', map);
}

// ── 赛果(供 Elo,比 historical 更深)──────────────────
type ResultMap = Record<string, ResultMatch>;

export function loadResults(): ResultMap {
  return readJson<ResultMap>('results.json', {});
}
export function saveResults(map: ResultMap): void {
  writeJson('results.json', map);
}

// ── API-Football 队名→id 缓存(避免反复解析)────────────
type AfTeamMap = Record<string, number>; // 归一化队名 → API-Football team id

export function loadAfTeams(): AfTeamMap {
  return readJson<AfTeamMap>('af-teams.json', {});
}
export function saveAfTeams(map: AfTeamMap): void {
  writeJson('af-teams.json', map);
}

// ── 球队杯赛 box-score 聚合(增量:仅累计新结束的场次)──────
/** 单队杯赛累计裸数据(各项为「跨场求和」,展示时除以 games 取均值)。 */
export interface TeamStatAgg {
  games: number;
  possession: number; // 控球率求和(%)
  shots: number;
  sot: number; // 射正
  corners: number;
  fouls: number;
  yellow: number;
  red: number;
  saves: number;
  offsides: number;
}
export interface TeamStatsStore {
  updatedAt: number;
  events: Record<string, true>; // 已处理的赛事 id(已结束场次不变,避免重复抓取)
  teams: Record<string, TeamStatAgg>; // 归一化队名 → 累计
}

const EMPTY_TEAM_STATS: TeamStatsStore = {
  updatedAt: 0,
  events: {},
  teams: {},
};

export function loadTeamStats(): TeamStatsStore {
  return readJson<TeamStatsStore>('team-stats.json', EMPTY_TEAM_STATS);
}
export function saveTeamStats(s: TeamStatsStore): void {
  writeJson('team-stats.json', s);
}

// ── 场外情报(按归一化队名)────────────────────────────
type IntelMap = Record<string, TeamIntel>;

export function loadIntel(): IntelMap {
  return readJson<IntelMap>('intel.json', {});
}
export function saveIntel(map: IntelMap): void {
  writeJson('intel.json', map);
}
