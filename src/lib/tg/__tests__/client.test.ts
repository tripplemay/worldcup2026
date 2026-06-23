/**
 * tg/client 纯函数辅助测试(largestPhoto / bufferToBase64 / toInlineKeyboard)
 * 不触网络;网络函数另行集成验证。
 */
import {
  largestPhoto,
  bufferToBase64,
  toInlineKeyboard,
} from 'lib/tg/client';
import type { TgPhotoSize, TgButton } from 'lib/tg/types';

describe('largestPhoto', () => {
  it('返回数组最后一个尺寸(Telegram 升序返回)', () => {
    const photos: TgPhotoSize[] = [
      { file_id: 's', width: 90, height: 90 },
      { file_id: 'm', width: 320, height: 320 },
      { file_id: 'l', width: 800, height: 800 },
    ];
    expect(largestPhoto(photos)).toBe(photos[2]);
    expect(largestPhoto(photos)?.file_id).toBe('l');
  });

  it('空数组返回 undefined', () => {
    expect(largestPhoto([])).toBeUndefined();
  });

  it('未传参返回 undefined', () => {
    expect(largestPhoto()).toBeUndefined();
    expect(largestPhoto(undefined)).toBeUndefined();
  });
});

describe('bufferToBase64', () => {
  it('对已知 Buffer 往返编码正确', () => {
    const buf = Buffer.from('hello', 'utf8');
    const b64 = bufferToBase64(buf);
    expect(b64).toBe('aGVsbG8=');
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('hello');
  });

  it('二进制字节往返一致', () => {
    const buf = Buffer.from([0x00, 0xff, 0x10, 0x7f]);
    const b64 = bufferToBase64(buf);
    expect(Buffer.from(b64, 'base64')).toEqual(buf);
  });
});

describe('toInlineKeyboard', () => {
  it('将 {text,data} 映射为 {text,callback_data} 并保留行列结构', () => {
    const rows: TgButton[][] = [
      [
        { text: '赢', data: 'won' },
        { text: '输', data: 'lost' },
      ],
      [{ text: '走盘', data: 'void' }],
    ];
    expect(toInlineKeyboard(rows)).toEqual({
      inline_keyboard: [
        [
          { text: '赢', callback_data: 'won' },
          { text: '输', callback_data: 'lost' },
        ],
        [{ text: '走盘', callback_data: 'void' }],
      ],
    });
  });

  it('空二维数组返回空 inline_keyboard', () => {
    expect(toInlineKeyboard([])).toEqual({ inline_keyboard: [] });
  });
});
