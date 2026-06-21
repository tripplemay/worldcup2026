#!/usr/bin/env node
/**
 * 联赛数据诊断(零 API 成本):比对 league-<key>-results.json 与 league-<key>-odds.json,
 * 报告闭盘赔率覆盖率 + 队名错配,供迭代 football-data → AF 别名(leagues.ts 的 fdAlias)。
 *
 * 用法:node scripts/league-diag.mjs <key>          (如 laliga / bundesliga / seriea / ligue1 / epl-2025)
 * 数据目录默认 .data/predict,可用 WC_DATA_DIR 覆盖。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const key = process.argv[2];
if (!key) {
  console.error('用法: node scripts/league-diag.mjs <key>');
  process.exit(1);
}
const dir = join(process.env.WC_DATA_DIR ?? '.data', 'predict');
const read = (f) => {
  try {
    return JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch {
    return {};
  }
};

const results = read(`league-${key}-results.json`);
const odds = read(`league-${key}-odds.json`);
const hist = read(`league-${key}-historical.json`);

const resVals = Object.values(results);
const oddsKeys = Object.keys(odds);

// 结果队名集合
const resNames = new Set();
for (const r of resVals) {
  resNames.add(r.homeNorm);
  resNames.add(r.awayNorm);
}
// 赔率队名集合(从 matchKey "a v b__date" 反解)
const oddsNames = new Set();
for (const k of oddsKeys) {
  const pair = k.split('__')[0];
  for (const n of pair.split(' v ')) oddsNames.add(n);
}

// 覆盖率:多少 result matchKey 命中 odds
const utcDate = (iso) => new Date(iso).toISOString().slice(0, 10);
const mk = (a, b, iso) => [a, b].sort().join(' v ') + '__' + utcDate(iso);
let withOdds = 0;
const noOddsTeams = {};
for (const r of resVals) {
  const k = mk(r.homeNorm, r.awayNorm, r.date);
  if (odds[k]) withOdds++;
  else {
    noOddsTeams[r.homeNorm] = (noOddsTeams[r.homeNorm] ?? 0) + 1;
    noOddsTeams[r.awayNorm] = (noOddsTeams[r.awayNorm] ?? 0) + 1;
  }
}

const onlyInOdds = [...oddsNames].filter((n) => !resNames.has(n)).sort();
const onlyInResults = [...resNames].filter((n) => !oddsNames.has(n)).sort();

console.log(`\n=== league=${key} ===`);
console.log(`results=${resVals.length}  historical(xG)=${Object.keys(hist).length}  oddsRows=${oddsKeys.length}`);
console.log(
  `闭盘覆盖: ${withOdds}/${resVals.length} (${resVals.length ? ((100 * withOdds) / resVals.length).toFixed(1) : 0}%)`,
);
console.log(`\n只在赔率里(FD名未对齐到AF,需加 alias)[${onlyInOdds.length}]:`);
console.log('  ' + (onlyInOdds.join(', ') || '(无)'));
console.log(`\n只在赛果里(AF名,其FD对应缺失/错配)[${onlyInResults.length}]:`);
console.log('  ' + (onlyInResults.join(', ') || '(无)'));
