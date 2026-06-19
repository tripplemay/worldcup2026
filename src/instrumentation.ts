/**
 * Next.js 启动钩子(Next 15 稳定特性)。
 * 进程启动时拉起实时赔率轮询器 + 结算守望者(仅 Node 运行时,跳过 Edge)。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startLivePoller } = await import('lib/odds/livePoller');
    startLivePoller();
    const { startSettleWatcher } = await import('lib/trade/settleWatcher');
    startSettleWatcher();
  }
}
