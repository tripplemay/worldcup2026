/**
 * Phase 10 · G7 前向纸面管道(协议最后一环)。
 *
 * 语义:配置被选为 incumbent 之后**新到达**的完赛比赛,才是它的"前向"样本——搜索过程从未
 * 见过这些比赛(watermark 之后才入库),故为真·前向验证。每日数据摄取(cron 4:35)之后、
 * 进化循环消费之前,对被追踪配置在 [watermark, 最新] 窗补记虚拟注(开盘价成交、闭盘量 CLV)。
 * forwardEvidence 喂 gauntlet 的 G7(live ≥150 注且 CLV t>2 才谈真钱)。
 * 首次运行只立 watermark 不回填(回填=把历史冒充前向,禁止)。
 */
import { runStrategy } from './engine';
import { toStrategyParams } from './evolve';
import type { EvoParams } from './evolve';
import type { EngineDataset, BetRecord } from './engine';

const dateKey = (iso: string) => iso.slice(0, 10);

export interface ForwardBet {
  date: string;
  home: string;
  away: string;
  market: string;
  selection: string;
  line?: number;
  odds: number;
  stake: number;
  clv: number | null;
  pnl: number;
}
export interface ForwardConfigTrack {
  label: string;
  evo: EvoParams;
  since: string; // 开始追踪日(=当时 watermark)
  bets: ForwardBet[];
}
export interface ForwardStore {
  watermark: string; // 已处理到的完赛日(含)
  byConfig: Record<string, ForwardConfigTrack>; // configHash → 追踪
}

export function newForwardStore(latestDate: string): ForwardStore {
  return { watermark: latestDate, byConfig: {} };
}

/**
 * 前向更新:对每个被追踪配置,补记 (watermark, latest] 窗内的虚拟注;推进 watermark。
 * tracked 中的新 configHash 自动开始追踪(since=当前 watermark,不回填)。不可变返回新 store。
 */
export async function updateForwardLog(
  dataset: EngineDataset,
  store: ForwardStore | null,
  tracked: { configHash: string; label: string; evo: EvoParams }[],
): Promise<ForwardStore> {
  const dates = dataset.allRes.map((r) => dateKey(r.date)).sort();
  const latest = dates[dates.length - 1] ?? '1970-01-01';
  // 首次:立 watermark(=最新完赛日)→ 下方追踪注册后因 latest==watermark 不会回填任何历史注
  const base = store ?? newForwardStore(latest);
  const byConfig: Record<string, ForwardConfigTrack> = { ...base.byConfig };
  for (const t of tracked) {
    if (!byConfig[t.configHash])
      byConfig[t.configHash] = {
        label: t.label,
        evo: t.evo,
        since: base.watermark,
        bets: [],
      };
  }
  if (latest > base.watermark) {
    for (const [, track] of Object.entries(byConfig)) {
      const r = await runStrategy(dataset, {
        ...toStrategyParams(track.evo),
        from: shiftDay(base.watermark, 1),
        to: latest,
      });
      const add: ForwardBet[] = r.bets
        .filter((b) => b.tier === 'value')
        .map((b) => ({
          date: b.date,
          home: b.home,
          away: b.away,
          market: b.market,
          selection: b.selection,
          line: b.line,
          odds: b.odds,
          stake: b.stake,
          clv: b.clv,
          pnl: b.pnl,
        }));
      track.bets = [...track.bets, ...add];
    }
  }
  return { watermark: latest, byConfig };
}

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 观测台行:每条被追踪策略的前向自动下注实测(注数/P&L/ROI/CLV/G7 进度)。 */
export interface ForwardSummaryRow {
  configHash: string;
  label: string;
  since: string;
  n: number;
  staked: number;
  pnl: number;
  roi: number;
  clvN: number;
  clvAvg: number;
  clvT: number;
  lastDate: string | null;
}
export function forwardSummary(store: ForwardStore | null): ForwardSummaryRow[] {
  if (!store) return [];
  return Object.entries(store.byConfig)
    .map(([configHash, tr]) => {
      const staked = tr.bets.reduce((s, b) => s + (b.stake ?? 0), 0);
      const pnl = tr.bets.reduce((s, b) => s + b.pnl, 0);
      const cs = tr.bets.filter((b) => b.clv != null).map((b) => b.clv!);
      const cn = cs.length;
      const cAvg = cn ? cs.reduce((s, x) => s + x, 0) / cn : 0;
      const cSd =
        cn > 1
          ? Math.sqrt(cs.reduce((s, x) => s + (x - cAvg) ** 2, 0) / (cn - 1))
          : 0;
      return {
        configHash,
        label: tr.label,
        since: tr.since,
        n: tr.bets.length,
        staked: +staked.toFixed(2),
        pnl: +pnl.toFixed(2),
        roi: staked > 0 ? +(pnl / staked).toFixed(4) : 0,
        clvN: cn,
        clvAvg: +cAvg.toFixed(4),
        clvT: cn > 1 && cSd > 0 ? +(cAvg / (cSd / Math.sqrt(cn))).toFixed(2) : 0,
        lastDate: tr.bets.length ? tr.bets[tr.bets.length - 1].date.slice(0, 10) : null,
      };
    })
    .sort((a, b) => b.since.localeCompare(a.since));
}

/** G7 证据:某配置的前向注数 + CLV t(喂 evaluateGates 的 evidence.forward)。 */
export function forwardEvidence(
  store: ForwardStore | null,
  configHash: string,
): { liveBets: number; liveClvT: number } | undefined {
  const track = store?.byConfig[configHash];
  if (!track) return undefined;
  const cs = track.bets.filter((b) => b.clv != null).map((b) => b.clv!);
  const n = cs.length;
  if (n < 2) return { liveBets: track.bets.length, liveClvT: 0 };
  const mean = cs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(
    cs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) || 0,
  );
  return {
    liveBets: track.bets.length,
    liveClvT: sd > 0 ? +((mean / (sd / Math.sqrt(n)))).toFixed(2) : 0,
  };
}
