#!/usr/bin/env node
/** 从 /tmp/wc-sweeps.json 提炼紧凑 per-league 摘要(供分析 workflow 的 args)。 */
import { readFileSync, writeFileSync } from 'fs';
const sweeps = JSON.parse(readFileSync(process.argv[2] || '/tmp/wc-sweeps.json', 'utf8'));
const OUT = process.argv[3] || '/tmp/wc-digests.json';
const SHRINK = [0, 100, 150, 200, 300];
const HFA = [0, 45, 65, 85];
const GS = [0.6, 0.8, 1.0];

const out = {};
for (const [key, lg] of Object.entries(sweeps)) {
  const r = lg.runs;
  const base = r.base || {};
  out[key] = {
    name: lg.name,
    n: base.n,
    withOdds: base.oddsCoverage?.withOdds,
    mismatch: base.oddsCoverage?.mismatch,
    perModelBrier: Object.fromEntries(
      Object.entries(base.perModel || {}).map(([id, v]) => [id, v.brier]),
    ),
    ensembleBrier: base.ensemble?.brier,
    ensembleHit: base.ensemble?.hitRate,
    r1_poissonXg: SHRINK.map((s) => ({
      s,
      favBiasMis: r[`shrink${s}`]?.r1?.['poisson-xg']?.favBiasMismatch,
      brier: r[`shrink${s}`]?.perModel?.['poisson-xg']?.brier,
    })),
    r1_elo_favBiasMis: base.r1?.elo?.favBiasMismatch,
    hfa: HFA.map((e) => ({
      elo: e,
      brier: r[`hfa${e}`]?.ensemble?.brier,
      hit: r[`hfa${e}`]?.ensemble?.hitRate,
    })),
    goals: GS.map((g) => ({
      gs: g,
      meanPred: r[`gs${g}`]?.goals?.meanPred,
      meanActual: r[`gs${g}`]?.goals?.meanActual,
      over25Pred: r[`gs${g}`]?.over25?.meanPredicted,
      over25Actual: r[`gs${g}`]?.over25?.actualOverRate,
      over25Hit: r[`gs${g}`]?.over25?.hitRate,
    })),
    draw: {
      actual: base.draw?.actualRate,
      pred: base.draw?.meanPredicted,
      picked: base.draw?.pickedRate,
    },
  };
}
writeFileSync(OUT, JSON.stringify(out, null, 2));
const sz = readFileSync(OUT, 'utf8').length;
console.log(`wrote ${OUT} (${sz} bytes, ${Object.keys(out).length} leagues)`);
