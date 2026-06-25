/**
 * 「沙盘」情景推演 —— 领域类型。
 *
 * 2026 世界杯赛制:48 队、12 组(A–L)各 4 队;每组前 2 名 + 8 个成绩最好的小组第三名
 * 进 32 强淘汰赛(R32, 比赛 73–88)→ R16(89–96)→ 1/4(97–100)→ 半决赛(101–102)
 * → 三四名(103)→ 决赛(104)。bracket 为赛前固定模板,不随小组赛结果重抽。
 */

export type GroupLetter =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L';

export const GROUP_LETTERS: GroupLetter[] = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
];

/** R32 里「迎战某个最佳第三名」的 8 个小组头名槽位。 */
export type WinnerSlot = '1A' | '1B' | '1D' | '1E' | '1G' | '1I' | '1K' | '1L';

/** 淘汰赛轮次。 */
export type KnockoutRound = 'R32' | 'R16' | 'QF' | 'SF' | 'P3' | 'F';

/**
 * bracket 模板里一场比赛的「位置引用」(队伍尚未确定时的占位)。
 * - W/R:某组头名 / 次名
 * - T3:迎战某头名槽位的最佳第三名(经第三名分配表解析为具体某组第三)
 * - WM/LM:某场比赛的胜者 / 负者(淘汰赛内部连接)
 */
export type PosRef =
  | { kind: 'W'; group: GroupLetter }
  | { kind: 'R'; group: GroupLetter }
  | { kind: 'T3'; slot: WinnerSlot; eligible: GroupLetter[] }
  | { kind: 'WM'; match: number }
  | { kind: 'LM'; match: number };

/** bracket 模板里的一场比赛(队伍以 PosRef 占位)。 */
export interface BracketMatchTpl {
  match: number; // 73..104
  round: KnockoutRound;
  home: PosRef;
  away: PosRef;
}

/**
 * 一支球队在一次模拟里走到的最远阶段(用于晋级深度统计)。
 * 顺序索引见 STAGE_ORDER:OUT(小组出局) < R32 < R16 < QF < SF < FINAL < CHAMPION。
 * 含义为「最后踢到的那一轮」:R32 负者=R32;决赛负者=FINAL;夺冠=CHAMPION。
 */
export type Stage = 'OUT' | 'R32' | 'R16' | 'QF' | 'SF' | 'FINAL' | 'CHAMPION';

export const STAGE_ORDER: Stage[] = [
  'OUT',
  'R32',
  'R16',
  'QF',
  'SF',
  'FINAL',
  'CHAMPION',
];

export const stageIndex = (s: Stage): number => STAGE_ORDER.indexOf(s);

/** 一场小组赛(归一化队名;已赛则带比分,未赛比分为空待采样)。 */
export interface GroupMatch {
  group: GroupLetter;
  home: string; // 归一化队名
  away: string;
  homeGoals?: number; // 已赛
  awayGoals?: number;
  played: boolean;
  round?: number; // 小组赛轮次 1/2/3(由 compute 按开赛日期判定;第三轮=本队最后一场)
  commenceTime?: string; // ISO(判轮次/排序用)
}

/** 小组赛算名次后的一行(归一化队名)。 */
export interface GroupRow {
  team: string; // 归一化队名
  group: GroupLetter;
  points: number;
  gf: number;
  ga: number;
  gd: number;
  rank: 1 | 2 | 3 | 4;
}

/** 一支队的某场比赛胜平负结果(自身视角)。 */
export type Outcome = 'W' | 'D' | 'L';

/** 小组名次抽出的位置(头名/次名/12 个第三名);knockout 据此建种子。 */
export interface GroupPositionsLike {
  winners: Record<string, GroupRow>; // 组字母 → 头名行
  runners: Record<string, GroupRow>; // 组字母 → 次名行
  thirds: GroupRow[]; // 12 个小组第三名
}

/** 球队元信息(展示名 + 组别 + 队徽),归一化名索引。 */
export interface TeamMeta {
  norm: string;
  name: string; // 展示名(英文,前端经 i18n 本地化)
  group: GroupLetter;
  logo?: string;
}

// ── Monte-Carlo 输出(接口/前端共享)──────────────────────────

/** 一支队的晋级深度概率分布。 */
export interface StageProbs {
  advance: number; // P(出线,进 R32)
  r16: number; // P(打进 16 强)
  qf: number; // P(打进 8 强)
  sf: number; // P(打进 4 强)
  final: number; // P(打进决赛)
  champion: number; // P(夺冠)
  expStage: number; // 期望阶段索引(0=OUT … 6=CHAMPION)
}

/** 取某目标轮的「打进及更深」概率(目标轮可配,前端展示用)。 */
export function reachProb(p: StageProbs, stage: Stage): number {
  switch (stage) {
    case 'R16':
      return p.r16;
    case 'QF':
      return p.qf;
    case 'SF':
      return p.sf;
    case 'FINAL':
      return p.final;
    case 'CHAMPION':
      return p.champion;
    default:
      return p.advance; // R32 / OUT 兜底为出线
  }
}

/** 按本队第三轮某结果(胜/平/负)分桶的条件前景。 */
export interface ResultBucket {
  outcome: Outcome;
  prob: number; // 该结果的边际概率
  target: number; // 「最期望」标量:P(打进目标轮 | 该结果)
  probs: StageProbs; // 该结果下的完整晋级分布
  topOpponent?: { norm: string; prob: number }; // 该结果下最可能的 R32 对手
}

/**
 * 单队「最可能晋级路线」的一跳(R16/QF;R32 复用 topOpponent)。
 * ⚠️ 逐轮独立众数:R32→R16→QF 三步各自取「到达该轮的 sim 子集」里的众数对手,
 * 不保证同属一条真实模拟链(前端须诚实标注)。prob 分母=本队到达该轮的 sim 数。
 */
export interface PathStep {
  round: 'R16' | 'QF';
  opponentNorm: string;
  opponentName?: string;
  prob: number; // P(本轮对手=该队 | 本队到达本轮)
}

/** 球队当前真实小组形势(取自实时积分榜 + 未赛对阵;现状,非 MC 预测)。 */
export interface TeamStanding {
  rank: number; // 当前小组排名(1-4)
  played: number; // 已赛场次
  win: number;
  draw: number;
  loss: number;
  gf: number; // 进球
  ga: number; // 失球
  gd: number; // 净胜球
  points: number; // 积分
  remaining: number; // 剩余小组赛场次
  remainingOpps?: { norm: string; name: string }[]; // 剩余对手(展示用)
}

/** 单队前景(全部 48 队)。 */
export interface TeamOutlook {
  norm: string;
  name: string;
  group: GroupLetter;
  logo?: string;
  played3: boolean; // 第三轮是否已踢(已踢则结果已定,无「最期望」)
  overall: StageProbs;
  rankProbs: { p1: number; p2: number; p3: number; p4: number }; // 组内名次分布
  byResult: ResultBucket[]; // 按 desirability 降序(至多 3 项)
  desired?: Outcome; // 最期望结果(played3 时为空)
  topOpponent?: { norm: string; prob: number }; // 总体最可能 R32 对手
  path?: PathStep[]; // 最可能晋级路线(R16/QF;仅深度够的队挂,见 PATH_GATE)
  standing?: TeamStanding; // 当前真实小组形势(现状)
}

/** 某组第三名「出线后」被 Annex C 分到某头名槽位的概率(分母=本组第三名出线的 sim 数)。 */
export interface ThirdSlotProb {
  slot: WinnerSlot;
  prob: number;
}

/** 一组第三名的出线竞争前景(48 队赛制:12 组第三名争 8 个出线名额)。 */
export interface ThirdRaceRow {
  group: GroupLetter;
  team: string; // 归一化名:本组「最常成为第三名的队」(众数,非某 sim 末值)
  name: string; // 展示名(英文,前端经 i18n 本地化)
  logo?: string;
  qualifyProb: number; // P(本组第三名出线进 R32),无条件;分母=有效 sim(seededSims,生产环境≈全 sims)
  slotProbs?: ThirdSlotProb[]; // 出线后落到各头名槽位的分布(降序),分母=本组出线 sims
}

/** 一条「自洽」夺冠路径里的一场(冠军实际赢下的某场对阵)。 */
export interface PathLeg {
  round: KnockoutRound;
  matchNo: number;
  opponentNorm: string;
  opponentName: string;
}

/**
 * 最可能夺冠路径(整条 champion-path):同一次模拟里冠军从 R32 连胜到决赛的对手序列。
 * 边与边天然自洽(是真实跑出过的一条 bracket),区别于 PathStep 的逐轮独立众数。
 */
export interface ChampionPath {
  champion: string; // 归一化名
  name: string;
  logo?: string;
  championProb: number; // 该队夺冠概率(=overall.champion;卡片大号数字,有意义的标尺)
  prob: number; // 这条具体路线的占比;分母=有效 sim(组合空间极大,单条天然很小)
  legs: PathLeg[]; // R32→决赛 实际对手序列
}

/** 第三轮一场对阵(双方视角 + 默契检测)。 */
export interface FixtureView {
  group: GroupLetter;
  home: string; // 归一化名
  away: string;
  homeName: string;
  awayName: string;
  homeLogo?: string;
  awayLogo?: string;
  played: boolean;
  commenceTime?: string;
  homeDesired?: Outcome; // 主队最期望(未踢时)
  awayDesired?: Outcome; // 客队最期望
  /** 双方最期望是否指向同一比赛结果(默契动机)。 */
  mutualInterest: boolean;
  jointOutcome?: 'home' | 'draw' | 'away'; // 共同期望的那个结果
}

export type ThirdTableSource = 'official' | 'algorithm';

/** 一次推演的完整结果(落盘 + 接口返回)。 */
export interface ScenarioResult {
  computedAt: number;
  sims: number;
  targetStage: Stage; // 「整条路径最易」的目标轮(默认 QF)
  thirdTableSource: ThirdTableSource;
  groupsLocked: GroupLetter[]; // 第三轮已全部踢完的组
  groupsPending: GroupLetter[]; // 还有第三轮未踢的组
  fixtures: FixtureView[]; // 第三轮对阵(未踢在前)
  teams: TeamOutlook[]; // 全部 48 队前景
  notes?: string;
  // ── C 阶段新增(全可选:老缓存无此字段时前端隐藏对应视图)──
  thirdRace?: ThirdRaceRow[]; // 12 组第三名出线竞争 + Annex C 槽位
  topPaths?: ChampionPath[]; // 按夺冠概率前 N 队各自最可能的自洽夺冠路径
  topPathsCovered?: number; // 上述路径合计覆盖的有效 sim 占比(诚实标注用)
}

// ── 展示口径切换:同一份 byResult.probs 上按不同「目标轮」重排/取最期望(前端交叉比对)──

/** 按指定目标轮(口径)对结果桶降序排(期望度 = 打进该轮及更深的概率)。 */
export function sortBucketsByMetric(
  byResult: ResultBucket[],
  stage: Stage,
): ResultBucket[] {
  return [...byResult].sort(
    (a, b) => reachProb(b.probs, stage) - reachProb(a.probs, stage),
  );
}

/** 在指定口径下的最期望结果(argmax 打进目标轮);无桶返回 undefined。 */
export function desiredByMetric(
  byResult: ResultBucket[],
  stage: Stage,
): Outcome | undefined {
  return sortBucketsByMetric(byResult, stage)[0]?.outcome;
}

/** 「有取舍」阈值:摆动绝对≥5pp 或 相对≥50%(后者救「绝对小但决定性」的弱旅,如 2%/0%)。 */
export const MEANINGFUL_ABS = 0.05;
export const MEANINGFUL_REL = 0.5;

/**
 * 在某口径下,胜/平/负三结果的概率摆动是否「有取舍」(值得高亮最期望/触发默契)。
 * 不够大 → 视为「势均·影响不大」,argmax 多半是噪声,不应误导。
 */
export function isMeaningful(byResult: ResultBucket[], stage: Stage): boolean {
  if (byResult.length < 2) return false;
  const vals = byResult.map((b) => reachProb(b.probs, stage));
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const spread = max - min;
  return (
    spread >= MEANINGFUL_ABS || (max > 0 && spread / max >= MEANINGFUL_REL)
  );
}
