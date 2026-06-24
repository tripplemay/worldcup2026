/**
 * 沙盘编排:取 ESPN 实时积分榜(队→组+元信息)+ 小组赛赛果 → 判轮次 → 跑 Monte-Carlo →
 * 组装 ScenarioResult(含新鲜度:计算时间 / 已锁定组 / 待定组)→ 落盘。
 *
 * 已赛比赛用真实赛果钉死,未赛(第三轮)采样;随每场收官重算,未开踢的队据此修正预期。
 */
import { espnProvider } from 'lib/espn/espn';
import { loadRatings, loadElo, saveScenario } from 'lib/db/store';
import { normalizeTeam } from 'lib/match/normalize';
import { groupOf } from 'lib/data/groups2026';
import { runMonteCarlo } from './montecarlo';
import { GROUP_LETTERS } from './types';
import type {
  GroupLetter,
  GroupMatch,
  ScenarioResult,
  Stage,
  TeamMeta,
} from './types';

/** 小组赛日期窗口(美东日期范围;2026 小组赛 6/11–6/27)。 */
const WC_GROUP_WINDOW =
  (process.env.WC_GROUP_WINDOW || '').trim() || '20260611-20260628';

const NOTES =
  '模型口径:泊松+Elo 融合(市场无关、省配额)、中立场、公平竞赛分缺省;第三名分配=FIFA Annex C 官方表;同组两场视为同时开球,条件结果对同组另一场取平均。';

export interface ComputeOptions {
  sims?: number;
  seed?: number;
  targetStage?: Stage;
}

/** 积分榜组名("Group A" / "A")→ 组字母。 */
function groupLetter(label: string): GroupLetter | undefined {
  const s = label
    .trim()
    .toUpperCase()
    .replace(/^GROUP\s*/, '');
  return /^[A-L]$/.test(s) ? (s as GroupLetter) : undefined;
}

// 按参数分桶的进行中计算:同参并发复用(省 CPU),不同 sims/seed/targetStage 各自独立
// (避免 cron 的 ?sims=N 静默拿到另一次默认 sims 的结果)。
const inFlight = new Map<string, Promise<ScenarioResult>>();

/** 计算并落盘最新情景推演;同参数的并发调用复用进行中的那次。 */
export function computeScenario(
  opts: ComputeOptions = {},
): Promise<ScenarioResult> {
  const key = JSON.stringify({
    sims: opts.sims,
    seed: opts.seed,
    targetStage: opts.targetStage,
  });
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = runCompute(opts).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function runCompute(opts: ComputeOptions): Promise<ScenarioResult> {
  const [groups, fixtures] = await Promise.all([
    espnProvider.getStandings(),
    espnProvider.getScoreboard(WC_GROUP_WINDOW),
  ]);
  const ratings = loadRatings();
  const eloMap = loadElo();

  // 队 → 组 + 元信息(以积分榜为准)
  const teamMeta: Record<string, TeamMeta> = {};
  const teamGroup: Record<string, GroupLetter> = {};
  for (const g of groups) {
    const letter = groupLetter(g.group);
    if (!letter) continue;
    for (const row of g.rows) {
      const norm = normalizeTeam(row.team);
      teamGroup[norm] = letter;
      teamMeta[norm] = { norm, name: row.team, group: letter, logo: row.logo };
    }
  }

  // 小组赛比赛 → GroupMatch(只取 stage=group-stage;组别由队名查表,静态兜底)
  const byGroup: Record<string, GroupMatch[]> = {};
  for (const f of fixtures) {
    if (f.stage !== 'group-stage') continue; // 排除淘汰赛
    const home = normalizeTeam(f.homeTeam);
    const away = normalizeTeam(f.awayTeam);
    const letter =
      teamGroup[home] ?? teamGroup[away] ?? groupOf(home) ?? groupOf(away);
    if (!letter) continue; // 无法定位组别 → 跳过(不显示错值)
    const played = f.status === 'post';
    (byGroup[letter] ??= []).push({
      group: letter,
      home,
      away,
      homeGoals: played ? f.homeScore : undefined,
      awayGoals: played ? f.awayScore : undefined,
      played,
      commenceTime: f.commenceTime,
    });
    // 兜底补元信息(积分榜没覆盖到的队)
    for (const [norm, raw] of [
      [home, f.homeTeam],
      [away, f.awayTeam],
    ] as const) {
      if (!teamMeta[norm])
        teamMeta[norm] = { norm, name: raw, group: letter, logo: undefined };
    }
  }

  // 轮次:4 队组每轮恰 2 场,且 matchday 按日顺序。优先「按开赛时间排序后两两配对」
  // (floor(i/2)+1,时区无关,避免 UTC 截日把晚场推到次日导致 round 错配);非 6 场时回退按 distinct 日期分档。
  for (const letter of Object.keys(byGroup)) {
    const list = byGroup[letter];
    const sorted = [...list].sort((a, b) =>
      (a.commenceTime ?? '').localeCompare(b.commenceTime ?? ''),
    );
    if (sorted.length === 6 && sorted.every((m) => m.commenceTime)) {
      sorted.forEach((m, i) => {
        m.round = Math.floor(i / 2) + 1;
      });
    } else {
      const dates = Array.from(
        new Set(list.map((m) => (m.commenceTime ?? '').slice(0, 10))),
      )
        .filter(Boolean)
        .sort();
      for (const m of list) {
        const idx = dates.indexOf((m.commenceTime ?? '').slice(0, 10));
        if (idx >= 0) m.round = idx + 1;
      }
    }
  }

  // 已锁定 / 待定组(第三轮是否全部踢完)
  const groupsLocked: GroupLetter[] = [];
  const groupsPending: GroupLetter[] = [];
  for (const letter of GROUP_LETTERS) {
    const list = byGroup[letter];
    if (!list || !list.length) continue;
    const r3 = list.filter((m) => m.round === 3);
    const eff = r3.length ? r3 : list.filter((m) => !m.played);
    const locked =
      eff.length > 0 ? eff.every((m) => m.played) : list.every((m) => m.played);
    (locked ? groupsLocked : groupsPending).push(letter);
  }

  const sim = runMonteCarlo(byGroup, teamMeta, ratings, eloMap, opts);

  // 失败可见:列出评分/Elo 缺失、退化为通用先验的队(正常 engine cron 后应为空)
  const fallbackNote = sim.fallbackTeams.length
    ? ` ⚠️无评分/Elo、概率为占位先验:${sim.fallbackTeams
        .map((n) => teamMeta[n]?.name ?? n)
        .join('、')}`
    : '';

  const result: ScenarioResult = {
    computedAt: Date.now(),
    sims: sim.sims,
    targetStage: sim.targetStage,
    thirdTableSource: 'official',
    groupsLocked,
    groupsPending,
    fixtures: sim.fixtures,
    teams: sim.teams,
    notes: NOTES + fallbackNote,
  };
  // 数据未就绪(积分榜/赛果空或全部对齐失败)→ 不落盘,避免用空结果覆盖既有推演
  if (result.teams.length > 0) saveScenario(result);
  return result;
}
