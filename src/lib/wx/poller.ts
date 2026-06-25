/**
 * Phase 9b:微信常驻轮询(经 instrumentation 在 PM2 进程内拉起)。
 * 每个管理员各有独立 clawbot/token,故为每个 token 起一条独立长轮询。
 * reconcile 每 30s 扫一次 token 列表(env + wx-bots.json),为新增 bot 起轮询 —— 新管理员
 * 经接口加入后无需重启即可生效。出错退避重试,绝不退出循环。
 */
import { getWxClients, type WxBotClient } from './client';
import { handleWxMessage } from './ingest';
import {
  loadWxCursor,
  saveWxCursor,
  loadWxCursorFor,
  saveWxCursorFor,
} from 'lib/db/store';

let started = false;
const active = new Set<string>(); // 已起轮询的 botKey
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RECONCILE_MS = 30_000;

/** 进程启动时拉起(instrumentation 调用);重复调用安全。 */
export function startWxPoller(): void {
  if (started) return;
  started = true;
  void reconcileForever();
}

async function reconcileForever(): Promise<void> {
  for (;;) {
    try {
      for (const bot of getWxClients()) {
        if (!active.has(bot.key)) {
          active.add(bot.key);
          void loop(bot);
        }
      }
    } catch (e) {
      console.error('[wx] reconcile 失败', e);
    }
    await sleep(RECONCILE_MS);
  }
}

async function loop(bot: WxBotClient): Promise<void> {
  const { client, key, primary } = bot;
  let cursor = primary ? loadWxCursor() : loadWxCursorFor(key);
  // 长轮询天然限速;出错退避 5s 重试,绝不退出循环
  for (;;) {
    try {
      const res = await client.poll(cursor);
      if (res.nextCursor) {
        cursor = res.nextCursor;
        if (primary) saveWxCursor(cursor);
        else saveWxCursorFor(key, cursor);
      }
      for (const msg of res.msgs ?? []) {
        try {
          await handleWxMessage(client, msg);
        } catch (e) {
          console.error('[wx] 处理消息失败', e);
        }
      }
    } catch (e) {
      console.error(`[wx] 轮询失败(bot ${key}),5s 后重试`, e);
      await sleep(5_000);
    }
  }
}
