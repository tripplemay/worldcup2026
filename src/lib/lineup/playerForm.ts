/**
 * 球员近期状态(API-Football 赛季聚合:场均评分 + 进球/助攻/出场)。
 *
 * 解析链:ESPN 名单(姓名+球衣号) → 该队 API-Football 名单(按球衣号/姓名匹配 player id)
 *        → 球员赛季统计。两层缓存(名单 + 状态)落 WC_DATA_DIR。
 * 两种填充:
 *  · 懒触发 ensure(详情页打开时,后台单任务补齐该场名单内球员);
 *  · 主动预热 prewarmUpcoming(引擎 cron/部署后台为未来比赛全队名单预拉,用户无需先看)。
 * 未配置 API_FOOTBALL_KEY 时跳过(回退无状态)。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  hasApiFootball,
  getSquad,
  getPlayerSeason,
  type SquadPlayer,
} from 'lib/predict/apifootball';
import { espnProvider } from 'lib/espn/espn';
import { loadAfTeams } from 'lib/db/store';
import { normalizeTeam } from 'lib/match/normalize';
import type { RosterPlayer, PlayerForm } from 'lib/espn/types';

const DATA_DIR = process.env.WC_DATA_DIR ?? '.data';
const SQUAD_FILE = join(DATA_DIR, 'af-squads.json');
const FORM_FILE = join(DATA_DIR, 'player-form.json');
const SEASON = Number(process.env.AF_FORM_SEASON ?? 2025); // 俱乐部当前赛季(2025-26)
const SQUAD_TTL = 7 * 86400_000; // 名单 7 天
const FORM_TTL = 86400_000; // 状态 1 天
const CONCURRENCY = 5;

interface SquadEntry {
  at: number;
  players: SquadPlayer[];
}
interface FormEntry {
  at: number;
  form: PlayerForm;
}

let squads: Record<string, SquadEntry> | null = null;
let forms: Record<string, FormEntry> | null = null;
const squadInflight = new Set<number>();
const formInflight = new Set<number>();

function load<T>(file: string): Record<string, T> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, T>;
  } catch {
    return {};
  }
}
function save(file: string, data: unknown): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  } catch (e) {
    console.error('[player-form] 写缓存失败', e);
  }
}
function squadStore(): Record<string, SquadEntry> {
  if (!squads) squads = load<SquadEntry>(SQUAD_FILE);
  return squads;
}
function formStore(): Record<string, FormEntry> {
  if (!forms) forms = load<FormEntry>(FORM_FILE);
  return forms;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** 按球衣号(优先)或姓名把 ESPN 球员解析到 API-Football player id。 */
function resolveId(squad: SquadPlayer[], p: RosterPlayer): number | undefined {
  if (p.jersey) {
    const n = Number(p.jersey);
    const byNum = squad.find((s) => s.number === n);
    if (byNum) return byNum.id;
  }
  const pn = norm(p.name);
  return squad.find((s) => norm(s.name) === pn)?.id;
}

const fresh = (at: number, ttl: number) => Date.now() - at < ttl;

/** 拉取并缓存球队名单(可 await;去重;失败/无 key 返回已有缓存或空)。 */
async function ensureSquad(afTeamId: number): Promise<SquadPlayer[]> {
  const sq = squadStore();
  const e = sq[afTeamId];
  if (e && fresh(e.at, SQUAD_TTL)) return e.players;
  if (squadInflight.has(afTeamId)) return e?.players ?? [];
  squadInflight.add(afTeamId);
  try {
    const players = await getSquad(afTeamId);
    if (players.length) {
      sq[afTeamId] = { at: Date.now(), players };
      save(SQUAD_FILE, sq);
      return players;
    }
    return e?.players ?? [];
  } finally {
    squadInflight.delete(afTeamId);
  }
}

/** 拉取并缓存给定球员的近期状态(可 await;限并发;去重;未返回的记空避免反复调用)。 */
async function fillForms(ids: number[]): Promise<void> {
  const fs = formStore();
  // 旧缓存(无 leagueId 字段)视为过期重拉一次,以补上联赛信息(一次性迁移)
  const stale = (id: number) => {
    const e = fs[id];
    if (!e || !fresh(e.at, FORM_TTL)) return true;
    return e.form.apps > 0 && e.form.leagueId === undefined;
  };
  const missing = [...new Set(ids)].filter(
    (id) => stale(id) && !formInflight.has(id),
  );
  if (!missing.length) return;
  missing.forEach((id) => formInflight.add(id));
  try {
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const batch = missing.slice(i, i + CONCURRENCY);
      const res = await Promise.all(
        batch.map((id) => getPlayerSeason(id, SEASON).then((f) => ({ id, f }))),
      );
      for (const { id, f } of res) {
        fs[id] = {
          at: Date.now(),
          form: f ?? { goals: 0, assists: 0, apps: 0 },
        };
      }
      save(FORM_FILE, fs);
    }
  } finally {
    missing.forEach((id) => formInflight.delete(id));
  }
}

/** 懒触发:详情页打开时后台补齐该场名单内球员的状态(非阻塞,单任务)。 */
function ensure(afTeamId: number, roster: RosterPlayer[]): void {
  if (!hasApiFootball()) return;
  void (async () => {
    const squad = await ensureSquad(afTeamId);
    if (!squad.length) return;
    const ids = roster
      .map((p) => resolveId(squad, p))
      .filter((x): x is number => !!x);
    await fillForms(ids);
  })();
}

/**
 * 给名单附加近期状态:用已缓存的即时返回(不阻塞),同时后台补齐缺失的;
 * 下次轮询即出。afTeamId 缺失或无名单缓存时原样返回。
 */
export function attachPlayerForm(
  afTeamId: number | undefined,
  roster: RosterPlayer[],
): RosterPlayer[] {
  if (!afTeamId || !roster.length) return roster;
  ensure(afTeamId, roster);
  const entry = squadStore()[afTeamId];
  if (!entry) return roster;
  const fs = formStore();
  return roster.map((p) => {
    const id = resolveId(entry.players, p);
    const fe = id ? fs[id] : undefined;
    return fe && fe.form.apps > 0 ? { ...p, form: fe.form } : p;
  });
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/**
 * 主动预热:为未来 days 天比赛的球队**全队名单**预拉评分并缓存。
 * 供引擎 cron/部署后台调用,使用户首次打开详情页即有评分(无需先看触发)。
 */
export async function prewarmUpcoming(days = 7): Promise<{ teams: number }> {
  if (!hasApiFootball()) return { teams: 0 };
  const start = ymd(new Date(Date.now() - 86400_000));
  const end = ymd(new Date(Date.now() + days * 86400_000));
  const fixtures = await espnProvider.getScoreboard(`${start}-${end}`);
  const af = loadAfTeams();
  const ids = new Set<number>();
  for (const f of fixtures) {
    if (f.status === 'post') continue;
    for (const t of [f.homeTeam, f.awayTeam]) {
      const id = af[normalizeTeam(t)];
      if (id) ids.add(id);
    }
  }
  for (const id of ids) {
    const squad = await ensureSquad(id);
    if (squad.length) await fillForms(squad.map((s) => s.id));
  }
  return { teams: ids.size };
}
