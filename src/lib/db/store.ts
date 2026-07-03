/**
 * 轻量 JSON 文件存储(预测系统用)。
 * 数据量小(48 队评分 + 数百场历史),无需数据库;零原生模块、零运维。
 * 落在 WC_DATA_DIR(默认本地 .data/,生产 /opt/apps/worldcup-data/,部署不丢)。
 * 日后若快照量大或需复杂查询,可平滑升级 SQLite。
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import type { HistMatch, TeamRating, ResultMatch } from 'lib/predict/types';
import type { LeagueMatchOdds } from 'lib/predict/oddsTypes';
import type { EpochResult } from 'research/search';
import type {
  TrialRegistry,
  HoldoutManifest,
  PromotionEntry,
} from 'research/governance';
import type { AnalystReport } from 'research/analyst';
import type { EvolutionState, EvolutionLogEntry } from 'research/evolve';
import type { ForwardStore } from 'research/forward';
import type { TeamIntel } from 'lib/intel/types';
import type { Wallet, Trade } from 'lib/trade/types';
import type { Bettor, BetSlip, Withdrawal } from 'lib/bets/types';
import type { ScenarioResult } from 'lib/scenario/types';

const DATA_DIR = process.env.WC_DATA_DIR ?? '.data';
const PREDICT_DIR = join(DATA_DIR, 'predict');

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(PREDICT_DIR, file), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  try {
    mkdirSync(PREDICT_DIR, { recursive: true });
    // 原子写:先写临时文件再 rename(同盘 rename 原子),避免半截写入/并发交错损坏
    const target = join(PREDICT_DIR, file);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, target);
  } catch (e) {
    // 写失败不抛(避免阻断请求);记录到 stderr
    console.error('[store] 写入失败', file, e);
  }
}

// ── 历史比赛(按 eventId 唯一)──────────────────────────
type HistMap = Record<string, HistMatch>;

export function loadHistorical(): HistMap {
  return readJson<HistMap>('historical.json', {});
}
export function saveHistorical(map: HistMap): void {
  writeJson('historical.json', map);
}

// ── 联赛历史(Phase 1:英超等俱乐部联赛回测,独立于 WC 数据)──────
export function loadLeagueHistorical(key: string): HistMap {
  return readJson<HistMap>(`league-${key}-historical.json`, {});
}
export function saveLeagueHistorical(key: string, map: HistMap): void {
  writeJson(`league-${key}-historical.json`, map);
}
export function loadLeagueResults(key: string): Record<string, ResultMatch> {
  return readJson<Record<string, ResultMatch>>(
    `league-${key}-results.json`,
    {},
  );
}
export function saveLeagueResults(
  key: string,
  map: Record<string, ResultMatch>,
): void {
  writeJson(`league-${key}-results.json`, map);
}
// 联赛历史赔率(football-data.co.uk 闭盘 1X2;按 matchKey 入键,跨源对齐)
export interface LeagueClosing {
  h: number;
  d: number;
  a: number;
}
export function loadLeagueOdds(key: string): Record<string, LeagueClosing> {
  return readJson<Record<string, LeagueClosing>>(`league-${key}-odds.json`, {});
}
export function saveLeagueOdds(
  key: string,
  map: Record<string, LeagueClosing>,
): void {
  writeJson(`league-${key}-odds.json`, map);
}
// 多市场历史赔率(Phase 10:开盘+闭盘 1X2/亚盘/大小球;league-<key>-oddsx.json)
export function loadLeagueOddsX(key: string): Record<string, LeagueMatchOdds> {
  return readJson<Record<string, LeagueMatchOdds>>(
    `league-${key}-oddsx.json`,
    {},
  );
}
export function saveLeagueOddsX(
  key: string,
  map: Record<string, LeagueMatchOdds>,
): void {
  writeJson(`league-${key}-oddsx.json`, map);
}
// Phase 10 研究调参时间线(搜索环每轮 epoch 结果;供客户端 /research 面板读)
export function loadResearchTimeline(): EpochResult[] {
  return readJson<EpochResult[]>('research-timeline.json', []);
}
export function saveResearchTimeline(list: EpochResult[]): void {
  writeJson('research-timeline.json', list);
}
/** 覆写前留一代备份(<file>.bak):统计生命线文件(注册表/状态/台账)防单点损坏。 */
function writeJsonWithBak(file: string, data: unknown): void {
  try {
    const cur = readFileSync(join(PREDICT_DIR, file), 'utf8');
    writeFileSync(join(PREDICT_DIR, `${file}.bak`), cur);
  } catch {
    /* 首写无备份 */
  }
  writeJson(file, data);
}

// 治理三件套(跨 run 累积:注册表钉死分母、holdout 锁定、晋级台账)
export function loadTrialRegistry(): TrialRegistry {
  return readJson<TrialRegistry>('trial-registry.json', {
    trials: [],
    seen: {},
  });
}
export function saveTrialRegistry(r: TrialRegistry): void {
  writeJsonWithBak('trial-registry.json', r);
}
export function loadHoldoutManifest(): HoldoutManifest | null {
  return readJson<HoldoutManifest | null>('holdout-manifest.json', null);
}
export function saveHoldoutManifest(m: HoldoutManifest): void {
  writeJson('holdout-manifest.json', m);
}
export function loadPromotionLedger(): PromotionEntry[] {
  return readJson<PromotionEntry[]>('promotion-ledger.json', []);
}
export function savePromotionLedger(list: PromotionEntry[]): void {
  writeJsonWithBak('promotion-ledger.json', list);
}
// LLM 研究分析报告(分析员产出;供 /research 面板显示)
export function loadResearchAnalysis(): AnalystReport | null {
  return readJson<AnalystReport | null>('research-analysis.json', null);
}
export function saveResearchAnalysis(r: AnalystReport): void {
  writeJson('research-analysis.json', r);
}
// 进化状态机(evolution-state.json;runId/schemaVersion 供一致性校验与重建)
export function loadEvolutionState(): EvolutionState | null {
  return readJson<EvolutionState | null>('evolution-state.json', null);
}
export function saveEvolutionState(s: EvolutionState): void {
  writeJsonWithBak('evolution-state.json', s);
}
// G7 前向纸面(watermark 之后新到完赛的虚拟注;research-forward.json)
export function loadForwardStore(): ForwardStore | null {
  return readJson<ForwardStore | null>('research-forward.json', null);
}
export function saveForwardStore(s: ForwardStore): void {
  writeJson('research-forward.json', s);
}

// 进化日志(append-only,永不截断;含 LLM 原始响应 + 验证器裁决 → 注入式重放)
export function loadEvolutionLog(): EvolutionLogEntry[] {
  return readJson<EvolutionLogEntry[]>('evolution-log.json', []);
}
export function appendEvolutionLog(entries: EvolutionLogEntry[]): void {
  if (!entries.length) return;
  writeJson('evolution-log.json', [...loadEvolutionLog(), ...entries]);
}

// ── 球队评分(按归一化队名)──────────────────────────────
type RatingMap = Record<string, TeamRating>;

export function loadRatings(): RatingMap {
  return readJson<RatingMap>('ratings.json', {});
}
export function saveRatings(map: RatingMap): void {
  writeJson('ratings.json', map);
}

// ── 权威 Elo(eloratings.net,覆盖全部国家队)────────────
type EloMap = Record<string, number>; // 归一化队名 → Elo

export function loadElo(): EloMap {
  return readJson<EloMap>('elo.json', {});
}
export function saveElo(map: EloMap): void {
  writeJson('elo.json', map);
}

// ── 赛果(供 Elo,比 historical 更深)──────────────────
type ResultMap = Record<string, ResultMatch>;

export function loadResults(): ResultMap {
  return readJson<ResultMap>('results.json', {});
}
export function saveResults(map: ResultMap): void {
  writeJson('results.json', map);
}

// ── API-Football 队名→id 缓存(避免反复解析)────────────
type AfTeamMap = Record<string, number>; // 归一化队名 → API-Football team id

export function loadAfTeams(): AfTeamMap {
  return readJson<AfTeamMap>('af-teams.json', {});
}
export function saveAfTeams(map: AfTeamMap): void {
  writeJson('af-teams.json', map);
}

// ── 球队杯赛 box-score 聚合(增量:仅累计新结束的场次)──────
/** 单队杯赛累计裸数据(各项为「跨场求和」,展示时除以 games 取均值)。 */
export interface TeamStatAgg {
  games: number;
  possession: number; // 控球率求和(%)
  shots: number;
  sot: number; // 射正
  corners: number;
  fouls: number;
  yellow: number;
  red: number;
  saves: number;
  offsides: number;
}
export interface TeamStatsStore {
  updatedAt: number;
  events: Record<string, true>; // 已处理的赛事 id(已结束场次不变,避免重复抓取)
  teams: Record<string, TeamStatAgg>; // 归一化队名 → 累计
}

const EMPTY_TEAM_STATS: TeamStatsStore = {
  updatedAt: 0,
  events: {},
  teams: {},
};

export function loadTeamStats(): TeamStatsStore {
  return readJson<TeamStatsStore>('team-stats.json', EMPTY_TEAM_STATS);
}
export function saveTeamStats(s: TeamStatsStore): void {
  writeJson('team-stats.json', s);
}

// ── 预测存档(赛前快照 + 赛后结果,供战绩追踪/对照)──────
export interface PredictionSnapshot {
  matchId: string; // ESPN 比赛 id
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  snapshotAt: number; // 快照时刻(ms)
  source: 'live' | 'reconstructed'; // 生产实时快照 / walk-forward 回填
  pHome: number;
  pDraw: number;
  pAway: number;
  predGoals: number; // 预期总进球 λ+μ
  over25?: number;
  btts?: number;
  // 各基础模型当时 1X2(CLV 校准:市场无关的泊松 vs 闭盘才是干净对比)
  models?: Record<string, { h: number; d: number; a: number }>;
  pick: 'H' | 'D' | 'A'; // 预测最大项
  // 赛后回填:
  settled: boolean;
  homeGoals?: number;
  awayGoals?: number;
  result?: 'H' | 'D' | 'A';
  hit?: boolean;
}
export type PredictionLog = Record<string, PredictionSnapshot>;
export function loadPredictionLog(): PredictionLog {
  return readJson<PredictionLog>('predictions-log.json', {});
}
export function savePredictionLog(log: PredictionLog): void {
  writeJson('predictions-log.json', log);
}

// ── 初盘(1X2 自捕获:轮询器首见某场赔率时写一次,永不覆盖)──────
export interface OpeningOdds {
  capturedAt: number; // 首见时刻(ms)
  home: number;
  draw: number;
  away: number;
}
export type OpeningOddsStore = Record<string, OpeningOdds>; // key = 比赛 id
export function loadOpeningOdds(): OpeningOddsStore {
  return readJson<OpeningOddsStore>('opening-odds.json', {});
}
export function saveOpeningOdds(s: OpeningOddsStore): void {
  writeJson('opening-odds.json', s);
}

// ── 交易指令(Copilot:EV路由 + 雷达合成的 4 级人工跟单指令)──────
export type SignalLevel = 'L1' | 'L2' | 'L3' | 'L4';
export type SignalStatus = 'UNREAD' | 'EXECUTED' | 'DISMISSED';
export interface TradingSignal {
  id: string;
  ts: number;
  matchId: string;
  match: string; // "Home vs Away"(展示名)
  level: SignalLevel;
  market: string;
  selection: string;
  line?: number;
  odds: number;
  ev: number;
  pWin: number;
  kelly: number;
  suggestedStake: number;
  resonance: boolean; // 雷达是否同向共振(L1)
  divergence?: string; // 模型分歧类型(CONSENSUS/R1_UNDERCONF/GOALS_FORM/SPLIT)
  status: SignalStatus;
}
export function loadSignals(): TradingSignal[] {
  return readJson<TradingSignal[]>('trading-signals.json', []);
}
export function saveSignals(list: TradingSignal[]): void {
  writeJson('trading-signals.json', list);
}

// ── 闭盘价(开赛前最后一拍,write-once;CLV 真值靶用)──────
export interface ClosingOdds {
  capturedAt: number;
  h: number | null;
  d: number | null;
  a: number | null;
  ahLine?: number | null;
  ahH?: number | null;
  ahA?: number | null;
  home?: string;
  away?: string;
}
export type ClosingOddsStore = Record<string, ClosingOdds>; // key = matchKey(队名对+UTC日),跨源对齐
export function loadClosingOdds(): ClosingOddsStore {
  return readJson<ClosingOddsStore>('closing-odds.json', {});
}
export function saveClosingOdds(s: ClosingOddsStore): void {
  writeJson('closing-odds.json', s);
}

// ── 赔率时序快照(雷达;内存为权威,5min 异步落盘)──────
export interface OddsSnapshotsFile {
  lastFlushed: number;
  matches: Record<string, { snapshots: (number | null)[][] }>;
}
export function loadOddsSnapshots(): OddsSnapshotsFile {
  return readJson<OddsSnapshotsFile>('odds-snapshots.json', {
    lastFlushed: 0,
    matches: {},
  });
}
export function saveOddsSnapshots(data: OddsSnapshotsFile): void {
  writeJson('odds-snapshots.json', data);
}

// ── 射手榜(API-Football topscorers,engine cron 刷新)──────
export interface LeadersStore {
  updatedAt: number;
  scorers: { name: string; team: string; goals: number; assists: number }[];
}
export function loadLeaders(): LeadersStore {
  return readJson<LeadersStore>('leaders.json', { updatedAt: 0, scorers: [] });
}
export function saveLeaders(s: LeadersStore): void {
  writeJson('leaders.json', s);
}

// ── 球员出场分钟(体能:核心球员近期累计分钟)──────────
export interface PlayerMinutesStore {
  updatedAt: number;
  events: Record<string, true>; // 已处理赛事 id
  teams: Record<
    string, // 归一化队名
    { matches: { date: string; mins: Record<string, number> }[] } // 逐场 playerId→分钟
  >;
}
const EMPTY_PM: PlayerMinutesStore = { updatedAt: 0, events: {}, teams: {} };
export function loadPlayerMinutes(): PlayerMinutesStore {
  return readJson<PlayerMinutesStore>('player-minutes.json', EMPTY_PM);
}
export function savePlayerMinutes(s: PlayerMinutesStore): void {
  writeJson('player-minutes.json', s);
}

// ── 模拟交易账本(虚拟资金 + 流水)──────────────────────
export function loadWallet(): Wallet | null {
  return readJson<Wallet | null>('wallet.json', null);
}
export function saveWallet(w: Wallet): void {
  writeJson('wallet.json', w);
}
export function loadTrades(): Trade[] {
  return readJson<Trade[]>('trade_logs.json', []);
}
export function saveTrades(list: Trade[]): void {
  writeJson('trade_logs.json', list);
}

// ── 场外情报(按归一化队名)────────────────────────────
type IntelMap = Record<string, TeamIntel>;

export function loadIntel(): IntelMap {
  return readJson<IntelMap>('intel.json', {});
}
export function saveIntel(map: IntelMap): void {
  writeJson('intel.json', map);
}

// ── 跟单人名册(Phase 9:可下注人,Telegram 按钮归属用)──────
export function loadBettors(): Bettor[] {
  return readJson<Bettor[]>('bettors.json', []);
}
export function saveBettors(list: Bettor[]): void {
  writeJson('bettors.json', list);
}

// ── 他平台注单(Phase 9:截图识别 + 赛后自动结算)──────────
export function loadBets(): BetSlip[] {
  return readJson<BetSlip[]>('bets.json', []);
}
export function saveBets(list: BetSlip[]): void {
  writeJson('bets.json', list);
}

// ── 提款流水(Phase 9:管理员逐笔记录投注人提款)──────────
export function loadWithdrawals(): Withdrawal[] {
  return readJson<Withdrawal[]>('withdrawals.json', []);
}
export function saveWithdrawals(list: Withdrawal[]): void {
  writeJson('withdrawals.json', list);
}

// ── 沙盘情景推演(Phase 8d:第三轮期望结果 + 整树晋级路径 Monte-Carlo)──────
export function loadScenario(): ScenarioResult | null {
  return readJson<ScenarioResult | null>('scenarios.json', null);
}
export function saveScenario(s: ScenarioResult): void {
  writeJson('scenarios.json', s);
}

// ── 微信「待归属」会话状态(收到截图后等管理员回复序号/姓名指定归属)──────
export interface WxPendingAssign {
  betId: string;
  bettorIds: string[]; // 提示里编号对应的投注人顺序(回复序号据此映射)
  at: number;
}
export type WxPendingStore = Record<string, WxPendingAssign>; // key = 微信 user_id
export function loadWxPending(): WxPendingStore {
  return readJson<WxPendingStore>('wx-pending.json', {});
}
export function saveWxPending(s: WxPendingStore): void {
  writeJson('wx-pending.json', s);
}

// ── 微信接入轮询游标(Phase 9b:wx-link 收单)──────────────
// 主 bot(env WX_BOT_TOKEN 第一个)用此 legacy 文件,保留历史游标不丢。
export function loadWxCursor(): string {
  return readJson<{ cursor: string }>('wx-cursor.json', { cursor: '' }).cursor;
}
export function saveWxCursor(cursor: string): void {
  writeJson('wx-cursor.json', { cursor, updatedAt: Date.now() });
}

// 附加 bot 各自独立游标(按 botKey 存于一个 map 文件)。
export function loadWxCursorFor(key: string): string {
  return readJson<Record<string, string>>('wx-cursors.json', {})[key] ?? '';
}
export function saveWxCursorFor(key: string, cursor: string): void {
  const m = readJson<Record<string, string>>('wx-cursors.json', {});
  m[key] = cursor;
  writeJson('wx-cursors.json', m);
}

// ── 微信多 bot:运行时新增的 clawbot(每人扫码各得一个独立 bot/token)──────
// 主 bot 仍走 env WX_BOT_TOKEN;此处存"额外"管理员扫码后拿到的 token,轮询器一并轮询。
// 注:token 是 clawbot 会话凭证(非主密钥),为支持动态增删落在数据目录(部署不丢、不入库主密钥体系)。
export interface WxBot {
  token: string;
  label?: string;
  addedAt: number;
}
export function loadWxBots(): WxBot[] {
  return readJson<WxBot[]>('wx-bots.json', []);
}
export function saveWxBots(list: WxBot[]): void {
  writeJson('wx-bots.json', list);
}
