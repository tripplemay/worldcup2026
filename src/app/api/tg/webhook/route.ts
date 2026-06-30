/**
 * POST /api/tg/webhook — Telegram bot 入口(Phase 9 投注单识别)。
 *
 * 鉴权:x-telegram-bot-api-secret-token === TG_WEBHOOK_SECRET(未设→禁用)。
 * 仅信任 TG_ADMIN_CHAT_ID 的会话。始终尽快回 200(非 2xx 会被 Telegram 重试)。
 *  · 图片消息 → 下载 → 视觉识别 → 落库(pending,未归属)→ 发「识别摘要 + 投注人按钮」。
 *  · 按钮回调 assign:<betId>:<bettorId> → 绑定归属 → 编辑原消息为「已归属」。
 */
import {
  recognizeBetSlipDetailed,
  recognitionFailureMessage,
} from 'lib/bets/recognize';
import { createBetFromRecognized, addBet, assignBettor } from 'lib/bets/bets';
import { saveBetImage } from 'lib/bets/images';
import { extractCaptureTime } from 'lib/bets/captureTime';
import { backfillLegKickoffs } from 'lib/bets/match';
import { listBettors, getBettor } from 'lib/bets/bettors';
import {
  largestPhoto,
  bufferToBase64,
  getFilePath,
  downloadFile,
  sendMessage,
  sendKeyboard,
  editMessageText,
  answerCallbackQuery,
} from 'lib/tg/client';
import { ok, fail } from 'lib/api/respond';
import { randomBytes } from 'crypto';
import type { TgUpdate, TgButton } from 'lib/tg/types';
import { isOutrightLeg, type BetSlip } from 'lib/bets/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authed(req: Request): boolean {
  const secret = process.env.TG_WEBHOOK_SECRET;
  if (!secret) return false; // 未配置即禁用
  return req.headers.get('x-telegram-bot-api-secret-token') === secret;
}

function isAdmin(chatId?: number): boolean {
  // TG_ADMIN_CHAT_ID 支持多个(逗号分隔);为空则一律拒绝(fail-closed)
  const admins = (process.env.TG_ADMIN_CHAT_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return admins.includes(String(chatId));
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 识别摘要(发给管理员核对)。 */
function summarize(slip: BetSlip): string {
  const cur = slip.currency ? `${slip.currency} ` : '';
  const lines = slip.legs.map((l, i) => {
    const line = l.line != null ? ` ${l.line}` : '';
    const odds = l.odds != null ? ` @${l.odds}` : '';
    if (isOutrightLeg(l))
      return `${i + 1}. ${l.competition} — 冠军 ${l.selection}${odds}`;
    return `${i + 1}. ${l.homeName} vs ${l.awayName} — ${l.market} ${
      l.selection
    }${line}${odds}`;
  });
  return [
    `🧾 识别注单(${slip.legs.length} ${
      slip.legs.length > 1 ? '串关' : '单注'
    })`,
    `本金 ${cur}${slip.stake.toFixed(
      2,
    )} · 可赢 ${cur}${slip.potentialReturn.toFixed(2)}`,
    `置信度 ${Math.round(slip.confidence * 100)}%`,
    ...lines,
  ].join('\n');
}

async function handlePhoto(
  chatId: number,
  messageId: number,
  photoFileId: string,
): Promise<void> {
  const filePath = await getFilePath(photoFileId);
  const buf = filePath ? await downloadFile(filePath) : null;
  if (!buf) {
    await sendMessage(chatId, '⚠️ 图片下载失败,请重试。');
    return;
  }
  const recognized = await recognizeBetSlipDetailed(
    bufferToBase64(buf),
    'image/jpeg',
  );
  if ('code' in recognized) {
    await sendMessage(chatId, recognitionFailureMessage(recognized.code));
    return;
  }
  const rec = recognized.slip;
  const slip = createBetFromRecognized(rec, {
    chatId,
    messageId,
    fileId: photoFileId,
  });
  // 下注时间:取图片拍摄/创建时间(EXIF/元数据);取不到展示层回退到入库时间
  const placedAt = extractCaptureTime(buf);
  if (placedAt) slip.placedAt = placedAt;
  // 随机文件名(不可枚举),与注单 id 解耦
  const imageRef = saveBetImage(randomBytes(16).toString('hex'), buf);
  if (imageRef) slip.imageRef = imageRef;
  // 回填各腿开赛时间(UTC+8 显示);失败静默
  await backfillLegKickoffs(slip);
  await addBet(slip);

  const bettors = listBettors().filter((b) => b.active !== false);
  if (!bettors.length) {
    await sendMessage(
      chatId,
      `${summarize(
        slip,
      )}\n\n⚠️ 名册为空,请先在盈亏页添加投注人或设 BET_TRACKER_BETTORS。`,
    );
    return;
  }
  const buttons: TgButton[] = bettors.map((b) => ({
    text: b.name,
    data: `assign:${slip.id}:${b.id}`,
  }));
  await sendKeyboard(
    chatId,
    `${summarize(slip)}\n\n这是谁的单?`,
    chunk(buttons, 2),
  );
}

async function handleAssign(
  chatId: number,
  messageId: number | undefined,
  callbackId: string,
  betId: string,
  bettorId: string,
): Promise<void> {
  const bettor = getBettor(bettorId);
  const done = bettor ? await assignBettor(betId, bettorId) : false;
  await answerCallbackQuery(
    callbackId,
    done ? `已归属 ${bettor?.name}` : '归属失败',
  );
  if (done && messageId != null) {
    await editMessageText(
      chatId,
      messageId,
      `✅ 已归属:${bettor?.name}\n(注单 ${betId})`,
    );
  }
}

async function handleUpdate(update: TgUpdate): Promise<void> {
  // 1) 按钮回调:归属
  const cq = update.callback_query;
  if (cq) {
    const chatId = cq.message?.chat.id;
    if (!isAdmin(chatId)) {
      await answerCallbackQuery(cq.id, '无权限');
      return;
    }
    const m = /^assign:([^:]+):(.+)$/.exec(cq.data ?? '');
    if (!m || chatId == null) {
      await answerCallbackQuery(cq.id);
      return;
    }
    await handleAssign(chatId, cq.message?.message_id, cq.id, m[1], m[2]);
    return;
  }

  // 2) 图片消息:识别 + 落库 + 发归属按钮
  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) {
    await sendMessage(chatId, '⛔ 仅管理员可用。');
    return;
  }
  const photo = largestPhoto(msg.photo);
  if (!photo) {
    await sendMessage(chatId, '请发送投注单截图(作为图片发送,而非文件)。');
    return;
  }
  await handlePhoto(chatId, msg.message_id, photo.file_id);
}

export async function POST(req: Request) {
  if (!authed(req)) return fail('unauthorized', 401);
  let update: TgUpdate | null = null;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return ok({}); // 始终 200,避免 Telegram 重试
  }
  try {
    if (update) await handleUpdate(update);
  } catch (e) {
    console.error('[tg/webhook] 处理失败', e);
  }
  return ok({});
}
