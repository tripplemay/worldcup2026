/**
 * 赔率快照持久化(WC_DATA_DIR/odds/snap.json)。
 * 与预测数据分目录,保持 odds 模块自洽;部署不丢(同 WC_DATA_DIR)。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { OddsSnap } from './changes';

const DATA_DIR = process.env.WC_DATA_DIR ?? '.data';
const ODDS_DIR = join(DATA_DIR, 'odds');
const FILE = join(ODDS_DIR, 'snap.json');
// 实时看板(odds-api.io)用独立快照文件:其 event id 空间与 the-odds-api 不同,分开存避免串号。
const LIVE_FILE = join(ODDS_DIR, 'live-snap.json');

function loadSnap(file: string): OddsSnap {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as OddsSnap;
  } catch {
    return {};
  }
}

function saveSnap(file: string, snap: OddsSnap): void {
  try {
    mkdirSync(ODDS_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(snap));
  } catch (e) {
    // 写失败不抛(不阻断请求)
    console.error('[odds] 快照写入失败', e);
  }
}

export const loadOddsSnap = (): OddsSnap => loadSnap(FILE);
export const saveOddsSnap = (snap: OddsSnap): void => saveSnap(FILE, snap);
export const loadLiveOddsSnap = (): OddsSnap => loadSnap(LIVE_FILE);
export const saveLiveOddsSnap = (snap: OddsSnap): void =>
  saveSnap(LIVE_FILE, snap);
