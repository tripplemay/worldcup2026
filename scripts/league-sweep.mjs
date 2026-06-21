#!/usr/bin/env node
/**
 * 多联赛校准扫描(零 API 成本,纯回测计算):对每个联赛跑 EPL 验证同款参数矩阵 —
 *   R1(shrinkEloScale 0→300)/ HFA / goalShrink —— 收集 perModel Brier、r1.favBias、
 *   over25(pred vs actual)、goals(pred vs actual),写 JSON 供跨联赛泛化分析。
 *   含 epl-2025 作基线参照。
 *
 * 用法:node scripts/league-sweep.mjs [from=2024-08-01] [out=/tmp/wc-sweeps.json]
 * 需 dev server 在 :3000。
 */
const FROM = process.argv[2] || '2024-08-01';
const OUT = process.argv[3] || '/tmp/wc-sweeps.json';
const BASE = 'http://localhost:3000/api/worldcup/epl/backtest';
import { writeFileSync } from 'fs';

const LEAGUES = [
  { key: 'epl-2025', name: 'EPL(基线)' },
  { key: 'laliga', name: 'La Liga' },
  { key: 'bundesliga', name: 'Bundesliga' },
  { key: 'seriea', name: 'Serie A' },
  { key: 'ligue1', name: 'Ligue 1' },
];

// 参数矩阵(label → query 片段)
const HFA = [
  [0, 1.0],
  [45, 1.08],
  [65, 1.12],
  [85, 1.16],
];
const SHRINK = [0, 100, 150, 200, 300];
const GS = [0.6, 0.8, 1.0];

async function bt(key, params) {
  const q = new URLSearchParams({ key, from: FROM, ...params });
  const r = await fetch(`${BASE}?${q}`);
  const j = await r.json();
  if (!j.success) throw new Error(`${key} ${q}: ${j.error}`);
  return j.data;
}

const all = {};
for (const lg of LEAGUES) {
  const runs = {};
  // 基线(联赛默认 hfa 65/1.12,shrink 0,goalShrink 0.6)
  runs.base = await bt(lg.key, {});
  // R1:shrinkEloScale 扫描
  for (const s of SHRINK) runs[`shrink${s}`] = await bt(lg.key, { shrinkEloScale: s });
  // HFA 扫描
  for (const [e, m] of HFA)
    runs[`hfa${e}`] = await bt(lg.key, { hfaElo: e, hfaMult: m });
  // goalShrink 扫描(大球/进球过度预测测试)
  for (const g of GS) runs[`gs${g}`] = await bt(lg.key, { goalShrink: g });
  all[lg.key] = { name: lg.name, runs };
  const b = runs.base;
  console.log(
    `\n=== ${lg.name} (${lg.key}) n=${b.n} withOdds=${b.oddsCoverage.withOdds} mismatch=${b.oddsCoverage.mismatch} ===`,
  );
  // perModel Brier
  const pm = b.perModel;
  console.log(
    '  Brier:',
    Object.entries(pm)
      .map(([id, v]) => `${id}=${v.brier}`)
      .join('  '),
    `| ens=${b.ensemble.brier}`,
  );
  // R1 favBias(mismatch 子集)随 shrink
  console.log(
    '  R1 poisson-xg favBiasMismatch:',
    SHRINK.map((s) => `s${s}=${runs[`shrink${s}`].r1['poisson-xg']?.favBiasMismatch}`).join(' '),
  );
  // 大球
  console.log(
    `  over25 base: pred=${b.over25.meanPredicted} actual=${b.over25.actualOverRate} hit=${b.over25.hitRate} | goals pred=${b.goals.meanPred} actual=${b.goals.meanActual}`,
  );
}

writeFileSync(OUT, JSON.stringify(all, null, 2));
console.log(`\n写入 ${OUT}`);
