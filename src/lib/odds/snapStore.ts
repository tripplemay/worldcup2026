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

export function loadOddsSnap(): OddsSnap {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as OddsSnap;
  } catch {
    return {};
  }
}

export function saveOddsSnap(snap: OddsSnap): void {
  try {
    mkdirSync(ODDS_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(snap));
  } catch (e) {
    // 写失败不抛(不阻断请求)
    console.error('[odds] 快照写入失败', e);
  }
}
