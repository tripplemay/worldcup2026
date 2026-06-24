/**
 * 从图片二进制提取「拍摄/创建时间」(零依赖)。
 *
 * 投注单「下注时间」以图片拍摄时间为准:
 *  · JPEG → EXIF DateTimeOriginal(0x9003)> DateTimeDigitized(0x9004)> DateTime(0x0132)
 *  · PNG  → tEXt/iTXt「Creation Time」/「date:create」/ XMP CreateDate
 * 取不到返回 undefined(调用方回退到上传时间)。
 *
 * 时区口径:EXIF 与朴素 ISO 不带时区,按北京时间(UTC+8)解读(投注人多在国内),
 * 返回对应 epoch ms;若字符串自带时区(Z/±HH:MM)则尊重其时区。
 */

const CN_OFFSET = 8 * 3600_000;

/** 解析日期时间字符串 → epoch ms;朴素(无 tz)按北京解读。失败返回 undefined。 */
export function parseCaptureString(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(t);
  if (!hasTz) {
    // EXIF "YYYY:MM:DD HH:MM:SS" 或朴素 ISO "YYYY-MM-DDTHH:MM:SS"
    const m = t.match(
      /^(\d{4})[:-](\d{2})[:-](\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/,
    );
    if (m) {
      const ms = Date.UTC(
        +m[1],
        +m[2] - 1,
        +m[3],
        +m[4],
        +m[5],
        m[6] ? +m[6] : 0,
      );
      return Number.isNaN(ms) ? undefined : ms - CN_OFFSET;
    }
  }
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? undefined : ms;
}

// ── JPEG EXIF ──────────────────────────────────────────

/** 读 JPEG 的 EXIF 拍摄时间原文字符串(找不到返回 undefined)。 */
function readJpegExif(buf: Buffer): string | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) {
      off += 1;
      continue;
    }
    const marker = buf[off + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS(进入图像数据)→ 停
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) break;
    const segStart = off + 4;
    const segEnd = off + 2 + len;
    if (segEnd > buf.length) break;
    if (
      marker === 0xe1 &&
      segStart + 6 <= segEnd &&
      buf.toString('ascii', segStart, segStart + 4) === 'Exif'
    ) {
      const dt = parseTiff(buf, segStart + 6, segEnd);
      if (dt) return dt;
    }
    off = segEnd;
  }
  return undefined;
}

/** 解析 TIFF 头(EXIF 主体)取拍摄时间。tiff=TIFF 起点,end=段尾界。 */
function parseTiff(buf: Buffer, tiff: number, end: number): string | undefined {
  if (tiff + 8 > end) return undefined;
  const bom = buf.toString('ascii', tiff, tiff + 2);
  const le = bom === 'II';
  if (!le && bom !== 'MM') return undefined;
  const u16 = (p: number) =>
    p + 2 <= end ? (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p)) : 0;
  const u32 = (p: number) =>
    p + 4 <= end ? (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p)) : 0;

  const ascii = (valPtr: number, type: number, count: number) => {
    if (type !== 2 || count <= 0 || count > 64) return undefined; // ASCII,合理上限
    const start = count <= 4 ? valPtr : tiff + u32(valPtr);
    if (start < tiff || start + count > end) return undefined;
    return buf.toString('ascii', start, start + count).split(String.fromCharCode(0))[0].trim();
  };

  type Entry = { type: number; count: number; valPtr: number };
  const readIfd = (ifdOff: number): Record<number, Entry> => {
    const res: Record<number, Entry> = {};
    if (ifdOff + 2 > end) return res;
    const n = u16(ifdOff);
    let p = ifdOff + 2;
    for (let i = 0; i < n && p + 12 <= end; i++, p += 12) {
      res[u16(p)] = { type: u16(p + 2), count: u32(p + 4), valPtr: p + 8 };
    }
    return res;
  };

  const ifd0 = readIfd(tiff + u32(tiff + 4));
  let original: string | undefined;
  let digitized: string | undefined;
  const exifPtr = ifd0[0x8769];
  if (exifPtr && exifPtr.type === 4) {
    const exifIfd = readIfd(tiff + u32(exifPtr.valPtr));
    const o = exifIfd[0x9003];
    const d = exifIfd[0x9004];
    if (o) original = ascii(o.valPtr, o.type, o.count);
    if (d) digitized = ascii(d.valPtr, d.type, d.count);
  }
  const dt0 = ifd0[0x0132];
  const dateTime = dt0 ? ascii(dt0.valPtr, dt0.type, dt0.count) : undefined;
  return original || digitized || dateTime;
}

// ── PNG 元数据 ─────────────────────────────────────────

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 读 PNG 的创建时间(tEXt/iTXt「Creation Time」/「date:create」/ XMP CreateDate)。 */
function readPngCreation(buf: Buffer): string | undefined {
  if (buf.length < 8) return undefined;
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) return undefined;
  let off = 8;
  let xmp: string | undefined;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) break;
    const seg = buf.subarray(dataStart, dataEnd);
    if (type === 'tEXt') {
      const z = seg.indexOf(0);
      if (z > 0) {
        const kw = seg.toString('latin1', 0, z);
        const val = seg.toString('latin1', z + 1);
        if (/creation time/i.test(kw) || /date:create/i.test(kw)) return val;
      }
    } else if (type === 'iTXt') {
      const z1 = seg.indexOf(0);
      if (z1 > 0 && seg[z1 + 1] === 0) {
        // 仅处理未压缩(compressionFlag=0)
        const kw = seg.toString('latin1', 0, z1);
        const z2 = seg.indexOf(0, z1 + 3); // langTag 结束
        const z3 = z2 >= 0 ? seg.indexOf(0, z2 + 1) : -1; // translatedKeyword 结束
        if (z3 >= 0) {
          const text = seg.toString('utf8', z3 + 1);
          if (/creation time/i.test(kw)) return text;
          if (/xmp/i.test(kw)) xmp = text;
        }
      }
    } else if (type === 'IEND') {
      break;
    }
    off = dataEnd + 4; // 跳过 CRC
  }
  if (xmp) {
    const m = xmp.match(
      /(?:CreateDate|DateCreated|DateTimeOriginal)\D{0,12}(\d{4}-\d{2}-\d{2}T[\d:]+(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
    );
    if (m) return m[1];
  }
  return undefined;
}

/**
 * 从图片二进制提取拍摄/创建时间 → epoch ms;取不到返回 undefined。
 * 任何解析异常都静默吞掉(调用方回退到上传时间)。
 */
export function extractCaptureTime(buf: Buffer): number | undefined {
  if (!buf || buf.length < 8) return undefined;
  try {
    let raw: string | undefined;
    if (buf[0] === 0xff && buf[1] === 0xd8) raw = readJpegExif(buf);
    else if (buf[0] === 0x89 && buf[1] === 0x50) raw = readPngCreation(buf);
    return raw ? parseCaptureString(raw) : undefined;
  } catch {
    return undefined;
  }
}
