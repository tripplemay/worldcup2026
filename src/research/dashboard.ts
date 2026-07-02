/**
 * Phase 10 · P4:调参可视化面板(读 epoch 时间线 → 静态 HTML,零耦合、可离线看)。
 *
 * 用户核心诉求:清晰看到每轮调参 + 本轮 vs 上轮变化。面板五块:
 *   ① 进度时间线  ② 本轮 vs 上轮 Diff 卡(参数增量/指标增量/闸门翻转)
 *   ③ 冠军演化(逐 epoch 指标)  ④ 本轮候选榜  ⑤ 参数一览
 * epochDiff / renderTimeline 均纯函数(可测);renderTimelineToFile 为薄 IO 包装(P4 daemon 用)。
 */
import type { EpochResult } from './search';
import type { StrategyParams } from './engine';

/** 扁平化策略参数为 name→值(供参数增量对比)。 */
export function flattenParams(p: StrategyParams): Record<string, number | undefined> {
  return {
    goalShrink: p.tuning.goalShrink,
    dcRho: p.tuning.dcRho,
    shrinkEloScale: p.tuning.shrinkEloScale,
    hfaElo: p.home?.eloBonus,
    hfaMult: p.home?.goalMult,
    marketWeight: p.marketWeight,
    minEv: p.bet.minEv,
    maxEv: p.bet.maxEv,
    minProb: p.bet.minProb,
    kellyFraction: p.bet.kellyFraction,
    maxStakePct: p.bet.maxStakePct,
  };
}

export interface ParamDelta {
  name: string;
  prev: number | undefined;
  cur: number | undefined;
  changed: boolean;
}
export interface MetricDelta {
  name: string;
  prev: number;
  cur: number;
  delta: number;
  better: boolean;
}
export interface ScreenFlip {
  name: string;
  from: boolean;
  to: boolean;
}
export interface EpochDiff {
  paramDeltas: ParamDelta[];
  metricDeltas: MetricDelta[];
  screenFlips: ScreenFlip[];
}

const METRICS: { name: string; get: (e: EpochResult) => number; lowerBetter: boolean }[] = [
  { name: 'gap(OOS)', get: (e) => e.winner.oosGap, lowerBetter: true },
  { name: 'valueROI(OOS)', get: (e) => e.winner.oosValueRoi, lowerBetter: false },
  { name: 'CLV-t(OOS)', get: (e) => e.winner.oosClvT, lowerBetter: false },
  { name: 'PBO', get: (e) => e.pbo, lowerBetter: true },
  { name: 'DSR', get: (e) => e.dsr.dsr, lowerBetter: false },
];

/** 本轮 vs 上轮:冠军参数增量、指标增量(含向好/向坏)、三筛翻转。 */
export function epochDiff(prev: EpochResult, cur: EpochResult): EpochDiff {
  const fp = flattenParams(prev.winnerParams);
  const fc = flattenParams(cur.winnerParams);
  const names = Array.from(new Set([...Object.keys(fp), ...Object.keys(fc)]));
  const paramDeltas: ParamDelta[] = names.map((name) => ({
    name,
    prev: fp[name],
    cur: fc[name],
    changed: fp[name] !== fc[name],
  }));
  const metricDeltas: MetricDelta[] = METRICS.map((m) => {
    const p = m.get(prev);
    const c = m.get(cur);
    const delta = +(c - p).toFixed(4);
    return {
      name: m.name,
      prev: p,
      cur: c,
      delta,
      better: m.lowerBetter ? delta < 0 : delta > 0,
    };
  });
  const screenFlips: ScreenFlip[] = (
    ['clvPass', 'pboPass', 'dsrPass', 'overall'] as const
  )
    .filter((k) => prev.screen[k] !== cur.screen[k])
    .map((k) => ({ name: k, from: prev.screen[k], to: cur.screen[k] }));
  return { paramDeltas, metricDeltas, screenFlips };
}

// ── HTML 渲染 ────────────────────────────────────────────
const esc = (s: unknown) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const fmt = (n: number | undefined, d = 4) =>
  n == null ? '—' : Number(n).toFixed(d);
const pass = (b: boolean) =>
  `<span class="${b ? 'ok' : 'bad'}">${b ? '✓' : '✗'}</span>`;

function timelinePanel(epochs: EpochResult[]): string {
  const rows = epochs
    .map(
      (e) => `<tr>
    <td>${e.epoch}</td><td>${e.gridSize}</td><td>${e.cumulativeTrials}</td>
    <td>${esc(e.winner.label)}</td><td>${fmt(e.winner.oosGap)}</td>
    <td>${fmt(e.winner.oosClvT, 2)}</td><td>${fmt(e.pbo, 3)}</td><td>${fmt(e.dsr.dsr, 3)}</td>
    <td>${pass(e.screen.overall)}</td></tr>`,
    )
    .join('');
  return `<h2>① 进度时间线</h2><table>
  <tr><th>epoch</th><th>网格</th><th>累计N</th><th>冠军</th><th>OOS gap</th><th>CLV-t</th><th>PBO</th><th>DSR</th><th>三筛</th></tr>
  ${rows}</table>`;
}

function diffPanel(prev: EpochResult, cur: EpochResult): string {
  const d = epochDiff(prev, cur);
  const pRows = d.paramDeltas
    .map(
      (p) =>
        `<tr class="${p.changed ? 'chg' : ''}"><td>${p.name}</td><td>${fmt(p.prev)}</td><td>${p.changed ? '→' : ''}</td><td>${fmt(p.cur)}</td></tr>`,
    )
    .join('');
  const mRows = d.metricDeltas
    .map(
      (m) =>
        `<tr><td>${m.name}</td><td>${fmt(m.prev)}</td><td>${fmt(m.cur)}</td><td class="${m.better ? 'ok' : 'bad'}">${m.delta >= 0 ? '+' : ''}${fmt(m.delta)} ${m.better ? '↑好' : '↓坏'}</td></tr>`,
    )
    .join('');
  const flips = d.screenFlips.length
    ? d.screenFlips
        .map((f) => `${f.name}: ${pass(f.from)}→${pass(f.to)}`)
        .join('、')
    : '无翻转';
  return `<h2>② 本轮 vs 上轮 Diff(epoch ${prev.epoch}→${cur.epoch})</h2>
  <div class="cols">
    <div><h3>参数增量</h3><table><tr><th>参</th><th>上轮</th><th></th><th>本轮</th></tr>${pRows}</table></div>
    <div><h3>指标增量</h3><table><tr><th>指标</th><th>上轮</th><th>本轮</th><th>Δ</th></tr>${mRows}</table></div>
  </div>
  <p><b>闸门翻转:</b>${flips}</p>`;
}

function leaderboardPanel(e: EpochResult): string {
  const rows = [...e.configs]
    .sort((a, b) => a.isGap - b.isGap)
    .map(
      (c) =>
        `<tr class="${c.label === e.winner.label ? 'win' : ''}"><td>${esc(c.label)}</td><td>${fmt(c.isGap)}</td><td>${fmt(c.oosGap)}</td><td>${fmt(c.oosValueRoi)}</td><td>${fmt(c.oosClvT, 2)}</td></tr>`,
    )
    .join('');
  return `<h2>④ 本轮候选榜(按 IS gap 升序;高亮=冠军)</h2><table>
  <tr><th>配置</th><th>IS gap</th><th>OOS gap</th><th>OOS ROI</th><th>OOS CLV-t</th></tr>${rows}</table>`;
}

/** 渲染整条 epoch 时间线为自包含 HTML(内联样式,可离线打开)。 */
export function renderTimeline(epochs: EpochResult[], title = '联赛策略研究 · 调参面板'): string {
  if (!epochs.length) return `<!doctype html><meta charset=utf8><h1>${esc(title)}</h1><p>暂无 epoch</p>`;
  const last = epochs[epochs.length - 1];
  const diff = epochs.length >= 2 ? diffPanel(epochs[epochs.length - 2], last) : '<h2>② Diff</h2><p>需 ≥2 轮</p>';
  const style = `body{font:14px/1.5 -apple-system,sans-serif;margin:24px;color:#222}
  table{border-collapse:collapse;margin:8px 0}th,td{border:1px solid #ddd;padding:4px 8px;text-align:right}
  th{background:#f5f5f5}td:first-child,th:first-child{text-align:left}
  .ok{color:#1a7f37;font-weight:600}.bad{color:#c0392b;font-weight:600}
  .chg{background:#fff8e1}.win{background:#e8f5e9;font-weight:600}
  .cols{display:flex;gap:32px;flex-wrap:wrap}h2{margin-top:28px;border-bottom:2px solid #eee;padding-bottom:4px}`;
  return `<!doctype html><html><head><meta charset=utf8><title>${esc(title)}</title><style>${style}</style></head>
<body><h1>${esc(title)}</h1>
<p>共 ${epochs.length} 轮;最新冠军 <b>${esc(last.winner.label)}</b>,三筛 ${pass(last.screen.overall)}(CLV ${pass(last.screen.clvPass)} / PBO ${pass(last.screen.pboPass)} / DSR ${pass(last.screen.dsrPass)})</p>
${timelinePanel(epochs)}
${diff}
${leaderboardPanel(last)}
</body></html>`;
}
