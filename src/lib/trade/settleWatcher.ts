/**
 * 常驻结算守望者(进程内,独立于用户浏览)。
 * 周期性探测「有未结算注的比赛是否已 FT」,是则立即结算模拟盘 + 预测存档。
 * 自适应节奏:有注的比赛进行中/刚完赛 → 快(默认 45s);有注但未开赛 → 中(5min);无未结算注 → 闲(10min)。
 * 全程 ESPN(免费);结算幂等且互斥,与 15min cron 兜底并存,只是把延迟从「≤15min」降到「≤一次轮询」。
 */
import { espnProvider } from 'lib/espn/espn';
import { loadTrades } from 'lib/db/store';
import { runSettlement } from './settle';
import { settlePredictionLog } from 'lib/predict/predictionLog';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const SEASON = process.env.WC_SEASON ?? '2026';
const WC_RANGE = `${SEASON}0611-${SEASON}0719`;
const LIVE_MS = num(process.env.PAPER_SETTLE_LIVE_MS, 45_000); // 有注的比赛进行中/刚完赛
const PRE_MS = num(process.env.PAPER_SETTLE_PRE_MS, 300_000); // 有注但未开赛
const IDLE_MS = num(process.env.PAPER_SETTLE_IDLE_MS, 600_000); // 无未结算注

let started = false;

async function tick(): Promise<number> {
  const pending = loadTrades().filter((t) => t.status === 'pending');
  if (!pending.length) return IDLE_MS;

  const board = await espnProvider.getScoreboard(WC_RANGE);
  const statusOf = new Map(board.map((m) => [m.id, m.status]));

  // 有未结算注对应的比赛已 FT → 结算(幂等;summary 口径取 90 分钟)
  if (pending.some((p) => statusOf.get(p.matchId) === 'post')) {
    await runSettlement();
    await settlePredictionLog();
  }

  // 结算后重算节奏:仍有注的比赛在打 或 已完赛但 summary 尚未更新 → 继续快轮询
  const remaining = loadTrades()
    .filter((t) => t.status === 'pending')
    .map((p) => statusOf.get(p.matchId));
  if (remaining.some((s) => s === 'in' || s === 'post')) return LIVE_MS;
  if (remaining.some((s) => s === 'pre')) return PRE_MS;
  return IDLE_MS;
}

function schedule(ms: number): void {
  const timer = setTimeout(run, ms);
  if (typeof timer.unref === 'function') timer.unref();
}

async function run(): Promise<void> {
  let next = IDLE_MS;
  try {
    next = await tick();
  } catch {
    next = IDLE_MS;
  }
  schedule(next);
}

/** 进程启动时拉起(instrumentation 调用)。重复调用安全。 */
export function startSettleWatcher(): void {
  if (started) return;
  started = true;
  schedule(3_000); // 启动后稍候首拉
}
