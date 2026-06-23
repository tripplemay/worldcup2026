/**
 * Phase 9b:微信接入(经 wx-link / iLink 协议)。
 * 一个微信号当「机器人」收投注单截图,喂给现有识别→结算流水线;归属在盈亏网页上做。
 *
 * 凭证由 env 注入:WX_BOT_TOKEN(loginWithQR 拿到)+ 可选 WX_BASE_URL(默认 iLink AI 域)。
 * 未配置 WX_BOT_TOKEN 时整个微信接入禁用(轮询器不启动)。
 */
import { WxLinkClient } from 'wx-link';

const DEFAULT_BASE = 'https://ilinkai.weixin.qq.com';

/** 是否已配置微信接入(有 bot token)。 */
export function hasWx(): boolean {
  return !!process.env.WX_BOT_TOKEN;
}

/** 构造微信客户端;未配置返回 null。 */
export function getWxClient(): WxLinkClient | null {
  const token = process.env.WX_BOT_TOKEN;
  if (!token) return null;
  const baseUrl = process.env.WX_BASE_URL || DEFAULT_BASE;
  return new WxLinkClient({ baseUrl, token });
}
