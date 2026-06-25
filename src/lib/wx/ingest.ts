/**
 * Phase 9b:处理一条微信消息 —— 截图 → 视觉识别 → 落库(未归属)→ 回执。
 * 复用现有 recognize / bets / images;归属在盈亏网页上做(方案 A)。
 */
import { randomBytes } from 'crypto';
import { MessageType, MessageItemType } from 'wx-link';
import type { WxLinkClient, WeixinMessage } from 'wx-link';
import { recognizeBetSlip } from 'lib/bets/recognize';
import { createBetFromRecognized, addBet, assignBettor } from 'lib/bets/bets';
import { listBettors } from 'lib/bets/bettors';
import { saveBetImage } from 'lib/bets/images';
import { extractCaptureTime } from 'lib/bets/captureTime';
import { backfillLegKickoffs } from 'lib/bets/match';
import { loadWxPending, saveWxPending } from 'lib/db/store';
import { resolveAssignChoice, assignPrompt } from './assign';
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

/** 处理单条消息:仅私聊;默认所有发送者皆管理员(或仅 WX_ADMIN_USER 名单);图片→识别入库,文本→归属选择。 */
export async function handleWxMessage(
  client: WxLinkClient,
  msg: WeixinMessage,
): Promise<void> {
  if (msg.message_type === MessageType.BOT) return; // 跳过机器人自身回显
  if (msg.group_id) return; // 暂只处理私聊(方案 A)
  const sender = msg.from_user_id;
  if (!sender) return;
  // 接入由「绑定 QR 只发给有资格的人」管控 → 默认放开:所有私聊发送者皆为管理员,无需配置。
  // 可选收紧:设了 WX_ADMIN_USER(逗号分隔)则只收名单内的人;不设则收所有人。
  const allow = (process.env.WX_ADMIN_USER ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length && !allow.includes(sender)) return;

  const imgItem = (msg.item_list ?? []).find(
    (it) => it.type === MessageItemType.IMAGE && it.image_item,
  );
  const textRaw = (msg.item_list ?? []).find(
    (it) => it.type === MessageItemType.TEXT && it.text_item,
  )?.text_item?.text;

  // 纯文本 + 有待归属注单 → 当作归属选择(回复序号/姓名)
  if (!imgItem && textRaw) {
    await handleAssignReply(client, msg, sender, textRaw);
    return;
  }
  if (!imgItem) return; // 既非图片、也无待归属文本 → 忽略

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

  // 回执识别摘要 + 询问归属(无内联按钮 → 让管理员回复序号/姓名)
  const bettors = listBettors().filter((b) => b.active !== false);
  if (!bettors.length) {
    await reply(
      client,
      msg,
      `${summarize(slip)}\n\n⚠️ 名册为空,请先在盈亏页添加投注人。`,
    );
    return;
  }
  const pending = loadWxPending();
  pending[sender] = {
    betId: slip.id,
    bettorIds: bettors.map((b) => b.id),
    at: Date.now(),
  };
  saveWxPending(pending);
  await reply(client, msg, `${summarize(slip)}\n\n${assignPrompt(bettors)}`);
}

/** 管理员回复序号/姓名 → 归属待定注单;无待定则忽略,无法解析则提示重试。 */
async function handleAssignReply(
  client: WxLinkClient,
  msg: WeixinMessage,
  sender: string,
  text: string,
): Promise<void> {
  const pending = loadWxPending();
  const p = pending[sender];
  if (!p) return; // 无待归属 → 忽略普通文本
  const all = listBettors();
  const ordered = p.bettorIds
    .map((id) => all.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => !!b);
  const choiceId = resolveAssignChoice(text, ordered);
  if (!choiceId) {
    await reply(client, msg, `没识别到选择。\n${assignPrompt(ordered)}`);
    return;
  }
  await assignBettor(p.betId, choiceId);
  delete pending[sender];
  saveWxPending(pending);
  const name = all.find((b) => b.id === choiceId)?.name ?? choiceId;
  await reply(client, msg, `✅ 已归属:${name}`);
}
