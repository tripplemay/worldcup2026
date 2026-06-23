/**
 * Telegram Bot API 轻客户端 — 零新依赖,直用 Node 20 全局 fetch / Buffer
 *
 * Token 取自 process.env.TG_BOT_TOKEN。API 基址 https://api.telegram.org/bot<TOKEN>,
 * 文件下载基址 https://api.telegram.org/file/bot<TOKEN>/<file_path>。
 * 设计要点:
 *  - 网络/解析失败一律 try/catch → 返回 null/false,绝不抛出(参考 odds/theoddsapi.ts)。
 *  - 所有请求 cache:'no-store'(Bot 数据实时,禁缓存)。
 *  - downloadFile 的 URL 内嵌 token,严禁打印日志。
 */
import type { TgPhotoSize, TgButton } from './types';

const API_HOST = 'https://api.telegram.org';

/** 当前 Bot token(无配置则返回空串,调用方据此降级)。 */
function token(): string {
  return (process.env.TG_BOT_TOKEN ?? '').trim();
}

// ── 纯函数辅助(全量测试)─────────────────────────────────

/** 取最大尺寸图片:Telegram 按升序返回,末尾即最大;空/未传 → undefined。 */
export function largestPhoto(
  photos?: TgPhotoSize[],
): TgPhotoSize | undefined {
  if (!photos || photos.length === 0) return undefined;
  return photos[photos.length - 1];
}

/** Buffer → base64 字符串。 */
export function bufferToBase64(buf: Buffer): string {
  return buf.toString('base64');
}

/** 便捷按钮二维数组 → Telegram inline_keyboard({text,data}→{text,callback_data})。 */
export function toInlineKeyboard(rows: TgButton[][]): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.data })),
    ),
  };
}

// ── 网络函数(原生 fetch,失败降级)──────────────────────

/**
 * 调用 Bot API 方法:POST `${BASE}/${method}`,body 为 JSON。
 * token 缺失或请求/解析失败 → null;HTTP 非 2xx → null;否则返回解析后的 json。
 */
async function api(method: string, body: object): Promise<any | null> {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch(`${API_HOST}/bot${t}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`[tg] api ${method} 失败:`, err);
    return null;
  }
}

/** 发送纯文本消息;成功返回 true。 */
export async function sendMessage(
  chatId: number | string,
  text: string,
): Promise<boolean> {
  const json = await api('sendMessage', { chat_id: chatId, text });
  return Boolean(json && json.ok);
}

/** 发送带内联键盘的消息;成功返回该消息 message_id,否则 null。 */
export async function sendKeyboard(
  chatId: number | string,
  text: string,
  rows: TgButton[][],
): Promise<number | null> {
  const json = await api('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: toInlineKeyboard(rows),
  });
  const id = json?.result?.message_id;
  return typeof id === 'number' ? id : null;
}

/** 编辑已发送消息的文本;成功返回 true。 */
export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
): Promise<boolean> {
  const json = await api('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
  });
  return Boolean(json && json.ok);
}

/** 应答内联按钮回调(消除按钮 loading 态);成功返回 true。 */
export async function answerCallbackQuery(
  id: string,
  text?: string,
): Promise<boolean> {
  const body: { callback_query_id: string; text?: string } = {
    callback_query_id: id,
  };
  if (text != null) body.text = text;
  const json = await api('answerCallbackQuery', body);
  return Boolean(json && json.ok);
}

/** 由 file_id 取文件的 file_path(下载第一步);失败返回 null。 */
export async function getFilePath(fileId: string): Promise<string | null> {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch(
      `${API_HOST}/bot${t}/getFile?file_id=${encodeURIComponent(fileId)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const path = json?.result?.file_path;
    return typeof path === 'string' ? path : null;
  } catch (err) {
    console.error('[tg] getFilePath 失败:', err);
    return null;
  }
}

/**
 * 下载文件内容为 Buffer。URL 内嵌 token,严禁打印该 URL。失败返回 null。
 */
export async function downloadFile(
  filePath: string,
): Promise<Buffer | null> {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch(`${API_HOST}/file/bot${t}/${filePath}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch (err) {
    // 注意:不打印 URL(含 token)
    console.error('[tg] downloadFile 失败:', err);
    return null;
  }
}
