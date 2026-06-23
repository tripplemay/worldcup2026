/**
 * Phase 9b:微信常驻轮询(经 instrumentation 在 PM2 进程内拉起)。
 * 长轮询 poll() 收消息 → handleWxMessage 处理 → 持久化游标。未配置 WX_BOT_TOKEN 则不启动。
 */
import { getWxClient, hasWx } from './client';
import { handleWxMessage } from './ingest';
import { loadWxCursor, saveWxCursor } from 'lib/db/store';

let started = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 进程启动时拉起(instrumentation 调用);重复调用安全。 */
export function startWxPoller(): void {
  if (started || !hasWx()) return;
  started = true;
  void loop();
}

async function loop(): Promise<void> {
  const client = getWxClient();
  if (!client) return;
  let cursor = loadWxCursor();
  // 长轮询天然限速;出错退避 5s 重试,绝不退出循环
  for (;;) {
    try {
      const res = await client.poll(cursor);
      if (res.nextCursor) {
        cursor = res.nextCursor;
        saveWxCursor(cursor);
      }
      for (const msg of res.msgs ?? []) {
        try {
          await handleWxMessage(client, msg);
        } catch (e) {
          console.error('[wx] 处理消息失败', e);
        }
      }
    } catch (e) {
      console.error('[wx] 轮询失败,5s 后重试', e);
      await sleep(5_000);
    }
  }
}
