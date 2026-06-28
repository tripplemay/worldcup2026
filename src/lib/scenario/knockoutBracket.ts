/**
 * 真实淘汰赛对阵树缝合引擎(纯函数,可独立测试)。
 *
 * 把两套脱节的数据缝成一棵连通的对阵树:
 *  - 骨架来自模板 bracket.ts 的 BRACKET(M73–104),含「谁的胜者/负者打谁」拓扑;
 *  - 身份来自 ESPN 真实积分榜(组头名/次名/第三名),队名与对阵图同源、零归一化风险;
 *  - 赛果来自 ESPN 真实淘汰赛对阵(比分/状态/晋级方),已踢钉死、未踢显占位。
 *
 * 关键:R32 的 T3(最佳第三名)槽位「从 ESPN 实际对阵反读」FIFA 真实分配,
 * 不重算 Annex C / 第三名排序——彻底规避抽签推导与现实偏差的风险。
 * R16 及以上按模板 WM/LM 用「实际胜者身份」逐轮传播并匹配真实场次,自愈式映射。
 */
import { BRACKET } from './bracket';
import { normalizeTeam } from 'lib/match/normalize';
import type { BracketMatch, GroupStanding } from 'lib/espn/types';
import type {
  BracketNode,
  BracketSide,
  GroupLetter,
  KnockoutBracket,
  PosRef,
} from './types';

/** 积分榜组名("Group A" / "A")→ 组字母。 */
function groupLetter(label: string): GroupLetter | undefined {
  const s = label
    .trim()
    .toUpperCase()
    .replace(/^GROUP\s*/, '');
  return /^[A-L]$/.test(s) ? (s as GroupLetter) : undefined;
}

interface TeamRef {
  norm: string;
  name: string;
  logo?: string;
}

/** 一侧解析结果:已定队伍 或 仍是占位。 */
interface SideResolve {
  team?: TeamRef;
  placeholder?: BracketSide['placeholder'];
}

/** 由模板位置引用 + 已知身份解析出一侧的具体队伍(尚不可解析则返回占位)。 */
function resolveRef(
  ref: PosRef,
  ctx: {
    winnersByGroup: Partial<Record<GroupLetter, TeamRef>>;
    runnersByGroup: Partial<Record<GroupLetter, TeamRef>>;
    winnerOf: Map<number, TeamRef>;
    loserOf: Map<number, TeamRef>;
  },
): SideResolve {
  switch (ref.kind) {
    case 'W': {
      const t = ctx.winnersByGroup[ref.group];
      return t ? { team: t } : { placeholder: { kind: 'W', group: ref.group } };
    }
    case 'R': {
      const t = ctx.runnersByGroup[ref.group];
      return t ? { team: t } : { placeholder: { kind: 'R', group: ref.group } };
    }
    case 'T3':
      // 第三名身份不从积分榜推导,等 ESPN 真实对阵反读;先占位。
      return { placeholder: { kind: 'T3', slot: ref.slot } };
    case 'WM': {
      const t = ctx.winnerOf.get(ref.match);
      return t ? { team: t } : { placeholder: { kind: 'WM', match: ref.match } };
    }
    case 'LM': {
      const t = ctx.loserOf.get(ref.match);
      return t ? { team: t } : { placeholder: { kind: 'LM', match: ref.match } };
    }
  }
}

/** 一场 ESPN 对阵的归一化双方 + 取某队所在侧数据。 */
function espnSides(m: BracketMatch) {
  return {
    homeNorm: normalizeTeam(m.homeTeam ?? ''),
    awayNorm: normalizeTeam(m.awayTeam ?? ''),
  };
}

/** 该 ESPN 场次的晋级方归一化名(post 才有;无 winner flag 时回退比分高者)。 */
function advancedNorm(m: BracketMatch, homeNorm: string, awayNorm: string): string | undefined {
  if (m.status !== 'post') return undefined;
  if (m.homeWinner) return homeNorm;
  if (m.awayWinner) return awayNorm;
  if (typeof m.homeScore === 'number' && typeof m.awayScore === 'number') {
    if (m.homeScore > m.awayScore) return homeNorm;
    if (m.awayScore > m.homeScore) return awayNorm;
  }
  return undefined; // 平局且无 flag(点球未知)→ 不判,保持占位
}

/** 把一侧(已知队伍/占位)+ 可选 ESPN 数据组装成 BracketSide。 */
function buildSide(
  team: TeamRef | undefined,
  placeholder: BracketSide['placeholder'],
  espn?: { score?: number; winner?: boolean },
): BracketSide {
  if (team) {
    return {
      norm: team.norm,
      name: team.name,
      logo: team.logo,
      score: espn?.score,
      winner: espn?.winner || undefined,
    };
  }
  return { placeholder };
}

export interface BuildBracketInput {
  standings: GroupStanding[];
  matches: BracketMatch[];
  /** 计算时间戳(默认 Date.now();测试可注入固定值)。 */
  now?: number;
}

/**
 * 缝合真实淘汰赛对阵树。已踢的钉死(含胜者传播),未踢/未定的显占位。
 */
export function buildKnockoutBracket(input: BuildBracketInput): KnockoutBracket {
  const { standings, matches } = input;
  const now = input.now ?? Date.now();

  // ── 1. 身份:从积分榜定各组头名/次名/第三名(仅小组赛全部踢完的组才采信)──
  const meta = new Map<string, TeamRef>();
  const remember = (rawName?: string, logo?: string): TeamRef | undefined => {
    if (!rawName) return undefined;
    const norm = normalizeTeam(rawName);
    const prev = meta.get(norm);
    const ref: TeamRef = { norm, name: prev?.name ?? rawName, logo: logo ?? prev?.logo };
    meta.set(norm, ref);
    return ref;
  };

  const winnersByGroup: Partial<Record<GroupLetter, TeamRef>> = {};
  const runnersByGroup: Partial<Record<GroupLetter, TeamRef>> = {};
  for (const g of standings) {
    const letter = groupLetter(g.group);
    if (!letter) continue;
    const rows = [...g.rows].sort((a, b) => a.rank - b.rank);
    const complete = rows.length >= 4 && rows.every((r) => r.played >= 3);
    for (const row of rows) remember(row.team, row.logo); // 元信息总是登记
    if (!complete) continue;
    const w = rows.find((r) => r.rank === 1);
    const r = rows.find((r) => r.rank === 2);
    if (w) winnersByGroup[letter] = remember(w.team, w.logo);
    if (r) runnersByGroup[letter] = remember(r.team, r.logo);
  }

  // ── 2. 索引 ESPN 真实淘汰赛对阵 ──
  for (const m of matches) {
    remember(m.homeTeam, m.homeLogo);
    remember(m.awayTeam, m.awayLogo);
  }
  const byPair = new Map<string, BracketMatch[]>();
  const byTeam = new Map<string, BracketMatch[]>();
  for (const m of matches) {
    const { homeNorm, awayNorm } = espnSides(m);
    if (!homeNorm || !awayNorm) continue;
    const pk = [homeNorm, awayNorm].sort().join(' v ');
    (byPair.get(pk) ?? byPair.set(pk, []).get(pk)!).push(m);
    (byTeam.get(homeNorm) ?? byTeam.set(homeNorm, []).get(homeNorm)!).push(m);
    (byTeam.get(awayNorm) ?? byTeam.set(awayNorm, []).get(awayNorm)!).push(m);
  }
  const usedIds = new Set<string>();

  const findByPair = (a: string, b: string): BracketMatch | undefined => {
    const pk = [a, b].sort().join(' v ');
    return (byPair.get(pk) ?? []).find((m) => !usedIds.has(m.id));
  };
  // 含某队、尚未占用的最早一场(队的 R32 在淘汰赛里时间最早,故取最早即其本轮场次)。
  const findEarliestWith = (norm: string): BracketMatch | undefined => {
    const cands = (byTeam.get(norm) ?? []).filter((m) => !usedIds.has(m.id));
    if (!cands.length) return undefined;
    return [...cands].sort((a, b) =>
      (a.commenceTime ?? '').localeCompare(b.commenceTime ?? ''),
    )[0];
  };

  // ── 3. 沿模板逐场缝合(BRACKET 已按 73..104 升序,R32 在 R16 之前)──
  const winnerOf = new Map<number, TeamRef>();
  const loserOf = new Map<number, TeamRef>();
  const ctx = { winnersByGroup, runnersByGroup, winnerOf, loserOf };
  const nodes: BracketNode[] = [];

  for (const tpl of BRACKET) {
    const homeR = resolveRef(tpl.home, ctx);
    const awayR = resolveRef(tpl.away, ctx);
    let homeTeam = homeR.team;
    let awayTeam = awayR.team;

    // 选定要映射的 ESPN 场次
    let matched: BracketMatch | undefined;
    if (homeTeam && awayTeam) {
      matched = findByPair(homeTeam.norm, awayTeam.norm);
    } else if (
      tpl.round === 'R32' &&
      ((homeTeam && awayR.placeholder?.kind === 'T3') ||
        (awayTeam && homeR.placeholder?.kind === 'T3'))
    ) {
      // R32 头名 vs 最佳第三名:已知头名队,从 ESPN 反读第三名队
      const known = (homeTeam ?? awayTeam)!;
      matched = findEarliestWith(known.norm);
      if (matched) {
        const { homeNorm, awayNorm } = espnSides(matched);
        const oppNorm = known.norm === homeNorm ? awayNorm : homeNorm;
        const oppRef = meta.get(oppNorm) ?? { norm: oppNorm, name: oppNorm };
        if (homeTeam) awayTeam = oppRef;
        else homeTeam = oppRef;
      }
    }

    let status: BracketNode['status'] = 'pre';
    let commenceTime: string | undefined;
    let espnId: string | undefined;
    let homeEspn: { score?: number; winner?: boolean } | undefined;
    let awayEspn: { score?: number; winner?: boolean } | undefined;

    if (matched && homeTeam && awayTeam) {
      usedIds.add(matched.id);
      status = matched.status;
      commenceTime = matched.commenceTime;
      espnId = matched.id;
      const { homeNorm, awayNorm } = espnSides(matched);
      const scoreFor = (norm: string) =>
        norm === homeNorm ? matched!.homeScore : norm === awayNorm ? matched!.awayScore : undefined;
      const adv = advancedNorm(matched, homeNorm, awayNorm);
      homeEspn = { score: scoreFor(homeTeam.norm), winner: adv === homeTeam.norm };
      awayEspn = { score: scoreFor(awayTeam.norm), winner: adv === awayTeam.norm };
      if (adv) {
        const winRef = adv === homeTeam.norm ? homeTeam : awayTeam;
        const loseRef = adv === homeTeam.norm ? awayTeam : homeTeam;
        winnerOf.set(tpl.match, winRef);
        loserOf.set(tpl.match, loseRef);
      }
    }

    const decided = winnerOf.has(tpl.match);
    nodes.push({
      match: tpl.match,
      round: tpl.round,
      home: buildSide(homeTeam, homeR.placeholder, homeEspn),
      away: buildSide(awayTeam, awayR.placeholder, awayEspn),
      status,
      commenceTime,
      espnId,
      decided,
    });
  }

  // ── 4. 冠军 + 未匹配场次(观测用,不静默丢弃)──
  const champ = winnerOf.get(104);
  const unmapped = matches
    .filter((m) => !usedIds.has(m.id))
    .map((m) => ({ id: m.id, homeTeam: m.homeTeam, awayTeam: m.awayTeam }));

  return {
    computedAt: now,
    nodes,
    champion: champ ? { norm: champ.norm, name: champ.name, logo: champ.logo } : undefined,
    unmapped,
  };
}
