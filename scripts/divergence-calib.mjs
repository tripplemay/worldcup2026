#!/usr/bin/env node
/**
 * 跨家分歧 · 历史校准(读盘第 4 步的实证验证)
 *
 * 问题:我们现在给用户展示的「跨家盘口分歧」(各家去水概率离散度 + 领跑/滞后家)
 *       到底有没有信息量?具体检验四条假设:
 *   H1 开盘分歧大 → 后续 line move 大?(分歧 = 即将波动 的读盘价值)
 *   H2 领跑家是「领先指标」吗?——市场收盘是否朝开盘领跑家的方向收敛?
 *      (H2b 关键:逐家 leave-one-out lead-lag,算「哪家开盘最能预测其余家的收盘移动」)
 *   H3 分歧大时,共识是否更不可靠?(按分级看共识 Brier);收盘是否比开盘更锐?
 *   H4 哪家收盘最锐(Brier 最低)?(Pinnacle 应最低 → 验证管线可信)
 *
 * 数据源:football-data.co.uk 各联赛 CSV —— 含 6 家具名博彩的**开盘 + 收盘** 1X2
 *   (B365/BW/BF/PS=Pinnacle/WH/1XB/IW/VC,逐季列集不同)+ 真实赛果(FTR)。
 *   纯离线、零 API 配额、不动生产。trueIP3 / 分歧算法 = 镜像 lib/odds/{trueIP,bookDivergence}.ts。
 *
 * 用法:node scripts/divergence-calib.mjs            (跑全部 5 联赛 × 3 季)
 *       node scripts/divergence-calib.mjs --json     (额外写 /tmp/divergence-calib.json)
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';

const SEASONS = ['2324', '2425', '2526'];
const LEAGUES = [
  { code: 'E0', name: 'EPL' },
  { code: 'SP1', name: 'La Liga' },
  { code: 'D1', name: 'Bundesliga' },
  { code: 'I1', name: 'Serie A' },
  { code: 'F1', name: 'Ligue 1' },
];
// 候选具名博彩(逐季存在与否不定,运行时按表头动态探测)。PS = Pinnacle(锐盘参照)。
const BOOKS = ['B365', 'BW', 'BF', 'PS', 'WH', '1XB', 'IW', 'VC'];
const CACHE = '/tmp/fd-cache';

// ── 数学基建(镜像 lib/odds/trueIP.ts + bookDivergence.ts)──────────────
const valid = (x) => typeof x === 'number' && x > 1;
function trueIP3(h, d, a) {
  if (!valid(h) || !valid(d) || !valid(a)) return null;
  const ih = 1 / h, id = 1 / d, ia = 1 / a, s = ih + id + ia;
  return s > 0 ? { home: ih / s, draw: id / s, away: ia / s } : null;
}
const SIDES = ['home', 'draw', 'away'];
function median(xs) {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** 各家去水概率 → 共识(各路中位数,重归一化)。 */
function consensus(perBook) {
  const med = {
    home: median(perBook.map((p) => p.home)),
    draw: median(perBook.map((p) => p.draw)),
    away: median(perBook.map((p) => p.away)),
  };
  const s = med.home + med.draw + med.away;
  return { home: med.home / s, draw: med.draw / s, away: med.away / s };
}
/** 镜像 computeBookDivergence:共识 + 极差最大那一路(topSide)+ 领跑/滞后。perBook>=3。 */
function divergence(perBook) {
  const cons = consensus(perBook);
  let topSide = 'home', topRange = -1, hi = perBook[0], lo = perBook[0];
  for (const s of SIDES) {
    let H = perBook[0], L = perBook[0];
    for (const p of perBook) { if (p[s] > H[s]) H = p; if (p[s] < L[s]) L = p; }
    const r = H[s] - L[s];
    if (r > topRange) { topRange = r; topSide = s; hi = H; lo = L; }
  }
  const spreadPp = topRange * 100;
  const level = spreadPp >= 6 ? 'wide' : spreadPp >= 3 ? 'moderate' : 'tight';
  return { cons, topSide, spreadPp, level, high: hi, low: lo, books: perBook.length };
}
/** 多类 Brier(0~2):Σ(p−y)²。 */
function brier(p, result) {
  const y = { home: result === 'home' ? 1 : 0, draw: result === 'draw' ? 1 : 0, away: result === 'away' ? 1 : 0 };
  return (p.home - y.home) ** 2 + (p.draw - y.draw) ** 2 + (p.away - y.away) ** 2;
}

// ── 统计小工具 ─────────────────────────────────────────────
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const std = (xs) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const se = (xs) => std(xs) / Math.sqrt(xs.length);
function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return NaN;
  const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}
/** OLS 斜率 y~x(过均值);市场「跟随」开盘偏离的比例。 */
function slope(pairs) {
  const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
  let sxy = 0, sxx = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  return sxx > 0 ? sxy / sxx : NaN;
}

// ── 取数 + 解析 ────────────────────────────────────────────
async function fetchCsv(season, code) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const cached = `${CACHE}/${season}-${code}.csv`;
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  const url = `https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`;
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(cached, text);
  return text;
}
const FTR_SIDE = { H: 'home', D: 'draw', A: 'away' };
/** 解析一个 CSV → 每场 {result, openBooks:[{key,home,draw,away}], closeBooks:[...]}。 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  const idx = (n) => head.indexOf(n);
  const iFtr = idx('FTR'), iH = idx('HomeTeam'), iA = idx('AwayTeam');
  if (iFtr < 0 || iH < 0) return [];
  // 动态探测各家开/收列
  const openCols = {}, closeCols = {};
  for (const b of BOOKS) {
    const o = [idx(`${b}H`), idx(`${b}D`), idx(`${b}A`)];
    const c = [idx(`${b}CH`), idx(`${b}CD`), idx(`${b}CA`)];
    if (o.every((x) => x >= 0)) openCols[b] = o;
    if (c.every((x) => x >= 0)) closeCols[b] = c;
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const result = FTR_SIDE[f[iFtr]];
    if (!result) continue;
    const pick = (cols) => {
      const out = [];
      for (const [k, [ih, id, ia]] of Object.entries(cols)) {
        const ip = trueIP3(parseFloat(f[ih]), parseFloat(f[id]), parseFloat(f[ia]));
        if (ip) out.push({ key: k, ...ip });
      }
      return out;
    };
    rows.push({
      result,
      home: f[iH],
      away: f[iA],
      openBooks: pick(openCols),
      closeBooks: pick(closeCols),
    });
  }
  return rows;
}

// ── 主流程 ─────────────────────────────────────────────────
async function main() {
  const recs = [];
  const perLeagueSeason = [];
  for (const lg of LEAGUES) {
    for (const season of SEASONS) {
      let rows;
      try { rows = parseCsv(await fetchCsv(season, lg.code)); }
      catch (e) { console.error(`skip ${lg.name} ${season}: ${e.message}`); continue; }
      let used = 0;
      for (const r of rows) {
        if (r.openBooks.length < 3) continue; // 分歧需 >=3 家
        const od = divergence(r.openBooks);
        const closeCons = r.closeBooks.length >= 2 ? consensus(r.closeBooks) : null;
        recs.push({
          league: lg.name, season, result: r.result,
          od, openCons: od.cons, closeCons,
          openBooks: r.openBooks, closeBooks: r.closeBooks,
        });
        used++;
      }
      perLeagueSeason.push({ league: lg.name, season, matches: used,
        openBookSet: rows[0]?.openBooks.map((b) => b.key).join('/') ?? '—' });
    }
  }

  console.log(`\n${'='.repeat(72)}\n跨家分歧 · 历史校准  (n=${recs.length} 场,5 联赛 × 3 季)\n${'='.repeat(72)}`);
  console.log('\n[样本] 联赛×季(开盘可用家集):');
  for (const x of perLeagueSeason)
    console.log(`  ${x.league.padEnd(11)} ${x.season}  n=${String(x.matches).padStart(3)}  books=${x.openBookSet}`);

  // 分布
  const lv = { tight: 0, moderate: 0, wide: 0 };
  recs.forEach((r) => lv[r.od.level]++);
  console.log(`\n[分布] 开盘分歧分级:tight ${lv.tight} / moderate ${lv.moderate} / wide ${lv.wide}` +
    `  | 平均 spread ${mean(recs.map((r) => r.od.spreadPp)).toFixed(2)}pp` +
    `  | 平均家数 ${mean(recs.map((r) => r.od.books)).toFixed(1)}`);

  // ── H1:开盘分歧 → 收盘 line move ──────────────────────────
  const mv = recs.filter((r) => r.closeCons);
  const moveTop = (r) => r.closeCons[r.od.topSide] - r.openCons[r.od.topSide];
  const tv = (r) => 0.5 * SIDES.reduce((a, s) => a + Math.abs(r.closeCons[s] - r.openCons[s]), 0);
  console.log(`\n[H1] 开盘分歧 → 收盘 line move(n=${mv.length} 有收盘):`);
  const BINS = [[0, 2], [2, 4], [4, 6], [6, 99]];
  for (const [lo, hi] of BINS) {
    const sub = mv.filter((r) => r.od.spreadPp >= lo && r.od.spreadPp < hi);
    if (!sub.length) continue;
    const aMoveTop = sub.map((r) => Math.abs(moveTop(r)) * 100);
    const aTv = sub.map((r) => tv(r) * 100);
    console.log(`  spread[${lo},${hi})pp  n=${String(sub.length).padStart(4)}  ` +
      `|Δtop|=${mean(aMoveTop).toFixed(2)}pp  收盘总变动 TV=${mean(aTv).toFixed(2)}pp`);
  }
  const cMoveTop = pearson(mv.map((r) => [r.od.spreadPp, Math.abs(moveTop(r)) * 100]));
  const cTv = pearson(mv.map((r) => [r.od.spreadPp, tv(r) * 100]));
  console.log(`  corr(spread, |Δtop|)=${cMoveTop.toFixed(3)}  corr(spread, TV)=${cTv.toFixed(3)}  (SE≈${(1 / Math.sqrt(mv.length)).toFixed(3)})`);

  // ── H2:市场是否朝开盘领跑家方向收敛(aggregate)────────────
  console.log(`\n[H2] 收盘是否朝开盘领跑家方向移动(signed Δtop>0 = 朝领跑):`);
  for (const L of ['tight', 'moderate', 'wide', 'ALL']) {
    const sub = mv.filter((r) => L === 'ALL' || r.od.level === L);
    if (!sub.length) continue;
    const signed = sub.map((r) => moveTop(r) * 100);
    const z = mean(signed) / se(signed);
    const posFrac = signed.filter((x) => x > 0).length / signed.length;
    console.log(`  ${L.padEnd(9)} n=${String(sub.length).padStart(4)}  meanΔtop=${mean(signed).toFixed(2)}pp` +
      `  z=${z.toFixed(1)}  P(Δtop>0)=${(posFrac * 100).toFixed(0)}%`);
  }
  console.log(`  注:领跑=topSide 上报最高家(构造上为极值),aggregate 受极值回归混淆;以 H2b 为准。`);

  // ── H2b:逐家 leave-one-out lead-lag(哪家领先)──────────────
  console.log(`\n[H2b] 逐家 lead-lag:开盘偏离其余家共识 → 预测其余家的收盘移动`);
  console.log(`      leadScore=corr(本家开盘偏离, 其余家收盘移动);beta=市场跟随比例;越高越「领先」`);
  const bookLead = {};
  for (const b of BOOKS) bookLead[b] = [];
  for (const r of mv) {
    const oByKey = Object.fromEntries(r.openBooks.map((p) => [p.key, p]));
    const cByKey = Object.fromEntries(r.closeBooks.map((p) => [p.key, p]));
    const keys = r.openBooks.map((p) => p.key).filter((k) => cByKey[k]); // 开+收都在
    if (keys.length < 3) continue;
    for (const b of keys) {
      const others = keys.filter((k) => k !== b);
      if (others.length < 2) continue;
      const oOpen = consensus(others.map((k) => oByKey[k]));
      const oClose = consensus(others.map((k) => cByKey[k]));
      for (const s of SIDES) {
        const bDev = oByKey[b][s] - oOpen[s];
        const oMove = oClose[s] - oOpen[s];
        bookLead[b].push([bDev, oMove]);
      }
    }
  }
  const leadRows = BOOKS
    .filter((b) => bookLead[b].length >= 30)
    .map((b) => {
      const pairs = bookLead[b];
      const hit = pairs.filter((p) => Math.abs(p[0]) > 0.005 && Math.sign(p[0]) === Math.sign(p[1]));
      const movers = pairs.filter((p) => Math.abs(p[0]) > 0.005);
      return {
        book: b, n: pairs.length / 3 | 0,
        leadScore: pearson(pairs), beta: slope(pairs),
        hitRate: movers.length ? hit.length / movers.length : NaN,
      };
    })
    .sort((a, b) => b.leadScore - a.leadScore);
  for (const x of leadRows)
    console.log(`  ${x.book.padEnd(5)} (${x.book === 'PS' ? 'Pinnacle' : x.book === 'B365' ? 'Bet365' : ''})`.padEnd(22) +
      `leadScore=${x.leadScore.toFixed(3)}  beta=${x.beta.toFixed(3)}  hitRate=${(x.hitRate * 100).toFixed(0)}%  (n≈${x.n})`);

  // ── H3:分歧 vs 共识可靠性;收盘 vs 开盘锐度 ──────────────────
  console.log(`\n[H3] 共识 Brier(越低越准)按开盘分歧分级 + 开盘/收盘对比:`);
  for (const L of ['tight', 'moderate', 'wide', 'ALL']) {
    const sub = recs.filter((r) => L === 'ALL' || r.od.level === L);
    const ob = sub.map((r) => brier(r.openCons, r.result));
    console.log(`  ${L.padEnd(9)} n=${String(sub.length).padStart(4)}  开盘共识Brier=${mean(ob).toFixed(4)} (SE ${se(ob).toFixed(4)})`);
  }
  const paired = mv.map((r) => brier(r.openCons, r.result) - brier(r.closeCons, r.result));
  console.log(`  收盘更锐?paired(开盘−收盘)Brier=${mean(paired).toFixed(4)} (SE ${se(paired).toFixed(4)}, z=${(mean(paired) / se(paired)).toFixed(1)};>0=收盘更准) n=${paired.length}`);

  // ── H4:逐家收盘锐度(Brier)───────────────────────────────
  console.log(`\n[H4] 逐家收盘去水 Brier(越低越锐;应见 Pinnacle 居前 → 验证管线):`);
  const bookBrier = {};
  for (const b of BOOKS) bookBrier[b] = [];
  for (const r of recs)
    for (const p of r.closeBooks) bookBrier[p.key].push(brier(p, r.result));
  const h4 = BOOKS
    .filter((b) => bookBrier[b].length >= 100)
    .map((b) => ({ book: b, brier: mean(bookBrier[b]), n: bookBrier[b].length }))
    .sort((a, b) => a.brier - b.brier);
  for (const x of h4)
    console.log(`  ${x.book.padEnd(5)} ${(x.book === 'PS' ? '(Pinnacle)' : '').padEnd(11)} closeBrier=${x.brier.toFixed(4)}  (n=${x.n})`);
  // 共识 vs 最锐单家
  const consBrier = mean(mv.map((r) => brier(r.closeCons, r.result)));
  console.log(`  收盘共识 Brier=${consBrier.toFixed(4)}(对照:聚合是否胜过最锐单家)`);

  if (process.argv.includes('--json')) {
    writeFileSync('/tmp/divergence-calib.json', JSON.stringify({
      n: recs.length, perLeagueSeason, levelDist: lv,
      h2b: leadRows, h4: h4,
    }, null, 2));
    console.log('\n→ /tmp/divergence-calib.json 已写');
  }
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
