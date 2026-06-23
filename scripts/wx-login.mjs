/**
 * 微信接入一次性扫码登录(本地运行,拿凭证)。
 * 用法:  node scripts/wx-login.mjs
 * 用你自己的微信号扫码绑定 ClawBot;成功后把打印的 WX_BOT_TOKEN / WX_BASE_URL 设为 GitHub Secret。
 * 说明:底层是腾讯官方 iLink / 微信 ClawBot(2026-03 推出的官方个人号 Bot 能力,官方合法),
 *       请遵守《微信ClawBot功能使用条款》。wx-link 为第三方 TS 封装。
 */
import { loginWithQR } from 'wx-link';
import readline from 'node:readline';

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(a.trim()); }));
}

try {
  const res = await loginWithQR({
    onQRCode: (url) => {
      console.log('\n=== 用你自己的微信号扫这个码,绑定 ClawBot ===');
      console.log('二维码内容:', url);
      console.log(
        '浏览器打开下面链接显示二维码再扫:\n  https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=' +
          encodeURIComponent(url),
      );
    },
    onStatusChange: (s) => console.log('[状态]', s),
    onVerifyCode: async ({ retry }) =>
      ask((retry ? '验证码错误,重输' : '输入手机上显示的验证码') + ': '),
  });
  console.log('\n✅ 绑定成功!把下面两个值设为 GitHub Secret(WX_ADMIN_USER 可后续从日志锁定):');
  console.log('WX_BOT_TOKEN=' + res.botToken);
  console.log('WX_BASE_URL=' + res.baseUrl);
  console.log('\n(accountId=' + res.accountId + ' userId=' + (res.userId || '') + ')');
  process.exit(0);
} catch (e) {
  console.error('登录失败:', e);
  process.exit(1);
}
