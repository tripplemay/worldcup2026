/**
 * 轻量 JSON 文件存储(预测系统用)。
 * 数据量小(48 队评分 + 数百场历史),无需数据库;零原生模块、零运维。
 * 落在 WC_DATA_DIR(默认本地 .data/,生产 /opt/apps/worldcup-data/,部署不丢)。
 * 日后若快照量大或需复杂查询,可平滑升级 SQLite。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { HistMatch, TeamRating } from 'lib/predict/types';
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

// ── 场外情报(按归一化队名)────────────────────────────
type IntelMap = Record<string, TeamIntel>;

export function loadIntel(): IntelMap {
  return readJson<IntelMap>('intel.json', {});
}
export function saveIntel(map: IntelMap): void {
  writeJson('intel.json', map);
}
