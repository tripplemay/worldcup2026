/**
 * Phase 9b:微信接入。底层是腾讯官方 iLink / 微信 ClawBot 个人号 Bot 能力
 * (官方服务器 ilinkai.weixin.qq.com,2026-03 推出);wx-link 为第三方 TS 封装。
 * 你绑定自己的微信号当 ClawBot 收投注单截图,喂给现有识别→结算流水线;归属在盈亏网页上做。
 *
 * 凭证由 env 注入:WX_BOT_TOKEN(扫码绑定拿到)+ 可选 WX_BASE_URL(默认官方域)。
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
