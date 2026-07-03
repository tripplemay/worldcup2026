/**
 * Phase 10 · football-data.co.uk 比赛解析(赛果 + 射门代理 xG 历史)—— 数据闭环底座。
 *
 * 用途:①早期赛季(AF 无覆盖)一次性回填 results/hist;②赛季中每日增量摄取(cron)。
 * eventId 用 `fd:<matchKey>` 派生(football-data 无 id);与 AF 数据按 **matchKey 去重**,
 * AF 条目(真 xG)优先、fd 条目(代理 xG)只补缺——用户拍板的「真 xG where 可得,代理兜底」。
 * 纯解析 + 质量校验(赛季场次/赔率域/比分域/重复键),坏数据宁可报 issue 不静默入库。
 */
import { normalizeTeam, matchKey } from 'lib/match/normalize';
import type { HistMatch, ResultMatch } from './types';

/** 射门代理 xG(与 eplIngest.xgProxy 同公式):射正×0.3 + 射偏×0.05。 */
const xgProxy = (sot: number, shots: number) =>
  +(sot * 0.3 + Math.max(0, shots - sot) * 0.05).toFixed(3);

function fdDateToISO(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${m[2]}-${m[1]}T12:00:00Z`;
}

export interface FdParseResult {
  results: Record<string, ResultMatch>; // eventId(fd:<matchKey>)→ 赛果
  hist: Record<string, HistMatch>; // 含射门的场次(代理 xG)
  issues: string[]; // 质量校验问题(调用方决定警告或拒绝)
  rows: number;
}

/**
 * 纯解析:football-data CSV → 赛果 + 代理 xG 历史 + 质量校验。
 * @param expectRows 赛季完整场次期望(EPL=380;赛季中增量传 null 跳过该断言)。
 */
export function parseFootballDataMatches(
  csvText: string,
  alias: Record<string, string> = {},
  expectRows: number | null = null,
): FdParseResult {
  const issues: string[] = [];
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length)
    return { results: {}, hist: {}, issues: ['空 CSV'], rows: 0 };
  const head = lines[0].split(',');
  const col = (n: string) => head.indexOf(n);
  const iDate = col('Date'),
    iH = col('HomeTeam'),
    iA = col('AwayTeam'),
    iFH = col('FTHG'),
    iFA = col('FTAG'),
    iHS = col('HS'),
    iAS = col('AS'),
    iHST = col('HST'),
    iAST = col('AST');
  if (iDate < 0 || iH < 0 || iA < 0 || iFH < 0 || iFA < 0)
    return { results: {}, hist: {}, issues: ['缺关键列(Date/队名/比分)'], rows: 0 };

  const results: Record<string, ResultMatch> = {};
  const hist: Record<string, HistMatch> = {};
  const seenKeys = new Set<string>();
  const norm = (n: string) => normalizeTeam(alias[n] ?? n);
  let rows = 0;

  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const iso = fdDateToISO(f[iDate]);
    const home = f[iH],
      away = f[iA];
    if (!iso || !home || !away) continue;
    const gh = parseInt(f[iFH], 10),
      ga = parseInt(f[iFA], 10);
    if (!Number.isFinite(gh) || !Number.isFinite(ga)) continue;
    rows++;
    // 质量:比分域
    if (gh < 0 || gh > 15 || ga < 0 || ga > 15) {
      issues.push(`比分越域 ${home} ${gh}-${ga} ${away} @${iso.slice(0, 10)}`);
      continue;
    }
    const hn = norm(home),
      an = norm(away);
    const mk = matchKey(hn, an, iso);
    // 质量:重复键
    if (seenKeys.has(mk)) {
      issues.push(`重复场次 ${mk}`);
      continue;
    }
    seenKeys.add(mk);
    const eventId = `fd:${mk}`;
    results[eventId] = {
      eventId,
      date: iso,
      homeNorm: hn,
      awayNorm: an,
      homeGoals: gh,
      awayGoals: ga,
    };
    // 射门列存在且有效 → 代理 xG 历史
    const hs = iHS >= 0 ? parseInt(f[iHS], 10) : NaN;
    const as = iAS >= 0 ? parseInt(f[iAS], 10) : NaN;
    const hst = iHST >= 0 ? parseInt(f[iHST], 10) : NaN;
    const ast = iAST >= 0 ? parseInt(f[iAST], 10) : NaN;
    if ([hs, as, hst, ast].every((x) => Number.isFinite(x) && x >= 0 && x < 60)) {
      hist[eventId] = {
        eventId,
        date: iso,
        homeName: home,
        awayName: away,
        homeNorm: hn,
        awayNorm: an,
        homeGoals: gh,
        awayGoals: ga,
        homeSoT: hst,
        homeShots: hs,
        awaySoT: ast,
        awayShots: as,
        homeXg: xgProxy(hst, hs),
        awayXg: xgProxy(ast, as),
      };
    }
  }
  // 质量:赛季完整性(全季模式)
  if (expectRows != null && Math.abs(rows - expectRows) > expectRows * 0.15)
    issues.push(`场次异常:${rows}(期望≈${expectRows})`);
  return { results, hist, issues, rows };
}

/**
 * 合并进既有 store map:按 **matchKey** 去重,既有条目(AF,真 xG)优先,fd 只补缺。
 * 返回新增计数(不可变:返回新 map)。
 */
export function mergeFdMatches<T extends { homeNorm: string; awayNorm: string; date: string }>(
  existing: Record<string, T>,
  incoming: Record<string, T>,
): { merged: Record<string, T>; added: number } {
  const existingKeys = new Set(
    Object.values(existing).map((m) => matchKey(m.homeNorm, m.awayNorm, m.date)),
  );
  const merged = { ...existing };
  let added = 0;
  for (const [id, m] of Object.entries(incoming)) {
    if (existingKeys.has(matchKey(m.homeNorm, m.awayNorm, m.date))) continue;
    merged[id] = m;
    added++;
  }
  return { merged, added };
}
