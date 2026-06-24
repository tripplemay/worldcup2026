import { extractCaptureTime, parseCaptureString } from '../captureTime';

const SP = String.fromCharCode(0x20); // 空格(规避构造时的字面空格问题)
const NUL = String.fromCharCode(0);
const CN = 8 * 3600_000;

/** 构造含 EXIF DateTimeOriginal 的最小 JPEG(小端 TIFF)。 */
function buildExifJpeg(dt: string): Buffer {
  const tiff = Buffer.alloc(64);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 偏移
  // IFD0(偏移 8):1 项 → ExifIFD 指针
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10); // ExifIFD ptr
  tiff.writeUInt16LE(4, 12); // LONG
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18); // → ExifIFD 偏移
  tiff.writeUInt32LE(0, 22); // 下一 IFD
  // ExifIFD(偏移 26):1 项 → DateTimeOriginal
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28);
  tiff.writeUInt16LE(2, 30); // ASCII
  tiff.writeUInt32LE(20, 32);
  tiff.writeUInt32LE(44, 36); // → 字符串偏移
  tiff.writeUInt32LE(0, 40);
  tiff.write((dt + NUL).slice(0, 20), 44, 'ascii'); // 19 字符 + NUL
  const app1 = Buffer.concat([Buffer.from('Exif' + NUL + NUL, 'ascii'), tiff]);
  const len = app1.length + 2;
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.concat([head, app1, Buffer.from([0xff, 0xd9])]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); // 解析器不校验 CRC
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, crc]);
}
/** 构造含 tEXt keyword=value 的最小 PNG。 */
function buildPngText(keyword: string, value: string): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(value, 'latin1'),
  ]);
  return Buffer.concat([sig, chunk('tEXt', data), chunk('IEND', Buffer.alloc(0))]);
}

describe('parseCaptureString', () => {
  it('EXIF 格式按北京解读', () => {
    const dt = '2026:06:25' + SP + '14:30:00';
    expect(parseCaptureString(dt)).toBe(Date.UTC(2026, 5, 25, 14, 30, 0) - CN);
  });
  it('朴素 ISO 按北京解读', () => {
    expect(parseCaptureString('2026-06-25T08:00:00')).toBe(
      Date.UTC(2026, 5, 25, 8, 0, 0) - CN,
    );
  });
  it('带时区则尊重时区(+08:00)', () => {
    expect(parseCaptureString('2026-06-25T08:00:00+08:00')).toBe(
      Date.UTC(2026, 5, 25, 0, 0, 0),
    );
  });
  it('带 Z 视为 UTC', () => {
    expect(parseCaptureString('2026-06-25T08:00:00Z')).toBe(
      Date.UTC(2026, 5, 25, 8, 0, 0),
    );
  });
  it('无法解析返回 undefined', () => {
    expect(parseCaptureString('hello')).toBeUndefined();
    expect(parseCaptureString('')).toBeUndefined();
  });
});

describe('extractCaptureTime', () => {
  it('JPEG EXIF DateTimeOriginal(按北京)', () => {
    const buf = buildExifJpeg('2026:06:25' + SP + '14:30:00');
    expect(extractCaptureTime(buf)).toBe(Date.UTC(2026, 5, 25, 14, 30, 0) - CN);
  });
  it('提取的时间在 UTC+8 渲染回原墙钟', () => {
    const ms = extractCaptureTime(buildExifJpeg('2026:06:25' + SP + '14:30:00'))!;
    const s = new Date(ms).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    expect(s).toContain('14:30');
  });
  it('PNG Creation Time(朴素→北京)', () => {
    const buf = buildPngText('Creation' + SP + 'Time', '2026-06-25T08:00:00');
    expect(extractCaptureTime(buf)).toBe(Date.UTC(2026, 5, 25, 8, 0, 0) - CN);
  });
  it('PNG Creation Time(带 Z→UTC)', () => {
    const buf = buildPngText('Creation' + SP + 'Time', '2026-06-25T08:00:00Z');
    expect(extractCaptureTime(buf)).toBe(Date.UTC(2026, 5, 25, 8, 0, 0));
  });
  it('无元数据返回 undefined', () => {
    expect(
      extractCaptureTime(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    ).toBeUndefined();
    expect(extractCaptureTime(buildPngText('Comment', 'hi'))).toBeUndefined();
  });
});
