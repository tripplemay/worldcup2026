/**
 * Phase 9 注单写锁:bets.json 是「整表 load→改→save」,并发(webhook 落单 vs 结算扫描)
 * 会相互覆盖丢更新。用进程内 Promise 串行链把所有写操作排队(单 PM2 实例足够)。
 */
let chain: Promise<unknown> = Promise.resolve();

/** 串行执行 fn(前一个完成后才开始);任一失败不阻断后续。 */
export function withBetsLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
