/**
 * Phase 9b:微信接入。底层是腾讯官方 iLink / 微信 ClawBot 个人号 Bot 能力
 * (官方服务器 ilinkai.weixin.qq.com,2026-03 推出);wx-link 为第三方 TS 封装。
 *
 * 重要事实:**每个人扫码各自生成一个独立 clawbot(独立 accountId/token)**,并非共用一个。
 * 故要支持多管理员,生产需同时轮询多个 token:
 *   - 主 bot:env WX_BOT_TOKEN(可逗号分隔多个);
 *   - 附加 bot:运行时经接口存入 wx-bots.json(每加一个管理员扫码后写入)。
 * WX_BASE_URL 可选(默认官方域)。无任何 token 时整个微信接入禁用(轮询器不启动)。
 */
import { createHash } from 'crypto';
import { WxLinkClient } from 'wx-link';
import { loadWxBots } from 'lib/db/store';

const DEFAULT_BASE = 'https://ilinkai.weixin.qq.com';

/** token → 稳定短键(用于按 bot 存游标 / 增删定位;不暴露原 token)。 */
export function botKey(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

/** env WX_BOT_TOKEN 解析出的 token 列表(逗号分隔、去空)。 */
export function envWxTokens(): string[] {
  return (process.env.WX_BOT_TOKEN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 所有要轮询的 clawbot token:env(主)+ wx-bots.json(附加),按出现顺序去重。 */
export function listWxTokens(): string[] {
  const stored = loadWxBots()
    .map((b) => b.token.trim())
    .filter(Boolean);
  return Array.from(new Set([...envWxTokens(), ...stored]));
}

/** 是否已配置微信接入(至少一个 token)。 */
export function hasWx(): boolean {
  return listWxTokens().length > 0;
}

export interface WxBotClient {
  client: WxLinkClient;
  key: string;
  primary: boolean; // 主 bot(env 第一个)→ 沿用 legacy 游标文件
}

/** 为当前所有 token 构造客户端;primary=env 第一个 token。 */
export function getWxClients(): WxBotClient[] {
  const baseUrl = process.env.WX_BASE_URL || DEFAULT_BASE;
  const primaryToken = envWxTokens()[0];
  return listWxTokens().map((token) => ({
    client: new WxLinkClient({ baseUrl, token }),
    key: botKey(token),
    primary: token === primaryToken,
  }));
}
