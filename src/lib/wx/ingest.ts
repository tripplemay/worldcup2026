/**
 * Phase 9b:处理一条微信消息 —— 截图 → 视觉识别 → 落库(未归属)→ 回执。
 * 复用现有 recognize / bets / images;归属在盈亏网页上做(方案 A)。
 */
import { randomBytes } from 'crypto';
import { MessageType, MessageItemType } from 'wx-link';
import type { WxLinkClient, WeixinMessage } from 'wx-link';
import { recognizeBetSlip } from 'lib/bets/recognize';
import { createBetFromRecognized, addBet } from 'lib/bets/bets';
import { saveBetImage } from 'lib/bets/images';
import { extractCaptureTime } from 'lib/bets/captureTime';
import { backfillLegKickoffs } from 'lib/bets/match';
import type { BetSlip } from 'lib/bets/types';

/** 识别摘要(回执给发送者核对)。 */
function summarize(slip: BetSlip): string {
  const cur = slip.currency ? `${slip.currency} ` : '';
  const lines = slip.legs.map((l, i) => {
    const line = l.line != null ? ` ${l.line}` : '';
    const odds = l.odds != null ? ` @${l.odds}` : '';
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

async function reply(
  client: WxLinkClient,
  msg: WeixinMessage,
  text: string,
): Promise<void> {
  if (!msg.from_user_id) return;
  try {
    await client.sendText({
      toUserId: msg.from_user_id,
      text,
      contextToken: msg.context_token,
    });
  } catch (e) {
    console.error('[wx] 回执失败', e);
  }
}

/** 处理单条消息:仅 1:1、仅(配置了的)管理员、仅图片;识别后落「未归属」注单。 */
export async function handleWxMessage(
  client: WxLinkClient,
  msg: WeixinMessage,
): Promise<void> {
  if (msg.message_type === MessageType.BOT) return; // 跳过机器人自身回显
  if (msg.group_id) return; // 暂只处理私聊(方案 A)
  const sender = msg.from_user_id;
  if (!sender) return;
  // fail-closed:未配置 WX_ADMIN_USER 时不处理任何人(避免陌生人发图落库);向 TG 看齐
  const admin = process.env.WX_ADMIN_USER;
  if (!admin) {
    console.warn(
      '[wx] 未设 WX_ADMIN_USER,忽略来自',
      sender,
      '的消息(请配置后再用)',
    );
    return;
  }
  if (sender !== admin) return; // 只信任配置的管理员

  const imgItem = (msg.item_list ?? []).find(
    (it) => it.type === MessageItemType.IMAGE && it.image_item,
  );
  if (!imgItem) return; // 非图片消息忽略

  const media = await client.downloadInboundMedia(imgItem);
  if (!media?.buffer) {
    await reply(client, msg, '⚠️ 图片下载失败,请重发');
    return;
  }
  const rec = await recognizeBetSlip(
    media.buffer.toString('base64'),
    media.contentType || 'image/jpeg',
  );
  if (!rec) {
    await reply(client, msg, '⚠️ 识别失败(未配置视觉模型或图片不清晰),请重发');
    return;
  }
  const slip = createBetFromRecognized(rec);
  // 下注时间:取图片拍摄/创建时间(微信发原图可保留);取不到展示层回退入库时间
  const placedAt = extractCaptureTime(media.buffer);
  if (placedAt) slip.placedAt = placedAt;
  const imageRef = saveBetImage(randomBytes(16).toString('hex'), media.buffer);
  if (imageRef) slip.imageRef = imageRef;
  // 回填各腿开赛时间(UTC+8 显示);失败静默
  await backfillLegKickoffs(slip);
  await addBet(slip);

  await reply(client, msg, `${summarize(slip)}\n\n请到盈亏页指定归属。`);
}
