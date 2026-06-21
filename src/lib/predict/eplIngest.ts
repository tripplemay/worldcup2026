/**
 * 联赛历史一次性摄取(Phase 1:大样本模型校准/回测)。
 * 数据源 API-Football:某联赛某赛季全部 FT 比赛 → 赛果(喂 Elo)+ 逐场射门/真 xG(喂评分)。
 * 存到独立的 league-<key>-*.json,完全不碰世界杯数据。下游复用同一套 HistMatch/ResultMatch。
 */
import { normalizeTeam, matchKey } from 'lib/match/normalize';
import {
  loadLeagueHistorical,
  saveLeagueHistorical,
  loadLeagueResults,
  saveLeagueResults,
  loadLeagueOdds,
  saveLeagueOdds,
  type LeagueClosing,
} from 'lib/db/store';
import {
  hasApiFootball,
  getLeagueFixtures,
  getFixtureStats,
} from './apifootball';

/** DD/MM/YYYY → 当日正午 UTC 的 ISO(供 matchKey 取 UTC 日;避开日界)。 */
function fdDateToISO(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T12:00:00Z`;
}

/**
 * 摄取 football-data.co.uk 某联赛某赛季 CSV 的闭盘 1X2(优先 Pinnacle PSC*,回退 Avg/B365)
 * → 按 matchKey(队名对+UTC日)入键,与我们 AF 赛果跨源对齐。AF 不保留历史赔率,故走此源。
 * @param alias football-data 简称 → AF 规范名(联赛专属,见 leagues.ts;归一化前对齐用)。
 */
export async function ingestFootballDataOdds(
  key: string,
  csvUrl: string,
  alias: Record<string, string> = {},
): Promise<{ rows: number; stored: number }> {
  const res = await fetch(csvUrl, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`football-data HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: 0, stored: 0 };
  const head = lines[0].split(',');
  const col = (name: string) => head.indexOf(name);
  const iDate = col('Date'),
    iH = col('HomeTeam'),
    iA = col('AwayTeam');
  // 闭盘优先级:Pinnacle 闭盘 → 平均闭盘 → Bet365 闭盘
  const sets = [
    ['PSCH', 'PSCD', 'PSCA'],
    ['AvgCH', 'AvgCD', 'AvgCA'],
    ['B365CH', 'B365CD', 'B365CA'],
  ].map((s) => s.map(col));
  const norm = (n: string) => normalizeTeam(alias[n] ?? n);
  const out: Record<string, LeagueClosing> = loadLeagueOdds(key); // 合并(多季叠加,勿覆盖)
  let stored = 0;
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const iso = fdDateToISO(f[iDate]);
    const home = f[iH],
      away = f[iA];
    if (!iso || !home || !away) continue;
    let odds: LeagueClosing | null = null;
    for (const [h, d, a] of sets) {
      const oh = parseFloat(f[h]),
        od = parseFloat(f[d]),
        oa = parseFloat(f[a]);
      if (oh > 1 && od > 1 && oa > 1) {
        odds = { h: oh, d: od, a: oa };
        break;
      }
    }
    if (!odds) continue;
    out[matchKey(norm(home), norm(away), iso)] = odds;
    stored++;
  }
  saveLeagueOdds(key, out);
  return { rows: lines.length - 1, stored };
}

/**
 * 全局节流:把相邻 AF 调用的「发起时刻」至少拉开 60000/RPM ms,尊重 API-Football
 * 每分钟限额(Pro 档 300/min)。摄取一季有数百次 stats 调用,不节流必触发 429。
 * env AF_INGEST_RPM 可覆盖(默认 250,留头寸给并发的 WC cron)。
 */
const AF_RPM = Math.max(1, Number(process.env.AF_INGEST_RPM ?? 250));
let _afNextSlot = 0;
function afThrottle(): Promise<void> {
  const gap = 60000 / AF_RPM;
  const now = Date.now();
  const slot = Math.max(now, _afNextSlot);
  _afNextSlot = slot + gap;
  const wait = slot - now;
  return wait > 0 ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve();
}

/** 射门代理 xG(真 expected_goals 缺失时回退):射正×0.3 + 射偏×0.05。 */
function xgProxy(sot: number, shots: number): number {
  const soff = Math.max(0, shots - sot);
  return +(sot * 0.3 + soff * 0.05).toFixed(3);
}

/** limit 个 worker 的简单并发池;单项失败置 null。 */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = null;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/**
 * 摄取某联赛某赛季全部 FT 比赛 → 赛果 + HistMatch(含真 xG)。
 * @param key   存储键(如 'epl-2025')
 * @param league API-Football 联赛 id(英超=39)
 * @param season 赛季起始年(2025-26 → 2025)
 */
export async function ingestLeagueSeason(
  key: string,
  league: number,
  season: number,
  resultsOnly = false, // 仅取赛果(喂 Elo 热启动),跳过逐场 xG/stats 调用
): Promise<{ fixtures: number; withStats: number }> {
  if (!hasApiFootball()) return { fixtures: 0, withStats: 0 };

  const fixtures = await getLeagueFixtures(league, season);

  // 1) 赛果(全部 FT)→ 喂 Elo
  const results = loadLeagueResults(key);
  for (const fx of fixtures) {
    results[String(fx.id)] = {
      eventId: String(fx.id),
      date: fx.date,
      homeNorm: normalizeTeam(fx.homeName),
      awayNorm: normalizeTeam(fx.awayName),
      homeGoals: fx.homeGoals,
      awayGoals: fx.awayGoals,
    };
  }
  saveLeagueResults(key, results);
  if (resultsOnly) return { fixtures: fixtures.length, withStats: 0 };

  // 2) 逐场射门/真 xG → HistMatch(喂评分)
  const stats = await pool(
    fixtures.map((f) => f.id),
    5,
    async (id) => {
      await afThrottle(); // 节流到 ≤AF_RPM/min,避免 429
      return getFixtureStats(id);
    },
  );
  const store = loadLeagueHistorical(key);
  let withStats = 0;
  fixtures.forEach((fx, i) => {
    const s = stats[i];
    if (!s) return;
    const h = s.get(fx.homeId);
    const a = s.get(fx.awayId);
    if (!h || !a) return;
    if (h.shots === 0 && a.shots === 0 && h.sot === 0 && a.sot === 0) return;
    store[String(fx.id)] = {
      eventId: String(fx.id),
      date: fx.date,
      homeName: fx.homeName,
      awayName: fx.awayName,
      homeNorm: normalizeTeam(fx.homeName),
      awayNorm: normalizeTeam(fx.awayName),
      homeGoals: fx.homeGoals,
      awayGoals: fx.awayGoals,
      homeSoT: h.sot,
      homeShots: h.shots,
      awaySoT: a.sot,
      awayShots: a.shots,
      homeXg: Number.isFinite(h.xg)
        ? +h.xg.toFixed(3)
        : xgProxy(h.sot, h.shots),
      awayXg: Number.isFinite(a.xg)
        ? +a.xg.toFixed(3)
        : xgProxy(a.sot, a.shots),
      homeGp: Number.isFinite(h.gp) ? +h.gp.toFixed(3) : undefined,
      awayGp: Number.isFinite(a.gp) ? +a.gp.toFixed(3) : undefined,
    };
    withStats++;
  });
  saveLeagueHistorical(key, store);
  return { fixtures: fixtures.length, withStats };
}
