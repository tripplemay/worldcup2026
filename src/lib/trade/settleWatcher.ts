/**
 * 常驻结算 + 赛后重算守望者(进程内,独立于用户浏览)。
 * 周期性探测 WC 比赛状态:
 *   1) 有未结算注的比赛已 FT → 立即结算模拟盘 + 预测存档;
 *   2) 任意比赛新完赛 → 防抖触发评分/TMI 重算(ingestHistory + recomputeRatings +
 *      ingestPlayerMinutes),并失效 predict/tmi 缓存,让下一场预测与球队动能即时吸收该结果。
 * 自适应节奏:有比赛进行中/有待结算注 → 快(45s);有注未开赛 → 中(5min);否则闲(10min)。
 * ESPN 探测免费;结算幂等+互斥;每日 engine cron + 15min cron 仍兜底。
 */
import { espnProvider } from 'lib/espn/espn';
import { loadTrades, loadBets } from 'lib/db/store';
import { runSettlement } from './settle';
import { settlePendingBets } from 'lib/bets/run';
import { settlePredictionLog } from 'lib/predict/predictionLog';
import { ingestHistory } from 'lib/predict/history';
import { recomputeRatings } from 'lib/predict/ratings';
import { fetchEloRatings } from 'lib/predict/eloratings';
import { ingestPlayerMinutes } from 'lib/predict/playerMinutes';
import { clearCache } from 'lib/cache';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) =>
  v == null ? d : v === '1' || v.toLowerCase() === 'true';

const SEASON = process.env.WC_SEASON ?? '2026';
const WC_RANGE = `${SEASON}0611-${SEASON}0719`;
const LIVE_MS = num(process.env.PAPER_SETTLE_LIVE_MS, 45_000); // 有比赛进行中/有待结算注
const PRE_MS = num(process.env.PAPER_SETTLE_PRE_MS, 300_000); // 有注但未开赛
const IDLE_MS = num(process.env.PAPER_SETTLE_IDLE_MS, 600_000); // 空闲
const RECOMPUTE_ON_FINISH = bool(process.env.PREDICT_RECOMPUTE_ON_FINISH, true);
const RECOMPUTE_DELAY_MS = num(process.env.PREDICT_RECOMPUTE_DELAY_MS, 120_000); // 完赛后稍候,待 AF 落数据

let started = false;
let seeded = false; // 首拍只记录、不重算(部署时 engine 已重算过启动前的完赛)
const handled = new Set<string>(); // 已记入/已触发重算的完赛比赛 id
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;

/** 赛后重算:摄取新结果 → 重算评分 → 增量摄取出场分钟(TMI 体能)→ 失效预测/TMI 缓存。 */
async function recomputeNow(): Promise<void> {
  try {
    await ingestHistory(14);
    const authElo = await fetchEloRatings();
    recomputeRatings(authElo);
    void ingestPlayerMinutes().catch(() => {});
    clearCache('predict:');
    clearCache('tmi:');
  } catch (e) {
    console.error('[settleWatcher] 赛后重算失败', e);
  }
}

/** 防抖:新完赛后稍候触发一次重算,窗口内多场完赛合并为一次(ingestHistory 本就批量覆盖)。 */
function scheduleRecompute(): void {
  if (recomputeTimer) return;
  const t = setTimeout(() => {
    recomputeTimer = null;
    void recomputeNow();
  }, RECOMPUTE_DELAY_MS);
  if (typeof t.unref === 'function') t.unref();
  recomputeTimer = t;
}

async function tick(): Promise<number> {
  const board = await espnProvider.getScoreboard(WC_RANGE);
  const statusOf = new Map(board.map((m) => [m.id, m.status]));
  const finishedIds = board.filter((m) => m.status === 'post').map((m) => m.id);

  // ① 赛后即时重算(防抖)
  if (RECOMPUTE_ON_FINISH) {
    if (!seeded) {
      finishedIds.forEach((id) => handled.add(id));
      seeded = true;
    } else {
      const fresh = finishedIds.filter((id) => !handled.has(id));
      if (fresh.length) {
        fresh.forEach((id) => handled.add(id));
        scheduleRecompute();
      }
    }
  }

  // ② 结算:有未结算注的比赛已 FT
  const pending = loadTrades().filter((t) => t.status === 'pending');
  if (
    pending.length &&
    pending.some((p) => statusOf.get(p.matchId) === 'post')
  ) {
    await runSettlement();
    await settlePredictionLog();
  }

  // ②b Phase 9:他平台注单结算(赛果跨 WC + 联赛;ESPN 探测免费,失败不阻塞守望者)
  if (
    loadBets().some((b) => b.status === 'pending' || b.status === 'unmatched')
  ) {
    try {
      await settlePendingBets();
    } catch (e) {
      console.error('[settleWatcher] 注单结算失败', e);
    }
  }

  // ③ 自适应节奏
  const anyLive = board.some((m) => m.status === 'in');
  const remaining = loadTrades()
    .filter((t) => t.status === 'pending')
    .map((p) => statusOf.get(p.matchId));
  if (anyLive || remaining.some((s) => s === 'in' || s === 'post'))
    return LIVE_MS;
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
