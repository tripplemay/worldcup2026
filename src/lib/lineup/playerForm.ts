/**
 * 球员近期状态(API-Football 赛季聚合:场均评分 + 进球/助攻/出场)。
 *
 * 解析链:ESPN 名单(姓名+球衣号) → 该队 API-Football 名单(按球衣号/姓名匹配 player id)
 *        → 球员赛季统计。两层缓存(名单 + 状态)落 WC_DATA_DIR,非阻塞后台补齐。
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
  const byName = squad.find((s) => norm(s.name) === pn);
  return byName?.id;
}

const fresh = (at: number, ttl: number) => Date.now() - at < ttl;

/** 后台补齐该队名单 + 名单内球员的近期状态(非阻塞,去重)。 */
function ensure(afTeamId: number, roster: RosterPlayer[]): void {
  if (!hasApiFootball()) return;
  const sq = squadStore();
  const entry = sq[afTeamId];
  if (!entry || !fresh(entry.at, SQUAD_TTL)) {
    if (squadInflight.has(afTeamId)) return; // 名单在拉,本轮先不动(状态需名单)
    squadInflight.add(afTeamId);
    void getSquad(afTeamId)
      .then((players) => {
        if (players.length) {
          sq[afTeamId] = { at: Date.now(), players };
          save(SQUAD_FILE, sq);
        }
      })
      .finally(() => squadInflight.delete(afTeamId));
    return;
  }
  // 名单已就绪 → 解析 id,补齐缺失/过期的状态
  const fs = formStore();
  const ids = [
    ...new Set(
      roster.map((p) => resolveId(entry.players, p)).filter((x): x is number => !!x),
    ),
  ];
  const missing = ids.filter(
    (id) => (!fs[id] || !fresh(fs[id].at, FORM_TTL)) && !formInflight.has(id),
  );
  if (!missing.length) return;
  missing.forEach((id) => formInflight.add(id));
  void (async () => {
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const batch = missing.slice(i, i + CONCURRENCY);
      const res = await Promise.all(
        batch.map((id) =>
          getPlayerSeason(id, SEASON).then((f) => ({ id, f })),
        ),
      );
      for (const { id, f } of res) {
        fs[id] = {
          at: Date.now(),
          form: f ?? { goals: 0, assists: 0, apps: 0 }, // 记空避免反复调用
        };
      }
    }
    save(FORM_FILE, fs);
  })().finally(() => missing.forEach((id) => formInflight.delete(id)));
}

/**
 * 给名单附加近期状态:用已缓存的即时返回(不阻塞),同时后台补齐缺失的;
 * 下次轮询即出。afTeamId 缺失或无缓存时原样返回。
 */
export function attachPlayerForm(
  afTeamId: number | undefined,
  roster: RosterPlayer[],
): RosterPlayer[] {
  if (!afTeamId || !roster.length) return roster;
  ensure(afTeamId, roster);
  const entry = squadStore()[afTeamId];
  if (!entry) return roster; // 名单尚未缓存
  const fs = formStore();
  return roster.map((p) => {
    const id = resolveId(entry.players, p);
    const fe = id ? fs[id] : undefined;
    return fe && fe.form.apps > 0 ? { ...p, form: fe.form } : p;
  });
}
