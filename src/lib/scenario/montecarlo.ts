/**
 * 沙盘 Monte-Carlo 驱动 + 条件聚合。
 *
 * 每次模拟:已赛小组赛钉死、未赛(第三轮)按 predictPair 采样比分 → 算 12 组名次 → 取最佳 8
 * 第三名并查 Annex C 解析 R32 → 沿 bracket 整树传播(平局点球)→ 记录每队最远阶段。
 * 跨 sim 按归一化对阵记忆化 predictPair/采样器(整轮一次概率,采样 O(1))。
 *
 * 聚合:每队 P(出线/16/8/4/决赛/夺冠) + 组内名次分布;并按「本队第三轮自身结果(胜/平/负)」
 * 分桶算条件晋级深度 → 每场第三轮对阵得出双方各自「最期望结果」+ 最可能 R32 对手 + 默契检测。
 */
import { predictPair, leagueAverages } from 'lib/predict/pair';
import { getFifaRank } from 'lib/data/fifaRanking';
import { buildScoreSampler, sampleScore } from './sampleMatch';
import type { ScoreSampler } from './sampleMatch';
import { mulberry32 } from './rng';
import type { Rng } from './rng';
import { simulateGroups } from './groupSim';
import { buildBracketSeed, simulateKnockout } from './knockout';
import { STAGE_ORDER, stageIndex } from './types';
import type {
  FixtureView,
  GroupMatch,
  Outcome,
  ResultBucket,
  Stage,
  StageProbs,
  TeamMeta,
  TeamOutlook,
} from './types';
import type { TeamRating } from 'lib/predict/types';

const DEFAULT_SIMS = Number(process.env.SCENARIO_SIMS) || 20000;
const DEFAULT_TARGET: Stage = 'QF'; // 「整条路径最易」默认目标轮:打进 8 强
const SHOOTOUT_LEAN = 0.5; // 点球向强队倾斜程度(0=纯抛硬币,1=按常规胜率比)

export interface SimConfig {
  sims?: number;
  seed?: number;
  targetStage?: Stage;
}

export interface SimOutput {
  teams: TeamOutlook[];
  fixtures: FixtureView[];
  targetStage: Stage;
  sims: number;
  /** 评分/Elo 缺失、退化为通用先验的队(归一化名);供上层标注「无信号」。 */
  fallbackTeams: string[];
}

type StageTally = Record<Stage, number>;
const newStageTally = (): StageTally => ({
  OUT: 0,
  R32: 0,
  R16: 0,
  QF: 0,
  SF: 0,
  FINAL: 0,
  CHAMPION: 0,
});

interface ResAcc {
  sims: number;
  stage: StageTally;
  opp: Map<string, number>;
}
interface TeamAcc {
  sims: number;
  stage: StageTally;
  rank: [number, number, number, number];
  opp: Map<string, number>;
  byRes: Record<Outcome, ResAcc>;
}

const newResAcc = (): ResAcc => ({
  sims: 0,
  stage: newStageTally(),
  opp: new Map(),
});
const newTeamAcc = (): TeamAcc => ({
  sims: 0,
  stage: newStageTally(),
  rank: [0, 0, 0, 0],
  opp: new Map(),
  byRes: { W: newResAcc(), D: newResAcc(), L: newResAcc() },
});

const inc = (m: Map<string, number>, k: string) =>
  m.set(k, (m.get(k) ?? 0) + 1);

/** 累计某 StageTally 里「达到 stage 及更深」的场次数。 */
function countReach(t: StageTally, stage: Stage): number {
  const i = stageIndex(stage);
  let sum = 0;
  for (const st of STAGE_ORDER) if (stageIndex(st) >= i) sum += t[st];
  return sum;
}

function stageProbsFrom(t: StageTally, total: number): StageProbs {
  const d = total || 1;
  let exp = 0;
  for (const st of STAGE_ORDER) exp += stageIndex(st) * t[st];
  return {
    advance: countReach(t, 'R32') / d,
    r16: countReach(t, 'R16') / d,
    qf: countReach(t, 'QF') / d,
    sf: countReach(t, 'SF') / d,
    final: countReach(t, 'FINAL') / d,
    champion: t.CHAMPION / d,
    expStage: exp / d,
  };
}

/** 取出现最多的 R32 对手 + 其在「该队进 R32 的 sim」里的占比。 */
function topOpp(
  m: Map<string, number>,
): { norm: string; prob: number } | undefined {
  let total = 0;
  let best = '';
  let bestN = 0;
  for (const [k, v] of m) {
    total += v;
    if (v > bestN) {
      bestN = v;
      best = k;
    }
  }
  if (!best || total === 0) return undefined;
  return { norm: best, prob: bestN / total };
}

/** 识别一组的第三轮比赛:优先 round===3,退而求其次取未赛,再退取开赛最晚的 2 场。 */
export function detectRound3(list: GroupMatch[]): GroupMatch[] {
  const tagged = list.filter((m) => m.round === 3);
  if (tagged.length) return tagged;
  // 末轮进行中需同时圈出「已踢 + 未踢」两腿,故优先按开赛时间取最后两场,而非只取未赛
  if (list.length >= 2 && list.every((m) => m.commenceTime)) {
    return [...list]
      .sort((a, b) =>
        (a.commenceTime ?? '').localeCompare(b.commenceTime ?? ''),
      )
      .slice(-2);
  }
  return list.filter((m) => !m.played);
}

const matchKeyOf = (m: GroupMatch) => `${m.group}|${m.home}|${m.away}`;
const homeOutcome = (o?: Outcome) =>
  o === 'W' ? 'home' : o === 'D' ? 'draw' : o === 'L' ? 'away' : undefined;
const awayOutcome = (o?: Outcome) =>
  o === 'W' ? 'away' : o === 'D' ? 'draw' : o === 'L' ? 'home' : undefined;

/** 跑 Monte-Carlo,产出每队前景 + 第三轮双视角。 */
export function runMonteCarlo(
  matchesByGroup: Record<string, GroupMatch[]>,
  teamMeta: Record<string, TeamMeta>,
  ratings: Record<string, TeamRating>,
  eloMap: Record<string, number>,
  config: SimConfig = {},
  fifaRankOf: (team: string) => number | undefined = getFifaRank,
): SimOutput {
  const sims = config.sims ?? DEFAULT_SIMS;
  const seed = config.seed ?? 12345;
  const targetStage = config.targetStage ?? DEFAULT_TARGET;
  const { leagueAvg, leagueAvgGoals } = leagueAverages(ratings);
  const pairCtx = { ratings, eloMap, leagueAvg, leagueAvgGoals, neutral: true };

  // 采样器记忆化(同对阵整轮只算一次)
  const samplerCache = new Map<string, ScoreSampler>();
  const fallbackTeams = new Set<string>(); // 评分/Elo 缺失、退化为通用先验的队
  const getSampler = (home: string, away: string): ScoreSampler => {
    const key = `${home}|${away}`;
    const hit = samplerCache.get(key);
    if (hit) return hit;
    const pred = predictPair(home, away, pairCtx);
    if (!pred) {
      fallbackTeams.add(home);
      fallbackTeams.add(away);
    }
    const s = pred
      ? buildScoreSampler(pred)
      : buildScoreSampler({
          modelId: 'fallback',
          matchId: 'sim',
          homeWin: 0.4,
          draw: 0.27,
          awayWin: 0.33,
          confidence: 'low',
        });
    samplerCache.set(key, s);
    return s;
  };
  const play = (home: string, away: string, rng: Rng): string => {
    const s = getSampler(home, away);
    const { homeGoals, awayGoals } = sampleScore(s, rng);
    if (homeGoals > awayGoals) return home;
    if (awayGoals > homeGoals) return away;
    const denom = s.pHome + s.pAway;
    const base = denom > 0 ? s.pHome / denom : 0.5;
    return rng() < 0.5 + SHOOTOUT_LEAN * (base - 0.5) ? home : away;
  };

  // 预处理:全部队、第三轮对阵集合、各队是否已踢第三轮
  const groups = Object.keys(matchesByGroup);
  const allTeams = new Set<string>();
  const r3KeySet = new Set<string>();
  const r3Matches: GroupMatch[] = [];
  const teamPlayed3: Record<string, boolean> = {};
  for (const g of groups) {
    const list = matchesByGroup[g];
    for (const m of list) {
      allTeams.add(m.home);
      allTeams.add(m.away);
    }
    for (const m of detectRound3(list)) {
      r3KeySet.add(matchKeyOf(m));
      r3Matches.push(m);
      teamPlayed3[m.home] = m.played;
      teamPlayed3[m.away] = m.played;
    }
  }

  const acc: Record<string, TeamAcc> = {};
  for (const t of allTeams) acc[t] = newTeamAcc();

  for (let i = 0; i < sims; i++) {
    const rng = mulberry32((seed ^ Math.imul(i + 1, 2654435761)) >>> 0);

    // 采样未赛、建完整赛果
    const complete: Record<string, GroupMatch[]> = {};
    const r3result: Record<string, Outcome> = {};
    for (const g of groups) {
      const arr: GroupMatch[] = [];
      for (const m of matchesByGroup[g]) {
        let hg = m.homeGoals ?? 0;
        let ag = m.awayGoals ?? 0;
        if (!m.played) {
          const sc = sampleScore(getSampler(m.home, m.away), rng);
          hg = sc.homeGoals;
          ag = sc.awayGoals;
        }
        const done: GroupMatch = {
          ...m,
          homeGoals: hg,
          awayGoals: ag,
          played: true,
        };
        arr.push(done);
        if (r3KeySet.has(matchKeyOf(m))) {
          r3result[m.home] = hg > ag ? 'W' : hg < ag ? 'L' : 'D';
          r3result[m.away] = ag > hg ? 'W' : ag < hg ? 'L' : 'D';
        }
      }
      complete[g] = arr;
    }

    const pos = simulateGroups(complete, fifaRankOf);
    const seedB = buildBracketSeed(pos, fifaRankOf);
    if (!seedB) continue;
    const ko = simulateKnockout(seedB, play, rng);

    const rankByTeam: Record<string, number> = {};
    for (const rows of Object.values(pos.rowsByGroup))
      for (const r of rows) rankByTeam[r.team] = r.rank;

    for (const t of allTeams) {
      const a = acc[t];
      const st: Stage = ko.stage[t] ?? 'OUT';
      a.sims += 1;
      a.stage[st] += 1;
      const rk = rankByTeam[t];
      if (rk >= 1 && rk <= 4) a.rank[rk - 1] += 1;
      const opp = ko.r32Opponent[t];
      if (opp) inc(a.opp, opp);
      const res = r3result[t];
      if (res) {
        const ra = a.byRes[res];
        ra.sims += 1;
        ra.stage[st] += 1;
        if (opp) inc(ra.opp, opp);
      }
    }
  }

  // 组装每队前景
  const outlookByNorm: Record<string, TeamOutlook> = {};
  const teams: TeamOutlook[] = [];
  for (const norm of allTeams) {
    const a = acc[norm];
    const meta = teamMeta[norm];
    const group = meta?.group ?? ('A' as TeamMeta['group']);
    const buckets: ResultBucket[] = [];
    for (const oc of ['W', 'D', 'L'] as Outcome[]) {
      const ra = a.byRes[oc];
      if (ra.sims === 0) continue;
      buckets.push({
        outcome: oc,
        prob: ra.sims / (a.sims || 1),
        target: countReach(ra.stage, targetStage) / ra.sims,
        probs: stageProbsFrom(ra.stage, ra.sims),
        topOpponent: topOpp(ra.opp),
      });
    }
    buckets.sort(
      (x, y) => y.target - x.target || y.probs.expStage - x.probs.expStage,
    );
    const played3 = teamPlayed3[norm] ?? false;
    const ol: TeamOutlook = {
      norm,
      name: meta?.name ?? norm,
      group,
      logo: meta?.logo,
      played3,
      overall: stageProbsFrom(a.stage, a.sims),
      rankProbs: {
        p1: a.rank[0] / (a.sims || 1),
        p2: a.rank[1] / (a.sims || 1),
        p3: a.rank[2] / (a.sims || 1),
        p4: a.rank[3] / (a.sims || 1),
      },
      byResult: buckets,
      desired: played3 ? undefined : buckets[0]?.outcome,
      topOpponent: topOpp(a.opp),
    };
    outlookByNorm[norm] = ol;
    teams.push(ol);
  }
  teams.sort(
    (a, b) =>
      b.overall.expStage - a.overall.expStage || a.norm.localeCompare(b.norm),
  );

  // 组装第三轮对阵双视角
  const fixtures: FixtureView[] = r3Matches.map((m) => {
    const ho = outlookByNorm[m.home];
    const ao = outlookByNorm[m.away];
    const hOut = m.played ? undefined : homeOutcome(ho?.desired);
    const aOut = m.played ? undefined : awayOutcome(ao?.desired);
    const mutual = !!hOut && !!aOut && hOut === aOut;
    return {
      group: m.group,
      home: m.home,
      away: m.away,
      homeName: ho?.name ?? m.home,
      awayName: ao?.name ?? m.away,
      homeLogo: ho?.logo,
      awayLogo: ao?.logo,
      played: m.played,
      commenceTime: m.commenceTime,
      homeDesired: m.played ? undefined : ho?.desired,
      awayDesired: m.played ? undefined : ao?.desired,
      mutualInterest: mutual,
      jointOutcome: mutual ? hOut : undefined,
    };
  });
  // 按比赛(开赛)顺序排:同组两场同时开球 → 相邻;缺时间的排最后
  fixtures.sort(
    (a, b) =>
      (a.commenceTime || '9999').localeCompare(b.commenceTime || '9999') ||
      a.group.localeCompare(b.group) ||
      a.home.localeCompare(b.home),
  );

  return {
    teams,
    fixtures,
    targetStage,
    sims,
    fallbackTeams: [...fallbackTeams],
  };
}
