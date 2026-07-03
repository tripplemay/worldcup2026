/**
 * Phase 10 · football-data.co.uk 开盘+闭盘 1X2 摄取(落 LeagueMatchOdds)。
 *
 * 复用现有 CSV 源(与 ingestFootballDataOdds 同一文件),但**多解析开盘列**:
 *   开盘 1X2:Pinnacle PSH/PSD/PSA → 回退 Bet365 B365H/B365D/B365A
 *   闭盘 1X2:Pinnacle PSCH/PSCD/PSCA → 回退平均 AvgC* → 回退 Bet365 B365C*
 * 亚盘/大小球开闭盘列同在此 CSV,待多市场引擎接入时在此扩展(model 已留 ah/totals)。
 * 解析纯函数(可脱网测);ingest 包装 = fetch + parse + 多季合并 + 落盘。
 */
import { normalizeTeam, matchKey } from 'lib/match/normalize';
import { loadLeagueOddsX, saveLeagueOddsX } from 'lib/db/store';
import type {
  LeagueMatchOdds,
  X2Odds,
  AhOdds,
  TotalOdds,
  OpenClose,
} from './oddsTypes';

/** DD/MM/YYYY 或 DD/MM/YY → 当日正午 UTC 的 ISO(供 matchKey 取 UTC 日;避日界)。 */
function fdDateToISO(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${m[2]}-${m[1]}T12:00:00Z`;
}

// 开盘优先:Pinnacle → Bet365;闭盘优先:Pinnacle → 平均 → Bet365
const OPEN_SETS = [
  ['PSH', 'PSD', 'PSA'],
  ['B365H', 'B365D', 'B365A'],
];
const CLOSE_SETS = [
  ['PSCH', 'PSCD', 'PSCA'],
  ['AvgCH', 'AvgCD', 'AvgCA'],
  ['B365CH', 'B365CD', 'B365CA'],
];

/** 从一行字段按优先级取首个三腿均 >1 的 1X2 报价;无则 undefined。 */
function pick1x2(f: string[], sets: number[][]): X2Odds | undefined {
  for (const [ih, id, ia] of sets) {
    if (ih < 0 || id < 0 || ia < 0) continue;
    const h = parseFloat(f[ih]);
    const d = parseFloat(f[id]);
    const a = parseFloat(f[ia]);
    if (h > 1 && d > 1 && a > 1) return { h, d, a };
  }
  return undefined;
}

// 大小球 2.5 开/闭盘(over,under)。开:Pinnacle→Bet365→平均;闭:PC→AvgC→B365C。
const OU_OPEN = [
  ['P>2.5', 'P<2.5'],
  ['B365>2.5', 'B365<2.5'],
  ['Avg>2.5', 'Avg<2.5'],
];
const OU_CLOSE = [
  ['PC>2.5', 'PC<2.5'],
  ['AvgC>2.5', 'AvgC<2.5'],
  ['B365C>2.5', 'B365C<2.5'],
];
// 亚盘 home/away 赔率优先级(线用 AHh 开 / AHCh 闭)。开:Pinnacle→Bet365→平均;闭:PC→AvgC→B365C。
const AH_OPEN_ODDS = [
  ['PAHH', 'PAHA'],
  ['B365AHH', 'B365AHA'],
  ['AvgAHH', 'AvgAHA'],
];
const AH_CLOSE_ODDS = [
  ['PCAHH', 'PCAHA'],
  ['AvgCAHH', 'AvgCAHA'],
  ['B365CAHH', 'B365CAHA'],
];

/** 大小球 2.5:取首个 over/under 均 >1 的一档。 */
function pickOU(f: string[], sets: number[][]): TotalOdds | undefined {
  for (const [io, iu] of sets) {
    if (io < 0 || iu < 0) continue;
    const over = parseFloat(f[io]);
    const under = parseFloat(f[iu]);
    if (over > 1 && under > 1) return { line: 2.5, over, under };
  }
  return undefined;
}
/** 亚盘主线:线(iLine)+ home/away 赔率优先级,取首个均有效。 */
function pickAH(
  f: string[],
  iLine: number,
  sets: number[][],
): AhOdds | undefined {
  if (iLine < 0) return undefined;
  const line = parseFloat(f[iLine]);
  if (!Number.isFinite(line)) return undefined;
  for (const [ih, ia] of sets) {
    if (ih < 0 || ia < 0) continue;
    const home = parseFloat(f[ih]);
    const away = parseFloat(f[ia]);
    if (home > 1 && away > 1) return { line, home, away };
  }
  return undefined;
}

/**
 * 纯解析:football-data CSV 文本 → Record<matchKey, LeagueMatchOdds>(仅 1X2 开+闭)。
 * @param alias football-data 简称 → 规范名(联赛专属,归一化前对齐)。
 * @param ingestedAt 落盘时间戳(测试传固定值以保确定性)。
 */
export function parseFootballDataOddsX(
  csvText: string,
  alias: Record<string, string> = {},
  ingestedAt = 0,
): Record<string, LeagueMatchOdds> {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return {};
  const head = lines[0].split(',');
  const col = (n: string) => head.indexOf(n);
  const iDate = col('Date'),
    iH = col('HomeTeam'),
    iA = col('AwayTeam');
  if (iDate < 0 || iH < 0 || iA < 0) return {};
  const openSets = OPEN_SETS.map((s) => s.map(col));
  const closeSets = CLOSE_SETS.map((s) => s.map(col));
  const ouOpenSets = OU_OPEN.map((s) => s.map(col));
  const ouCloseSets = OU_CLOSE.map((s) => s.map(col));
  const iAHh = col('AHh');
  const iAHCh = col('AHCh');
  const ahOpenSets = AH_OPEN_ODDS.map((s) => s.map(col));
  const ahCloseSets = AH_CLOSE_ODDS.map((s) => s.map(col));
  const norm = (n: string) => normalizeTeam(alias[n] ?? n);
  const out: Record<string, LeagueMatchOdds> = {};
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const iso = fdDateToISO(f[iDate]);
    const home = f[iH],
      away = f[iA];
    if (!iso || !home || !away) continue;
    const open = pick1x2(f, openSets);
    const close = pick1x2(f, closeSets);
    if (!open && !close) continue; // 无任何 1X2 → 跳过
    const x2: OpenClose<X2Odds> = {};
    if (open) x2.open = open;
    if (close) x2.close = close;
    const hn = norm(home),
      an = norm(away);
    const rec: LeagueMatchOdds = {
      homeNorm: hn,
      awayNorm: an,
      kickoff: iso,
      source: 'football-data',
      ingestedAt,
      x2,
    };
    // 大小球 2.5(开+闭)
    const tOpen = pickOU(f, ouOpenSets);
    const tClose = pickOU(f, ouCloseSets);
    if (tOpen || tClose) {
      const t: OpenClose<TotalOdds> = {};
      if (tOpen) t.open = tOpen;
      if (tClose) t.close = tClose;
      rec.totals = [t];
    }
    // 亚盘主线(开线 AHh + 闭线 AHCh,开/闭各自的线)
    const aOpen = pickAH(f, iAHh, ahOpenSets);
    const aClose = pickAH(f, iAHCh, ahCloseSets);
    if (aOpen || aClose) {
      const a: OpenClose<AhOdds> = {};
      if (aOpen) a.open = aOpen;
      if (aClose) a.close = aClose;
      rec.ah = [a];
    }
    out[matchKey(hn, an, iso)] = rec;
  }
  return out;
}

/**
 * 摄取某联赛某赛季 CSV 的开盘+闭盘 1X2 → LeagueMatchOdds,多季合并落盘(勿覆盖)。
 * @returns rows=CSV 数据行数;stored=写入的比赛数。
 */
export async function ingestFootballDataOddsX(
  key: string,
  csvUrl: string,
  alias: Record<string, string> = {},
): Promise<{ rows: number; stored: number }> {
  const res = await fetch(csvUrl, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`football-data HTTP ${res.status}`);
  const text = await res.text();
  const parsed = parseFootballDataOddsX(text, alias, Date.now());
  const out = loadLeagueOddsX(key); // 多季叠加合并
  let stored = 0;
  for (const [k, v] of Object.entries(parsed)) {
    out[k] = v;
    stored++;
  }
  saveLeagueOddsX(key, out);
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
  return { rows, stored };
}
