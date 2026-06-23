/**
 * Phase 9 注单原图存取(复核用)。落在 WC_DATA_DIR/bet-images/(部署不丢)。
 * 仅服务端使用。文件名 = 注单 id + 扩展名;读取做路径穿越防护。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.WC_DATA_DIR ?? '.data';
const IMG_DIR = join(DATA_DIR, 'bet-images');

/** 保存原图,返回文件名(失败 undefined,不抛)。 */
export function saveBetImage(
  id: string,
  buf: Buffer,
  ext = 'jpg',
): string | undefined {
  try {
    mkdirSync(IMG_DIR, { recursive: true });
    const file = `${id}.${ext}`;
    writeFileSync(join(IMG_DIR, file), buf);
    return file;
  } catch (e) {
    console.error('[bets] 原图保存失败', e);
    return undefined;
  }
}

/** 读原图;非法文件名(含路径分隔/..)或缺失返回 null。 */
export function readBetImage(file: string): Buffer | null {
  if (!file || /[/\\]/.test(file) || file.includes('..')) return null;
  try {
    return readFileSync(join(IMG_DIR, file));
  } catch {
    return null;
  }
}
